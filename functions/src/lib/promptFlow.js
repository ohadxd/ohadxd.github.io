"use strict";

const { ACTIVITY_CONFIG, REQUIRED_STEPS, REQUIRED_STEP_KEYS } = require("../config/agentConfig");

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

function sanitizePromptSteps(rawSteps = {}) {
  const steps = {};

  for (const step of REQUIRED_STEPS) {
    steps[step.key] = normalizeText(
      rawSteps[step.key],
      ACTIVITY_CONFIG.maxStepLength
    );
  }

  return steps;
}

function getMissingSteps(steps) {
  return REQUIRED_STEPS.filter((step) => !steps[step.key]).map((step) => ({
    key: step.key,
    label: step.label,
    shortLabel: step.shortLabel,
    message: step.missingMessage
  }));
}

function buildValidationResponse(steps) {
  const missingSteps = getMissingSteps(steps);
  const isComplete = missingSteps.length === 0;

  if (isComplete) {
    return {
      isComplete: true,
      missingSteps: [],
      message: ACTIVITY_CONFIG.readyMessage,
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

function buildFinalHebrewPrompt(steps) {
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

function buildFinalEnglishPrompt(steps, guardrails = "") {
  const character = sanitizeEnglishPromptField(steps.character);
  const place = sanitizeEnglishPromptField(steps.place);
  const action = sanitizeEnglishPromptField(steps.action);
  const style = sanitizeEnglishPromptField(steps.style);
  const detail = sanitizeEnglishPromptField(steps.detail);
  const promptGuardrails = sanitizeEnglishPromptField(guardrails);

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

function buildSessionDraft(steps, validation) {
  return {
    promptSteps: steps,
    promptStepOrder: REQUIRED_STEP_KEYS,
    isPromptComplete: validation.isComplete,
    missingStepKeys: validation.missingSteps.map((step) => step.key),
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  buildFinalEnglishPrompt,
  buildFinalHebrewPrompt,
  buildSessionDraft,
  buildValidationResponse,
  containsHebrew,
  normalizeClassCode,
  normalizeSeed,
  sanitizePromptSteps,
  sanitizeStudentName
};
