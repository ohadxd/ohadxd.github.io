"use strict";

const admin = require("firebase-admin");
const { randomUUID, createHash } = require("node:crypto");
const { BigQuery } = require("@google-cloud/bigquery");
const { GoogleGenAI } = require("@google/genai");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const {
  ACTIVITY_CONFIG,
  DEFAULT_LESSON_KEY
} = require("./config/agentConfig");
const {
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
} = require("./lib/promptFlow");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();
const bigquery = new BigQuery();
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const PROMPT_LAB_WEB_API_KEY = defineSecret("PROMPT_LAB_WEB_API_KEY");
const ADMIN_USERNAME = defineSecret("ADMIN_USERNAME");
const ADMIN_PASSWORD = defineSecret("ADMIN_PASSWORD");

function getCallableOptions(extra = {}) {
  return {
    region: ACTIVITY_CONFIG.region,
    ...extra
  };
}

function getAdminConfigRef() {
  return db
    .collection(ACTIVITY_CONFIG.adminConfigCollection)
    .doc(ACTIVITY_CONFIG.adminConfigDocId);
}

function getAllowedProviderValues() {
  return new Set(ACTIVITY_CONFIG.supportedProviders.map((item) => item.value));
}

function getAllowedModelValues(provider) {
  return new Set((ACTIVITY_CONFIG.providerModelCatalog[provider] || []).map((item) => item.value));
}

function sanitizePromptLabAdminConfig(rawData = {}) {
  const defaults = ACTIVITY_CONFIG.adminPromptLabDefaults;
  const allowedProviders = getAllowedProviderValues();
  const activeProvider = allowedProviders.has(String(rawData.activeProvider || "").trim())
    ? String(rawData.activeProvider).trim()
    : defaults.activeProvider;
  const geminiModelValue = String(rawData.geminiImageModel || "").trim();
  const openAiModelValue = String(rawData.openAiImageModel || "").trim();
  const allowedGeminiModels = getAllowedModelValues("gemini");
  const allowedOpenAiModels = getAllowedModelValues("openai");
  const geminiGuidanceScale = Number(rawData.geminiGuidanceScale);
  const spendLookbackDays = Number(rawData.spendLookbackDays);
  const allowedGeminiAspectRatios = new Set(["1:1", "3:4", "4:3", "9:16", "16:9"]);
  const allowedGeminiImageSizes = new Set(["1K", "2K"]);
  const allowedOpenAiQualities = new Set(["low", "medium", "high", "auto"]);
  const allowedOpenAiSizes = new Set(["1024x1024", "1536x1024", "1024x1536", "auto"]);
  const allowedBillingLocations = new Set(["US", "EU", "us", "eu"]);

  return {
    activeProvider,
    geminiImageModel: allowedGeminiModels.has(geminiModelValue)
      ? geminiModelValue
      : defaults.geminiImageModel,
    geminiAspectRatio: allowedGeminiAspectRatios.has(String(rawData.geminiAspectRatio || "").trim())
      ? String(rawData.geminiAspectRatio).trim()
      : defaults.geminiAspectRatio,
    geminiImageSize: allowedGeminiImageSizes.has(String(rawData.geminiImageSize || "").trim())
      ? String(rawData.geminiImageSize).trim()
      : defaults.geminiImageSize,
    geminiGuidanceScale:
      Number.isFinite(geminiGuidanceScale) && geminiGuidanceScale >= 1 && geminiGuidanceScale <= 20
        ? Number(geminiGuidanceScale.toFixed(1))
        : defaults.geminiGuidanceScale,
    openAiImageModel: allowedOpenAiModels.has(openAiModelValue)
      ? openAiModelValue
      : defaults.openAiImageModel,
    openAiImageQuality: allowedOpenAiQualities.has(String(rawData.openAiImageQuality || "").trim())
      ? String(rawData.openAiImageQuality).trim()
      : defaults.openAiImageQuality,
    openAiImageSize: allowedOpenAiSizes.has(String(rawData.openAiImageSize || "").trim())
      ? String(rawData.openAiImageSize).trim()
      : defaults.openAiImageSize,
    googleBillingProjectId: String(rawData.googleBillingProjectId || "").trim().slice(0, 80),
    googleBillingLocation: allowedBillingLocations.has(String(rawData.googleBillingLocation || "").trim())
      ? String(rawData.googleBillingLocation).trim().toUpperCase()
      : defaults.googleBillingLocation,
    googleBillingDataset: String(rawData.googleBillingDataset || "").trim().slice(0, 128),
    googleBillingTable: String(rawData.googleBillingTable || "").trim().slice(0, 256),
    spendLookbackDays:
      Number.isInteger(spendLookbackDays) && spendLookbackDays >= 1 && spendLookbackDays <= 60
        ? spendLookbackDays
        : defaults.spendLookbackDays
  };
}

async function loadPromptLabAdminConfig() {
  const configSnapshot = await getAdminConfigRef().get();
  const rawData = configSnapshot.exists ? configSnapshot.data() : {};

  return sanitizePromptLabAdminConfig(rawData);
}

function buildProviderStatus(secretValues = {}) {
  return {
    geminiKeyConfigured: Boolean(secretValues.geminiApiKey),
    openAiKeyConfigured: Boolean(secretValues.openAiApiKey),
    googleBillingConfigured: Boolean(
      secretValues.googleBillingProjectId &&
      secretValues.googleBillingLocation &&
      secretValues.googleBillingDataset &&
      secretValues.googleBillingTable
    )
  };
}

function serializePromptLabAdminConfig(config, secretValues = {}) {
  return {
    settings: config,
    supportedProviders: ACTIVITY_CONFIG.supportedProviders,
    providerModelCatalog: ACTIVITY_CONFIG.providerModelCatalog,
    providerStatus: buildProviderStatus({
      ...secretValues,
      googleBillingProjectId: config.googleBillingProjectId,
      googleBillingLocation: config.googleBillingLocation,
      googleBillingDataset: config.googleBillingDataset,
      googleBillingTable: config.googleBillingTable
    })
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

function getSecretOrThrow(secretRef, message) {
  const value = normalizeSecretValue(secretRef.value());

  if (!value) {
    throw new HttpsError("failed-precondition", message);
  }

  return value;
}

function normalizeAdminUsername(value) {
  return String(value || "").trim().toLowerCase().slice(0, 64);
}

function buildAdminSessionExpiry(date = new Date()) {
  return Timestamp.fromDate(new Date(date.getTime() + 8 * 60 * 60 * 1000));
}

async function requireAdminSession(sessionToken) {
  assertStringValue(sessionToken, "permission-denied", "חסר טוקן ניהול.");

  const adminSessionRef = db.collection("adminSessions").doc(sessionToken.trim());
  const adminSessionSnapshot = await adminSessionRef.get();

  if (!adminSessionSnapshot.exists) {
    throw new HttpsError("permission-denied", "סשן הניהול לא תקף. התחברו מחדש.");
  }

  const adminSession = adminSessionSnapshot.data() || {};
  const expiresAt = adminSession.expiresAt instanceof Timestamp
    ? adminSession.expiresAt.toDate()
    : null;

  if (!expiresAt || expiresAt.getTime() <= Date.now()) {
    await adminSessionRef.delete().catch(() => {});
    throw new HttpsError("permission-denied", "סשן הניהול פג. התחברו מחדש.");
  }

  await adminSessionRef.set(
    {
      lastSeenAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return {
    adminSessionRef,
    adminSession
  };
}

function serializeClassAccessCode(classDoc) {
  const data = classDoc.data() || {};
  const lessonKey = sanitizeLessonKey(data.lessonKey || DEFAULT_LESSON_KEY);
  const lesson = getLessonDefinition(lessonKey);

  return {
    code: classDoc.id,
    label: String(data.label || "").trim(),
    isActive: data.isActive !== false,
    activitySlug: String(data.activitySlug || ACTIVITY_CONFIG.activitySlug).trim() || ACTIVITY_CONFIG.activitySlug,
    lessonKey,
    lessonTitle: lesson.title,
    seatCount: getSeatCount(data),
    allowedGenerationsPerStudent: getGenerationLimit(data),
    comicSeatCount: getLessonSeatCount(data, "comic-lab"),
    comicGenerationsPerStudent: getLessonGenerationLimit(data, "comic-lab"),
    totalGenerations: Number(data.totalGenerations || 0),
    totalSessions: Number(data.totalSessions || 0),
    participantsCount: Number(data.participantsCount || 0),
    expiresAtMs: data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0
  };
}

function sanitizeClassAdminPayload(rawData = {}) {
  const code = normalizeClassCode(rawData.classCode);
  const label = String(rawData.label || "").trim().slice(0, 80);
  const seatCount = Number(rawData.seatCount);
  const allowedGenerationsPerStudent = Number(rawData.allowedGenerationsPerStudent);
  const lessonKey = sanitizeLessonKey(rawData.lessonKey || DEFAULT_LESSON_KEY);
  const defaultSeatCount =
    lessonKey === "comic-lab" ? ACTIVITY_CONFIG.comicSeatCount : ACTIVITY_CONFIG.defaultSeatCount;
  const defaultGenerationLimit =
    lessonKey === "comic-lab"
      ? ACTIVITY_CONFIG.comicGenerationsPerStudent
      : ACTIVITY_CONFIG.defaultGenerationsPerStudent;

  if (!code) {
    throw new HttpsError("invalid-argument", "יש להזין קוד כיתה תקין.");
  }

  return {
    classCode: code,
    label: label || code,
    lessonKey,
    isActive: rawData.isActive !== false,
    seatCount:
      Number.isInteger(seatCount) && seatCount >= 1 && seatCount <= 60
        ? seatCount
        : defaultSeatCount,
    allowedGenerationsPerStudent:
      Number.isInteger(allowedGenerationsPerStudent) &&
      allowedGenerationsPerStudent >= 1 &&
      allowedGenerationsPerStudent <= 20
        ? allowedGenerationsPerStudent
        : defaultGenerationLimit
  };
}

async function loadClassAccessCode(classCode, lessonKey = DEFAULT_LESSON_KEY) {
  const normalizedCode = normalizeClassCode(classCode);
  const requestedLessonKey = sanitizeLessonKey(lessonKey);

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

  const classLessonKey = sanitizeLessonKey(classData.lessonKey || DEFAULT_LESSON_KEY);

  if (classLessonKey !== requestedLessonKey) {
    throw new HttpsError("failed-precondition", ACTIVITY_CONFIG.invalidLessonCode);
  }

  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new HttpsError("failed-precondition", ACTIVITY_CONFIG.expiredClassCode);
  }

  return {
    classRef,
    classData,
    classLessonKey,
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

function getLessonGenerationLimit(classData, lessonKey = DEFAULT_LESSON_KEY) {
  const lesson = getLessonDefinition(lessonKey);

  if (lesson.key === "comic-lab") {
    const rawComicLimit = Number(classData.comicGenerationsPerStudent);

    if (Number.isFinite(rawComicLimit) && rawComicLimit > 0) {
      return Math.floor(rawComicLimit);
    }

    return ACTIVITY_CONFIG.comicGenerationsPerStudent;
  }

  return getGenerationLimit(classData);
}

function getSeatCount(classData) {
  const rawSeatCount = Number(classData.seatCount);

  if (Number.isFinite(rawSeatCount) && rawSeatCount > 0) {
    return Math.floor(rawSeatCount);
  }

  return ACTIVITY_CONFIG.defaultSeatCount;
}

function getLessonSeatCount(classData, lessonKey = DEFAULT_LESSON_KEY) {
  const lesson = getLessonDefinition(lessonKey);

  if (lesson.key === "comic-lab") {
    const rawComicSeatCount = Number(classData.comicSeatCount);

    if (Number.isFinite(rawComicSeatCount) && rawComicSeatCount > 0) {
      return Math.floor(rawComicSeatCount);
    }

    return ACTIVITY_CONFIG.comicSeatCount;
  }

  return getSeatCount(classData);
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

function buildProviderSelection(config) {
  const activeProvider = config.activeProvider === "openai" ? "openai" : "gemini";

  if (activeProvider === "openai") {
    return {
      provider: "openai",
      imageModel: config.openAiImageModel,
      openAiImageQuality: config.openAiImageQuality,
      openAiImageSize: config.openAiImageSize,
      supportsSeed: false
    };
  }

  return {
    provider: "gemini",
    imageModel: config.geminiImageModel,
    geminiAspectRatio: config.geminiAspectRatio,
    geminiGuidanceScale: config.geminiGuidanceScale,
    geminiImageSize: config.geminiImageSize,
    supportsSeed: config.geminiImageModel === "gemini-2.5-flash-image"
  };
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

async function generateImageWithImagen(ai, finalPromptText, seed, promptConfig) {
  const imageConfig = {
    numberOfImages: 1,
    aspectRatio: promptConfig.geminiAspectRatio,
    outputMimeType: "image/png"
  };

  if (Number.isInteger(seed)) {
    imageConfig.seed = seed;
  }

  if (promptConfig.imageModel === "imagen-4.0-generate-001") {
    imageConfig.imageSize = promptConfig.geminiImageSize;
  }

  const response = await ai.models.generateImages({
    model: promptConfig.imageModel,
    prompt: finalPromptText,
    config: imageConfig
  });
  const firstImage = response.generatedImages?.[0]?.image;
  const imageBase64 = String(firstImage?.imageBytes || "").trim();

  if (!imageBase64) {
    throw new Error("Imagen generation did not return image data.");
  }

  return {
    imageBase64,
    mimeType: String(firstImage?.mimeType || "image/png").trim() || "image/png"
  };
}

async function fetchOpenAiJson(url, apiKey, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      String(payload?.error?.message || `OpenAI request failed with status ${response.status}.`)
    );
  }

  return payload;
}

async function generateImageWithOpenAi(apiKey, finalPromptText, promptConfig) {
  const payload = await fetchOpenAiJson("https://api.openai.com/v1/images/generations", apiKey, {
    method: "POST",
    body: JSON.stringify({
      model: promptConfig.imageModel,
      prompt: finalPromptText,
      quality: promptConfig.openAiImageQuality,
      size: promptConfig.openAiImageSize
    })
  });
  const imageBase64 = String(payload?.data?.[0]?.b64_json || "").trim();

  if (!imageBase64) {
    throw new Error("OpenAI image generation did not return image data.");
  }

  return {
    imageBase64,
    mimeType: "image/png",
    usage: payload?.usage || null
  };
}

function buildUtcMidnightDate(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function buildDayBuckets(days) {
  const safeDays = Math.max(1, Math.min(60, Number(days) || ACTIVITY_CONFIG.adminPromptLabDefaults.spendLookbackDays));
  const todayUtc = buildUtcMidnightDate();
  const firstDay = new Date(todayUtc.getTime() - (safeDays - 1) * 24 * 60 * 60 * 1000);
  const startSeconds = Math.floor(firstDay.getTime() / 1000);
  const endSeconds = Math.floor((todayUtc.getTime() + 24 * 60 * 60 * 1000) / 1000);

  return {
    safeDays,
    startSeconds,
    endSeconds
  };
}

function formatUtcDayKeyFromSeconds(value) {
  const safeDate = new Date(Number(value || 0) * 1000);
  return safeDate.toISOString().slice(0, 10);
}

function formatCurrencyValue(value) {
  return Number((Number(value) || 0).toFixed(4));
}

function parseOpenAiCostBuckets(payload) {
  const buckets = Array.isArray(payload?.data) ? payload.data : [];

  return buckets.map((bucket) => {
    const results = Array.isArray(bucket?.results) ? bucket.results : [];
    const amount = results.reduce((sum, item) => sum + Number(item?.amount?.value || 0), 0);

    return {
      day: formatUtcDayKeyFromSeconds(bucket?.start_time),
      usd: formatCurrencyValue(amount)
    };
  });
}

function parseOpenAiImageUsageBuckets(payload) {
  const buckets = Array.isArray(payload?.data) ? payload.data : [];

  return buckets.map((bucket) => {
    const results = Array.isArray(bucket?.results) ? bucket.results : [];
    const images = results.reduce((sum, item) => {
      const candidateKeys = ["images", "num_images", "generated_images", "output_images"];

      for (const key of candidateKeys) {
        const numericValue = Number(item?.[key]);

        if (Number.isFinite(numericValue) && numericValue >= 0) {
          return sum + numericValue;
        }
      }

      return sum;
    }, 0);

    return {
      day: formatUtcDayKeyFromSeconds(bucket?.start_time),
      images: Math.floor(images)
    };
  });
}

function mergeDailySpendRows(costRows, usageRows) {
  const rowMap = new Map();

  for (const row of costRows) {
    rowMap.set(row.day, {
      day: row.day,
      openAiUsd: row.usd,
      openAiImages: 0,
      googleUsd: 0
    });
  }

  for (const row of usageRows) {
    const existing = rowMap.get(row.day) || {
      day: row.day,
      openAiUsd: 0,
      openAiImages: 0,
      googleUsd: 0
    };
    existing.openAiImages = row.images;
    rowMap.set(row.day, existing);
  }

  return rowMap;
}

async function loadOpenAiSpendReport(apiKey, days) {
  const { safeDays, startSeconds, endSeconds } = buildDayBuckets(days);
  const commonParams = new URLSearchParams({
    start_time: String(startSeconds),
    end_time: String(endSeconds),
    bucket_width: "1d"
  });
  const costsUrl = `https://api.openai.com/v1/organization/costs?${commonParams.toString()}`;
  const usageUrl = `https://api.openai.com/v1/organization/usage/images?${commonParams.toString()}`;
  const [costPayload, usagePayload] = await Promise.all([
    fetchOpenAiJson(costsUrl, apiKey),
    fetchOpenAiJson(usageUrl, apiKey)
  ]);
  const mergedRows = mergeDailySpendRows(
    parseOpenAiCostBuckets(costPayload),
    parseOpenAiImageUsageBuckets(usagePayload)
  );

  return {
    days: safeDays,
    rowMap: mergedRows
  };
}

async function loadGoogleBillingSpendReport(config, days) {
  if (!config.googleBillingProjectId || !config.googleBillingDataset || !config.googleBillingTable) {
    return {
      days,
      rowMap: new Map(),
      needsSetup: true
    };
  }

  const tablePath =
    `\`${config.googleBillingProjectId}.${config.googleBillingDataset}.${config.googleBillingTable}\``;
  const { safeDays } = buildDayBuckets(days);
  const todayUtc = buildUtcMidnightDate();
  const firstDay = new Date(todayUtc.getTime() - (safeDays - 1) * 24 * 60 * 60 * 1000);
  const [rows] = await bigquery.query({
    query: [
      "SELECT",
      "  FORMAT_DATE('%F', DATE(usage_start_time)) AS day,",
      "  ROUND(SUM(CAST(cost AS NUMERIC)), 4) AS usd",
      `FROM ${tablePath}`,
      "WHERE DATE(usage_start_time) BETWEEN @startDate AND @endDate",
      "GROUP BY day",
      "ORDER BY day DESC"
    ].join("\n"),
    location: config.googleBillingLocation || "US",
    params: {
      startDate: firstDay.toISOString().slice(0, 10),
      endDate: todayUtc.toISOString().slice(0, 10)
    }
  });
  const rowMap = new Map();

  for (const row of rows) {
    rowMap.set(String(row.day), {
      day: String(row.day),
      googleUsd: formatCurrencyValue(row.usd || 0)
    });
  }

  return {
    days: safeDays,
    rowMap,
    needsSetup: false
  };
}

function buildSpendReportRows(days, openAiReport, googleReport) {
  const { safeDays } = buildDayBuckets(days);
  const todayUtc = buildUtcMidnightDate();
  const rows = [];

  for (let offset = 0; offset < safeDays; offset += 1) {
    const dayDate = new Date(todayUtc.getTime() - offset * 24 * 60 * 60 * 1000);
    const dayKey = dayDate.toISOString().slice(0, 10);
    const openAiRow = openAiReport?.rowMap?.get(dayKey) || {};
    const googleRow = googleReport?.rowMap?.get(dayKey) || {};
    const openAiUsd = formatCurrencyValue(openAiRow.openAiUsd || 0);
    const googleUsd = formatCurrencyValue(googleRow.googleUsd || 0);

    rows.push({
      day: dayKey,
      openAiUsd,
      openAiImages: Number(openAiRow.openAiImages || 0),
      googleUsd,
      totalUsd: formatCurrencyValue(openAiUsd + googleUsd)
    });
  }

  return rows;
}

function buildSpendTotals(rows) {
  return rows.reduce(
    (totals, row) => {
      totals.openAiUsd = formatCurrencyValue(totals.openAiUsd + row.openAiUsd);
      totals.googleUsd = formatCurrencyValue(totals.googleUsd + row.googleUsd);
      totals.totalUsd = formatCurrencyValue(totals.totalUsd + row.totalUsd);
      totals.openAiImages += Number(row.openAiImages || 0);
      return totals;
    },
    {
      openAiUsd: 0,
      googleUsd: 0,
      totalUsd: 0,
      openAiImages: 0
    }
  );
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

function buildComicBlueprintHash(steps) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        character: String(steps?.character || ""),
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
    lessonKey: sanitizeLessonKey(usageData.lessonKey),
    provider: String(usageData.provider || "").trim(),
    model: String(usageData.model || "").trim(),
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

exports.adminLogin = onCall(
  getCallableOptions({
    secrets: [ADMIN_USERNAME, ADMIN_PASSWORD]
  }),
  async (request) => {
    const username = normalizeAdminUsername(request.data?.username);
    const password = String(request.data?.password || "");
    const expectedUsername = normalizeAdminUsername(
      getSecretOrThrow(ADMIN_USERNAME, "סוד ADMIN_USERNAME לא הוגדר.")
    );
    const expectedPassword = getSecretOrThrow(
      ADMIN_PASSWORD,
      "סוד ADMIN_PASSWORD לא הוגדר."
    );

    if (username !== expectedUsername || password !== expectedPassword) {
      throw new HttpsError("permission-denied", "שם המשתמש או הסיסמה שגויים.");
    }

    const sessionToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

    await db.collection("adminSessions").doc(sessionToken).set({
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: buildAdminSessionExpiry(),
      lastSeenAt: FieldValue.serverTimestamp(),
      username: expectedUsername
    });

    return {
      ok: true,
      sessionToken,
      username: expectedUsername,
      expiresAtMs: Date.now() + 8 * 60 * 60 * 1000
    };
  }
);

exports.adminLogout = onCall(getCallableOptions(), async (request) => {
  const sessionToken = String(request.data?.sessionToken || "").trim();

  if (sessionToken) {
    await db.collection("adminSessions").doc(sessionToken).delete().catch(() => {});
  }

  return {
    ok: true
  };
});

exports.adminListClasses = onCall(getCallableOptions(), async (request) => {
  await requireAdminSession(request.data?.sessionToken);
  const snapshot = await db.collection("classAccessCodes").get();
  const items = snapshot.docs
    .map((classDoc) => serializeClassAccessCode(classDoc))
    .sort((left, right) => left.code.localeCompare(right.code, "en"));

  return {
    ok: true,
    items
  };
});

exports.adminUpsertClass = onCall(getCallableOptions(), async (request) => {
  await requireAdminSession(request.data?.sessionToken);
  const payload = sanitizeClassAdminPayload(request.data);
  const classRef = db.collection("classAccessCodes").doc(payload.classCode);

  await classRef.set(
    {
      activitySlug: ACTIVITY_CONFIG.activitySlug,
      allowedGenerationsPerStudent: payload.allowedGenerationsPerStudent,
      comicGenerationsPerStudent:
        payload.lessonKey === "comic-lab"
          ? payload.allowedGenerationsPerStudent
          : ACTIVITY_CONFIG.comicGenerationsPerStudent,
      isActive: payload.isActive,
      label: payload.label,
      lessonKey: payload.lessonKey,
      seatCount: payload.seatCount,
      comicSeatCount:
        payload.lessonKey === "comic-lab" ? payload.seatCount : ACTIVITY_CONFIG.comicSeatCount,
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  const classSnapshot = await classRef.get();

  return {
    ok: true,
    item: serializeClassAccessCode(classSnapshot)
  };
});

exports.adminSetClassActive = onCall(getCallableOptions(), async (request) => {
  await requireAdminSession(request.data?.sessionToken);
  const classCode = normalizeClassCode(request.data?.classCode);

  if (!classCode) {
    throw new HttpsError("invalid-argument", "יש להזין קוד כיתה תקין.");
  }

  const classRef = db.collection("classAccessCodes").doc(classCode);
  const classSnapshot = await classRef.get();

  if (!classSnapshot.exists) {
    throw new HttpsError("not-found", "קוד הכיתה לא נמצא.");
  }

  await classRef.set(
    {
      isActive: request.data?.isActive !== false,
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  const updatedSnapshot = await classRef.get();

  return {
    ok: true,
    item: serializeClassAccessCode(updatedSnapshot)
  };
});

exports.adminGetPromptLabSettings = onCall(
  getCallableOptions({
    secrets: [GEMINI_API_KEY, OPENAI_API_KEY]
  }),
  async (request) => {
    await requireAdminSession(request.data?.sessionToken);
    const settings = await loadPromptLabAdminConfig();

    return {
      ok: true,
      ...serializePromptLabAdminConfig(settings, {
        geminiApiKey: normalizeSecretValue(GEMINI_API_KEY.value()),
        openAiApiKey: normalizeSecretValue(OPENAI_API_KEY.value())
      })
    };
  }
);

exports.adminSavePromptLabSettings = onCall(getCallableOptions(), async (request) => {
  await requireAdminSession(request.data?.sessionToken);
  const settings = sanitizePromptLabAdminConfig(request.data?.settings || {});

  await getAdminConfigRef().set(
    {
      ...settings,
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return {
    ok: true,
    settings
  };
});

exports.adminGetSpendReport = onCall(
  getCallableOptions({
    secrets: [OPENAI_API_KEY]
  }),
  async (request) => {
    await requireAdminSession(request.data?.sessionToken);
    const settings = await loadPromptLabAdminConfig();
    const requestedDays = Number(request.data?.days);
    const days =
      Number.isInteger(requestedDays) && requestedDays >= 1 && requestedDays <= 60
        ? requestedDays
        : settings.spendLookbackDays;
    const openAiApiKey = normalizeSecretValue(OPENAI_API_KEY.value());
    let openAiError = "";
    let googleError = "";
    let openAiReport = {
      days,
      rowMap: new Map()
    };
    let googleReport = {
      days,
      rowMap: new Map(),
      needsSetup: true
    };

    if (openAiApiKey) {
      try {
        openAiReport = await loadOpenAiSpendReport(openAiApiKey, days);
      } catch (error) {
        logger.error("Failed to load OpenAI spend report", error);
        openAiError = String(error.message || "OpenAI spend report is unavailable.");

        if (openAiError.includes("403")) {
          openAiError =
            "OpenAI usage and costs endpoints require an Admin API key or matching usage permission in the OpenAI organization.";
        }
      }
    } else {
      openAiError = "OpenAI API key is not configured in backend secrets.";
    }

    try {
      googleReport = await loadGoogleBillingSpendReport(settings, days);
    } catch (error) {
      logger.error("Failed to load Google Billing spend report", error);
      googleError = String(error.message || "Google billing export report is unavailable.");
    }

    const rows = buildSpendReportRows(days, openAiReport, googleReport);
    const totals = buildSpendTotals(rows);

    return {
      ok: true,
      rows,
      totals,
      days,
      providerStatus: buildProviderStatus({
        geminiApiKey: "configured",
        openAiApiKey,
        googleBillingProjectId: settings.googleBillingProjectId,
        googleBillingLocation: settings.googleBillingLocation,
        googleBillingDataset: settings.googleBillingDataset,
        googleBillingTable: settings.googleBillingTable
      }),
      notes: {
        openAiError,
        googleError,
        googleNeedsSetup: Boolean(googleReport.needsSetup)
      }
    };
  }
);

exports.getSeatMap = onCall(
  getCallableOptions({
    secrets: [PROMPT_LAB_WEB_API_KEY]
  }),
  async (request) => {
  const { classRef, classData, normalizedCode } = await loadClassAccessCode(
    request.data?.classCode,
    request.data?.lessonKey
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
  const lessonKey = sanitizeLessonKey(request.data?.lessonKey);
  const lesson = getLessonDefinition(lessonKey);
  const { classRef, classData, normalizedCode } = await loadClassAccessCode(
    request.data?.classCode,
    lessonKey
  );
  const seatCount = getLessonSeatCount(classData, lessonKey);
  const seatNumber = normalizeSeatNumber(request.data?.seatNumber, seatCount);
  const generationLimit = getLessonGenerationLimit(classData, lessonKey);
  const sessionRef = db.collection("studentSessions").doc();
  const seatRef = classRef.collection("seats").doc(formatSeatId(seatNumber));
  const now = new Date();
  const sessionPayload = {
    activitySlug: ACTIVITY_CONFIG.activitySlug,
    classCode: normalizedCode,
    classLabel: classData.label || "",
    createdAt: FieldValue.serverTimestamp(),
    comicCharacterBlueprintEnglish: "",
    comicCharacterBlueprintHash: "",
    comicCharacterBlueprintHebrew: "",
    currentSeed: null,
    generationsCount: 0,
    generationLimit,
    isPromptComplete: false,
    lastSeenAt: FieldValue.serverTimestamp(),
    lessonKey: lesson.key,
    missingStepKeys: lesson.steps.map((step) => step.key),
    promptStepOrder: lesson.steps.map((step) => step.key),
    promptSteps: buildEmptyPromptSteps(lesson.key),
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
    lessonKey: lesson.key,
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
  const lessonKey = sanitizeLessonKey(sessionData.lessonKey);
  const { classRef, classData, normalizedCode } = await loadClassAccessCode(
    sessionData.classCode,
    lessonKey
  );
  const seatCount = getLessonSeatCount(classData, lessonKey);
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
    lessonKey,
    studentName: sessionData.studentName || "תלמיד/ה",
    seatNumber,
    generationLimit: Number(
      sessionData.generationLimit ||
        getLessonGenerationLimit(classData, lessonKey)
    ),
    remainingGenerations: Math.max(
      Number(
        sessionData.generationLimit ||
          getLessonGenerationLimit(classData, lessonKey)
      ) -
        Number(sessionData.generationsCount || 0),
      0
    ),
    seed: normalizeSeed(sessionData.currentSeed),
    promptSteps: sessionData.promptSteps || buildEmptyPromptSteps(lessonKey),
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
  const lessonKey = sanitizeLessonKey(sessionData.lessonKey);
  const { classRef, classData, normalizedCode } = await loadClassAccessCode(
    sessionData.classCode,
    lessonKey
  );
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
  const lessonKey = sanitizeLessonKey(sessionData.lessonKey);
  const { classRef } = await loadClassAccessCode(sessionData.classCode, lessonKey);
  const steps = sanitizePromptSteps(request.data?.steps, lessonKey);
  const seed = normalizeSeed(request.data?.seed);
  const validation = buildValidationResponse(steps, lessonKey);
  const draft = buildSessionDraft(steps, validation, lessonKey);
  const promptStepsHash = buildPromptStepsHash(steps);
  const cachedTranslatedSteps = getCachedTranslatedSteps(sessionData, promptStepsHash);

  await sessionRef.set(
    {
      ...draft,
      classCode: sessionData.classCode,
      currentSeed: seed,
      lessonKey,
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
    secrets: [GEMINI_API_KEY, OPENAI_API_KEY],
    timeoutSeconds: 120,
    memory: "1GiB"
  }),
  async (request) => {
    const { sessionRef, sessionData } = await loadSession(request.data?.sessionId);
    const lessonKey = sanitizeLessonKey(sessionData.lessonKey);
    const { classRef, classData, normalizedCode } = await loadClassAccessCode(
      sessionData.classCode,
      lessonKey
    );
    const steps = sanitizePromptSteps(request.data?.steps || sessionData.promptSteps, lessonKey);
    const seed = normalizeSeed(request.data?.seed ?? sessionData.currentSeed);
    const validation = buildValidationResponse(steps, lessonKey);
    const promptStepsHash = buildPromptStepsHash(steps);
    const comicBlueprintHash = buildComicBlueprintHash(steps);

    if (!validation.isComplete) {
    await sessionRef.set(
      {
        ...buildSessionDraft(steps, validation, lessonKey),
        lessonKey,
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

    const generationLimit = getLessonGenerationLimit(classData, lessonKey);
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

    const promptLabSettings = await loadPromptLabAdminConfig();
    const providerSelection = buildProviderSelection(promptLabSettings);
    let finalPromptHebrew;
    let finalPromptEnglish;
    let translatedPromptStepsEnglish;
    let comicCharacterBlueprintEnglish = "";
    let comicCharacterBlueprintHebrew = "";
    let image;
    let provider = providerSelection.provider;
    let model = providerSelection.imageModel;
    let effectiveSeed = providerSelection.supportsSeed ? seed : null;

    try {
      const geminiApiKey = normalizeSecretValue(GEMINI_API_KEY.value());

      if (!geminiApiKey) {
        throw new Error("Gemini translation key is missing.");
      }

      const ai = new GoogleGenAI({ apiKey: geminiApiKey });
      translatedPromptStepsEnglish =
        getCachedTranslatedSteps(sessionData, promptStepsHash) ||
        await translateStepsToEnglish(ai, steps);

      if (lessonKey === "comic-lab") {
        const hasCachedBlueprint =
          sessionData.comicCharacterBlueprintHash === comicBlueprintHash &&
          sessionData.comicCharacterBlueprintEnglish &&
          sessionData.comicCharacterBlueprintHebrew;

        comicCharacterBlueprintEnglish = hasCachedBlueprint
          ? String(sessionData.comicCharacterBlueprintEnglish || "").trim()
          : buildComicCharacterBlueprintEnglish(translatedPromptStepsEnglish);
        comicCharacterBlueprintHebrew = hasCachedBlueprint
          ? String(sessionData.comicCharacterBlueprintHebrew || "").trim()
          : buildComicCharacterBlueprintHebrew(steps);
      }

      finalPromptEnglish = buildFinalEnglishPrompt(
        translatedPromptStepsEnglish,
        ACTIVITY_CONFIG.imagePromptGuardrailsEnglish,
        lessonKey,
        {
          characterBlueprintEnglish: comicCharacterBlueprintEnglish,
          originalSteps: steps,
          panelNumber: generationsCount + 1
        }
      );
      finalPromptHebrew = buildFinalHebrewPrompt(steps, lessonKey, {
        characterBlueprintHebrew: comicCharacterBlueprintHebrew,
        panelNumber: generationsCount + 1
      });

      if (providerSelection.provider === "openai") {
        const openAiApiKey = normalizeSecretValue(OPENAI_API_KEY.value());

        if (!openAiApiKey) {
          throw new Error("OpenAI image key is missing.");
        }

        image = await generateImageWithOpenAi(openAiApiKey, finalPromptEnglish, providerSelection);
      } else {
        if (providerSelection.imageModel.startsWith("imagen-")) {
          image = await generateImageWithImagen(ai, finalPromptEnglish, effectiveSeed, providerSelection);
        } else {
          image = await generateImageWithGemini(ai, finalPromptEnglish, effectiveSeed);
        }
      }
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
        ...buildSessionDraft(steps, validation, lessonKey),
        comicCharacterBlueprintEnglish:
          lessonKey === "comic-lab" ? comicCharacterBlueprintEnglish : "",
        comicCharacterBlueprintHash:
          lessonKey === "comic-lab" ? comicBlueprintHash : "",
        comicCharacterBlueprintHebrew:
          lessonKey === "comic-lab" ? comicCharacterBlueprintHebrew : "",
        generationsCount: FieldValue.increment(1),
        lastGeneratedAt: FieldValue.serverTimestamp(),
        lastGeneratedImagePath: storedImage.imageStoragePath || "",
        lastGeneratedImageUrl: storedImage.imageDownloadUrl || "",
        lastGeneratedPromptEnglish: finalPromptEnglish,
        lastGeneratedPrompt: finalPromptHebrew,
        lastGeneratedModel: model,
        lastGeneratedProvider: provider,
        currentSeed: effectiveSeed,
        lastUsedSeed: effectiveSeed,
        lastSeenAt: FieldValue.serverTimestamp(),
        lessonKey,
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
      lessonKey,
      model,
      provider,
      seed: effectiveSeed,
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
      model,
      provider,
      remainingGenerations: Math.max(generationLimit - newGenerationCount, 0),
      seed: effectiveSeed,
      seedApplied: providerSelection.supportsSeed,
      usageId: usageRef.id,
      message:
        lessonKey === "comic-lab"
          ? "כל הכבוד. יצרתם פאנל קומיקס חדש, והדמויות נשמרו עקביות גם לפעם הבאה."
          : ACTIVITY_CONFIG.generationSuccess
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
