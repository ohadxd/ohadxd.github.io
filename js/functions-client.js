import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

const EMULATOR_ORIGIN = "http://127.0.0.1:5001/groovetech-9a3fb/europe-west1";
const PRODUCTION_ORIGIN = "https://europe-west1-groovetech-9a3fb.cloudfunctions.net";
let firebaseClientConfig = null;
let firestoreDb = null;
let firestoreEmulatorConnected = false;

function getFunctionsOrigin() {
  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  ) {
    return EMULATOR_ORIGIN;
  }

  return PRODUCTION_ORIGIN;
}

export function getDownloadGeneratedImageUrl(usageId, filename = "") {
  const params = new URLSearchParams();

  if (usageId) {
    params.set("usageId", usageId);
  }

  if (filename) {
    params.set("filename", filename);
  }

  return `${getFunctionsOrigin()}/downloadGeneratedImage?${params.toString()}`;
}

async function callFunction(functionName, data) {
  const response = await fetch(`${getFunctionsOrigin()}/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ data })
  });

  const payload = await response.json();

  if (!response.ok || payload.error) {
    const message =
      payload?.error?.message || "קרתה תקלה. נסו שוב בעוד רגע.";
    throw new Error(message);
  }

  return {
    data: payload.result
  };
}

function getFirestoreDb() {
  if (!firebaseClientConfig?.apiKey) {
    throw new Error("Realtime Firebase config is not available.");
  }

  if (!firestoreDb) {
    const app = getApps().length
      ? getApps()[0]
      : initializeApp(firebaseClientConfig, "prompt-lab-realtime");
    firestoreDb = getFirestore(app);

    if (
      !firestoreEmulatorConnected &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ) {
      connectFirestoreEmulator(firestoreDb, "127.0.0.1", 8080);
      firestoreEmulatorConnected = true;
    }
  }

  return firestoreDb;
}

export function setRealtimeClientConfig(config) {
  if (!config?.apiKey) {
    return;
  }

  if (!firebaseClientConfig) {
    firebaseClientConfig = config;
  }
}

export function subscribeSeatMap(publicSeatMapId, handlers) {
  const db = getFirestoreDb();
  const seatMapRef = doc(db, "publicSeatMaps", publicSeatMapId);

  return onSnapshot(
    seatMapRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        handlers?.onError?.(new Error("לוח המקומות עדיין לא זמין."));
        return;
      }

      handlers?.onData?.(snapshot.data());
    },
    (error) => {
      handlers?.onError?.(error);
    }
  );
}

export function joinActivityCallable(data) {
  return callFunction("joinActivity", data);
}

export function getSeatMapCallable(data) {
  return callFunction("getSeatMap", data);
}

export function restoreActivityCallable(data) {
  return callFunction("restoreActivity", data);
}

export function getStudentCreationsCallable(data) {
  return callFunction("getStudentCreations", data);
}

export function leaveActivityCallable(data) {
  return callFunction("leaveActivity", data);
}

export function validatePromptStepsCallable(data) {
  return callFunction("validatePromptSteps", data);
}

export function generateImageCallable(data) {
  return callFunction("generateImage", data);
}

export function adminLoginCallable(data) {
  return callFunction("adminLogin", data);
}

export function adminLogoutCallable(data) {
  return callFunction("adminLogout", data);
}

export function adminListClassesCallable(data) {
  return callFunction("adminListClasses", data);
}

export function adminUpsertClassCallable(data) {
  return callFunction("adminUpsertClass", data);
}

export function adminSetClassActiveCallable(data) {
  return callFunction("adminSetClassActive", data);
}
