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

const ENGLISH_STEP_TRANSLATION_INSTRUCTION = [
  "You translate validated Hebrew image-building fields into short natural English phrases.",
  "Translate faithfully from Hebrew to English.",
  "Return strict JSON only.",
  "Keep each value concise and faithful to the source.",
  "Do not merge fields together.",
  "Do not add extra ideas.",
  "Do not leave any Hebrew words in the response.",
  "Keys must be exactly: character, place, action, style, detail."
].join(" ");

const ENGLISH_STEP_TRANSLATION_SCHEMA = {
  type: "object",
  properties: {
    character: { type: "string" },
    place: { type: "string" },
    action: { type: "string" },
    style: { type: "string" },
    detail: { type: "string" }
  },
  required: ["character", "place", "action", "style", "detail"],
  additionalProperties: false
};

module.exports = {
  ACTIVITY_CONFIG,
  ENGLISH_STEP_TRANSLATION_SCHEMA,
  ENGLISH_STEP_TRANSLATION_INSTRUCTION,
  REQUIRED_STEPS,
  REQUIRED_STEP_KEYS
};
