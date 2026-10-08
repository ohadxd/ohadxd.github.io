"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const context = vm.createContext({});
vm.runInContext(readFileSync(resolve(__dirname, "../../js/class-schedule.js"), "utf8").replace(/^export /gm, ""), context);
const { toScheduleInputValue, fromScheduleInputValue, setupScheduleInputs, readScheduleInputs } = context;

test("schedule fields use Israel time in both summer and winter", () => {
  assert.equal(toScheduleInputValue(Date.UTC(2026, 9, 8, 10)), "2026-10-08T13:00");
  assert.equal(fromScheduleInputValue("2026-10-08T13:00"), Date.UTC(2026, 9, 8, 10));
  assert.equal(fromScheduleInputValue("2026-01-08T13:00"), Date.UTC(2026, 0, 8, 11));
});

test("invalid dates and nonexistent daylight saving times are rejected", () => {
  for (const value of ["", "2026-02-30T13:00", "2026-10-08T25:00", "2026-03-27T02:30"]) {
    assert.throws(() => fromScheduleInputValue(value));
  }
});

function input() {
  return { value: "", addEventListener(type, listener) { this[type] = listener; } };
}

test("changing opening moves the default closing by 45 minutes and keeps custom closing", () => {
  const opens = input(), closes = input();
  const reset = setupScheduleInputs(opens, closes, Date.UTC(2026, 9, 8, 10));
  assert.equal(closes.value, "2026-10-08T13:45");
  opens.value = "2026-10-08T14:00";
  opens.change();
  assert.equal(closes.value, "2026-10-08T14:45");
  closes.value = "2026-10-08T16:00";
  opens.value = "2026-10-08T15:00";
  opens.change();
  assert.equal(closes.value, "2026-10-08T16:00");
  reset(Date.UTC(2026, 9, 8, 10));
  opens.value = "2026-10-08T17:00";
  opens.change();
  assert.equal(closes.value, "2026-10-08T17:45");
});

test("the form rejects closing before opening", () => {
  assert.throws(() => readScheduleInputs({ value: "2026-10-08T13:00" }, { value: "2026-10-08T12:00" }));
});
