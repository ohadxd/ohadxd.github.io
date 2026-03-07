const EMULATOR_ORIGIN = "http://127.0.0.1:5001/groovetech-9a3fb/europe-west1";
const PRODUCTION_ORIGIN = "https://europe-west1-groovetech-9a3fb.cloudfunctions.net";

function getFunctionsOrigin() {
  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  ) {
    return EMULATOR_ORIGIN;
  }

  return PRODUCTION_ORIGIN;
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

export function joinActivityCallable(data) {
  return callFunction("joinActivity", data);
}

export function validatePromptStepsCallable(data) {
  return callFunction("validatePromptSteps", data);
}

export function generateImageCallable(data) {
  return callFunction("generateImage", data);
}
