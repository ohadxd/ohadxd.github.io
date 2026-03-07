"use strict";

const admin = require("firebase-admin");
const { GoogleGenAI } = require("@google/genai");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const {
  ACTIVITY_CONFIG,
  ENGLISH_STEP_TRANSLATION_SCHEMA,
  ENGLISH_STEP_TRANSLATION_INSTRUCTION
} = require("./config/agentConfig");
const {
  buildDeterministicEnglishPrompt,
  buildFallbackEnglishPrompt,
  buildSessionDraft,
  buildValidationResponse,
  containsHebrew,
  getStepTemplatePayload,
  normalizeClassCode,
  sanitizeEnglishField,
  sanitizePromptSteps,
  sanitizeStudentName
} = require("./lib/promptFlow");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

function getCallableOptions(extra = {}) {
  return {
    region: ACTIVITY_CONFIG.region,
    ...extra
  };
}

function normalizeSecretValue(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/^\uFEFF/, "").trim();
}

function parseLooseJsonObject(text) {
  if (typeof text !== "string") {
    return null;
  }

  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const startIndex = trimmed.indexOf("{");
    const endIndex = trimmed.lastIndexOf("}");

    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
      return null;
    }

    return JSON.parse(trimmed.slice(startIndex, endIndex + 1));
  }
}

function assertStringValue(value, code, message) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpsError(code, message);
  }
}

async function loadClassAccessCode(classCode) {
  const normalizedCode = normalizeClassCode(classCode);

  if (!normalizedCode) {
    throw new HttpsError("invalid-argument", "יש להזין קוד כיתה.");
  }

  const classRef = db.collection("classAccessCodes").doc(normalizedCode);
  const classSnapshot = await classRef.get();

  if (!classSnapshot.exists) {
    throw new HttpsError("failed-precondition", ACTIVITY_CONFIG.invalidClassCode);
  }

  const classData = classSnapshot.data();
  const expiresAt = classData.expiresAt instanceof Timestamp ? classData.expiresAt.toDate() : null;

  if (classData.isActive === false) {
    throw new HttpsError("failed-precondition", ACTIVITY_CONFIG.invalidClassCode);
  }

  if (classData.activitySlug && classData.activitySlug !== ACTIVITY_CONFIG.activitySlug) {
    throw new HttpsError("failed-precondition", ACTIVITY_CONFIG.invalidClassCode);
  }

  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new HttpsError("failed-precondition", ACTIVITY_CONFIG.expiredClassCode);
  }

  return {
    classRef,
    classData,
    normalizedCode
  };
}

async function loadSession(sessionId) {
  assertStringValue(sessionId, "invalid-argument", "חסר מזהה סשן.");

  const sessionRef = db.collection("studentSessions").doc(sessionId.trim());
  const sessionSnapshot = await sessionRef.get();

  if (!sessionSnapshot.exists) {
    throw new HttpsError("not-found", ACTIVITY_CONFIG.sessionNotFound);
  }

  return {
    sessionRef,
    sessionData: sessionSnapshot.data()
  };
}

function getGenerationLimit(classData) {
  const rawLimit = Number(classData.allowedGenerationsPerStudent);
  if (Number.isFinite(rawLimit) && rawLimit > 0) {
    return Math.floor(rawLimit);
  }

  return ACTIVITY_CONFIG.defaultGenerationsPerStudent;
}

function getSeatCount(classData) {
  const rawSeatCount = Number(classData.seatCount);

  if (Number.isFinite(rawSeatCount) && rawSeatCount > 0) {
    return Math.floor(rawSeatCount);
  }

  return ACTIVITY_CONFIG.defaultSeatCount;
}

function normalizeSeatNumber(seatNumber, seatCount) {
  const numericSeat = Number(seatNumber);

  if (!Number.isInteger(numericSeat) || numericSeat < 1 || numericSeat > seatCount) {
    throw new HttpsError("invalid-argument", ACTIVITY_CONFIG.invalidSeatNumber);
  }

  return numericSeat;
}

function formatSeatId(seatNumber) {
  return String(seatNumber).padStart(2, "0");
}

function buildSeatTimestamp(date = new Date()) {
  const seatExpiry = new Date(date.getTime() + ACTIVITY_CONFIG.seatClaimMinutes * 60 * 1000);
  return Timestamp.fromDate(seatExpiry);
}

function getActiveSeatSessionId(seatData, now = new Date()) {
  if (!seatData || seatData.status !== "taken" || !seatData.sessionId) {
    return "";
  }

  if (!(seatData.claimedUntil instanceof Timestamp)) {
    return seatData.sessionId;
  }

  return seatData.claimedUntil.toDate().getTime() > now.getTime() ? seatData.sessionId : "";
}

function buildSeatPayload({ classCode, seatNumber, sessionId, studentName }) {
  return {
    classCode,
    seatNumber,
    sessionId,
    status: "taken",
    studentName,
    lastSeenAt: FieldValue.serverTimestamp(),
    claimedUntil: buildSeatTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
}

async function touchSeatClaim(classRef, seatNumber, sessionId, studentName) {
  if (!Number.isInteger(seatNumber) || seatNumber < 1) {
    return;
  }

  const seatRef = classRef.collection("seats").doc(formatSeatId(seatNumber));

  await seatRef.set(
    buildSeatPayload({
      classCode: classRef.id,
      seatNumber,
      sessionId,
      studentName
    }),
    { merge: true }
  );
}

async function buildFinalEnglishPrompt(ai, steps) {
  const payload = JSON.stringify(getStepTemplatePayload(steps), null, 2);
  const translationPrompt =
    "Translate these validated Hebrew image-building steps into English JSON with the same five fields:\n" +
    payload;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model: ACTIVITY_CONFIG.textModel,
        config: {
          temperature: 0,
          maxOutputTokens: 300,
          thinkingConfig: {
            thinkingBudget: 0
          },
          responseMimeType: "application/json",
          responseJsonSchema: ENGLISH_STEP_TRANSLATION_SCHEMA,
          systemInstruction: ENGLISH_STEP_TRANSLATION_INSTRUCTION
        },
        contents: translationPrompt
      });

      const translated = parseLooseJsonObject(response.text || "");

      if (!translated) {
        throw new Error("Gemini did not return parsable JSON for step translation.");
      }

      const translatedSteps = {
        character: sanitizeEnglishField(translated.character, ""),
        place: sanitizeEnglishField(translated.place, ""),
        action: sanitizeEnglishField(translated.action, ""),
        style: sanitizeEnglishField(translated.style, ""),
        detail: sanitizeEnglishField(translated.detail, "")
      };

      const hasAllFields = Object.values(translatedSteps).every(Boolean);
      const hasHebrewLeak = Object.values(translatedSteps).some((value) =>
        containsHebrew(value)
      );

      if (hasAllFields && !hasHebrewLeak) {
        return buildDeterministicEnglishPrompt(translatedSteps);
      }

      throw new Error("Translated prompt fields were incomplete or still contained Hebrew.");
    } catch (error) {
      logger.error("Failed to translate prompt steps with Gemini text model", {
        attempt,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (Object.values(steps).some((value) => containsHebrew(value))) {
    throw new Error("Could not build a clean English prompt from the Hebrew steps.");
  }

  return buildDeterministicEnglishPrompt({
    character: sanitizeEnglishField(steps.character, steps.character),
    place: sanitizeEnglishField(steps.place, steps.place),
    action: sanitizeEnglishField(steps.action, steps.action),
    style: sanitizeEnglishField(steps.style, steps.style),
    detail: sanitizeEnglishField(steps.detail, steps.detail)
  }) || buildFallbackEnglishPrompt(steps);
}

async function generateImageWithGemini(ai, finalPrompt) {
  const response = await ai.models.generateContent({
    model: ACTIVITY_CONFIG.imageModel,
    contents: finalPrompt,
    config: {
      responseModalities: ["TEXT", "IMAGE"]
    }
  });

  for (const candidate of response.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.inlineData?.data) {
        return {
          imageBase64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || "image/png"
        };
      }
    }
  }

  throw new Error("Gemini image generation did not return image data.");
}

exports.getSeatMap = onCall(getCallableOptions(), async (request) => {
  const { classRef, classData, normalizedCode } = await loadClassAccessCode(
    request.data?.classCode
  );
  const seatCount = getSeatCount(classData);
  const seatSnapshot = await classRef.collection("seats").get();
  const now = new Date();
  const seatLookup = new Map();

  for (const seatDoc of seatSnapshot.docs) {
    const seatData = seatDoc.data();
    const activeSessionId = getActiveSeatSessionId(seatData, now);

    if (!activeSessionId) {
      continue;
    }

    seatLookup.set(Number(seatData.seatNumber || 0), {
      status: "taken"
    });
  }

  const seats = Array.from({ length: seatCount }, (_, index) => {
    const seatNumber = index + 1;
    const activeSeat = seatLookup.get(seatNumber);

    return {
      seatNumber,
      status: activeSeat ? "taken" : "available"
    };
  });

  return {
    ok: true,
    classCode: normalizedCode,
    classLabel: classData.label || "",
    seatCount,
    seats
  };
});

exports.joinActivity = onCall(getCallableOptions(), async (request) => {
  const studentName = sanitizeStudentName(request.data?.studentName);
  const { classRef, classData, normalizedCode } = await loadClassAccessCode(
    request.data?.classCode
  );
  const seatCount = getSeatCount(classData);
  const seatNumber = normalizeSeatNumber(request.data?.seatNumber, seatCount);
  const generationLimit = getGenerationLimit(classData);
  const sessionRef = db.collection("studentSessions").doc();
  const seatRef = classRef.collection("seats").doc(formatSeatId(seatNumber));
  const now = new Date();
  const sessionPayload = {
    activitySlug: ACTIVITY_CONFIG.activitySlug,
    classCode: normalizedCode,
    classLabel: classData.label || "",
    createdAt: FieldValue.serverTimestamp(),
    generationsCount: 0,
    generationLimit,
    isPromptComplete: false,
    lastSeenAt: FieldValue.serverTimestamp(),
    missingStepKeys: ["character", "place", "action", "style", "detail"],
    promptStepOrder: ["character", "place", "action", "style", "detail"],
    promptSteps: {
      character: "",
      place: "",
      action: "",
      style: "",
      detail: ""
    },
    seatNumber,
    status: "joined",
    studentName,
    updatedAt: FieldValue.serverTimestamp()
  };

  await db.runTransaction(async (transaction) => {
    const seatSnapshot = await transaction.get(seatRef);
    const seatData = seatSnapshot.exists ? seatSnapshot.data() : null;
    const activeSeatSessionId = getActiveSeatSessionId(seatData, now);

    if (activeSeatSessionId) {
      throw new HttpsError("failed-precondition", ACTIVITY_CONFIG.seatTaken);
    }

    transaction.set(sessionRef, sessionPayload);
    transaction.set(
      seatRef,
      buildSeatPayload({
        classCode: normalizedCode,
        seatNumber,
        sessionId: sessionRef.id,
        studentName
      }),
      { merge: true }
    );
    transaction.set(
      classRef,
      {
        activitySlug: ACTIVITY_CONFIG.activitySlug,
        lastJoinedAt: FieldValue.serverTimestamp(),
        participantsCount: FieldValue.increment(1),
        totalSessions: FieldValue.increment(1)
      },
      { merge: true }
    );
  });

  return {
    ok: true,
    sessionId: sessionRef.id,
    classCode: normalizedCode,
    classLabel: classData.label || "",
    studentName,
    seatNumber,
    generationLimit,
    remainingGenerations: generationLimit,
    promptSteps: sessionPayload.promptSteps,
    message: ACTIVITY_CONFIG.welcomeMessage
  };
});

exports.restoreActivity = onCall(getCallableOptions(), async (request) => {
  const { sessionRef, sessionData } = await loadSession(request.data?.sessionId);
  const { classRef, classData, normalizedCode } = await loadClassAccessCode(
    sessionData.classCode
  );
  const seatCount = getSeatCount(classData);
  const seatNumber = normalizeSeatNumber(sessionData.seatNumber, seatCount);
  const seatRef = classRef.collection("seats").doc(formatSeatId(seatNumber));
  const now = new Date();

  await db.runTransaction(async (transaction) => {
    const seatSnapshot = await transaction.get(seatRef);
    const seatData = seatSnapshot.exists ? seatSnapshot.data() : null;
    const activeSeatSessionId = getActiveSeatSessionId(seatData, now);

    if (activeSeatSessionId && activeSeatSessionId !== sessionRef.id) {
      throw new HttpsError("failed-precondition", ACTIVITY_CONFIG.seatRestoreFailed);
    }

    transaction.set(
      sessionRef,
      {
        lastSeenAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    transaction.set(
      seatRef,
      buildSeatPayload({
        classCode: normalizedCode,
        seatNumber,
        sessionId: sessionRef.id,
        studentName: sessionData.studentName || "תלמיד/ה"
      }),
      { merge: true }
    );
  });

  return {
    ok: true,
    sessionId: sessionRef.id,
    classCode: normalizedCode,
    classLabel: classData.label || "",
    studentName: sessionData.studentName || "תלמיד/ה",
    seatNumber,
    generationLimit: Number(sessionData.generationLimit || getGenerationLimit(classData)),
    remainingGenerations: Math.max(
      Number(sessionData.generationLimit || getGenerationLimit(classData)) -
        Number(sessionData.generationsCount || 0),
      0
    ),
    promptSteps: sessionData.promptSteps || {
      character: "",
      place: "",
      action: "",
      style: "",
      detail: ""
    },
    isPromptComplete: Boolean(sessionData.isPromptComplete),
    message: ACTIVITY_CONFIG.resumeMessage
  };
});

exports.validatePromptSteps = onCall(getCallableOptions(), async (request) => {
  const { sessionRef, sessionData } = await loadSession(request.data?.sessionId);
  const { classRef } = await loadClassAccessCode(sessionData.classCode);
  const steps = sanitizePromptSteps(request.data?.steps);
  const validation = buildValidationResponse(steps);
  const draft = buildSessionDraft(steps, validation);

  await sessionRef.set(
    {
      ...draft,
      classCode: sessionData.classCode,
      lastSeenAt: FieldValue.serverTimestamp(),
      status: validation.isComplete ? "ready" : "building",
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  await touchSeatClaim(
    classRef,
    Number(sessionData.seatNumber || 0),
    sessionRef.id,
    sessionData.studentName || "תלמיד/ה"
  );

  return {
    ok: true,
    isComplete: validation.isComplete,
    missingSteps: validation.missingSteps,
    nextSuggestedStep: validation.nextSuggestedStep,
    message: validation.message
  };
});

exports.generateImage = onCall(
  getCallableOptions({
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 120,
    memory: "1GiB"
  }),
  async (request) => {
    const { sessionRef, sessionData } = await loadSession(request.data?.sessionId);
    const { classRef, classData, normalizedCode } = await loadClassAccessCode(
      sessionData.classCode
    );
    const steps = sanitizePromptSteps(request.data?.steps || sessionData.promptSteps);
    const validation = buildValidationResponse(steps);

    if (!validation.isComplete) {
    await sessionRef.set(
      {
        ...buildSessionDraft(steps, validation),
        lastSeenAt: FieldValue.serverTimestamp(),
        status: "building",
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      await touchSeatClaim(
        classRef,
        Number(sessionData.seatNumber || 0),
        sessionRef.id,
        sessionData.studentName || "תלמיד/ה"
      );

      return {
        ok: false,
        didGenerate: false,
        isComplete: false,
        missingSteps: validation.missingSteps,
        message: validation.message
      };
    }

    const generationLimit = getGenerationLimit(classData);
    const generationsCount = Number(sessionData.generationsCount || 0);

    if (generationsCount >= generationLimit) {
      return {
        ok: false,
        didGenerate: false,
        isComplete: true,
        missingSteps: [],
        message: ACTIVITY_CONFIG.limitReached
      };
    }

    const apiKey = normalizeSecretValue(GEMINI_API_KEY.value());

    if (!apiKey) {
      throw new HttpsError(
        "failed-precondition",
        "סוד Gemini API לא הוגדר ב-Firebase Functions."
      );
    }

    const ai = new GoogleGenAI({ apiKey });
    let finalPromptEnglish;
    let image;

    try {
      finalPromptEnglish = await buildFinalEnglishPrompt(ai, steps);
      image = await generateImageWithGemini(ai, finalPromptEnglish);
    } catch (error) {
      logger.error("Failed to generate an image from validated prompt steps", error);
      throw new HttpsError(
        "internal",
        "לא הצלחתי להכין פרומפט תקין לתמונה. נסו שוב בעוד רגע."
      );
    }

    const usageRef = db.collection("generationUsage").doc();
    const newGenerationCount = generationsCount + 1;

    await sessionRef.set(
      {
        ...buildSessionDraft(steps, validation),
        generationsCount: FieldValue.increment(1),
        lastGeneratedAt: FieldValue.serverTimestamp(),
        lastGeneratedPrompt: finalPromptEnglish,
        lastSeenAt: FieldValue.serverTimestamp(),
        status: "generated",
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    await touchSeatClaim(
      classRef,
      Number(sessionData.seatNumber || 0),
      sessionRef.id,
      sessionData.studentName || "תלמיד/ה"
    );

    await classRef.set(
      {
        lastGeneratedAt: FieldValue.serverTimestamp(),
        totalGenerations: FieldValue.increment(1)
      },
      { merge: true }
    );

    await usageRef.set({
      classCode: normalizedCode,
      createdAt: FieldValue.serverTimestamp(),
      finalPromptEnglish,
      generationIndex: newGenerationCount,
      imageMimeType: image.mimeType,
      model: ACTIVITY_CONFIG.imageModel,
      sessionId: sessionRef.id,
      stepSnapshot: steps,
      studentName: sessionData.studentName || "תלמיד/ה"
    });

    return {
      ok: true,
      didGenerate: true,
      imageDataUrl: `data:${image.mimeType};base64,${image.imageBase64}`,
      finalPromptEnglish,
      remainingGenerations: Math.max(generationLimit - newGenerationCount, 0),
      usageId: usageRef.id,
      message: ACTIVITY_CONFIG.generationSuccess
    };
  }
);
