"use strict";

const {
  ACTIVITY_CONFIG,
  DEFAULT_LESSON_KEY,
  LESSON_DEFINITIONS
} = require("../config/agentConfig");

function normalizeText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeStudentName(studentName) {
  const cleanName = normalizeText(studentName, ACTIVITY_CONFIG.maxNameLength);
  return cleanName || "תלמיד/ה";
}

function normalizeClassCode(classCode) {
  if (typeof classCode !== "string") {
    return "";
  }

  return classCode.replace(/\s+/g, "").trim().toUpperCase().slice(0, 24);
}

function sanitizeLessonKey(lessonKey) {
  const candidate = String(lessonKey || "").trim();
  return LESSON_DEFINITIONS[candidate] ? candidate : DEFAULT_LESSON_KEY;
}

function getLessonDefinition(lessonKey) {
  return LESSON_DEFINITIONS[sanitizeLessonKey(lessonKey)];
}

function buildEmptyPromptSteps(lessonKey = DEFAULT_LESSON_KEY) {
  const lesson = getLessonDefinition(lessonKey);

  return lesson.steps.reduce((steps, step) => {
    steps[step.key] = "";
    return steps;
  }, {});
}

function sanitizePromptSteps(rawSteps = {}, lessonKey = DEFAULT_LESSON_KEY) {
  const lesson = getLessonDefinition(lessonKey);
  const steps = {};

  for (const step of lesson.steps) {
    steps[step.key] = normalizeText(
      rawSteps[step.key],
      ACTIVITY_CONFIG.maxStepLength
    );
  }

  return steps;
}

function getMissingSteps(steps, lessonKey = DEFAULT_LESSON_KEY) {
  const lesson = getLessonDefinition(lessonKey);

  return lesson.steps.filter((step) => !steps[step.key]).map((step) => ({
    key: step.key,
    label: step.label,
    shortLabel: step.shortLabel,
    message: step.missingMessage
  }));
}

function buildValidationResponse(steps, lessonKey = DEFAULT_LESSON_KEY) {
  const missingSteps = getMissingSteps(steps, lessonKey);
  const isComplete = missingSteps.length === 0;
  const lesson = getLessonDefinition(lessonKey);

  if (isComplete) {
    return {
      isComplete: true,
      missingSteps: [],
      message:
        lesson.key === "comic-lab"
          ? "מעולה. כל חמשת השלבים מלאים, ואפשר להכין עכשיו פאנל קומיקס מסודר."
          : ACTIVITY_CONFIG.readyMessage,
      nextSuggestedStep: null
    };
  }

  const missingLabels = missingSteps.map((step) => step.shortLabel).join(", ");

  return {
    isComplete: false,
    missingSteps,
    message: `${ACTIVITY_CONFIG.missingPrefix} ${missingLabels}.`,
    nextSuggestedStep: missingSteps[0].key
  };
}

function sanitizePromptField(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/[`"']/g, "").replace(/\s+/g, " ").trim();
}

function sanitizeEnglishPromptField(value) {
  return sanitizePromptField(value).replace(/[^\x20-\x7E]+/g, " ").replace(/\s+/g, " ").trim();
}

function containsHebrew(value) {
  return /[\u0590-\u05FF]/.test(String(value || ""));
}

function normalizeSeed(seedValue) {
  if (seedValue === null || seedValue === undefined || seedValue === "") {
    return null;
  }

  const numericSeed = Number(seedValue);

  if (!Number.isInteger(numericSeed) || numericSeed < 0 || numericSeed > 2147483647) {
    return null;
  }

  return numericSeed;
}

function buildComicCharacterBlueprintHebrew(steps) {
  const characters = sanitizePromptField(steps.character);
  const consistency = sanitizePromptField(steps.detail);
  const style = sanitizePromptField(steps.style);

  return [
    `הדמויות הקבועות בקומיקס: ${characters}.`,
    `מה חייב להישאר אותו דבר בכל פאנל: ${consistency}.`,
    `סגנון הקומיקס שנשאר קבוע: ${style}.`
  ].join(" ");
}

function buildComicCharacterBlueprintEnglish(steps) {
  const characters = sanitizeEnglishPromptField(steps.character);
  const consistency = sanitizeEnglishPromptField(steps.detail);
  const style = sanitizeEnglishPromptField(steps.style);

  return [
    `Recurring comic characters: ${characters}.`,
    `Always keep these consistency rules: ${consistency}.`,
    `Recurring comic style: ${style}.`
  ].join(" ");
}

function buildFinalHebrewPrompt(
  steps,
  lessonKey = DEFAULT_LESSON_KEY,
  extra = {}
) {
  const lesson = getLessonDefinition(lessonKey);

  if (lesson.key === "comic-lab") {
    const panelScene = sanitizePromptField(steps.place);
    const dialogue = sanitizePromptField(steps.action);
    const characterBlueprintHebrew = sanitizePromptField(
      extra.characterBlueprintHebrew || buildComicCharacterBlueprintHebrew(steps)
    );

    return [
      "זוהי תמונת קומיקס ידידותית לילדים של פאנל אחד.",
      characterBlueprintHebrew,
      "שומרים על אותן דמויות, אותם בגדים, אותם צבעים ואותם אביזרים בכל פאנל בסדרה.",
      `מה רואים בפאנל הזה: ${panelScene}.`,
      `מה הדמויות אומרות בפאנל הזה: ${dialogue}.`,
      extra.panelNumber ? `זה פאנל מספר ${extra.panelNumber}.` : ""
    ]
      .filter(Boolean)
      .join(" ");
  }

  const character = sanitizePromptField(steps.character);
  const place = sanitizePromptField(steps.place);
  const action = sanitizePromptField(steps.action);
  const style = sanitizePromptField(steps.style);
  const detail = sanitizePromptField(steps.detail);

  return [
    "התמונה ידידותית לילדים",
    `הדמות הראשית: ${character}.`,
    `המקום או הסביבה: ${place}.`,
    `הפעולה שמתרחשת עכשיו: ${action}.`,
    `הסגנון החזותי: ${style}.`,
    `הפרט המיוחד: ${detail}.`
  ].join(" ");
}

function buildFinalEnglishPrompt(
  steps,
  guardrails = "",
  lessonKey = DEFAULT_LESSON_KEY,
  extra = {}
) {
  const lesson = getLessonDefinition(lessonKey);
  const promptGuardrails = sanitizeEnglishPromptField(guardrails);

  if (lesson.key === "comic-lab") {
    const panelScene = sanitizeEnglishPromptField(steps.place);
    const dialogueEnglish = sanitizeEnglishPromptField(steps.action);
    const characterBlueprintEnglish = sanitizeEnglishPromptField(
      extra.characterBlueprintEnglish || buildComicCharacterBlueprintEnglish(steps)
    );
    const parts = [
      "Create a single child-friendly comic panel.",
      characterBlueprintEnglish,
      ACTIVITY_CONFIG.comicConsistencyInstructionEnglish,
      `Current panel scene: ${panelScene}.`,
      `Dialogue intent for this panel: ${dialogueEnglish}.`,
      `Comic visual style: ${sanitizeEnglishPromptField(steps.style)}.`,
      "High quality comic panel, expressive faces, clear framing, rich detail.",
      "Do not render printed text, letters, captions, speech bubbles, subtitles, watermark, or logo.",
      "Leave clean negative space near the speaking characters so dialogue can be added later in the app."
    ];

    if (extra.panelNumber) {
      parts.push(`Panel number in this comic sequence: ${extra.panelNumber}.`);
    }

    if (promptGuardrails) {
      parts.push(`Quality guardrails: ${promptGuardrails}.`);
    }

    return parts.join(" ");
  }

  const character = sanitizeEnglishPromptField(steps.character);
  const place = sanitizeEnglishPromptField(steps.place);
  const action = sanitizeEnglishPromptField(steps.action);
  const style = sanitizeEnglishPromptField(steps.style);
  const detail = sanitizeEnglishPromptField(steps.detail);
  const parts = [
    "Create a child-friendly image.",
    `Main subject: ${character}.`,
    `Setting: ${place}.`,
    `Action: ${action}.`,
    `Visual style: ${style}.`,
    `Special detail: ${detail}.`,
    "High quality, clear composition, expressive lighting, rich detail."
  ];

  if (promptGuardrails) {
    parts.push(`Quality guardrails: ${promptGuardrails}.`);
  }

  return parts.join(" ");
}

function buildSessionDraft(steps, validation, lessonKey = DEFAULT_LESSON_KEY) {
  const lesson = getLessonDefinition(lessonKey);

  return {
    lessonKey: lesson.key,
    promptSteps: steps,
    promptStepOrder: lesson.steps.map((step) => step.key),
    isPromptComplete: validation.isComplete,
    missingStepKeys: validation.missingSteps.map((step) => step.key),
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  buildComicCharacterBlueprintEnglish,
  buildComicCharacterBlueprintHebrew,
  buildEmptyPromptSteps,
  buildFinalEnglishPrompt,
  buildFinalHebrewPrompt,
  buildSessionDraft,
  buildValidationResponse,
  containsHebrew,
  getLessonDefinition,
  normalizeClassCode,
  normalizeSeed,
  sanitizeLessonKey,
  sanitizePromptSteps,
  sanitizeStudentName
};
