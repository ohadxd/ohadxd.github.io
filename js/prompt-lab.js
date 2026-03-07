import {
  generateImageCallable,
  getSeatMapCallable,
  joinActivityCallable,
  restoreActivityCallable,
  validatePromptStepsCallable
} from "/js/functions-client.js";

const STORAGE_SESSION_KEY = "funlab-prompt-lab-session";
const STORAGE_DRAFT_KEY = "funlab-prompt-lab-draft";
const AUTOSAVE_DELAY_MS = 1400;

const joinForm = document.getElementById("joinForm");
const joinButton = document.getElementById("joinButton");
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
const sessionBadge = document.getElementById("sessionBadge");
const remainingBadge = document.getElementById("remainingBadge");
const selectedSeatBadge = document.getElementById("selectedSeatBadge");
const seatStatusText = document.getElementById("seatStatusText");
const seatBoard = document.getElementById("seatBoard");
const imagePreview = document.getElementById("imagePreview");
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
  autosaveTimer: null
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
  finalPromptOutput.textContent = "";
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
  updateJoinButtonAvailability();
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

async function loadSeatMap({ showErrors = false } = {}) {
  const classCode = normalizeClassCode(classCodeInput.value);

  if (!classCode) {
    seatBoard.innerHTML = "";
    seatStatusText.textContent = "הקלידו קוד כיתה כדי לראות את לוח המקומות.";
    state.selectedSeatNumber = 0;
    updateSeatBadge();
    updateJoinButtonAvailability();
    return;
  }

  seatStatusText.textContent = "טוען את לוח המקומות...";
  refreshSeatsButton.disabled = true;

  try {
    const response = await getSeatMapCallable({ classCode });
    const payload = response.data;
    const availableCount = payload.seats.filter((seat) => seat.status === "available").length;

    state.classCode = payload.classCode;

    if (
      state.selectedSeatNumber &&
      payload.seats.some(
        (seat) =>
          seat.seatNumber === state.selectedSeatNumber &&
          seat.status === "taken" &&
          !(state.sessionId && state.seatNumber === state.selectedSeatNumber)
      )
    ) {
      state.selectedSeatNumber = 0;
      updateSeatBadge();
    }

    renderSeatBoard(payload.seats);
    seatStatusText.textContent = `יש כרגע ${availableCount} מקומות פנויים.`;
    updateJoinButtonAvailability();
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

  persistSessionState();
  persistDraftState();
  setJoinLocked(true);
  enableActivity();
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
    showStatus("good", "חזרתם למקום שלכם", response.data.message);
    await loadSeatMap();
  } catch (error) {
    removeStorage(STORAGE_SESSION_KEY);
    state.sessionId = "";
    state.seatNumber = 0;
    state.selectedSeatNumber = Number(savedSession.seatNumber || 0);
    setJoinLocked(false);

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
    const response = await generateImageCallable({
      sessionId: state.sessionId,
      steps: collectSteps()
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
    imagePreview.src = payload.imageDataUrl;
    finalPromptOutput.textContent = payload.finalPromptEnglish;
    resultCard.hidden = false;
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

updateSeatBadge();
updateRemainingBadge(0);
void restoreSavedSession();
