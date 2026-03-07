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
  imageModel: "gemini-2.5-flash-image",
  firebaseWebApp: {
    appId: "1:56393078768:web:0f6c29d78a6dcdb4516f35",
    authDomain: "groovetech-9a3fb.firebaseapp.com",
    databaseURL: "https://groovetech-9a3fb-default-rtdb.europe-west1.firebasedatabase.app",
    measurementId: "G-8VF8CVG3L0",
    messagingSenderId: "56393078768",
    projectId: "groovetech-9a3fb",
    storageBucket: "groovetech-9a3fb.firebasestorage.app"
  },
  defaultGenerationsPerStudent: 6,
  defaultSeatCount: 25,
  seatClaimMinutes: 120,
  maxStepLength: 160,
  maxNameLength: 40,
  welcomeMessage:
    "איזה יופי, הצטרפתם לפעילות. עכשיו נבנה פרומפט חכם צעד אחרי צעד.",
  resumeMessage:
    "חזרתם למקום שלכם. הפרומפט שלכם נשמר ואפשר להמשיך מאיפה שעצרתם.",
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
  invalidSeatNumber:
    "בחרו מקום אחד פנוי מתוך הלוח לפני הכניסה לפעילות.",
  seatTaken:
    "המקום הזה כבר תפוס. בחרו מקום אחר בלוח.",
  seatRestoreFailed:
    "לא הצלחתי לשחזר את המקום שלכם. בחרו שוב מקום פנוי.",
  childSafeTone:
    "דברו בעברית פשוטה, קצרה ומעודדת שמתאימה לתלמידי כיתות ה-ו."
};

module.exports = {
  ACTIVITY_CONFIG,
  REQUIRED_STEPS,
  REQUIRED_STEP_KEYS
};
