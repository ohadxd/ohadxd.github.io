import {
  generateImageCallable,
  getDownloadGeneratedImageUrl,
  getSeatMapCallable,
  getStudentCreationsCallable,
  joinActivityCallable,
  leaveActivityCallable,
  restoreActivityCallable,
  setRealtimeClientConfig,
  subscribeSeatMap,
  validatePromptStepsCallable
} from "/js/functions-client.js?v=20260308-gallery-1";

const STORAGE_SESSION_KEY = "funlab-prompt-lab-session";
const STORAGE_DRAFT_KEY = "funlab-prompt-lab-draft";
const AUTOSAVE_DELAY_MS = 1400;
const SEAT_POLL_MS = 30000;

const joinForm = document.getElementById("joinForm");
const joinButton = document.getElementById("joinButton");
const leaveSeatButton = document.getElementById("leaveSeatButton");
const refreshSeatsButton = document.getElementById("refreshSeatsButton");
const validateButton = document.getElementById("validateButton");
const generateButton = document.getElementById("generateButton");
const clearButton = document.getElementById("clearButton");
const statusBox = document.getElementById("statusBox");
const statusTitle = document.getElementById("statusTitle");
const statusText = document.getElementById("statusText");
const missingList = document.getElementById("missingList");
const activityCard = document.getElementById("activityCard");
const resultCard = document.getElementById("resultCard");
const studentGalleryCard = document.getElementById("studentGalleryCard");
const studentGalleryGrid = document.getElementById("studentGalleryGrid");
const studentGalleryEmpty = document.getElementById("studentGalleryEmpty");
const sessionBadge = document.getElementById("sessionBadge");
const remainingBadge = document.getElementById("remainingBadge");
const selectedSeatBadge = document.getElementById("selectedSeatBadge");
const seatStatusText = document.getElementById("seatStatusText");
const seatBoard = document.getElementById("seatBoard");
const imagePreview = document.getElementById("imagePreview");
const downloadImageButton = document.getElementById("downloadImageButton");
const savedImageNote = document.getElementById("savedImageNote");
const finalPromptOutput = document.getElementById("finalPromptOutput");
const classCodeInput = document.getElementById("classCode");
const studentNameInput = document.getElementById("studentName");
const stepInputs = Array.from(document.querySelectorAll("[data-step-key]"));
const exampleButtons = Array.from(document.querySelectorAll("[data-fill-target]"));

const emptySteps = {
  character: "",
  place: "",
  action: "",
  style: "",
  detail: ""
};

const state = {
  sessionId: "",
  classCode: "",
  studentName: "",
  seatNumber: 0,
  selectedSeatNumber: 0,
  remainingGenerations: 0,
  seatMap: [],
  generationHistory: [],
  autosaveTimer: null,
  seatPollTimer: null,
  publicSeatMapId: "",
  seatRealtimeUnsubscribe: null,
  featuredUsageId: ""
};

function normalizeClassCode(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase()
    .slice(0, 24);
}

function collectSteps() {
  return stepInputs.reduce((steps, input) => {
    steps[input.dataset.stepKey] = input.value.trim();
    return steps;
  }, {});
}

function buildHebrewPromptPreview(steps) {
  return [
    `דמות ראשית: ${steps.character || "-"}`,
    `מקום או סביבה: ${steps.place || "-"}`,
    `מה קורה בתמונה: ${steps.action || "-"}`,
    `סגנון חזותי: ${steps.style || "-"}`,
    `פרט מיוחד: ${steps.detail || "-"}`
  ].join("\n");
}

function buildCreationFilename(creation) {
  const seatLabel = String(state.seatNumber || creation?.seatNumber || "00").padStart(2, "0");
  const generationLabel = String(creation?.generationIndex || 0).padStart(2, "0");
  return `funlab-seat-${seatLabel}-gen-${generationLabel || "00"}.png`;
}

function getCreationPreviewUrl(creation) {
  return creation?.imageDataUrl || creation?.imagePreviewUrl || "";
}

function buildCreationSummary(creation) {
  if (creation?.finalPromptHebrew) {
    return creation.finalPromptHebrew;
  }

  return buildHebrewPromptPreview(creation?.stepSnapshot || emptySteps);
}

function resetGalleryState() {
  state.generationHistory = [];
  state.featuredUsageId = "";
  studentGalleryGrid.innerHTML = "";
  studentGalleryCard.hidden = true;
  studentGalleryEmpty.hidden = true;
}

function fillSteps(steps = emptySteps) {
  for (const input of stepInputs) {
    input.value = steps[input.dataset.stepKey] || "";
  }
}

function readStorage(key) {
  try {
    const rawValue = window.localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch (error) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Ignore storage failures and keep the activity usable.
  }
}

function removeStorage(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    // Ignore storage failures and keep the activity usable.
  }
}

function persistSessionState() {
  if (!state.sessionId) {
    removeStorage(STORAGE_SESSION_KEY);
    return;
  }

  writeStorage(STORAGE_SESSION_KEY, {
    sessionId: state.sessionId,
    classCode: state.classCode,
    studentName: state.studentName,
    seatNumber: state.seatNumber
  });
}

function persistDraftState() {
  const classCode = normalizeClassCode(classCodeInput.value);

  if (!classCode) {
    removeStorage(STORAGE_DRAFT_KEY);
    return;
  }

  writeStorage(STORAGE_DRAFT_KEY, {
    classCode,
    seatNumber: state.selectedSeatNumber || state.seatNumber || 0,
    steps: collectSteps()
  });
}

function setButtonState(button, isBusy, idleText, busyText) {
  button.disabled = isBusy;
  button.textContent = isBusy ? busyText : idleText;
}

function updateJoinButtonAvailability() {
  const hasCode = Boolean(normalizeClassCode(classCodeInput.value));
  joinButton.disabled = !hasCode || !state.selectedSeatNumber || Boolean(state.sessionId);
}

function showStatus(kind, title, message, missingSteps = []) {
  statusBox.hidden = false;
  statusBox.className = `callout ${kind}`;
  statusTitle.textContent = title;
  statusText.textContent = message;
  missingList.innerHTML = "";

  for (const step of missingSteps) {
    const item = document.createElement("span");
    item.className = "pill";
    item.textContent = step.label;
    missingList.appendChild(item);
  }
}

function enableActivity() {
  activityCard.hidden = false;
  validateButton.disabled = false;
  generateButton.disabled = false;
}

function resetResults() {
  resultCard.hidden = true;
  imagePreview.removeAttribute("src");
  downloadImageButton.hidden = true;
  downloadImageButton.removeAttribute("href");
  downloadImageButton.removeAttribute("download");
  delete downloadImageButton.dataset.downloadMode;
  savedImageNote.hidden = true;
  savedImageNote.textContent = "";
  finalPromptOutput.textContent = "";
}

function showCreationAsMainResult(creation) {
  const previewUrl = getCreationPreviewUrl(creation);

  if (!previewUrl) {
    return;
  }

  state.featuredUsageId = creation.usageId || "";
  imagePreview.src = previewUrl;

  if (creation.usageId && creation.imageStoragePath) {
    downloadImageButton.href = getDownloadGeneratedImageUrl(
      creation.usageId,
      buildCreationFilename(creation)
    );
    downloadImageButton.dataset.downloadMode = "server";
    downloadImageButton.removeAttribute("download");
  } else {
    downloadImageButton.href = previewUrl;
    downloadImageButton.dataset.downloadMode = "client";
    downloadImageButton.setAttribute("download", buildCreationFilename(creation));
  }

  downloadImageButton.hidden = false;
  savedImageNote.textContent = creation.imageStoragePath
    ? "התמונה נשמרה בענן ותישאר זמינה גם אחרי רענון."
    : "התמונה זמינה כרגע מהעמוד הזה.";
  savedImageNote.hidden = false;
  finalPromptOutput.textContent = buildCreationSummary(creation);
  resultCard.hidden = false;
  renderGenerationGallery();
}

function renderGenerationGallery() {
  studentGalleryGrid.innerHTML = "";

  if (!state.sessionId) {
    studentGalleryCard.hidden = true;
    studentGalleryEmpty.hidden = true;
    return;
  }

  if (!state.generationHistory.length) {
    studentGalleryCard.hidden = false;
    studentGalleryEmpty.hidden = false;
    return;
  }

  studentGalleryCard.hidden = false;
  studentGalleryEmpty.hidden = true;

  for (const creation of state.generationHistory) {
    const card = document.createElement("article");
    const title = document.createElement("div");
    const meta = document.createElement("div");
    const head = document.createElement("div");
    const preview = document.createElement("img");
    const copy = document.createElement("div");
    const actions = document.createElement("div");
    const showButton = document.createElement("button");
    const downloadLink = document.createElement("a");
    const isActive = creation.usageId && creation.usageId === state.featuredUsageId;

    card.className = `gallery-card${isActive ? " is-active" : ""}`;
    head.className = "gallery-card-head";
    title.className = "gallery-card-title";
    meta.className = "gallery-card-meta";
    copy.className = "gallery-card-copy";
    actions.className = "gallery-card-actions";

    title.textContent = `יצירה ${creation.generationIndex || "?"}`;
    meta.textContent = creation.createdAtMs
      ? new Date(creation.createdAtMs).toLocaleTimeString("he-IL", {
          hour: "2-digit",
          minute: "2-digit"
        })
      : "נשמרה עכשיו";
    preview.src = getCreationPreviewUrl(creation);
    preview.alt = `תצוגה מקדימה של יצירה ${creation.generationIndex || ""}`;
    copy.textContent = buildCreationSummary(creation);

    showButton.type = "button";
    showButton.className = "btn-ghost";
    showButton.textContent = isActive ? "מוצגת עכשיו" : "להציג בגדול";
    showButton.disabled = isActive;
    showButton.addEventListener("click", () => {
      showCreationAsMainResult(creation);
    });

    downloadLink.className = "btn-primary";
    downloadLink.textContent = "הורדה";
    if (creation.usageId && creation.imageStoragePath) {
      downloadLink.href = getDownloadGeneratedImageUrl(
        creation.usageId,
        buildCreationFilename(creation)
      );
    } else {
      downloadLink.href = getCreationPreviewUrl(creation);
      downloadLink.setAttribute("download", buildCreationFilename(creation));
    }

    head.append(title, meta);
    actions.append(showButton, downloadLink);
    card.append(head, preview, copy, actions);
    studentGalleryGrid.appendChild(card);
  }
}

async function loadGenerationHistory() {
  if (!state.sessionId) {
    resetGalleryState();
    return;
  }

  try {
    const response = await getStudentCreationsCallable({
      sessionId: state.sessionId
    });
    state.generationHistory = Array.isArray(response.data?.items)
      ? response.data.items
      : [];
    renderGenerationGallery();

    if (!state.generationHistory.length) {
      return;
    }

    const featuredCreation = state.generationHistory.find(
      (creation) => creation.usageId === state.featuredUsageId
    );

    showCreationAsMainResult(featuredCreation || state.generationHistory[0]);
  } catch (error) {
    state.generationHistory = [];
    state.featuredUsageId = "";
    renderGenerationGallery();
  }
}

function updateRemainingBadge(value) {
  if (typeof value === "number") {
    state.remainingGenerations = value;
  }

  remainingBadge.textContent = `נשארו ${state.remainingGenerations} יצירות`;
}

function updateSeatBadge() {
  if (state.selectedSeatNumber) {
    selectedSeatBadge.textContent = `בחרתם מקום ${state.selectedSeatNumber}`;
    return;
  }

  selectedSeatBadge.textContent = "עדיין לא בחרתם מקום";
}

function setJoinLocked(isLocked) {
  classCodeInput.readOnly = isLocked;
  studentNameInput.readOnly = isLocked;
  refreshSeatsButton.disabled = isLocked;
  leaveSeatButton.hidden = !isLocked;
  updateJoinButtonAvailability();
}

function stopSeatRealtime() {
  if (typeof state.seatRealtimeUnsubscribe === "function") {
    state.seatRealtimeUnsubscribe();
  }

  state.seatRealtimeUnsubscribe = null;
}

function renderSeatBoard(seats = []) {
  state.seatMap = seats;
  seatBoard.innerHTML = "";

  if (!seats.length) {
    seatBoard.innerHTML = '<div class="field-help">עוד אין לוח מקומות להצגה.</div>';
    return;
  }

  for (const seat of seats) {
    const seatButton = document.createElement("button");
    const isMine = state.seatNumber === seat.seatNumber && Boolean(state.sessionId);
    const isSelected = state.selectedSeatNumber === seat.seatNumber;
    const isTaken = seat.status === "taken" && !isMine;

    seatButton.type = "button";
    seatButton.className = [
      "seat-button",
      isMine ? "is-mine" : "",
      isSelected ? "is-selected" : "",
      isTaken ? "is-taken" : "is-available"
    ]
      .filter(Boolean)
      .join(" ");
    seatButton.disabled = isTaken || Boolean(state.sessionId);
    seatButton.innerHTML = `
      <span class="seat-number">${seat.seatNumber}</span>
      <span class="seat-copy">${isMine ? "שלי" : isTaken ? "תפוס" : "פנוי"}</span>
    `;

    if (!seatButton.disabled) {
      seatButton.addEventListener("click", () => {
        state.selectedSeatNumber = seat.seatNumber;
        updateSeatBadge();
        persistDraftState();
        renderSeatBoard(state.seatMap);
        updateJoinButtonAvailability();
      });
    }

    seatBoard.appendChild(seatButton);
  }
}

function startSeatPolling() {
  if (state.seatRealtimeUnsubscribe) {
    return;
  }

  window.clearInterval(state.seatPollTimer);
  state.seatPollTimer = window.setInterval(() => {
    if (document.visibilityState !== "visible") {
      return;
    }

    if (state.sessionId) {
      return;
    }

    if (!normalizeClassCode(classCodeInput.value)) {
      return;
    }

    void loadSeatMap();
  }, SEAT_POLL_MS);
}

function stopSeatPolling() {
  window.clearInterval(state.seatPollTimer);
  state.seatPollTimer = null;
}

function applySeatMapPayload(payload, { fromRealtime = false } = {}) {
  const seats = Array.isArray(payload?.seats) ? payload.seats : [];
  const availableCount = seats.filter((seat) => seat.status === "available").length;
  const previouslySelectedSeat = state.selectedSeatNumber;

  if (payload?.classCode) {
    state.classCode = payload.classCode;
  }

  if (
    state.selectedSeatNumber &&
    seats.some(
      (seat) =>
        seat.seatNumber === state.selectedSeatNumber &&
        seat.status === "taken" &&
        !(state.sessionId && state.seatNumber === state.selectedSeatNumber)
    )
  ) {
    state.selectedSeatNumber = 0;
    updateSeatBadge();
    if (!state.sessionId && previouslySelectedSeat) {
      showStatus(
        "warn",
        "המקום נתפס בינתיים",
        `מקום ${previouslySelectedSeat} כבר לא פנוי. בחרו מקום אחר בלוח.`
      );
    }
  }

  renderSeatBoard(seats);
  seatStatusText.textContent = fromRealtime
    ? `הלוח מתעדכן בזמן אמת. יש כרגע ${availableCount} מקומות פנויים.`
    : `יש כרגע ${availableCount} מקומות פנויים.`;
  updateJoinButtonAvailability();
}

function ensureSeatRealtime(payload) {
  if (!payload?.publicSeatMapId || !payload?.firebaseConfig?.apiKey) {
    startSeatPolling();
    return;
  }

  state.publicSeatMapId = payload.publicSeatMapId;
  setRealtimeClientConfig(payload.firebaseConfig);

  if (state.seatRealtimeUnsubscribe) {
    return;
  }

  state.seatRealtimeUnsubscribe = subscribeSeatMap(payload.publicSeatMapId, {
    onData: (seatMapData) => {
      applySeatMapPayload(seatMapData, { fromRealtime: true });
    },
    onError: () => {
      stopSeatRealtime();
      startSeatPolling();
    }
  });

  stopSeatPolling();
}

async function loadSeatMap({ showErrors = false } = {}) {
  const classCode = normalizeClassCode(classCodeInput.value);

  if (!classCode) {
    seatBoard.innerHTML = "";
    seatStatusText.textContent = "הקלידו קוד כיתה כדי לראות את לוח המקומות.";
    stopSeatRealtime();
    state.selectedSeatNumber = 0;
    state.publicSeatMapId = "";
    updateSeatBadge();
    updateJoinButtonAvailability();
    return;
  }

  seatStatusText.textContent = "טוען את לוח המקומות...";
  refreshSeatsButton.disabled = true;

  try {
    const response = await getSeatMapCallable({ classCode });
    const payload = response.data;
    applySeatMapPayload(payload);
    if (!state.sessionId) {
      ensureSeatRealtime(payload);
    }
  } catch (error) {
    seatBoard.innerHTML = "";
    seatStatusText.textContent = "לא הצלחתי לטעון את המקומות כרגע.";

    if (showErrors) {
      showStatus("bad", "לא נטען לוח המקומות", error.message || "נסו שוב בעוד רגע.");
    }
  } finally {
    if (!state.sessionId) {
      refreshSeatsButton.disabled = false;
    }
  }
}

function applySession(payload) {
  state.sessionId = payload.sessionId;
  state.classCode = normalizeClassCode(payload.classCode || classCodeInput.value);
  state.studentName = payload.studentName || studentNameInput.value.trim();
  state.seatNumber = Number(payload.seatNumber || state.selectedSeatNumber || 0);
  state.selectedSeatNumber = state.seatNumber;

  classCodeInput.value = state.classCode;
  studentNameInput.value = state.studentName;

  updateSeatBadge();
  updateRemainingBadge(payload.remainingGenerations);
  sessionBadge.textContent = `מקום ${state.seatNumber} | ${state.studentName}`;

  if (payload.promptSteps) {
    fillSteps(payload.promptSteps);
  }

  state.generationHistory = [];
  state.featuredUsageId = "";
  persistSessionState();
  persistDraftState();
  setJoinLocked(true);
  stopSeatPolling();
  enableActivity();
  renderGenerationGallery();
}

async function restoreSavedSession() {
  const savedSession = readStorage(STORAGE_SESSION_KEY);
  const savedDraft = readStorage(STORAGE_DRAFT_KEY);

  if (savedSession?.classCode) {
    classCodeInput.value = savedSession.classCode;
  } else if (savedDraft?.classCode) {
    classCodeInput.value = savedDraft.classCode;
  }

  if (savedSession?.studentName) {
    studentNameInput.value = savedSession.studentName;
  }

  if (savedSession?.seatNumber) {
    state.selectedSeatNumber = Number(savedSession.seatNumber);
    updateSeatBadge();
  }

  await loadSeatMap();

  if (!savedSession?.sessionId) {
    if (savedDraft?.steps) {
      fillSteps(savedDraft.steps);
    }

    return;
  }

  try {
    const response = await restoreActivityCallable({
      sessionId: savedSession.sessionId
    });
    applySession(response.data);
    await loadGenerationHistory();
    showStatus("good", "חזרתם למקום שלכם", response.data.message);
    await loadSeatMap();
  } catch (error) {
    removeStorage(STORAGE_SESSION_KEY);
    state.sessionId = "";
    state.seatNumber = 0;
    state.selectedSeatNumber = Number(savedSession.seatNumber || 0);
    resetGalleryState();
    setJoinLocked(false);
    startSeatPolling();

    if (savedDraft?.steps) {
      fillSteps(savedDraft.steps);
    }

    showStatus(
      "warn",
      "צריך לבחור מקום מחדש",
      error.message || "בחרו שוב מקום פנוי בלוח והמשיכו."
    );
    await loadSeatMap();
  }
}

function scheduleSilentDraftSave() {
  persistDraftState();

  if (!state.sessionId) {
    return;
  }

  window.clearTimeout(state.autosaveTimer);
  state.autosaveTimer = window.setTimeout(async () => {
    try {
      await validatePromptStepsCallable({
        sessionId: state.sessionId,
        steps: collectSteps()
      });
    } catch (error) {
      // Ignore autosave failures and let the manual flow continue.
    }
  }, AUTOSAVE_DELAY_MS);
}

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!state.selectedSeatNumber) {
    showStatus("warn", "צריך לבחור מקום", "בחרו מקום אחד פנוי מתוך לוח המקומות.");
    return;
  }

  resetResults();
  setButtonState(joinButton, true, "כניסה לפעילות", "מתחבר...");

  try {
    const response = await joinActivityCallable({
      classCode: classCodeInput.value,
      studentName: studentNameInput.value,
      seatNumber: state.selectedSeatNumber
    });

    applySession(response.data);
    await loadGenerationHistory();
    await loadSeatMap();
    showStatus("good", "נכנסתם בהצלחה", response.data.message);
  } catch (error) {
    showStatus(
      "bad",
      "לא הצלחנו להיכנס",
      error.message || "קרתה תקלה. נסו שוב בעוד רגע."
    );
    updateJoinButtonAvailability();
  } finally {
    if (!state.sessionId) {
      setButtonState(joinButton, false, "כניסה לפעילות", "מתחבר...");
      updateJoinButtonAvailability();
    } else {
      joinButton.textContent = "כניסה לפעילות";
    }
  }
});

validateButton.addEventListener("click", async () => {
  if (!state.sessionId) {
    showStatus("warn", "צריך להתחיל מההתחלה", "בחרו קוד כיתה, מקום ושם תלמיד.");
    return;
  }

  resetResults();
  setButtonState(validateButton, true, "בדיקת שלבים", "בודק...");

  try {
    const response = await validatePromptStepsCallable({
      sessionId: state.sessionId,
      steps: collectSteps()
    });
    const payload = response.data;

    persistDraftState();

    if (payload.isComplete) {
      showStatus("good", "הכול מוכן", payload.message);
      return;
    }

    showStatus("warn", "צריך להשלים עוד קצת", payload.message, payload.missingSteps);
  } catch (error) {
    showStatus(
      "bad",
      "הבדיקה נכשלה",
      error.message || "לא הצלחתי לבדוק את השלבים."
    );
  } finally {
    setButtonState(validateButton, false, "בדיקת שלבים", "בודק...");
  }
});

generateButton.addEventListener("click", async () => {
  if (!state.sessionId) {
    showStatus("warn", "צריך להתחיל מההתחלה", "בחרו קוד כיתה, מקום ושם תלמיד.");
    return;
  }

  setButtonState(generateButton, true, "יצירת תמונה", "יוצר...");

  try {
    const currentSteps = collectSteps();
    const response = await generateImageCallable({
      sessionId: state.sessionId,
      steps: currentSteps
    });
    const payload = response.data;

    if (!payload.didGenerate) {
      showStatus(
        "warn",
        "עדיין לא יוצרים תמונה",
        payload.message,
        payload.missingSteps || []
      );
      return;
    }

    updateRemainingBadge(payload.remainingGenerations);
    const newCreation = {
      usageId: payload.usageId || "",
      generationIndex: state.generationHistory.length + 1,
      createdAtMs: Date.now(),
      imageDataUrl: payload.imageDataUrl,
      imagePreviewUrl: payload.imageDownloadUrl || "",
      imageStoragePath: payload.imageStoragePath || "",
      finalPromptHebrew: payload.finalPromptHebrew || buildHebrewPromptPreview(currentSteps),
      stepSnapshot: currentSteps
    };

    state.generationHistory = [
      newCreation,
      ...state.generationHistory.filter((creation) => creation.usageId !== newCreation.usageId)
    ];
    showCreationAsMainResult(newCreation);
    persistDraftState();
    showStatus("good", "התמונה מוכנה", payload.message);
  } catch (error) {
    showStatus(
      "bad",
      "יצירת התמונה נכשלה",
      error.message || "לא הצלחתי ליצור תמונה כרגע."
    );
  } finally {
    setButtonState(generateButton, false, "יצירת תמונה", "יוצר...");
  }
});

downloadImageButton.addEventListener("click", (event) => {
  if (!downloadImageButton.href || downloadImageButton.href.endsWith("#")) {
    event.preventDefault();
    showStatus("bad", "אין קובץ להורדה", "נסו ליצור את התמונה מחדש.");
    return;
  }

  if (downloadImageButton.dataset.downloadMode === "server") {
    downloadImageButton.setAttribute("aria-busy", "true");
    window.setTimeout(() => {
      downloadImageButton.removeAttribute("aria-busy");
    }, 1200);
    return;
  }

  downloadImageButton.setAttribute("aria-busy", "true");
  window.setTimeout(() => {
    downloadImageButton.removeAttribute("aria-busy");
  }, 800);
});

clearButton.addEventListener("click", () => {
  fillSteps(emptySteps);
  resetResults();
  scheduleSilentDraftSave();
  showStatus("warn", "ניקינו את השלבים", "עכשיו אפשר להתחיל שוב מאותו מקום עם רעיון חדש.");
});

for (const input of stepInputs) {
  input.addEventListener("input", scheduleSilentDraftSave);
}

for (const button of exampleButtons) {
  button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.fillTarget);

    if (!target) {
      return;
    }

    target.value = button.dataset.fillValue || "";
    scheduleSilentDraftSave();
    target.focus();
  });
}

let seatLoadTimer = 0;

classCodeInput.addEventListener("input", () => {
  const currentCode = normalizeClassCode(classCodeInput.value);

  if (!state.sessionId) {
    stopSeatRealtime();
    state.publicSeatMapId = "";
    state.selectedSeatNumber = 0;
    updateSeatBadge();
  }

  window.clearTimeout(seatLoadTimer);
  seatLoadTimer = window.setTimeout(() => {
    void loadSeatMap();
  }, 450);

  if (!currentCode) {
    seatBoard.innerHTML = "";
  }

  updateJoinButtonAvailability();
});

classCodeInput.addEventListener("blur", () => {
  void loadSeatMap({ showErrors: true });
});

refreshSeatsButton.addEventListener("click", () => {
  void loadSeatMap({ showErrors: true });
});

leaveSeatButton.addEventListener("click", async () => {
  if (!state.sessionId) {
    return;
  }

  leaveSeatButton.disabled = true;

  try {
    await leaveActivityCallable({ sessionId: state.sessionId });
  } catch (error) {
    showStatus("bad", "לא הצלחנו לקום מהמקום", error.message || "נסו שוב בעוד רגע.");
    leaveSeatButton.disabled = false;
    return;
  }

  state.sessionId = "";
  state.studentName = "";
  state.seatNumber = 0;
  state.selectedSeatNumber = 0;
  resetGalleryState();
  updateSeatBadge();
  sessionBadge.textContent = "עדיין לא התחברתם";
  updateRemainingBadge(0);
  setJoinLocked(false);
  leaveSeatButton.disabled = false;
  activityCard.hidden = true;
  resetResults();
  removeStorage(STORAGE_SESSION_KEY);
  removeStorage(STORAGE_DRAFT_KEY);
  fillSteps(emptySteps);
  showStatus("good", "קמתם מהמקום", "המקום שוחרר. אפשר לבחור מקום חדש בלוח.");
  startSeatPolling();
  void loadSeatMap();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !state.sessionId) {
    void loadSeatMap();
  }
});

updateSeatBadge();
updateRemainingBadge(0);
startSeatPolling();
void restoreSavedSession();
