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
} from "/js/functions-client.js?v=20260315-comic-2";

const STORAGE_SESSION_KEY = "funlab-prompt-lab-session";
const STORAGE_DRAFT_KEY = "funlab-prompt-lab-draft";
const AUTOSAVE_DELAY_MS = 1400;
const SEAT_POLL_MS = 30000;
const DEFAULT_LESSON_KEY = "image-lab";
const COMIC_VISIBLE_SEAT_COUNT = 15;
const COMIC_MAX_BUBBLES = 4;
const COMIC_DIALOGUE_MAX_CHARS = 84;
const COMIC_SPEAKER_MAX_CHARS = 26;
const COMIC_DOWNLOAD_WIDTH = 1600;
const COMIC_DIALOGUE_VERB_PATTERN =
  "(?:אומר(?:ת|ים|ות)?|שואל(?:ת|ים|ות)?|צועק(?:ת|ים|ות)?|לוחש(?:ת|ים|ות)?|עונה(?:ים|ות)?|קורא(?:ת|ים|ות)?|חושב(?:ת|ים|ות)?)";
const COMIC_DIALOGUE_REGEX = new RegExp(
  `([^:\\n,.!?]{1,32}?)\\s+${COMIC_DIALOGUE_VERB_PATTERN}\\s*:\\s*(.+?)(?=(?:\\s+[^:\\n,.!?]{1,32}?\\s+${COMIC_DIALOGUE_VERB_PATTERN}\\s*:)|$)`,
  "g"
);
const COMIC_LAYOUTS = {
  1: [{ left: 0.57, top: 0.06, width: 0.33, minHeight: 0.16, tail: "right" }],
  2: [
    { left: 0.08, top: 0.07, width: 0.32, minHeight: 0.16, tail: "left" },
    { left: 0.57, top: 0.07, width: 0.32, minHeight: 0.16, tail: "right" }
  ],
  3: [
    { left: 0.08, top: 0.07, width: 0.3, minHeight: 0.15, tail: "left" },
    { left: 0.6, top: 0.08, width: 0.28, minHeight: 0.15, tail: "right" },
    { left: 0.57, top: 0.69, width: 0.31, minHeight: 0.16, tail: "right" }
  ],
  4: [
    { left: 0.07, top: 0.07, width: 0.29, minHeight: 0.15, tail: "left" },
    { left: 0.62, top: 0.08, width: 0.25, minHeight: 0.15, tail: "right" },
    { left: 0.58, top: 0.66, width: 0.3, minHeight: 0.16, tail: "right" },
    { left: 0.08, top: 0.68, width: 0.28, minHeight: 0.15, tail: "left" }
  ]
};

const LESSON_DEFINITIONS = {
  "image-lab": {
    key: "image-lab",
    leadText: "במסלול הזה בונים תמונה אחת ב-5 שלבים קבועים.",
    activityHeading: "בונים את הפרומפט",
    activityIntro: "ממלאים את כל 5 השלבים ואז יוצרים תמונה.",
    generateButtonLabel: "יצירת תמונה",
    emptyGalleryText: "עדיין אין כאן יצירות. כשתיצרו תמונה ראשונה, היא תופיע כאן ותישמר להשוואה.",
    quickItems: [
      "1. בוחרים דמות ראשית.",
      "2. מוסיפים מקום או סביבה.",
      "3. כותבים מה הדמות עושה.",
      "4. בוחרים סגנון חזותי.",
      "5. מוסיפים פרט מיוחד קטן ומעניין."
    ],
    guardrailText:
      "המערכת לא מאפשרת בקשה חופשית לתמונה. היא בודקת שיש כל השלבים ורק אז יוצרת.",
    steps: {
      character: {
        label: "1. דמות ראשית",
        placeholder: "למשל: רובוט קטן וחברותי",
        help: "מי הדמות שמופיעה בתמונה?",
        examples: [
          "רובוט קטן וחברותי",
          "כלבה אמיצה עם צעיף אדום",
          "ילדה סקרנית עם משקפיים עגולים",
          "דרקון ירוק חמוד ולא מפחיד"
        ]
      },
      place: {
        label: "2. מקום / סביבה",
        placeholder: "למשל: גן משחקים עתידני",
        help: "איפה הסיפור קורה?",
        examples: [
          "גן משחקים עתידני",
          "יער קסום עם שביל זוהר",
          "כיתה צבעונית ביום גשם",
          "חוף ים עם עפיפונים בשמיים"
        ]
      },
      action: {
        label: "3. פעולה",
        placeholder: "למשל: מחזיק בלון ומחייך",
        help: "מה הדמות עושה ממש עכשיו?",
        examples: [
          "מחזיק בלון ומחייך",
          "רצה אחרי עפיפון צבעוני",
          "מגלה דלת סודית קטנה",
          "שומר על חתלתול שנרטב"
        ]
      },
      style: {
        label: "4. סגנון חזותי",
        placeholder: "למשל: איור ספר ילדים צבעוני",
        help: "איך התמונה צריכה להיראות?",
        examples: [
          "איור ספר ילדים צבעוני",
          "קומיקס בהיר עם קווים נקיים",
          "תלת ממד חמוד ורך",
          "ציור ריאליסטי עדין ומפורט"
        ]
      },
      detail: {
        label: "5. פרט מיוחד",
        placeholder: "למשל: תיק עם כוכבים זוהרים",
        help: "איזה פרט קטן יעשה את התמונה מיוחדת?",
        examples: [
          "תיק עם כוכבים זוהרים",
          "לב קטן שמאיר בחושך",
          "טיפות גשם נוצצות באוויר",
          "כובע צהוב עם סמל של ברק"
        ]
      }
    }
  },
  "comic-lab": {
    key: "comic-lab",
    leadText:
      "במסלול הזה יוצרים סדרת פאנלים לקומיקס. אותן דמויות נשארות קבועות, כל תלמיד מקבל עד 10 פאנלים, ופתוחים עד 15 מקומות.",
    activityHeading: "יוצרים פאנל קומיקס",
    activityIntro: "מגדירים את הדמויות הקבועות, כותבים מה קורה בפאנל ומה כל דמות אומרת, והמערכת מוסיפה בועות דיבור מקצועיות.",
    generateButtonLabel: "יצירת פאנל קומיקס",
    emptyGalleryText: "עדיין אין כאן פאנלים. כשתיצרו את הפאנל הראשון, כל הקומיקס שלכם יישמר כאן להשוואה.",
    quickItems: [
      "1. בוחרים את הדמויות שחוזרות בכל הקומיקס.",
      "2. כותבים מה קורה בפאנל הזה.",
      "3. כותבים מה כל דמות אומרת.",
      "4. בוחרים סגנון קומיקס קבוע.",
      "5. מזכירים מה חייב להישאר אותו דבר בכל פאנל."
    ],
    guardrailText:
      "מאחורי הקלעים המערכת שומרת על אותן דמויות לאורך כל הסדרה, ומוסיפה אחר כך בועות דיבור ברורות בעברית כדי שהקומיקס ייראה מקצועי.",
    steps: {
      character: {
        label: "1. דמויות קבועות",
        placeholder: "למשל: מאיה עם חולצה צהובה ורובוט כחול קטן בשם ריבו",
        help: "מי הדמויות שיחזרו שוב ושוב בקומיקס?",
        examples: [
          "מאיה עם חולצה צהובה ורובוט כחול קטן בשם ריבו",
          "שני אחים תאומים וחתול ג׳ינג׳י שובב",
          "בלשית צעירה וינשוף חכם עם משקפיים",
          "ילד גולש ודרקון כיס ירוק"
        ]
      },
      place: {
        label: "2. מה קורה בפאנל",
        placeholder: "למשל: מאיה וריבו מגלים דלת סודית במסדרון בית הספר",
        help: "מה רואים עכשיו בפאנל הזה?",
        examples: [
          "מאיה וריבו מגלים דלת סודית במסדרון בית הספר",
          "הינשוף מצביע על מפה ישנה בספרייה",
          "החתול קופץ על קופסה מסתורית בגג",
          "הילד והדרקון עוצרים מול גל ענק"
        ]
      },
      action: {
        label: "3. מה כל דמות אומרת",
        placeholder: "למשל: מאיה אומרת: מצאנו אותה! ריבו אומר: אני סורק עכשיו",
        help: "כתבו משפט קצר לכל דמות שרואים בפאנל.",
        examples: [
          "מאיה אומרת: מצאנו אותה! ריבו אומר: אני סורק עכשיו",
          "הינשוף אומר: עקבו אחרי הסימנים. הבלשית אומרת: אני רושמת הכול",
          "החתול אומר: מיאו, יש כאן משהו! התאום אומר: תפתחי בזהירות",
          "הדרקון אומר: אני רואה את הדרך. הילד אומר: קדימה, בוא נזוז"
        ]
      },
      style: {
        label: "4. סגנון הקומיקס",
        placeholder: "למשל: קומיקס צבעוני לילדים עם קווים נקיים",
        help: "איך כל הקומיקס צריך להיראות?",
        examples: [
          "קומיקס צבעוני לילדים עם קווים נקיים",
          "קומיקס הרפתקאות בהיר עם בועות דיבור ברורות",
          "קומיקס מצחיק עם הבעות פנים גדולות",
          "איור קומיקס רך כמו ספר ילדים"
        ]
      },
      detail: {
        label: "5. מה חייב להישאר קבוע",
        placeholder: "למשל: מאיה תמיד עם חולצה צהובה וריבו תמיד כחול עם עיניים ירוקות",
        help: "איזה פרטים אסור שישתנו בין הפאנלים?",
        examples: [
          "מאיה תמיד עם חולצה צהובה וריבו תמיד כחול עם עיניים ירוקות",
          "הינשוף תמיד עם משקפיים והבלשית תמיד עם מחברת אדומה",
          "לחתול תמיד יש קולר זהב ולתאומים תמיד אותם בגדים",
          "הדרקון תמיד קטן וירוק והילד תמיד עם קסדה כתומה"
        ]
      }
    }
  }
};

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
const resultVisualStage = document.getElementById("resultVisualStage");
const imagePreview = document.getElementById("imagePreview");
const resultComicOverlay = document.getElementById("resultComicOverlay");
const downloadImageButton = document.getElementById("downloadImageButton");
const savedImageNote = document.getElementById("savedImageNote");
const finalPromptOutput = document.getElementById("finalPromptOutput");
const classCodeInput = document.getElementById("classCode");
const studentNameInput = document.getElementById("studentName");
const seedInput = document.getElementById("seedInput");
const lessonLeadText = document.getElementById("lessonLeadText");
const lessonGuardrailText = document.getElementById("lessonGuardrailText");
const activityHeading = document.getElementById("activityHeading");
const activityIntro = document.getElementById("activityIntro");
const lessonQuickItems = [1, 2, 3, 4, 5].map((index) =>
  document.getElementById(`lessonQuick${index}`)
);
const lessonChooserButtons = Array.from(
  document.querySelectorAll("#lessonChooser [data-lesson-key]")
);
const stepFieldRefs = {
  character: {
    input: document.getElementById("stepCharacter"),
    label: document.getElementById("stepCharacterLabel"),
    help: document.getElementById("stepCharacterHelp"),
    examples: document.getElementById("stepCharacterExamples")
  },
  place: {
    input: document.getElementById("stepPlace"),
    label: document.getElementById("stepPlaceLabel"),
    help: document.getElementById("stepPlaceHelp"),
    examples: document.getElementById("stepPlaceExamples")
  },
  action: {
    input: document.getElementById("stepAction"),
    label: document.getElementById("stepActionLabel"),
    help: document.getElementById("stepActionHelp"),
    examples: document.getElementById("stepActionExamples")
  },
  style: {
    input: document.getElementById("stepStyle"),
    label: document.getElementById("stepStyleLabel"),
    help: document.getElementById("stepStyleHelp"),
    examples: document.getElementById("stepStyleExamples")
  },
  detail: {
    input: document.getElementById("stepDetail"),
    label: document.getElementById("stepDetailLabel"),
    help: document.getElementById("stepDetailHelp"),
    examples: document.getElementById("stepDetailExamples")
  }
};
const stepInputs = Object.values(stepFieldRefs).map((field) => field.input);

const state = {
  sessionId: "",
  classCode: "",
  studentName: "",
  lessonKey: DEFAULT_LESSON_KEY,
  seatNumber: 0,
  selectedSeatNumber: 0,
  remainingGenerations: 0,
  seatMap: [],
  generationHistory: [],
  autosaveTimer: null,
  seatPollTimer: null,
  publicSeatMapId: "",
  seatRealtimeUnsubscribe: null,
  featuredUsageId: "",
  currentSeed: null
};

function normalizeClassCode(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase()
    .slice(0, 24);
}

function normalizeLessonKey(value) {
  const lessonKey = String(value || "").trim();
  return LESSON_DEFINITIONS[lessonKey] ? lessonKey : DEFAULT_LESSON_KEY;
}

function getLessonDefinition(lessonKey) {
  return LESSON_DEFINITIONS[normalizeLessonKey(lessonKey)];
}

function buildEmptySteps(lessonKey = DEFAULT_LESSON_KEY) {
  return Object.keys(getLessonDefinition(lessonKey).steps).reduce((steps, stepKey) => {
    steps[stepKey] = "";
    return steps;
  }, {});
}

function collectSteps() {
  return stepInputs.reduce((steps, input) => {
    steps[input.dataset.stepKey] = input.value.trim();
    return steps;
  }, {});
}

function buildHebrewPromptPreview(steps, lessonKey = state.lessonKey) {
  if (normalizeLessonKey(lessonKey) === "comic-lab") {
    return [
      `דמויות קבועות: ${steps.character || "-"}`,
      `מה קורה בפאנל: ${steps.place || "-"}`,
      `מה הדמויות אומרות: ${steps.action || "-"}`,
      `סגנון הקומיקס: ${steps.style || "-"}`,
      `חוקי עקביות: ${steps.detail || "-"}`
    ].join("\n");
  }

  return [
    `דמות ראשית: ${steps.character || "-"}`,
    `מקום או סביבה: ${steps.place || "-"}`,
    `מה קורה בתמונה: ${steps.action || "-"}`,
    `סגנון חזותי: ${steps.style || "-"}`,
    `פרט מיוחד: ${steps.detail || "-"}`
  ].join("\n");
}

function normalizeSeed(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericSeed = Number(value);

  if (!Number.isInteger(numericSeed) || numericSeed < 0 || numericSeed > 2147483647) {
    return null;
  }

  return numericSeed;
}

function buildCreationFilename(creation) {
  const seatLabel = String(state.seatNumber || creation?.seatNumber || "00").padStart(2, "0");
  const generationLabel = String(creation?.generationIndex || 0).padStart(2, "0");
  const lessonLabel = normalizeLessonKey(creation?.lessonKey || state.lessonKey) === "comic-lab"
    ? "comic"
    : "image";
  return `funlab-${lessonLabel}-seat-${seatLabel}-gen-${generationLabel || "00"}.png`;
}

function getCreationPreviewUrl(creation) {
  return creation?.imageDataUrl || creation?.imagePreviewUrl || "";
}

function buildCreationSummary(creation) {
  if (creation?.finalPromptHebrew) {
    return creation.finalPromptHebrew;
  }

  return buildHebrewPromptPreview(
    creation?.stepSnapshot || buildEmptySteps(creation?.lessonKey),
    creation?.lessonKey || state.lessonKey
  );
}

function isComicLesson(lessonKey = state.lessonKey) {
  return normalizeLessonKey(lessonKey) === "comic-lab";
}

function isComicCreation(creation) {
  return isComicLesson(creation?.lessonKey || state.lessonKey);
}

function getVisibleSeatLimit() {
  return isComicLesson() ? COMIC_VISIBLE_SEAT_COUNT : Number.POSITIVE_INFINITY;
}

function getVisibleSeats(seats = state.seatMap) {
  const limit = getVisibleSeatLimit();
  return Array.isArray(seats) ? seats.filter((seat) => Number(seat?.seatNumber || 0) <= limit) : [];
}

function sanitizeDialogueChunk(value, maxLength) {
  return String(value || "")
    .replace(/[\u200E\u200F]+/g, "")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function parseComicDialogue(rawDialogue) {
  const source = sanitizeDialogueChunk(rawDialogue, 420);
  const entries = [];

  if (!source) {
    return entries;
  }

  COMIC_DIALOGUE_REGEX.lastIndex = 0;

  for (const match of source.matchAll(COMIC_DIALOGUE_REGEX)) {
    const speaker = sanitizeDialogueChunk(match[1], COMIC_SPEAKER_MAX_CHARS);
    const text = sanitizeDialogueChunk(match[2], COMIC_DIALOGUE_MAX_CHARS);

    if (speaker && text) {
      entries.push({ speaker, text });
    }
  }

  if (entries.length) {
    return entries.slice(0, COMIC_MAX_BUBBLES);
  }

  const simpleParts = source
    .split(/\n+|[;|]+/g)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of simpleParts) {
    const namedMatch = part.match(/^([^:]{1,32})\s*:\s*(.+)$/);

    if (namedMatch) {
      entries.push({
        speaker: sanitizeDialogueChunk(namedMatch[1], COMIC_SPEAKER_MAX_CHARS),
        text: sanitizeDialogueChunk(namedMatch[2], COMIC_DIALOGUE_MAX_CHARS)
      });
      continue;
    }

    entries.push({
      speaker: "",
      text: sanitizeDialogueChunk(part, COMIC_DIALOGUE_MAX_CHARS)
    });
  }

  if (!entries.length) {
    entries.push({
      speaker: "",
      text: sanitizeDialogueChunk(source, COMIC_DIALOGUE_MAX_CHARS)
    });
  }

  if (entries.length <= COMIC_MAX_BUBBLES) {
    return entries;
  }

  const limitedEntries = entries.slice(0, COMIC_MAX_BUBBLES);
  const overflowText = entries
    .slice(COMIC_MAX_BUBBLES - 1)
    .map((entry) => `${entry.speaker ? `${entry.speaker}: ` : ""}${entry.text}`)
    .join(" | ");

  limitedEntries[COMIC_MAX_BUBBLES - 1] = {
    speaker: limitedEntries[COMIC_MAX_BUBBLES - 1].speaker,
    text: sanitizeDialogueChunk(overflowText, COMIC_DIALOGUE_MAX_CHARS)
  };

  return limitedEntries;
}

function buildComicBubbleLayout(entries) {
  const safeEntries = entries.slice(0, COMIC_MAX_BUBBLES);
  const layout = COMIC_LAYOUTS[safeEntries.length] || COMIC_LAYOUTS[COMIC_MAX_BUBBLES];

  return safeEntries.map((entry, index) => ({
    ...layout[index],
    speaker: entry.speaker,
    text: entry.text
  }));
}

function clearComicOverlay(container) {
  if (!container) {
    return;
  }

  container.innerHTML = "";
  container.hidden = true;
}

function renderComicOverlay(container, creation) {
  if (!container) {
    return;
  }

  clearComicOverlay(container);

  if (!isComicCreation(creation)) {
    return;
  }

  const dialogueEntries = parseComicDialogue(creation?.stepSnapshot?.action || "");

  if (!dialogueEntries.length) {
    return;
  }

  const bubbles = buildComicBubbleLayout(dialogueEntries);

  for (const bubble of bubbles) {
    const bubbleElement = document.createElement("div");
    const speaker = document.createElement("div");
    const text = document.createElement("div");

    bubbleElement.className = `comic-bubble tail-${bubble.tail}`;
    bubbleElement.style.left = `${bubble.left * 100}%`;
    bubbleElement.style.top = `${bubble.top * 100}%`;
    bubbleElement.style.width = `${bubble.width * 100}%`;
    bubbleElement.style.minHeight = `${bubble.minHeight * 100}%`;

    if (bubble.speaker) {
      speaker.className = "comic-bubble-speaker";
      speaker.textContent = bubble.speaker;
      bubbleElement.appendChild(speaker);
    }

    text.className = "comic-bubble-text";
    text.textContent = bubble.text;
    bubbleElement.appendChild(text);
    container.appendChild(bubbleElement);
  }

  container.hidden = false;
}

function renderCreationVisual(stageElement, imageElement, overlayElement, creation) {
  if (!stageElement || !imageElement) {
    return;
  }

  const previewUrl = getCreationPreviewUrl(creation);

  if (!previewUrl) {
    imageElement.removeAttribute("src");
    clearComicOverlay(overlayElement);
    return;
  }

  imageElement.src = previewUrl;
  stageElement.classList.toggle("is-comic", isComicCreation(creation));
  renderComicOverlay(overlayElement, creation);
}

function findCreationByUsageId(usageId) {
  return state.generationHistory.find((creation) => creation.usageId === usageId) || null;
}

function getFeaturedCreation() {
  return findCreationByUsageId(state.featuredUsageId) || state.generationHistory[0] || null;
}

async function loadImageElement(sourceUrl) {
  const image = new Image();
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";

  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("לא הצלחתי לטעון את התמונה לייצוא."));
    image.src = sourceUrl;
  });
}

function roundedRectPath(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function buildWrappedLines(context, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (context.measureText(nextLine).width <= maxWidth || !currentLine) {
      currentLine = nextLine;
      continue;
    }

    lines.push(currentLine);
    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function fitBubbleText(context, bubble, boxWidth, boxHeight) {
  let fontSize = Math.max(24, Math.round(boxWidth * 0.09));
  let speakerFontSize = Math.round(fontSize * 0.52);
  let lines = [];
  let lineHeight = 0;
  const textWidth = boxWidth - 28;
  const speaker = bubble.speaker ? `${bubble.speaker}` : "";
  const body = bubble.text || "";

  while (fontSize >= 14) {
    context.font = `700 ${fontSize}px "Noto Sans Hebrew", "Assistant", Arial, sans-serif`;
    lines = buildWrappedLines(context, body, textWidth);
    lineHeight = Math.round(fontSize * 1.24);
    const speakerHeight = speaker ? Math.round(speakerFontSize * 1.4) : 0;
    const totalHeight = speakerHeight + lines.length * lineHeight + 26;

    if (lines.length <= 4 && totalHeight <= boxHeight) {
      return {
        fontSize,
        speakerFontSize,
        lines,
        lineHeight
      };
    }

    fontSize -= 1;
    speakerFontSize = Math.round(fontSize * 0.52);
  }

  context.font = `700 14px "Noto Sans Hebrew", "Assistant", Arial, sans-serif`;
  lines = buildWrappedLines(context, body, textWidth).slice(0, 4);

  if (lines.length === 4) {
    lines[3] = `${lines[3].slice(0, 20).trim()}...`;
  }

  return {
    fontSize: 14,
    speakerFontSize: 10,
    lines,
    lineHeight: 18
  };
}

function drawBubbleOnCanvas(context, bubble, imageWidth, imageHeight) {
  const boxX = Math.round(bubble.left * imageWidth);
  const boxY = Math.round(bubble.top * imageHeight);
  const boxWidth = Math.round(bubble.width * imageWidth);
  const minHeight = Math.round(bubble.minHeight * imageHeight);
  const tailSize = Math.max(18, Math.round(imageWidth * 0.018));
  const radius = Math.max(18, Math.round(imageWidth * 0.018));
  const shadowBlur = Math.max(10, Math.round(imageWidth * 0.014));
  const textMetrics = fitBubbleText(context, bubble, boxWidth, minHeight + 40);
  const speakerHeight = bubble.speaker ? Math.round(textMetrics.speakerFontSize * 1.45) : 0;
  const boxHeight = Math.max(
    minHeight,
    24 + speakerHeight + textMetrics.lines.length * textMetrics.lineHeight + 18
  );

  context.save();
  context.shadowColor = "rgba(31, 61, 104, 0.18)";
  context.shadowBlur = shadowBlur;
  context.shadowOffsetY = Math.max(8, Math.round(imageHeight * 0.01));
  context.fillStyle = "rgba(255, 255, 255, 0.96)";
  roundedRectPath(context, boxX, boxY, boxWidth, boxHeight, radius);
  context.fill();
  context.restore();

  context.save();
  context.strokeStyle = "#1f3d68";
  context.lineWidth = Math.max(3, Math.round(imageWidth * 0.003));
  context.fillStyle = "rgba(255, 255, 255, 0.96)";
  roundedRectPath(context, boxX, boxY, boxWidth, boxHeight, radius);
  context.fill();
  context.stroke();

  const tailBaseY = bubble.tail === "left" ? boxY + boxHeight - tailSize * 1.2 : boxY + boxHeight - tailSize * 1.15;
  const tailBaseX = bubble.tail === "left" ? boxX + boxWidth * 0.18 : boxX + boxWidth * 0.82;
  context.beginPath();
  context.moveTo(tailBaseX, tailBaseY);
  context.lineTo(
    bubble.tail === "left" ? tailBaseX - tailSize * 1.2 : tailBaseX + tailSize * 1.2,
    tailBaseY + tailSize * 0.4
  );
  context.lineTo(
    bubble.tail === "left" ? tailBaseX + tailSize * 0.25 : tailBaseX - tailSize * 0.25,
    tailBaseY - tailSize * 0.15
  );
  context.closePath();
  context.fill();
  context.stroke();

  context.direction = "rtl";
  context.textAlign = "right";
  context.fillStyle = "#102b47";

  let cursorY = boxY + 24;
  const textX = boxX + boxWidth - 14;

  if (bubble.speaker) {
    context.font = `800 ${textMetrics.speakerFontSize}px "Noto Sans Hebrew", "Assistant", Arial, sans-serif`;
    context.fillText(bubble.speaker, textX, cursorY + textMetrics.speakerFontSize);
    cursorY += speakerHeight;
  }

  context.font = `700 ${textMetrics.fontSize}px "Noto Sans Hebrew", "Assistant", Arial, sans-serif`;

  for (const line of textMetrics.lines) {
    cursorY += textMetrics.lineHeight;
    context.fillText(line, textX, cursorY);
  }

  context.restore();
}

async function buildComicCompositeBlob(creation) {
  const dialogueEntries = parseComicDialogue(creation?.stepSnapshot?.action || "");

  if (!dialogueEntries.length) {
    return null;
  }

  let sourceUrl = getCreationPreviewUrl(creation);
  let revokeSourceUrl = null;

  if (creation?.usageId && creation?.imageStoragePath) {
    const response = await fetch(
      getDownloadGeneratedImageUrl(creation.usageId, buildCreationFilename(creation))
    );

    if (!response.ok) {
      throw new Error("לא הצלחתי למשוך את האיור מהשרת.");
    }

    const imageBlob = await response.blob();
    sourceUrl = URL.createObjectURL(imageBlob);
    revokeSourceUrl = sourceUrl;
  }

  if (!sourceUrl) {
    return null;
  }

  try {
    const baseImage = await loadImageElement(sourceUrl);
    const scale = baseImage.naturalWidth > COMIC_DOWNLOAD_WIDTH
      ? 1
      : COMIC_DOWNLOAD_WIDTH / Math.max(baseImage.naturalWidth, 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(baseImage.naturalWidth * scale);
    canvas.height = Math.round(baseImage.naturalHeight * scale);
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("לא הצלחתי להכין את משטח הציור להורדה.");
    }

    context.drawImage(baseImage, 0, 0, canvas.width, canvas.height);

    for (const bubble of buildComicBubbleLayout(dialogueEntries)) {
      drawBubbleOnCanvas(context, bubble, canvas.width, canvas.height);
    }

    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("לא הצלחתי להכין את קובץ הקומיקס להורדה."));
      }, "image/png");
    });
  } finally {
    if (revokeSourceUrl) {
      URL.revokeObjectURL(revokeSourceUrl);
    }
  }
}

function triggerBlobDownload(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 2000);
}

async function downloadCreation(creation, triggerElement) {
  if (!creation) {
    throw new Error("לא מצאתי יצירה להורדה.");
  }

  triggerElement?.setAttribute("aria-busy", "true");

  try {
    if (isComicCreation(creation)) {
      const blob = await buildComicCompositeBlob(creation);

      if (blob) {
        triggerBlobDownload(blob, buildCreationFilename(creation));
        return;
      }
    }

    if (creation.usageId && creation.imageStoragePath) {
      window.location.assign(
        getDownloadGeneratedImageUrl(creation.usageId, buildCreationFilename(creation))
      );
      return;
    }

    const fallbackLink = document.createElement("a");
    fallbackLink.href = getCreationPreviewUrl(creation);
    fallbackLink.download = buildCreationFilename(creation);
    document.body.appendChild(fallbackLink);
    fallbackLink.click();
    fallbackLink.remove();
  } finally {
    window.setTimeout(() => {
      triggerElement?.removeAttribute("aria-busy");
    }, 600);
  }
}

function resetGalleryState() {
  state.generationHistory = [];
  state.featuredUsageId = "";
  studentGalleryGrid.innerHTML = "";
  studentGalleryCard.hidden = true;
  studentGalleryEmpty.hidden = true;
}

function fillSteps(steps = buildEmptySteps(state.lessonKey)) {
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
    lessonKey: state.lessonKey,
    studentName: state.studentName,
    seatNumber: state.seatNumber
  });
}

function persistDraftState() {
  const classCode = normalizeClassCode(classCodeInput.value);
  const steps = collectSteps();
  const seed = normalizeSeed(seedInput.value);
  const hasContent = Object.values(steps).some(Boolean) || Boolean(classCode) || Number.isInteger(seed);

  if (!hasContent && state.lessonKey === DEFAULT_LESSON_KEY) {
    removeStorage(STORAGE_DRAFT_KEY);
    return;
  }

  writeStorage(STORAGE_DRAFT_KEY, {
    classCode,
    lessonKey: state.lessonKey,
    seatNumber: state.selectedSeatNumber || state.seatNumber || 0,
    seed,
    steps
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

function setLessonChooserDisabled(isDisabled) {
  for (const button of lessonChooserButtons) {
    button.disabled = isDisabled;
  }
}

function applyExampleToField(stepKey, value) {
  const field = stepFieldRefs[stepKey]?.input;

  if (!field) {
    return;
  }

  field.value = value;
  scheduleSilentDraftSave();
  field.focus();
}

function renderExampleGrid(stepKey, examples = []) {
  const container = stepFieldRefs[stepKey]?.examples;

  if (!container) {
    return;
  }

  container.innerHTML = "";

  for (const example of examples) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "example-chip";
    button.textContent = example;
    button.addEventListener("click", () => {
      applyExampleToField(stepKey, example);
    });
    container.appendChild(button);
  }
}

function renderLessonUi() {
  const lesson = getLessonDefinition(state.lessonKey);

  lessonLeadText.textContent = lesson.leadText;
  lessonGuardrailText.textContent = lesson.guardrailText;
  activityHeading.textContent = lesson.activityHeading;
  activityIntro.textContent = lesson.activityIntro;
  generateButton.textContent = lesson.generateButtonLabel;
  studentGalleryEmpty.textContent = lesson.emptyGalleryText;

  lessonQuickItems.forEach((item, index) => {
    item.textContent = lesson.quickItems[index] || "";
  });

  for (const [stepKey, config] of Object.entries(lesson.steps)) {
    const field = stepFieldRefs[stepKey];

    field.label.textContent = config.label;
    field.input.placeholder = config.placeholder;
    field.help.textContent = config.help;
    renderExampleGrid(stepKey, config.examples);
  }

  for (const button of lessonChooserButtons) {
    button.classList.toggle("is-active", button.dataset.lessonKey === lesson.key);
  }
}

function setLessonKey(nextLessonKey, options = {}) {
  const shouldResetSteps = options.resetSteps === true;
  const shouldPersist = options.persist !== false;

  state.lessonKey = normalizeLessonKey(nextLessonKey);

  if (state.selectedSeatNumber > getVisibleSeatLimit() && !state.sessionId) {
    state.selectedSeatNumber = 0;
    updateSeatBadge();
  }

  renderLessonUi();

  if (shouldResetSteps) {
    fillSteps(buildEmptySteps(state.lessonKey));
    resetResults();
  }

  if (shouldPersist) {
    persistDraftState();
    persistSessionState();
  }

  if (state.seatMap.length && !state.sessionId) {
    applySeatMapPayload({
      classCode: state.classCode || normalizeClassCode(classCodeInput.value),
      seats: state.seatMap
    });
  }
}

function resetResults() {
  resultCard.hidden = true;
  imagePreview.removeAttribute("src");
  resultVisualStage.classList.remove("is-comic");
  clearComicOverlay(resultComicOverlay);
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
  renderCreationVisual(resultVisualStage, imagePreview, resultComicOverlay, creation);

  if (isComicCreation(creation)) {
    downloadImageButton.href = "#";
    downloadImageButton.dataset.downloadMode = "comic";
    downloadImageButton.removeAttribute("download");
  } else if (creation.usageId && creation.imageStoragePath) {
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
    ? isComicCreation(creation)
      ? "האיור נשמר בענן, והבועות המקצועיות יתווספו גם בהורדה."
      : "התמונה נשמרה בענן ותישאר זמינה גם אחרי רענון."
    : isComicCreation(creation)
      ? "הקומיקס מורכב כאן בעמוד עם בועות דיבור ברורות."
      : "התמונה זמינה כרגע מהעמוד הזה.";
  if (Number.isInteger(creation.seed)) {
    savedImageNote.textContent += ` seed: ${creation.seed}.`;
  }
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
    const previewFrame = document.createElement("div");
    const previewOverlay = document.createElement("div");
    const isActive = creation.usageId && creation.usageId === state.featuredUsageId;
    const lessonLabel = normalizeLessonKey(creation.lessonKey || state.lessonKey) === "comic-lab"
      ? "פאנל"
      : "יצירה";

    card.className = `gallery-card${isActive ? " is-active" : ""}`;
    head.className = "gallery-card-head";
    title.className = "gallery-card-title";
    meta.className = "gallery-card-meta";
    copy.className = "gallery-card-copy";
    actions.className = "gallery-card-actions";
    previewFrame.className = "creation-stage gallery-stage";
    previewOverlay.className = "comic-overlay";
    previewOverlay.hidden = true;

    title.textContent = `${lessonLabel} ${creation.generationIndex || "?"}`;
    meta.textContent = creation.createdAtMs
      ? new Date(creation.createdAtMs).toLocaleTimeString("he-IL", {
          hour: "2-digit",
          minute: "2-digit"
        })
      : "נשמרה עכשיו";
    if (Number.isInteger(creation.seed)) {
      meta.textContent += ` | seed ${creation.seed}`;
    }
    preview.src = getCreationPreviewUrl(creation);
    preview.alt = `תצוגה מקדימה של ${lessonLabel} ${creation.generationIndex || ""}`;
    previewFrame.classList.toggle("is-comic", isComicCreation(creation));
    renderComicOverlay(previewOverlay, creation);
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
    if (isComicCreation(creation)) {
      downloadLink.href = "#";
      downloadLink.addEventListener("click", async (event) => {
        event.preventDefault();

        try {
          await downloadCreation(creation, downloadLink);
        } catch (error) {
          showStatus("bad", "ההורדה נכשלה", error.message || "לא הצלחתי להכין את הקובץ.");
        }
      });
    } else if (creation.usageId && creation.imageStoragePath) {
      downloadLink.href = getDownloadGeneratedImageUrl(
        creation.usageId,
        buildCreationFilename(creation)
      );
    } else {
      downloadLink.href = getCreationPreviewUrl(creation);
      downloadLink.setAttribute("download", buildCreationFilename(creation));
    }

    head.append(title, meta);
    previewFrame.append(preview, previewOverlay);
    actions.append(showButton, downloadLink);
    card.append(head, previewFrame, copy, actions);
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
  setLessonChooserDisabled(isLocked);
  updateJoinButtonAvailability();
}

function stopSeatRealtime() {
  if (typeof state.seatRealtimeUnsubscribe === "function") {
    state.seatRealtimeUnsubscribe();
  }

  state.seatRealtimeUnsubscribe = null;
}

function renderSeatBoard(seats = []) {
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
  state.seatMap = seats;
  const visibleSeats = getVisibleSeats(seats);
  const availableCount = visibleSeats.filter((seat) => seat.status === "available").length;
  const previouslySelectedSeat = state.selectedSeatNumber;

  if (payload?.classCode) {
    state.classCode = payload.classCode;
  }

  if (
    state.selectedSeatNumber > getVisibleSeatLimit() ||
    state.selectedSeatNumber &&
    seats.some(
      (seat) =>
        seat.seatNumber === state.selectedSeatNumber &&
        seat.seatNumber <= getVisibleSeatLimit() &&
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

  renderSeatBoard(visibleSeats);
  seatStatusText.textContent = fromRealtime
    ? isComicLesson()
      ? `לוח הקומיקס מתעדכן בזמן אמת. פתוחים עד 15 מקומות, ויש כרגע ${availableCount} פנויים.`
      : `הלוח מתעדכן בזמן אמת. יש כרגע ${availableCount} מקומות פנויים.`
    : isComicLesson()
      ? `במסלול הקומיקס פתוחים עד 15 מקומות, ויש כרגע ${availableCount} פנויים.`
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
  setLessonKey(payload.lessonKey || state.lessonKey, { persist: false });
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

  state.currentSeed = normalizeSeed(payload.seed);
  seedInput.value = Number.isInteger(state.currentSeed) ? String(state.currentSeed) : "";

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
  setLessonKey(savedDraft?.lessonKey || savedSession?.lessonKey || DEFAULT_LESSON_KEY, {
    persist: false
  });

  if (savedSession?.classCode) {
    classCodeInput.value = savedSession.classCode;
  } else if (savedDraft?.classCode) {
    classCodeInput.value = savedDraft.classCode;
  }

  if (savedSession?.studentName) {
    studentNameInput.value = savedSession.studentName;
  }

  if (savedDraft && Object.prototype.hasOwnProperty.call(savedDraft, "seed")) {
    const savedSeed = normalizeSeed(savedDraft.seed);
    seedInput.value = Number.isInteger(savedSeed) ? String(savedSeed) : "";
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
        steps: collectSteps(),
        seed: normalizeSeed(seedInput.value)
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
      lessonKey: state.lessonKey,
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
      steps: collectSteps(),
      seed: normalizeSeed(seedInput.value)
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

  setButtonState(
    generateButton,
    true,
    getLessonDefinition(state.lessonKey).generateButtonLabel,
    "יוצר..."
  );

  try {
    const currentSteps = collectSteps();
    const response = await generateImageCallable({
      sessionId: state.sessionId,
      steps: currentSteps,
      seed: normalizeSeed(seedInput.value)
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
      finalPromptHebrew:
        payload.finalPromptHebrew || buildHebrewPromptPreview(currentSteps, state.lessonKey),
      lessonKey: state.lessonKey,
      seed: normalizeSeed(payload.seed),
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
    setButtonState(
      generateButton,
      false,
      getLessonDefinition(state.lessonKey).generateButtonLabel,
      "יוצר..."
    );
  }
});

downloadImageButton.addEventListener("click", (event) => {
  const featuredCreation = getFeaturedCreation();

  if (featuredCreation && isComicCreation(featuredCreation)) {
    event.preventDefault();
    void downloadCreation(featuredCreation, downloadImageButton).catch((error) => {
      showStatus("bad", "ההורדה נכשלה", error.message || "לא הצלחתי להכין את הקובץ.");
    });
    return;
  }

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
  fillSteps(buildEmptySteps(state.lessonKey));
  resetResults();
  scheduleSilentDraftSave();
  showStatus("warn", "ניקינו את השלבים", "עכשיו אפשר להתחיל שוב מאותו מקום עם רעיון חדש.");
});

for (const input of stepInputs) {
  input.addEventListener("input", scheduleSilentDraftSave);
}

seedInput.addEventListener("input", scheduleSilentDraftSave);

for (const button of lessonChooserButtons) {
  button.addEventListener("click", () => {
    if (state.sessionId) {
      return;
    }

    setLessonKey(button.dataset.lessonKey, { resetSteps: true });
    showStatus(
      "good",
      "בחרתם שיעור",
      normalizeLessonKey(button.dataset.lessonKey) === "comic-lab"
        ? "עכשיו נבנה קומיקס עם דמויות קבועות לאורך כל הפאנלים."
        : "עכשיו נבנה תמונה אחת ברעיון ברור וב-5 שלבים."
    );
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
  fillSteps(buildEmptySteps(state.lessonKey));
  seedInput.value = "";
  showStatus("good", "קמתם מהמקום", "המקום שוחרר. אפשר לבחור מקום חדש בלוח.");
  startSeatPolling();
  void loadSeatMap();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !state.sessionId) {
    void loadSeatMap();
  }
});

setLessonKey(DEFAULT_LESSON_KEY, { persist: false });
updateSeatBadge();
updateRemainingBadge(0);
startSeatPolling();
void restoreSavedSession();
