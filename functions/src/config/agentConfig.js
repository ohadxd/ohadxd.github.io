"use strict";

const REQUIRED_STEPS = [
  {
    key: "character",
    label: "דמות ראשית",
    shortLabel: "דמות",
    placeholder: "למשל: חתול סקרן",
    missingMessage: "עוד לא בחרת דמות ראשית. כתבו מי מופיע בתמונה."
  },
  {
    key: "place",
    label: "מקום",
    shortLabel: "מקום",
    placeholder: "למשל: יער קסום",
    missingMessage: "עוד לא בחרת מקום. כתבו איפה הסיפור קורה."
  },
  {
    key: "action",
    label: "פעולה",
    shortLabel: "פעולה",
    placeholder: "למשל: קופץ מעל שלולית",
    missingMessage: "עוד לא כתבת פעולה. כתבו מה הדמות עושה."
  },
  {
    key: "style",
    label: "סגנון חזותי",
    shortLabel: "סגנון",
    placeholder: "למשל: איור צבעוני לילדים",
    missingMessage: "עוד לא בחרת סגנון חזותי. כתבו איך התמונה צריכה להיראות."
  },
  {
    key: "detail",
    label: "פרט מיוחד",
    shortLabel: "פרט מיוחד",
    placeholder: "למשל: כובע עם כוכבים זוהרים",
    missingMessage: "עוד לא הוספת פרט מיוחד. כתבו משהו קטן ומעניין שישלים את התמונה."
  }
];

const REQUIRED_STEP_KEYS = REQUIRED_STEPS.map((step) => step.key);

const ACTIVITY_CONFIG = {
  activitySlug: "ai-prompt-lab",
  activityTitle: "מעבדת פרומפטים",
  region: "europe-west1",
  textModel: "gemini-2.5-flash",
  imageModel: "gemini-2.5-flash-image",
  defaultGenerationsPerStudent: 3,
  maxStepLength: 160,
  maxNameLength: 40,
  welcomeMessage:
    "איזה יופי, הצטרפתם לפעילות. עכשיו נבנה פרומפט חכם צעד אחרי צעד.",
  readyMessage:
    "מעולה. כל חמשת השלבים מלאים, ואפשר להכין פרומפט מסודר לתמונה.",
  missingPrefix:
    "כדי ליצור תמונה צריך להשלים קודם את כל השלבים:",
  generationSuccess:
    "כל הכבוד. בניתם פרומפט מלא, ושלחתי אותו ליצירת התמונה.",
  limitReached:
    "הגעתם למספר יצירות התמונה המותר לפעילות הזאת. בקשו מהמורה לפתוח עוד ניסיונות.",
  invalidClassCode:
    "קוד הכיתה לא נמצא או לא פעיל כרגע. בדקו עם המורה ונסו שוב.",
  expiredClassCode:
    "קוד הכיתה הזה כבר לא פעיל. בקשו מהמורה קוד חדש.",
  sessionNotFound:
    "לא מצאתי את הסשן של התלמיד. התחילו מחדש עם קוד הכיתה.",
  childSafeTone:
    "דברו בעברית פשוטה, קצרה ומעודדת שמתאימה לתלמידי כיתות ה-ו."
};

const ENGLISH_PROMPT_SYSTEM_INSTRUCTION = [
  "You build image prompts for children in a tightly controlled educational activity.",
  "Input arrives as validated Hebrew step values.",
  "Return exactly one clean English image prompt for an image model.",
  "Do not ask questions.",
  "Do not explain your reasoning.",
  "Do not add safety policy text.",
  "Keep the prompt visually rich, child-friendly, and faithful to the five supplied steps.",
  "Mention all five parts: character, place, action, visual style, special detail.",
  "Output only the final English prompt."
].join(" ");

module.exports = {
  ACTIVITY_CONFIG,
  ENGLISH_PROMPT_SYSTEM_INSTRUCTION,
  REQUIRED_STEPS,
  REQUIRED_STEP_KEYS
};
