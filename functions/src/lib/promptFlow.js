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

function buildFinalHebrewPrompt(steps) {
  const character = sanitizePromptField(steps.character);
  const place = sanitizePromptField(steps.place);
  const action = sanitizePromptField(steps.action);
  const style = sanitizePromptField(steps.style);
  const detail = sanitizePromptField(steps.detail);

  return [
    "צרו תמונה ידידותית לילדים לפי התיאור הבא.",
    `הדמות הראשית: ${character}.`,
    `המקום או הסביבה: ${place}.`,
    `הפעולה שמתרחשת עכשיו: ${action}.`,
    `הסגנון החזותי: ${style}.`,
    `הפרט המיוחד: ${detail}.`,
    "התמונה צריכה להיות איכותית, ברורה, צבעונית, עם קומפוזיציה מסודרת ואווירה חמה."
  ].join(" ");
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
  buildFinalHebrewPrompt,
  buildSessionDraft,
  buildValidationResponse,
  normalizeClassCode,
  sanitizePromptSteps,
  sanitizeStudentName
};
