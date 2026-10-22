"use strict";

const { buildApiErrorDetails } = require("./apiErrors");

function millis(value) {
  return typeof value?.toMillis === "function" ? value.toMillis() : null;
}

// Explicit allowlist: student session IDs and authentication data stay server-side.
function serializeStudentActivity(doc) {
  const data = doc.data() || {};
  return {
    studentName: String(data.studentName || "תלמיד/ה"),
    seatNumber: Number(data.seatNumber || 0),
    lessonKey: String(data.lessonKey || "image-lab"),
    status: String(data.status || "building"),
    generationsCount: Number(data.generationsCount || 0),
    promptSteps: data.promptSteps || {},
    lastGeneratedPrompt: String(data.lastGeneratedPrompt || ""),
    lastGeneratedPromptEnglish: String(data.lastGeneratedPromptEnglish || ""),
    lastApiError: data.lastApiError || null,
    lastApiErrorSteps: data.lastApiErrorSteps || {},
    lastApiErrorAtMs: millis(data.lastApiErrorAt),
    lastSeenAtMs: millis(data.lastSeenAt)
  };
}

async function recordStudentApiError(sessionRef, error, context, steps, timestamp) {
  await sessionRef.set({
    lastApiError: { model: null, ...buildApiErrorDetails(error, context) },
    lastApiErrorSteps: steps,
    lastApiErrorAt: timestamp,
    lastSeenAt: timestamp
  }, { mergeFields: ["lastApiError", "lastApiErrorSteps", "lastApiErrorAt", "lastSeenAt"] });
}

module.exports = { serializeStudentActivity, recordStudentApiError };
