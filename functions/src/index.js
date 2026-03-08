"use strict";

const admin = require("firebase-admin");
const { randomUUID, createHash } = require("node:crypto");
const { GoogleGenAI } = require("@google/genai");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { ACTIVITY_CONFIG } = require("./config/agentConfig");
const {
  buildFinalEnglishPrompt,
  buildFinalHebrewPrompt,
  buildSessionDraft,
  buildValidationResponse,
  containsHebrew,
  normalizeClassCode,
  normalizeSeed,
  sanitizePromptSteps,
  sanitizeStudentName
} = require("./lib/promptFlow");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const PROMPT_LAB_WEB_API_KEY = defineSecret("PROMPT_LAB_WEB_API_KEY");

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

function buildPublicSeatMapId(normalizedCode) {
  return createHash("sha256")
    .update(`${ACTIVITY_CONFIG.activitySlug}|${normalizedCode}`)
    .digest("hex")
    .slice(0, 24);
}

function buildClientFirebaseConfig(apiKey) {
  return {
    ...ACTIVITY_CONFIG.firebaseWebApp,
    apiKey
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

async function buildSeatMapPayload(classRef, classData, normalizedCode) {
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
    classLabel: classData.label || "",
    classCode: normalizedCode,
    publicSeatMapId: buildPublicSeatMapId(normalizedCode),
    seatCount,
    seats
  };
}

async function publishPublicSeatMap(seatMapPayload) {
  const publicSeatMapRef = db.collection("publicSeatMaps").doc(seatMapPayload.publicSeatMapId);

  await publicSeatMapRef.set(
    {
      classLabel: seatMapPayload.classLabel,
      seatCount: seatMapPayload.seatCount,
      seats: seatMapPayload.seats,
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
}

async function generateImageWithGemini(ai, finalPromptText, seed) {
  const config = {
    responseModalities: ["TEXT", "IMAGE"]
  };

  if (Number.isInteger(seed)) {
    config.seed = seed;
  }

  const response = await ai.models.generateContent({
    model: ACTIVITY_CONFIG.imageModel,
    contents: finalPromptText,
    config
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

function extractTextFromGeminiResponse(response) {
  if (typeof response?.text === "string" && response.text.trim()) {
    return response.text.trim();
  }

  const textParts = [];

  for (const candidate of response?.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (typeof part.text === "string" && part.text.trim()) {
        textParts.push(part.text.trim());
      }
    }
  }

  return textParts.join("\n").trim();
}

function parseJsonObjectFromText(text) {
  const rawText = String(text || "").trim();
  const withoutFence = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const jsonStart = withoutFence.indexOf("{");
  const jsonEnd = withoutFence.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error("Translation response did not include JSON.");
  }

  return JSON.parse(withoutFence.slice(jsonStart, jsonEnd + 1));
}

function sanitizeTranslatedSteps(rawSteps) {
  const translatedSteps = {
    character: String(rawSteps?.character || "").trim(),
    place: String(rawSteps?.place || "").trim(),
    action: String(rawSteps?.action || "").trim(),
    style: String(rawSteps?.style || "").trim(),
    detail: String(rawSteps?.detail || "").trim()
  };

  const hasMissingValue = Object.values(translatedSteps).some((value) => !value);
  const hasHebrewText = Object.values(translatedSteps).some((value) => containsHebrew(value));

  if (hasMissingValue || hasHebrewText) {
    throw new Error("Translation response was incomplete.");
  }

  return translatedSteps;
}

function buildPromptStepsHash(steps) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        character: String(steps?.character || ""),
        place: String(steps?.place || ""),
        action: String(steps?.action || ""),
        style: String(steps?.style || ""),
        detail: String(steps?.detail || "")
      })
    )
    .digest("hex");
}

function getCachedTranslatedSteps(sessionData, promptStepsHash) {
  if (!sessionData || sessionData.promptTranslationHash !== promptStepsHash) {
    return null;
  }

  try {
    return sanitizeTranslatedSteps(sessionData.translatedPromptStepsEnglish || {});
  } catch (error) {
    return null;
  }
}

async function translateStepsToEnglish(ai, steps) {
  const translationPrompt = [
    ACTIVITY_CONFIG.englishTranslationInstruction,
    "Student steps JSON:",
    JSON.stringify(steps)
  ].join("\n");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await ai.models.generateContent({
      model: ACTIVITY_CONFIG.textModel,
      contents: translationPrompt,
      config: {
        temperature: 0
      }
    });
    const responseText = extractTextFromGeminiResponse(response);

    try {
      return sanitizeTranslatedSteps(parseJsonObjectFromText(responseText));
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }
    }
  }

  throw new Error("Failed to translate prompt steps to English.");
}

function buildStoragePartition(sessionId) {
  return createHash("sha256").update(String(sessionId || "")).digest("hex").slice(0, 16);
}

async function saveGeneratedImageToStorage(image, sessionData, sessionId, usageId) {
  const bucket = storage.bucket();
  const fileExtension = image.mimeType === "image/jpeg" ? "jpg" : "png";
  const storagePartition = buildStoragePartition(sessionId);
  const filePath =
    `generated-images/${storagePartition}/seat-${String(sessionData.seatNumber || "00").padStart(2, "0")}/` +
    `${usageId}.${fileExtension}`;
  const downloadToken = randomUUID();
  const imageBuffer = Buffer.from(image.imageBase64, "base64");
  const file = bucket.file(filePath);

  await file.save(imageBuffer, {
    resumable: false,
    contentType: image.mimeType,
    metadata: {
      cacheControl: "public,max-age=31536000,immutable",
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
        sessionId: String(sessionId || "")
      }
    }
  });

  return {
    imageStoragePath: filePath,
    imageDownloadUrl:
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`
  };
}

function sanitizeDownloadFilename(filename, mimeType) {
  const fallbackExtension = mimeType === "image/jpeg" ? "jpg" : "png";
  const safeBaseName = String(filename || "funlab-image")
    .replace(/[^\w\u0590-\u05FF.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const baseName = safeBaseName || "funlab-image";

  if (/\.(png|jpg|jpeg)$/i.test(baseName)) {
    return baseName;
  }

  return `${baseName}.${fallbackExtension}`;
}

function buildAsciiFilename(filename, mimeType) {
  const fallbackExtension = mimeType === "image/jpeg" ? "jpg" : "png";
  const asciiName = String(filename || "funlab-image")
    .replace(/[^\x20-\x7E]+/g, "-")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  if (!asciiName) {
    return `funlab-image.${fallbackExtension}`;
  }

  if (/\.(png|jpg|jpeg)$/i.test(asciiName)) {
    return asciiName;
  }

  return `${asciiName}.${fallbackExtension}`;
}

function getTimestampMillis(value) {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  return 0;
}

function buildCreationHistoryItem(usageDoc) {
  const usageData = usageDoc.data() || {};

  return {
    usageId: usageDoc.id,
    generationIndex: Number(usageData.generationIndex || 0),
    createdAtMs: getTimestampMillis(usageData.createdAt),
    imagePreviewUrl: String(usageData.imageDownloadUrl || "").trim(),
    imageStoragePath: String(usageData.imageStoragePath || "").trim(),
    finalPromptEnglish: String(usageData.finalPromptEnglish || "").trim(),
    finalPromptHebrew: String(usageData.finalPromptHebrew || "").trim(),
    seed: normalizeSeed(usageData.seed),
    stepSnapshot: usageData.stepSnapshot || {
      character: "",
      place: "",
      action: "",
      style: "",
      detail: ""
    }
  };
}

async function loadStudentCreations(sessionId) {
  const snapshot = await db
    .collection("generationUsage")
    .where("sessionId", "==", sessionId)
    .get();

  return snapshot.docs
    .map((usageDoc) => buildCreationHistoryItem(usageDoc))
    .sort((left, right) => {
      if (right.createdAtMs !== left.createdAtMs) {
        return right.createdAtMs - left.createdAtMs;
      }

      return right.generationIndex - left.generationIndex;
    });
}

exports.getSeatMap = onCall(
  getCallableOptions({
    secrets: [PROMPT_LAB_WEB_API_KEY]
  }),
  async (request) => {
  const { classRef, classData, normalizedCode } = await loadClassAccessCode(
    request.data?.classCode
  );
  const seatMapPayload = await buildSeatMapPayload(classRef, classData, normalizedCode);
  const webApiKey = normalizeSecretValue(PROMPT_LAB_WEB_API_KEY.value());
  await publishPublicSeatMap(seatMapPayload);

  return {
    ok: true,
    ...seatMapPayload,
    firebaseConfig: webApiKey ? buildClientFirebaseConfig(webApiKey) : null
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
    currentSeed: null,
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
    promptTranslationHash: "",
    seatNumber,
    status: "joined",
    studentName,
    translatedPromptStepsEnglish: null,
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

  await publishPublicSeatMap(await buildSeatMapPayload(classRef, classData, normalizedCode));

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

  await publishPublicSeatMap(await buildSeatMapPayload(classRef, classData, normalizedCode));

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
    seed: normalizeSeed(sessionData.currentSeed),
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

exports.getStudentCreations = onCall(getCallableOptions(), async (request) => {
  const { sessionRef } = await loadSession(request.data?.sessionId);
  const items = await loadStudentCreations(sessionRef.id);

  return {
    ok: true,
    items
  };
});

exports.leaveActivity = onCall(getCallableOptions(), async (request) => {
  const { sessionRef, sessionData } = await loadSession(request.data?.sessionId);
  const { classRef, classData, normalizedCode } = await loadClassAccessCode(sessionData.classCode);
  const seatNumber = Number(sessionData.seatNumber || 0);

  await sessionRef.set(
    {
      leftAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
      status: "left",
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  if (Number.isInteger(seatNumber) && seatNumber > 0) {
    const seatRef = classRef.collection("seats").doc(formatSeatId(seatNumber));
    await seatRef.delete().catch((error) => {
      logger.error("Failed to release seat after leaveActivity", error);
    });
  }

  await publishPublicSeatMap(await buildSeatMapPayload(classRef, classData, normalizedCode));

  return {
    ok: true,
    message: "קמתם מהמקום. אפשר לבחור עכשיו מקום חדש."
  };
});

exports.validatePromptSteps = onCall(getCallableOptions(), async (request) => {
  const { sessionRef, sessionData } = await loadSession(request.data?.sessionId);
  const { classRef } = await loadClassAccessCode(sessionData.classCode);
  const steps = sanitizePromptSteps(request.data?.steps);
  const seed = normalizeSeed(request.data?.seed);
  const validation = buildValidationResponse(steps);
  const draft = buildSessionDraft(steps, validation);
  const promptStepsHash = buildPromptStepsHash(steps);
  const cachedTranslatedSteps = getCachedTranslatedSteps(sessionData, promptStepsHash);

  await sessionRef.set(
    {
      ...draft,
      classCode: sessionData.classCode,
      currentSeed: seed,
      lastSeenAt: FieldValue.serverTimestamp(),
      promptTranslationHash: cachedTranslatedSteps ? promptStepsHash : "",
      status: validation.isComplete ? "ready" : "building",
      translatedPromptStepsEnglish: cachedTranslatedSteps,
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
    const seed = normalizeSeed(request.data?.seed ?? sessionData.currentSeed);
    const validation = buildValidationResponse(steps);
    const promptStepsHash = buildPromptStepsHash(steps);

    if (!validation.isComplete) {
    await sessionRef.set(
      {
        ...buildSessionDraft(steps, validation),
        lastSeenAt: FieldValue.serverTimestamp(),
        promptTranslationHash: "",
        status: "building",
          translatedPromptStepsEnglish: null,
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
    let finalPromptHebrew;
    let finalPromptEnglish;
    let translatedPromptStepsEnglish;
    let image;

    try {
      finalPromptHebrew = buildFinalHebrewPrompt(steps);
      translatedPromptStepsEnglish =
        getCachedTranslatedSteps(sessionData, promptStepsHash) ||
        await translateStepsToEnglish(ai, steps);
      finalPromptEnglish = buildFinalEnglishPrompt(
        translatedPromptStepsEnglish,
        ACTIVITY_CONFIG.imagePromptGuardrailsEnglish
      );
      image = await generateImageWithGemini(ai, finalPromptEnglish, seed);
    } catch (error) {
      logger.error("Failed to generate an image from validated prompt steps", error);
      throw new HttpsError(
        "internal",
        "לא הצלחתי להכין פרומפט תקין לתמונה. נסו שוב בעוד רגע."
      );
    }

    const usageRef = db.collection("generationUsage").doc();
    let storedImage = {
      imageStoragePath: "",
      imageDownloadUrl: ""
    };

    try {
      storedImage = await saveGeneratedImageToStorage(
        image,
        sessionData,
        sessionRef.id,
        usageRef.id
      );
    } catch (error) {
      logger.error("Failed to save generated image to Firebase Storage", error);
    }

    const newGenerationCount = generationsCount + 1;

    await sessionRef.set(
      {
        ...buildSessionDraft(steps, validation),
        generationsCount: FieldValue.increment(1),
        lastGeneratedAt: FieldValue.serverTimestamp(),
        lastGeneratedImagePath: storedImage.imageStoragePath || "",
        lastGeneratedImageUrl: storedImage.imageDownloadUrl || "",
        lastGeneratedPromptEnglish: finalPromptEnglish,
        lastGeneratedPrompt: finalPromptHebrew,
        currentSeed: seed,
        lastUsedSeed: seed,
        lastSeenAt: FieldValue.serverTimestamp(),
        promptTranslationHash: promptStepsHash,
        status: "generated",
        translatedPromptStepsEnglish,
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
      finalPromptHebrew,
      generationIndex: newGenerationCount,
      imageDownloadUrl: storedImage.imageDownloadUrl || "",
      imageMimeType: image.mimeType,
      imageStoragePath: storedImage.imageStoragePath || "",
      model: ACTIVITY_CONFIG.imageModel,
      seed,
      sessionId: sessionRef.id,
      stepSnapshot: steps,
      studentName: sessionData.studentName || "תלמיד/ה"
    });

    return {
      ok: true,
      didGenerate: true,
      imageDataUrl: `data:${image.mimeType};base64,${image.imageBase64}`,
      imageDownloadUrl: storedImage.imageDownloadUrl || "",
      imageStoragePath: storedImage.imageStoragePath || "",
      finalPromptEnglish,
      finalPromptHebrew,
      remainingGenerations: Math.max(generationLimit - newGenerationCount, 0),
      seed,
      usageId: usageRef.id,
      message: ACTIVITY_CONFIG.generationSuccess
    };
  }
);

exports.downloadGeneratedImage = onRequest(getCallableOptions(), async (request, response) => {
  if (request.method !== "GET") {
    response.set("Allow", "GET");
    response.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const usageId = String(request.query.usageId || "").trim();

    if (!usageId) {
      response.status(400).send("Missing usageId.");
      return;
    }

    const usageSnapshot = await db.collection("generationUsage").doc(usageId).get();

    if (!usageSnapshot.exists) {
      response.status(404).send("Image not found.");
      return;
    }

    const usageData = usageSnapshot.data() || {};
    const imageStoragePath = String(usageData.imageStoragePath || "").trim();
    const imageMimeType = String(usageData.imageMimeType || "image/png").trim() || "image/png";

    if (!imageStoragePath) {
      response.status(404).send("Stored image is not available.");
      return;
    }

    const bucket = storage.bucket();
    const file = bucket.file(imageStoragePath);
    const [exists] = await file.exists();

    if (!exists) {
      response.status(404).send("Stored image file was not found.");
      return;
    }

    const requestedFilename = sanitizeDownloadFilename(
      request.query.filename,
      imageMimeType
    );
    const asciiFilename = buildAsciiFilename(requestedFilename, imageMimeType);

    response.setHeader("Content-Type", imageMimeType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(requestedFilename)}`
    );
    response.setHeader("Cache-Control", "private, max-age=0, must-revalidate");

    file.createReadStream()
      .on("error", (error) => {
        logger.error("Failed while streaming generated image download", error);

        if (!response.headersSent) {
          response.status(500).send("Failed to download image.");
          return;
        }

        response.end();
      })
      .pipe(response);
  } catch (error) {
    logger.error("downloadGeneratedImage failed", error);
    response.status(500).send("Failed to download image.");
  }
});
