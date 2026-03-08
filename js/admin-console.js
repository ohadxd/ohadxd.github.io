import {
  adminListClassesCallable,
  adminLoginCallable,
  adminLogoutCallable,
  adminSetClassActiveCallable,
  adminUpsertClassCallable
} from "/js/functions-client.js?v=20260308-admin-1";

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
const classListCard = document.getElementById("classListCard");
const classGrid = document.getElementById("adminClassGrid");
const refreshButton = document.getElementById("refreshAdminClassesButton");
const createClassForm = document.getElementById("createClassForm");
const createClassButton = document.getElementById("createClassButton");
const newClassCodeInput = document.getElementById("newClassCode");
const newClassLabelInput = document.getElementById("newClassLabel");
const newClassSeatsInput = document.getElementById("newClassSeats");
const newClassLimitInput = document.getElementById("newClassLimit");

const state = {
  sessionToken: "",
  username: "",
  items: []
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

function setLoggedOutUi() {
  state.sessionToken = "";
  state.username = "";
  state.items = [];
  sessionBadge.textContent = "לא מחוברים";
  logoutButton.hidden = true;
  controlsCard.hidden = true;
  classListCard.hidden = true;
  classGrid.innerHTML = "";
}

function setLoggedInUi() {
  sessionBadge.textContent = `מחובר: ${state.username}`;
  logoutButton.hidden = false;
  controlsCard.hidden = false;
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

async function loadClasses() {
  const response = await adminListClassesCallable({
    sessionToken: state.sessionToken
  });
  state.items = Array.isArray(response.data?.items) ? response.data.items : [];
  renderClassGrid();
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
    await loadClasses();
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
    await loadClasses();
    showStatus("good", "חזרתם לניהול", "סשן הניהול שוחזר.");
  } catch (error) {
    clearStorage();
    setLoggedOutUi();
    showStatus("warn", "צריך להתחבר מחדש", error.message || "סשן הניהול כבר לא תקף.");
  }
}

setLoggedOutUi();
showStatus("warn", "מוכנים", "התחברו כדי לפתוח או לסגור כיתות.");
void restoreAdminSession();
