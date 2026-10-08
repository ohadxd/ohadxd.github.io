"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildApiErrorDetails, fetchOpenAiJson } = require("../src/lib/apiErrors");

test("OpenAI failures preserve the complete body, status, code and request ID", async (t) => {
  const body = {
    error: {
      message: "Quota exceeded",
      code: "insufficient_quota",
      type: "billing_error",
      param: null,
      extra: { limit: 0 }
    }
  };
  const raw = JSON.stringify(body);
  t.mock.method(globalThis, "fetch", async () => new Response(raw, {
    status: 429,
    headers: { "x-request-id": "req_test" }
  }));
  await assert.rejects(fetchOpenAiJson("https://example.test", "secret-test-key"), (error) => {
    const details = buildApiErrorDetails(error, { provider: "openai", stage: "image-generation" });
    assert.equal(details.message, body.error.message);
    assert.equal(details.httpStatus, 429);
    assert.equal(details.code, "insufficient_quota");
    assert.equal(details.type, "billing_error");
    assert.equal(details.requestId, "req_test");
    assert.deepEqual(details.response, body);
    assert.equal(details.rawResponse, raw);
    assert.equal(JSON.stringify(details).includes("secret-test-key"), false);
    return true;
  });
});

test("non-JSON upstream failures retain the original response text", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("upstream unavailable", { status: 502 }));
  await assert.rejects(fetchOpenAiJson("https://example.test", "test-key"), (error) => {
    const details = buildApiErrorDetails(error);
    assert.equal(details.httpStatus, 502);
    assert.equal(details.rawResponse, "upstream unavailable");
    assert.equal(details.response, null);
    return true;
  });
});

test("Google SDK JSON messages retain the provider error and numeric code", () => {
  const body = { error: { code: 403, message: "Permission denied", status: "PERMISSION_DENIED" } };
  const error = new Error(JSON.stringify(body));
  error.name = "ApiError";
  error.status = 403;
  const details = buildApiErrorDetails(error, { provider: "gemini" });
  assert.equal(details.httpStatus, 403);
  assert.equal(details.code, 403);
  assert.equal(details.status, "PERMISSION_DENIED");
  assert.deepEqual(details.response, body);
  assert.deepEqual(JSON.parse(JSON.stringify(details)), details);
});

test("local failures remain serializable without exposing stacks", () => {
  const details = buildApiErrorDetails(new Error("Gemini translation key is missing."));
  assert.equal(details.message, "Gemini translation key is missing.");
  assert.equal(details.httpStatus, null);
  assert.equal(details.response, null);
  assert.equal(Object.hasOwn(details, "stack"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(details)), details);
});

test("successful OpenAI responses keep their existing payload", async (t) => {
  const body = { data: [{ b64_json: "image-data" }] };
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status: 200 }));
  assert.deepEqual(await fetchOpenAiJson("https://example.test", "test-key"), body);
});
