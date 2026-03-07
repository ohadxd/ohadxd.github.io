"use strict";

const admin = require("firebase-admin");
const { randomUUID } = require("node:crypto");
const { GoogleGenAI } = require("@google/genai");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { ACTIVITY_CONFIG } = require("./config/agentConfig");
const {
  buildFinalHebrewPrompt,
  buildSessionDraft,
  buildValidationResponse,
  normalizeClassCode,
  sanitizePromptSteps,
  sanitizeStudentName
} = require("./lib/promptFlow");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();
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

async function generateImageWithGemini(ai, finalPromptHebrew) {
  const response = await ai.models.generateContent({
    model: ACTIVITY_CONFIG.imageModel,
    contents: finalPromptHebrew,
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

async function saveGeneratedImageToStorage(image, sessionData, sessionId, normalizedCode, usageId) {
  const bucket = storage.bucket();
  const fileExtension = image.mimeType === "image/jpeg" ? "jpg" : "png";
  const filePath =
    `generated-images/${normalizedCode}/seat-${String(sessionData.seatNumber || "00").padStart(2, "0")}/` +
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
        classCode: normalizedCode,
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
    let finalPromptHebrew;
    let image;

    try {
      finalPromptHebrew = buildFinalHebrewPrompt(steps);
      image = await generateImageWithGemini(ai, finalPromptHebrew);
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
        normalizedCode,
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
        lastGeneratedPrompt: finalPromptHebrew,
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
      finalPromptHebrew,
      generationIndex: newGenerationCount,
      imageDownloadUrl: storedImage.imageDownloadUrl || "",
      imageMimeType: image.mimeType,
      imageStoragePath: storedImage.imageStoragePath || "",
      model: ACTIVITY_CONFIG.imageModel,
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
      finalPromptHebrew,
      remainingGenerations: Math.max(generationLimit - newGenerationCount, 0),
      usageId: usageRef.id,
      message: ACTIVITY_CONFIG.generationSuccess
    };
  }
);
