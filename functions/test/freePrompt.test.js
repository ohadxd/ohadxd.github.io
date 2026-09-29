"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildFinalEnglishPrompt,
  buildFinalHebrewPrompt,
  buildValidationResponse,
  checkFreePromptGeneration,
  containsDisallowedFreePromptContent,
  sanitizePromptSteps
} = require("../src/lib/promptFlow");

test("a free prompt remains one field and is limited to 1200 characters", () => {
  const steps = sanitizePromptSteps({ prompt: "  חתול  מצייר  ".repeat(200) }, "free-lab");
  assert.deepEqual(Object.keys(steps), ["prompt"]);
  assert.equal(steps.prompt.length, 1200);
  assert.equal(buildValidationResponse(steps, "free-lab").isComplete, true);
  assert.equal(buildValidationResponse({ prompt: "" }, "free-lab").isComplete, false);
  assert.equal(buildFinalHebrewPrompt({ prompt: "חתול מצייר" }, "free-lab"), "חתול מצייר");
  assert.match(buildFinalEnglishPrompt({ prompt: "a cat painting" }, "child-safe", "free-lab"), /a cat painting/);
});

test("free generation requires a safe assessment of the current prompt", () => {
  const safe = { isSafe: true, score: 85, englishPrompt: "a cat painting" };
  assert.equal(checkFreePromptGeneration(null, "a", "a", true, "a cat").allowed, false);
  assert.equal(checkFreePromptGeneration({ isSafe: false }, "a", "a", true, "a cat").allowed, false);
  assert.equal(checkFreePromptGeneration(safe, "old", "new", true, "a cat").allowed, false);
  assert.equal(checkFreePromptGeneration(safe, "a", "a", false, "a cat").allowed, true);
});

test("a low score requires a separate confirmation", () => {
  const low = { isSafe: true, score: 69, englishPrompt: "a cat painting" };
  assert.equal(checkFreePromptGeneration(low, "a", "a", false, "a cat").needsConfirmation, true);
  assert.equal(checkFreePromptGeneration(low, "a", "a", true, "a cat").allowed, true);
});

test("explicit violent and personal-data prompts are blocked even if the model approves", () => {
  const unsafe = "תמונה אלימה עם פציעות קשות ודם";
  assert.equal(containsDisallowedFreePromptContent(unsafe), true);
  assert.equal(containsDisallowedFreePromptContent("איור של חתול כתום בגינה"), false);
  assert.equal(containsDisallowedFreePromptContent("my email is kid@example.com"), true);
  const mistakenApproval = { isSafe: true, score: 88, englishPrompt: "a violent scene" };
  assert.equal(checkFreePromptGeneration(mistakenApproval, "a", "a", true, unsafe).allowed, false);
});
