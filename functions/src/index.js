"use strict";

const admin = require("firebase-admin");
const { GoogleGenAI } = require("@google/genai");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const {
  ACTIVITY_CONFIG,
  ENGLISH_PROMPT_SYSTEM_INSTRUCTION
} = require("./config/agentConfig");
const {
  buildFallbackEnglishPrompt,
  buildSessionDraft,
  buildValidationResponse,
  getStepTemplatePayload,
  normalizeClassCode,
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

async function buildFinalEnglishPrompt(ai, steps) {
  const payload = JSON.stringify(getStepTemplatePayload(steps), null, 2);

  try {
    const response = await ai.models.generateContent({
      model: ACTIVITY_CONFIG.textModel,
      config: {
        temperature: 0.2,
        maxOutputTokens: 180,
        systemInstruction: ENGLISH_PROMPT_SYSTEM_INSTRUCTION
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Turn these validated Hebrew image-building steps into one English prompt:\n" +
                payload
            }
          ]
        }
      ]
    });

    const finalPrompt = (response.text || "").replace(/\s+/g, " ").trim();

    if (finalPrompt) {
      return finalPrompt;
    }
  } catch (error) {
    logger.error("Failed to build final English prompt with Gemini text model", error);
  }

  return buildFallbackEnglishPrompt(steps);
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

exports.joinActivity = onCall(getCallableOptions(), async (request) => {
  const studentName = sanitizeStudentName(request.data?.studentName);
  const { classRef, classData, normalizedCode } = await loadClassAccessCode(
    request.data?.classCode
  );

  const sessionRef = db.collection("studentSessions").doc();
  const generationLimit = getGenerationLimit(classData);
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
    status: "joined",
    studentName,
    updatedAt: FieldValue.serverTimestamp()
  };

  await sessionRef.set(sessionPayload);
  await classRef.set(
    {
      activitySlug: ACTIVITY_CONFIG.activitySlug,
      lastJoinedAt: FieldValue.serverTimestamp(),
      participantsCount: FieldValue.increment(1),
      totalSessions: FieldValue.increment(1)
    },
    { merge: true }
  );

  return {
    ok: true,
    sessionId: sessionRef.id,
    classCode: normalizedCode,
    classLabel: classData.label || "",
    studentName,
    generationLimit,
    remainingGenerations: generationLimit,
    message: ACTIVITY_CONFIG.welcomeMessage
  };
});

exports.validatePromptSteps = onCall(getCallableOptions(), async (request) => {
  const { sessionRef, sessionData } = await loadSession(request.data?.sessionId);
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

    const apiKey = GEMINI_API_KEY.value();

    if (!apiKey) {
      throw new HttpsError(
        "failed-precondition",
        "סוד Gemini API לא הוגדר ב-Firebase Functions."
      );
    }

    const ai = new GoogleGenAI({ apiKey });
    const finalPromptEnglish = await buildFinalEnglishPrompt(ai, steps);
    const image = await generateImageWithGemini(ai, finalPromptEnglish);
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
