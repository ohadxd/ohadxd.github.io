import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyD7fUlXVgRNKKPBL-rST6CZ2xgeXTBg0F0",
  authDomain: "groovetech-9a3fb.firebaseapp.com",
  databaseURL: "https://groovetech-9a3fb-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "groovetech-9a3fb",
  storageBucket: "groovetech-9a3fb.firebasestorage.app",
  messagingSenderId: "56393078768",
  appId: "1:56393078768:web:0f6c29d78a6dcdb4516f35",
  measurementId: "G-8VF8CVG3L0"
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app, "europe-west1");

if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

export const joinActivityCallable = httpsCallable(functions, "joinActivity");
export const validatePromptStepsCallable = httpsCallable(
  functions,
  "validatePromptSteps"
);
export const generateImageCallable = httpsCallable(functions, "generateImage");
