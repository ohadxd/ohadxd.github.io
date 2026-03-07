import {
  generateImageCallable,
  joinActivityCallable,
  validatePromptStepsCallable
} from "/js/functions-client.js";

const joinForm = document.getElementById("joinForm");
const joinButton = document.getElementById("joinButton");
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
const imagePreview = document.getElementById("imagePreview");
const finalPromptOutput = document.getElementById("finalPromptOutput");
const classCodeInput = document.getElementById("classCode");
const studentNameInput = document.getElementById("studentName");
const stepInputs = Array.from(document.querySelectorAll("[data-step-key]"));

const state = {
  sessionId: "",
  remainingGenerations: 0
};

function collectSteps() {
  return stepInputs.reduce((steps, input) => {
    steps[input.dataset.stepKey] = input.value.trim();
    return steps;
  }, {});
}

function setButtonState(button, isBusy, idleText, busyText) {
  button.disabled = isBusy;
  button.textContent = isBusy ? busyText : idleText;
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

function updateRemainingBadge(value) {
  if (typeof value === "number") {
    state.remainingGenerations = value;
  }

  remainingBadge.textContent = `נשארו ${state.remainingGenerations} יצירות`;
}

function resetResults() {
  resultCard.hidden = true;
  imagePreview.removeAttribute("src");
  finalPromptOutput.textContent = "";
}

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  resetResults();
  setButtonState(joinButton, true, "כניסה לפעילות", "מתחבר...");

  try {
    const response = await joinActivityCallable({
      classCode: classCodeInput.value,
      studentName: studentNameInput.value
    });
    const payload = response.data;

    state.sessionId = payload.sessionId;
    updateRemainingBadge(payload.remainingGenerations);
    sessionBadge.textContent = `סשן פעיל: ${payload.studentName}`;
    enableActivity();
    showStatus("good", "נכנסתם בהצלחה", payload.message);
  } catch (error) {
    showStatus(
      "bad",
      "לא הצלחנו להיכנס",
      error.message || "קרתה תקלה. נסו שוב בעוד רגע."
    );
  } finally {
    setButtonState(joinButton, false, "כניסה לפעילות", "מתחבר...");
  }
});

validateButton.addEventListener("click", async () => {
  if (!state.sessionId) {
    showStatus("warn", "צריך להתחיל מההתחלה", "הזינו קודם קוד כיתה ושם תלמיד.");
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
    showStatus("warn", "צריך להתחיל מההתחלה", "הזינו קודם קוד כיתה ושם תלמיד.");
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
        payload.isComplete ? "warn" : "warn",
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
  for (const input of stepInputs) {
    input.value = "";
  }

  resetResults();
  showStatus(
    "warn",
    "ניקינו את השלבים",
    "אפשר להתחיל מחדש ולבנות פרומפט חדש צעד אחרי צעד."
  );
});
