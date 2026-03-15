"use strict";

const LESSON_DEFINITIONS = {
  "image-lab": {
    key: "image-lab",
    title: "בונים תמונה",
    shortTitle: "תמונה",
    description: "בונים רעיון לתמונה אחת ב-5 שלבים קבועים.",
    generationLimit: 6,
    generateButtonLabel: "יצירת תמונה",
    steps: [
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
    ]
  },
  "comic-lab": {
    key: "comic-lab",
    title: "יוצרים קומיקס",
    shortTitle: "קומיקס",
    description: "יוצרים סדרת פאנלים עם אותן דמויות קבועות לאורך כל הקומיקס.",
    generationLimit: 15,
    generateButtonLabel: "יצירת פאנל קומיקס",
    steps: [
      {
        key: "character",
        label: "דמויות קבועות",
        shortLabel: "דמויות",
        placeholder: "למשל: מאיה ילדה עם שיער מתולתל וטי-שירט צהובה, ורובוט כחול קטן בשם ריבו",
        missingMessage: "עוד לא בחרת את הדמויות הקבועות. כתבו מי יופיע שוב ושוב בקומיקס."
      },
      {
        key: "place",
        label: "מה קורה בפאנל",
        shortLabel: "פאנל",
        placeholder: "למשל: מאיה וריבו עומדים מול דלת סודית בבית הספר",
        missingMessage: "עוד לא כתבת מה קורה בפאנל הזה. כתבו מה רואים עכשיו."
      },
      {
        key: "action",
        label: "מה כל דמות אומרת",
        shortLabel: "דיבור",
        placeholder: "למשל: מאיה אומרת: מצאנו את הדלת! ריבו אומר: אני סורק עכשיו",
        missingMessage: "עוד לא כתבת מה הדמויות אומרות. כתבו משפט קצר לכל דמות."
      },
      {
        key: "style",
        label: "סגנון הקומיקס",
        shortLabel: "סגנון",
        placeholder: "למשל: קומיקס צבעוני לילדים עם קווים נקיים",
        missingMessage: "עוד לא בחרת סגנון קומיקס. כתבו איך הקומיקס צריך להיראות."
      },
      {
        key: "detail",
        label: "איך שומרים על עקביות",
        shortLabel: "עקביות",
        placeholder: "למשל: מאיה תמיד עם חולצה צהובה, וריבו תמיד כחול עם עיניים ירוקות",
        missingMessage: "עוד לא כתבת איך לשמור על עקביות. כתבו מה חייב להישאר אותו דבר בכל פאנל."
      }
    ]
  }
};

const DEFAULT_LESSON_KEY = "image-lab";
const REQUIRED_STEPS = LESSON_DEFINITIONS[DEFAULT_LESSON_KEY].steps;
const REQUIRED_STEP_KEYS = REQUIRED_STEPS.map((step) => step.key);

const ACTIVITY_CONFIG = {
  activitySlug: "ai-prompt-lab",
  activityTitle: "מעבדת פרומפטים",
  region: "europe-west1",
  imageModel: "gemini-2.5-flash-image",
  textModel: "gemini-2.5-flash",
  adminConfigCollection: "adminConfig",
  adminConfigDocId: "promptLab",
  firebaseWebApp: {
    appId: "1:56393078768:web:0f6c29d78a6dcdb4516f35",
    authDomain: "groovetech-9a3fb.firebaseapp.com",
    databaseURL: "https://groovetech-9a3fb-default-rtdb.europe-west1.firebasedatabase.app",
    measurementId: "G-8VF8CVG3L0",
    messagingSenderId: "56393078768",
    projectId: "groovetech-9a3fb",
    storageBucket: "groovetech-9a3fb.firebasestorage.app"
  },
  defaultGenerationsPerStudent: LESSON_DEFINITIONS[DEFAULT_LESSON_KEY].generationLimit,
  comicGenerationsPerStudent: LESSON_DEFINITIONS["comic-lab"].generationLimit,
  defaultSeatCount: 25,
  seatClaimMinutes: 120,
  maxStepLength: 220,
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
    "דברו בעברית פשוטה, קצרה ומעודדת שמתאימה לתלמידי כיתות ה-ו.",
  supportedProviders: [
    { value: "gemini", label: "Gemini" },
    { value: "openai", label: "OpenAI" }
  ],
  providerModelCatalog: {
    gemini: [
      { value: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image" },
      { value: "imagen-4.0-generate-001", label: "Imagen 4" },
      { value: "imagen-4.0-fast-generate-001", label: "Imagen 4 Fast" },
      { value: "imagen-4.0-ultra-generate-001", label: "Imagen 4 Ultra" },
      { value: "imagen-3.0-generate-002", label: "Imagen 3" }
    ],
    openai: [
      { value: "gpt-image-1.5", label: "GPT Image 1.5" },
      { value: "gpt-image-1", label: "GPT Image 1" },
      { value: "gpt-image-1-mini", label: "GPT Image 1 Mini" }
    ]
  },
  adminPromptLabDefaults: {
    activeProvider: "gemini",
    geminiImageModel: "gemini-2.5-flash-image",
    geminiAspectRatio: "1:1",
    geminiImageSize: "1K",
    geminiGuidanceScale: 5,
    openAiImageModel: "gpt-image-1.5",
    openAiImageQuality: "medium",
    openAiImageSize: "1024x1024",
    googleBillingProjectId: "groovetech-9a3fb",
    googleBillingLocation: "US",
    googleBillingDataset: "",
    googleBillingTable: "",
    spendLookbackDays: 14
  },
  englishTranslationInstruction: [
    "Translate the student's five prompt-building steps from Hebrew into natural, child-safe English.",
    "Return valid JSON only with exactly these keys: character, place, action, style, detail.",
    "Keep each value short, vivid, and suitable for an image model.",
    "Do not add explanations, markdown, numbering, or extra keys.",
    "Do not leave Hebrew text in the output."
  ].join(" "),
  imagePromptGuardrailsEnglish: [
    "Child-safe and classroom-friendly.",
    "Clear anatomy.",
    "No extra limbs.",
    "No extra fingers.",
    "No duplicated body parts.",
    "No deformed hands.",
    "No cropped face.",
    "No text, letters, watermark, or logo unless requested.",
    "Clear subject separation and coherent composition."
  ].join(" "),
  comicConsistencyInstructionEnglish: [
    "This is part of a comic series.",
    "Keep the recurring characters consistent across every panel.",
    "Keep the same face shape, hairstyle, clothing colors, accessories, body proportions, and overall visual identity in every new panel.",
    "Use clear comic-panel framing and readable speech-bubble placement."
  ].join(" "),
  imageNegativePromptEnglish: [
    "extra limbs",
    "extra fingers",
    "duplicated body parts",
    "deformed hands",
    "cropped face",
    "unreadable text",
    "watermark",
    "logo"
  ].join(", ")
};

module.exports = {
  ACTIVITY_CONFIG,
  DEFAULT_LESSON_KEY,
  LESSON_DEFINITIONS,
  REQUIRED_STEPS,
  REQUIRED_STEP_KEYS
};
