"use strict";

const {
  ACTIVITY_CONFIG,
  REQUIRED_STEPS,
  REQUIRED_STEP_KEYS
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

function buildFallbackEnglishPrompt(steps) {
  return buildDeterministicEnglishPrompt(steps);
}

function sanitizeEnglishField(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value
    .replace(/[`"']/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || fallback;
}

function containsHebrew(value) {
  return /[\u0590-\u05FF]/.test(value || "");
}

function normalizePromptClause(value) {
  const normalized = sanitizeEnglishField(value, "");

  if (!normalized) {
    return "";
  }

  if (/^[A-Z]/.test(normalized)) {
    return normalized.charAt(0).toLowerCase() + normalized.slice(1);
  }

  return normalized;
}

function buildDeterministicEnglishPrompt(steps) {
  const character = normalizePromptClause(steps.character);
  const place = normalizePromptClause(steps.place);
  const action = normalizePromptClause(steps.action);
  const detail = normalizePromptClause(steps.detail);
  const style = normalizePromptClause(steps.style);

  return [
    `Create a child-friendly image of ${character}.`,
    `Setting: ${place}.`,
    `Action: ${action}.`,
    `Special detail: ${detail}.`,
    `Visual style: ${style}.`,
    "High quality, rich detail, clear composition, expressive lighting."
  ].join(" ");
}

function getStepTemplatePayload(steps) {
  return {
    character: steps.character,
    place: steps.place,
    action: steps.action,
    style: steps.style,
    detail: steps.detail
  };
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
  buildDeterministicEnglishPrompt,
  buildFallbackEnglishPrompt,
  buildSessionDraft,
  buildValidationResponse,
  containsHebrew,
  getStepTemplatePayload,
  normalizeClassCode,
  sanitizePromptSteps,
  sanitizeEnglishField,
  sanitizeStudentName
};
