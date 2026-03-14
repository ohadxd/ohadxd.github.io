import {
  adminGetPromptLabSettingsCallable,
  adminGetSpendReportCallable,
  adminListClassesCallable,
  adminLoginCallable,
  adminLogoutCallable,
  adminSavePromptLabSettingsCallable,
  adminSetClassActiveCallable,
  adminUpsertClassCallable
} from "/js/functions-client.js?v=20260314-admin-2";

const STORAGE_KEY = "funlab-admin-session";

const loginForm = document.getElementById("adminLoginForm");
const loginButton = document.getElementById("adminLoginButton");
const logoutButton = document.getElementById("adminLogoutButton");
const usernameInput = document.getElementById("adminUsername");
const passwordInput = document.getElementById("adminPassword");
const sessionBadge = document.getElementById("adminSessionBadge");
const statusCard = document.getElementById("adminStatusCard");
const statusBox = document.getElementById("adminStatusBox");
const statusTitle = document.getElementById("adminStatusTitle");
const statusText = document.getElementById("adminStatusText");
const controlsCard = document.getElementById("adminControlsCard");
const providerSettingsCard = document.getElementById("providerSettingsCard");
const spendReportCard = document.getElementById("spendReportCard");
const classListCard = document.getElementById("classListCard");
const classGrid = document.getElementById("adminClassGrid");
const refreshButton = document.getElementById("refreshAdminClassesButton");
const refreshPromptLabSettingsButton = document.getElementById("refreshPromptLabSettingsButton");
const refreshSpendReportButton = document.getElementById("refreshSpendReportButton");
const createClassForm = document.getElementById("createClassForm");
const createClassButton = document.getElementById("createClassButton");
const newClassCodeInput = document.getElementById("newClassCode");
const newClassLabelInput = document.getElementById("newClassLabel");
const newClassSeatsInput = document.getElementById("newClassSeats");
const newClassLimitInput = document.getElementById("newClassLimit");
const promptLabSettingsForm = document.getElementById("promptLabSettingsForm");
const savePromptLabSettingsButton = document.getElementById("savePromptLabSettingsButton");
const activeProviderSelect = document.getElementById("activeProviderSelect");
const geminiImageModelSelect = document.getElementById("geminiImageModelSelect");
const openAiImageModelSelect = document.getElementById("openAiImageModelSelect");
const openAiImageQualitySelect = document.getElementById("openAiImageQualitySelect");
const openAiImageSizeSelect = document.getElementById("openAiImageSizeSelect");
const geminiAspectRatioSelect = document.getElementById("geminiAspectRatioSelect");
const geminiImageSizeSelect = document.getElementById("geminiImageSizeSelect");
const geminiGuidanceScaleInput = document.getElementById("geminiGuidanceScaleInput");
const providerStatusPills = document.getElementById("providerStatusPills");
const billingSettingsForm = document.getElementById("billingSettingsForm");
const saveBillingSettingsButton = document.getElementById("saveBillingSettingsButton");
const googleBillingProjectInput = document.getElementById("googleBillingProjectInput");
const googleBillingLocationSelect = document.getElementById("googleBillingLocationSelect");
const googleBillingDatasetInput = document.getElementById("googleBillingDatasetInput");
const googleBillingTableInput = document.getElementById("googleBillingTableInput");
const spendLookbackDaysInput = document.getElementById("spendLookbackDaysInput");
const spendMetricGrid = document.getElementById("spendMetricGrid");
const spendNotesBox = document.getElementById("spendNotesBox");
const spendNotesText = document.getElementById("spendNotesText");
const spendReportBody = document.getElementById("spendReportBody");

const state = {
  sessionToken: "",
  username: "",
  items: [],
  settings: null,
  providerStatus: null,
  providerCatalog: {
    gemini: [],
    openai: []
  },
  supportedProviders: [],
  spendRows: [],
  spendTotals: null
};

function readStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function writeStorage(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch (error) {
    // Ignore storage failures.
  }
}

function clearStorage() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    // Ignore storage failures.
  }
}

function setBusy(button, isBusy, idleText, busyText) {
  button.disabled = isBusy;
  button.textContent = isBusy ? busyText : idleText;
}

function showStatus(kind, title, message) {
  statusCard.hidden = false;
  statusBox.className = `callout ${kind}`;
  statusTitle.textContent = title;
  statusText.textContent = message;
}

function clearSelectOptions(selectElement, placeholder = "") {
  selectElement.innerHTML = "";

  if (placeholder) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholder;
    selectElement.appendChild(option);
  }
}

function fillSelectOptions(selectElement, items = []) {
  clearSelectOptions(selectElement);

  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    selectElement.appendChild(option);
  }
}

function setLoggedOutUi() {
  state.sessionToken = "";
  state.username = "";
  state.items = [];
  state.settings = null;
  state.providerStatus = null;
  state.spendRows = [];
  state.spendTotals = null;
  sessionBadge.textContent = "לא מחוברים";
  logoutButton.hidden = true;
  controlsCard.hidden = true;
  providerSettingsCard.hidden = true;
  spendReportCard.hidden = true;
  classListCard.hidden = true;
  classGrid.innerHTML = "";
  providerStatusPills.innerHTML = "";
  spendMetricGrid.innerHTML = "";
  spendReportBody.innerHTML = "";
  spendNotesBox.hidden = true;
}

function setLoggedInUi() {
  sessionBadge.textContent = `מחובר: ${state.username}`;
  logoutButton.hidden = false;
  controlsCard.hidden = false;
  providerSettingsCard.hidden = false;
  spendReportCard.hidden = false;
  classListCard.hidden = false;
}

function buildClassCard(item) {
  const article = document.createElement("article");
  const head = document.createElement("div");
  const title = document.createElement("div");
  const meta = document.createElement("div");
  const stats = document.createElement("div");
  const toggleButton = document.createElement("button");

  article.className = "admin-class-card";
  head.className = "gallery-card-head";
  title.className = "gallery-card-title";
  meta.className = "gallery-card-meta";
  stats.className = "admin-class-stats";

  title.textContent = item.code;
  meta.textContent = item.label || "ללא תיאור";
  stats.innerHTML = [
    `<span class="pill">${item.isActive ? "פתוחה" : "סגורה"}</span>`,
    `<span class="pill">${item.seatCount} מקומות</span>`,
    `<span class="pill">${item.allowedGenerationsPerStudent} יצירות</span>`,
    `<span class="pill">${item.totalGenerations || 0} יצירות בפועל</span>`
  ].join("");

  toggleButton.type = "button";
  toggleButton.className = item.isActive ? "btn-secondary" : "btn-primary";
  toggleButton.textContent = item.isActive ? "סגירת כיתה" : "פתיחת כיתה";
  toggleButton.addEventListener("click", async () => {
    setBusy(toggleButton, true, toggleButton.textContent, "שומר...");

    try {
      const response = await adminSetClassActiveCallable({
        sessionToken: state.sessionToken,
        classCode: item.code,
        isActive: !item.isActive
      });
      replaceClassItem(response.data.item);
      showStatus(
        "good",
        "עודכן",
        `${response.data.item.code} ${response.data.item.isActive ? "נפתחה" : "נסגרה"}.`
      );
    } catch (error) {
      showStatus("bad", "העדכון נכשל", error.message || "נסו שוב בעוד רגע.");
    } finally {
      renderClassGrid();
    }
  });

  head.append(title, meta);
  article.append(head, stats, toggleButton);
  return article;
}

function replaceClassItem(updatedItem) {
  const nextItems = state.items.filter((item) => item.code !== updatedItem.code);
  nextItems.push(updatedItem);
  state.items = nextItems.sort((left, right) => left.code.localeCompare(right.code, "en"));
}

function renderClassGrid() {
  classGrid.innerHTML = "";

  if (!state.items.length) {
    classGrid.innerHTML = '<div class="gallery-empty">עדיין אין קודי כיתה להצגה.</div>';
    return;
  }

  for (const item of state.items) {
    classGrid.appendChild(buildClassCard(item));
  }
}

function renderProviderStatus(status = {}) {
  providerStatusPills.innerHTML = "";
  const pills = [
    {
      label: status.geminiKeyConfigured ? "Gemini key מחובר" : "Gemini key חסר",
      good: status.geminiKeyConfigured
    },
    {
      label: status.openAiKeyConfigured ? "OpenAI key מחובר" : "OpenAI key חסר",
      good: status.openAiKeyConfigured
    },
    {
      label: status.googleBillingConfigured ? "Google Billing מחובר" : "Google Billing לא הוגדר",
      good: status.googleBillingConfigured
    }
  ];

  for (const pillData of pills) {
    const pill = document.createElement("span");
    pill.className = `pill ${pillData.good ? "pill-good" : "pill-warn"}`;
    pill.textContent = pillData.label;
    providerStatusPills.appendChild(pill);
  }
}

function renderSpendMetrics(totals) {
  spendMetricGrid.innerHTML = "";

  if (!totals) {
    spendMetricGrid.innerHTML = '<div class="gallery-empty">עדיין אין נתוני עלות להצגה.</div>';
    return;
  }

  const metrics = [
    { label: "OpenAI USD", value: totals.openAiUsd.toFixed(4) },
    { label: "Google USD", value: totals.googleUsd.toFixed(4) },
    { label: "סה״כ USD", value: totals.totalUsd.toFixed(4) },
    { label: "OpenAI Images", value: String(totals.openAiImages || 0) }
  ];

  for (const metric of metrics) {
    const card = document.createElement("div");
    const key = document.createElement("div");
    const value = document.createElement("div");
    card.className = "admin-metric-card";
    key.className = "admin-metric-key";
    value.className = "admin-metric-value";
    key.textContent = metric.label;
    value.textContent = metric.value;
    card.append(key, value);
    spendMetricGrid.appendChild(card);
  }
}

function renderSpendNotes(notes = {}) {
  const messages = [];

  if (notes.openAiError) {
    messages.push(`OpenAI: ${notes.openAiError}`);
  }

  if (notes.googleNeedsSetup) {
    messages.push("Google Billing: צריך להגדיר Billing Export ל-BigQuery כדי לראות חיוב מדויק.");
  } else if (notes.googleError) {
    messages.push(`Google Billing: ${notes.googleError}`);
  }

  if (!messages.length) {
    spendNotesBox.hidden = true;
    spendNotesText.textContent = "";
    return;
  }

  spendNotesBox.hidden = false;
  spendNotesText.textContent = messages.join(" | ");
}

function renderSpendRows(rows = []) {
  spendReportBody.innerHTML = "";

  if (!rows.length) {
    spendReportBody.innerHTML =
      '<tr><td colspan="5" class="admin-table-empty">עדיין אין נתוני עלות.</td></tr>';
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.day}</td>
      <td>${Number(row.openAiUsd || 0).toFixed(4)}</td>
      <td>${Number(row.openAiImages || 0)}</td>
      <td>${Number(row.googleUsd || 0).toFixed(4)}</td>
      <td>${Number(row.totalUsd || 0).toFixed(4)}</td>
    `;
    spendReportBody.appendChild(tr);
  }
}

function getSettingsFromForms() {
  return {
    ...(state.settings || {}),
    activeProvider: activeProviderSelect.value || "gemini",
    geminiImageModel: geminiImageModelSelect.value || "",
    geminiAspectRatio: geminiAspectRatioSelect.value || "1:1",
    geminiImageSize: geminiImageSizeSelect.value || "1K",
    geminiGuidanceScale: Number(geminiGuidanceScaleInput.value),
    openAiImageModel: openAiImageModelSelect.value || "",
    openAiImageQuality: openAiImageQualitySelect.value || "medium",
    openAiImageSize: openAiImageSizeSelect.value || "1024x1024",
    googleBillingProjectId: googleBillingProjectInput.value.trim(),
    googleBillingLocation: googleBillingLocationSelect.value || "US",
    googleBillingDataset: googleBillingDatasetInput.value.trim(),
    googleBillingTable: googleBillingTableInput.value.trim(),
    spendLookbackDays: Number(spendLookbackDaysInput.value)
  };
}

function applySettingsToForms(settings) {
  if (!settings) {
    return;
  }

  activeProviderSelect.value = settings.activeProvider || "gemini";
  geminiImageModelSelect.value = settings.geminiImageModel || "";
  geminiAspectRatioSelect.value = settings.geminiAspectRatio || "1:1";
  geminiImageSizeSelect.value = settings.geminiImageSize || "1K";
  geminiGuidanceScaleInput.value = String(settings.geminiGuidanceScale ?? 5);
  openAiImageModelSelect.value = settings.openAiImageModel || "";
  openAiImageQualitySelect.value = settings.openAiImageQuality || "medium";
  openAiImageSizeSelect.value = settings.openAiImageSize || "1024x1024";
  googleBillingProjectInput.value = settings.googleBillingProjectId || "";
  googleBillingLocationSelect.value = settings.googleBillingLocation || "US";
  googleBillingDatasetInput.value = settings.googleBillingDataset || "";
  googleBillingTableInput.value = settings.googleBillingTable || "";
  spendLookbackDaysInput.value = String(settings.spendLookbackDays || 14);
}

function applyCatalogToForms() {
  fillSelectOptions(activeProviderSelect, state.supportedProviders);
  fillSelectOptions(geminiImageModelSelect, state.providerCatalog.gemini || []);
  fillSelectOptions(openAiImageModelSelect, state.providerCatalog.openai || []);
}

async function loadClasses() {
  const response = await adminListClassesCallable({
    sessionToken: state.sessionToken
  });
  state.items = Array.isArray(response.data?.items) ? response.data.items : [];
  renderClassGrid();
}

async function loadPromptLabSettings() {
  const response = await adminGetPromptLabSettingsCallable({
    sessionToken: state.sessionToken
  });
  state.settings = response.data?.settings || null;
  state.providerStatus = response.data?.providerStatus || null;
  state.providerCatalog = response.data?.providerModelCatalog || state.providerCatalog;
  state.supportedProviders = response.data?.supportedProviders || state.supportedProviders;
  applyCatalogToForms();
  applySettingsToForms(state.settings);
  renderProviderStatus(state.providerStatus);
}

async function loadSpendReport() {
  const response = await adminGetSpendReportCallable({
    sessionToken: state.sessionToken,
    days: Number(spendLookbackDaysInput.value || state.settings?.spendLookbackDays || 14)
  });
  state.spendRows = Array.isArray(response.data?.rows) ? response.data.rows : [];
  state.spendTotals = response.data?.totals || null;
  renderSpendMetrics(state.spendTotals);
  renderSpendRows(state.spendRows);
  renderSpendNotes(response.data?.notes || {});
  renderProviderStatus(response.data?.providerStatus || state.providerStatus || {});
}

async function loadAdminScreen() {
  await Promise.all([loadClasses(), loadPromptLabSettings()]);
  await loadSpendReport();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(loginButton, true, "כניסה", "נכנס...");

  try {
    const response = await adminLoginCallable({
      username: usernameInput.value,
      password: passwordInput.value
    });
    state.sessionToken = response.data.sessionToken;
    state.username = response.data.username;
    writeStorage({
      sessionToken: state.sessionToken,
      username: state.username
    });
    passwordInput.value = "";
    setLoggedInUi();
    await loadAdminScreen();
    showStatus("good", "התחברת בהצלחה", "מסך הניהול מוכן.");
  } catch (error) {
    setLoggedOutUi();
    clearStorage();
    showStatus("bad", "ההתחברות נכשלה", error.message || "בדקו שם משתמש וסיסמה.");
  } finally {
    setBusy(loginButton, false, "כניסה", "נכנס...");
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    if (state.sessionToken) {
      await adminLogoutCallable({
        sessionToken: state.sessionToken
      });
    }
  } catch (error) {
    // Ignore logout failures and clear local state anyway.
  }

  clearStorage();
  setLoggedOutUi();
  showStatus("warn", "התנתקת", "סשן הניהול נסגר.");
});

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;

  try {
    await loadClasses();
    showStatus("good", "הרשימה התעדכנה", "כל קודי הכיתה נטענו מחדש.");
  } catch (error) {
    showStatus("bad", "הרענון נכשל", error.message || "נסו שוב בעוד רגע.");
  } finally {
    refreshButton.disabled = false;
  }
});

refreshPromptLabSettingsButton.addEventListener("click", async () => {
  refreshPromptLabSettingsButton.disabled = true;

  try {
    await loadPromptLabSettings();
    showStatus("good", "הגדרות ה-AI עודכנו", "הספקים והמודלים נטענו מחדש.");
  } catch (error) {
    showStatus("bad", "הרענון נכשל", error.message || "נסו שוב בעוד רגע.");
  } finally {
    refreshPromptLabSettingsButton.disabled = false;
  }
});

refreshSpendReportButton.addEventListener("click", async () => {
  refreshSpendReportButton.disabled = true;

  try {
    await loadSpendReport();
    showStatus("good", "העלויות עודכנו", "דו״ח העלויות נטען מחדש.");
  } catch (error) {
    showStatus("bad", "טעינת העלויות נכשלה", error.message || "נסו שוב בעוד רגע.");
  } finally {
    refreshSpendReportButton.disabled = false;
  }
});

createClassForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(createClassButton, true, "יצירת קוד כיתה", "יוצר...");

  try {
    const response = await adminUpsertClassCallable({
      sessionToken: state.sessionToken,
      classCode: newClassCodeInput.value,
      label: newClassLabelInput.value,
      seatCount: Number(newClassSeatsInput.value),
      allowedGenerationsPerStudent: Number(newClassLimitInput.value),
      isActive: true
    });
    replaceClassItem(response.data.item);
    renderClassGrid();
    createClassForm.reset();
    newClassSeatsInput.value = "25";
    newClassLimitInput.value = "6";
    showStatus("good", "נוצר קוד כיתה", `${response.data.item.code} מוכן לשימוש.`);
  } catch (error) {
    showStatus("bad", "לא נוצר קוד כיתה", error.message || "בדקו את הנתונים ונסו שוב.");
  } finally {
    setBusy(createClassButton, false, "יצירת קוד כיתה", "יוצר...");
  }
});

promptLabSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(savePromptLabSettingsButton, true, "שמירת הגדרות AI", "שומר...");

  try {
    const response = await adminSavePromptLabSettingsCallable({
      sessionToken: state.sessionToken,
      settings: getSettingsFromForms()
    });
    state.settings = response.data?.settings || state.settings;
    applySettingsToForms(state.settings);
    await loadSpendReport();
    showStatus("good", "הגדרות ה-AI נשמרו", "הספק והמודלים עודכנו.");
  } catch (error) {
    showStatus("bad", "השמירה נכשלה", error.message || "בדקו את ההגדרות ונסו שוב.");
  } finally {
    setBusy(savePromptLabSettingsButton, false, "שמירת הגדרות AI", "שומר...");
  }
});

billingSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(saveBillingSettingsButton, true, "שמירת הגדרות עלויות", "שומר...");

  try {
    const response = await adminSavePromptLabSettingsCallable({
      sessionToken: state.sessionToken,
      settings: getSettingsFromForms()
    });
    state.settings = response.data?.settings || state.settings;
    applySettingsToForms(state.settings);
    await loadSpendReport();
    showStatus("good", "הגדרות העלויות נשמרו", "חיבורי ה-Billing עודכנו.");
  } catch (error) {
    showStatus("bad", "השמירה נכשלה", error.message || "בדקו את פרטי ה-BigQuery ונסו שוב.");
  } finally {
    setBusy(saveBillingSettingsButton, false, "שמירת הגדרות עלויות", "שומר...");
  }
});

async function restoreAdminSession() {
  const savedSession = readStorage();

  if (!savedSession?.sessionToken) {
    setLoggedOutUi();
    return;
  }

  state.sessionToken = String(savedSession.sessionToken);
  state.username = String(savedSession.username || "admin");
  setLoggedInUi();

  try {
    await loadAdminScreen();
    showStatus("good", "חזרתם לניהול", "סשן הניהול שוחזר.");
  } catch (error) {
    clearStorage();
    setLoggedOutUi();
    showStatus("warn", "צריך להתחבר מחדש", error.message || "סשן הניהול כבר לא תקף.");
  }
}

setLoggedOutUi();
showStatus("warn", "מוכנים", "התחברו כדי לפתוח או לסגור כיתות ולנהל ספקי AI.");
void restoreAdminSession();
