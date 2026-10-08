"use strict";

const { HttpsError } = require("firebase-functions/v2/https");
const DEFAULT_CLASS_DURATION_MS = 45 * 60 * 1000;

function getClassWindow(classData) {
  return {
    opensAtMs: classData.opensAt?.toMillis() ?? null,
    closesAtMs: (classData.closesAt || classData.expiresAt)?.toMillis() ?? null
  };
}

function sanitizeClassWindow(data, now = Date.now()) {
  const opensAtMs = data.opensAtMs === undefined ? now : data.opensAtMs;
  const closesAtMs = data.closesAtMs === undefined ? opensAtMs + DEFAULT_CLASS_DURATION_MS : data.closesAtMs;
  if (
    typeof opensAtMs !== "number" || typeof closesAtMs !== "number" ||
    !Number.isSafeInteger(opensAtMs) || !Number.isSafeInteger(closesAtMs) ||
    opensAtMs <= 0 || closesAtMs <= opensAtMs ||
    !Number.isFinite(new Date(opensAtMs).getTime()) || !Number.isFinite(new Date(closesAtMs).getTime())
  ) {
    throw new HttpsError("invalid-argument", "יש להזין זמני פתיחה וסגירה תקינים. הסגירה חייבת להיות אחרי הפתיחה.");
  }
  return { opensAtMs, closesAtMs };
}

function assertClassWindowOpen(classData, now = Date.now()) {
  const window = getClassWindow(classData);
  const formatTime = (ms) => new Intl.DateTimeFormat("he-IL", {
    dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem"
  }).format(new Date(ms));
  if (window.opensAtMs !== null && now < window.opensAtMs) {
    throw new HttpsError("failed-precondition", `הכיתה עדיין לא נפתחה. הכניסה תתאפשר ב-${formatTime(window.opensAtMs)} (שעון ישראל).`, {
      reason: "CLASS_NOT_OPEN_YET", ...window
    });
  }
  if (window.closesAtMs !== null && now >= window.closesAtMs) {
    throw new HttpsError("failed-precondition", `חלון הפעילות של הכיתה הסתיים ב-${formatTime(window.closesAtMs)} (שעון ישראל).`, {
      reason: "CLASS_WINDOW_CLOSED", ...window
    });
  }
}

module.exports = { DEFAULT_CLASS_DURATION_MS, getClassWindow, sanitizeClassWindow, assertClassWindowOpen };
