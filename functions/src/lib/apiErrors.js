"use strict";

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildApiErrorDetails(error, context = {}) {
  const message = String(error?.message || error || "Unknown error");
  // Google SDK errors can carry the provider's JSON body in their message.
  const response = error?.apiResponse ?? parseJson(message);
  const providerError = response?.error;
  return {
    ...context,
    message,
    name: error?.name || "Error",
    httpStatus: error?.httpStatus ?? error?.status ?? null,
    code: providerError?.code ?? error?.code ?? null,
    status: providerError?.status ?? null,
    type: providerError?.type ?? null,
    param: providerError?.param ?? null,
    requestId: error?.requestId ?? null,
    response,
    rawResponse: error?.rawResponse ?? null
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
  const rawResponse = await response.text();
  const payload = parseJson(rawResponse);
  if (!response.ok) {
    const error = new Error(
      String(payload?.error?.message || `OpenAI request failed with status ${response.status}.`)
    );
    error.httpStatus = response.status;
    error.apiResponse = payload;
    error.rawResponse = rawResponse;
    error.requestId = response.headers.get("x-request-id");
    throw error;
  }
  return payload || {};
}

module.exports = { buildApiErrorDetails, fetchOpenAiJson };
