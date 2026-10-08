"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");

const script = readFileSync(resolve(__dirname, "../../js/admin-console.js"), "utf8")
  .replace(/^import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";\s*/gm, "");
const scheduleScript = readFileSync(resolve(__dirname, "../../js/class-schedule.js"), "utf8")
  .replace(/^export /gm, "");

function element() {
  return {
    children: [], listeners: {}, attributes: {}, disabled: false,
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}

function loadUi(confirm, deleteClass, setSchedule = () => assert.fail("Unexpected schedule save")) {
  const elements = new Map();
  const context = vm.createContext({
    document: {
      createElement: element,
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      }
    },
    window: { confirm, localStorage: { getItem: () => null } },
    adminDeleteClassCallable: deleteClass,
    adminSetClassScheduleCallable: setSchedule
  });
  vm.runInContext(`${scheduleScript}\n${script}\nglobalThis.testUi = { state, buildClassCard };`, context);
  const { state, buildClassCard } = context.testUi;
  state.sessionToken = "test-session";
  state.items = [
    { code: "CLASS123", label: "Morning class", isActive: true },
    { code: "OTHER456", label: "Other class", isActive: false }
  ];
  const card = buildClassCard(state.items[0]);
  const [toggleButton, deleteButton] = card.children[2].children;
  const scheduleForm = card.children[3];
  return {
    state, elements, toggleButton, deleteButton, scheduleForm,
    opensInput: scheduleForm.children[0].children[1],
    closesInput: scheduleForm.children[1].children[1],
    scheduleSaveButton: scheduleForm.children[3]
  };
}

test("canceling the class-specific confirmation sends no delete request", async () => {
  let confirmation;
  const ui = loadUi((message) => { confirmation = message; return false; }, () => {
    assert.fail("Canceled confirmation must not call the API");
  });
  await ui.deleteButton.listeners.click();
  assert.match(confirmation, /CLASS123 \(Morning class\)/);
  assert.equal(ui.state.items.length, 2);
  assert.equal(ui.deleteButton.disabled, false);
});

test("confirmed deletion sends admin credentials and removes only the deleted class", async () => {
  const ui = loadUi(() => true, async (request) => {
    assert.deepEqual(JSON.parse(JSON.stringify(request)), { sessionToken: "test-session", classCode: "CLASS123" });
    return { data: { ok: true, classCode: "CLASS123" } };
  });
  await ui.deleteButton.listeners.click();
  assert.deepEqual(Array.from(ui.state.items, (item) => item.code), ["OTHER456"]);
  assert.equal(ui.elements.get("adminStatusTitle").textContent, "הכיתה נמחקה");
});

test("controls stay disabled while the delete request is pending", async () => {
  let finish;
  const ui = loadUi(() => true, () => new Promise((resolveRequest) => { finish = resolveRequest; }));
  const pending = ui.deleteButton.listeners.click();
  assert.equal(ui.deleteButton.disabled, true);
  assert.equal(ui.toggleButton.disabled, true);
  assert.equal(ui.state.items.length, 2);
  finish({ data: { ok: true, classCode: "CLASS123" } });
  await pending;
});

test("failed deletion retains the class and displays the API error", async () => {
  const ui = loadUi(() => true, async () => { throw new Error("Deletion failed"); });
  await ui.deleteButton.listeners.click();
  assert.equal(ui.state.items.length, 2);
  assert.equal(ui.elements.get("adminStatusTitle").textContent, "המחיקה נכשלה");
  assert.equal(ui.elements.get("adminStatusText").textContent, "Deletion failed");
  const replacement = ui.elements.get("adminClassGrid").children[0];
  assert.equal(replacement.children[2].children[1].disabled, false);
});

test("admin schedule save sends Israel dates as UTC timestamps and updates the class", async () => {
  const ui = loadUi(() => false, () => {}, async (request) => {
    assert.deepEqual(JSON.parse(JSON.stringify(request)), {
      sessionToken: "test-session", classCode: "CLASS123",
      opensAtMs: Date.UTC(2026, 9, 8, 10), closesAtMs: Date.UTC(2026, 9, 8, 10, 45)
    });
    assert.equal(ui.deleteButton.disabled, true);
    assert.equal(ui.toggleButton.disabled, true);
    return { data: { item: { ...ui.state.items[0], ...request } } };
  });
  ui.opensInput.value = "2026-10-08T13:00";
  ui.closesInput.value = "2026-10-08T13:45";
  await ui.scheduleForm.listeners.submit({ preventDefault() {} });
  assert.equal(ui.state.items[0].opensAtMs, Date.UTC(2026, 9, 8, 10));
  assert.equal(ui.elements.get("adminStatusTitle").textContent, "התזמון נשמר");
});

test("failed schedule saves keep the edited times and enable retry", async () => {
  const ui = loadUi(() => false, () => {}, async () => { throw new Error("Save failed"); });
  ui.opensInput.value = "2026-10-08T13:00";
  ui.closesInput.value = "2026-10-08T13:45";
  await ui.scheduleForm.listeners.submit({ preventDefault() {} });
  assert.equal(ui.opensInput.value, "2026-10-08T13:00");
  assert.equal(ui.closesInput.value, "2026-10-08T13:45");
  assert.equal(ui.scheduleSaveButton.disabled, false);
  assert.equal(ui.elements.get("adminStatusText").textContent, "Save failed");
  assert.equal(ui.state.items[0].opensAtMs, undefined);
});

test("invalid schedule times never reach the API", async () => {
  const ui = loadUi(() => false, () => {});
  ui.opensInput.value = "2026-10-08T13:00";
  ui.closesInput.value = "2026-10-08T12:00";
  await ui.scheduleForm.listeners.submit({ preventDefault() {} });
  assert.equal(ui.elements.get("adminStatusTitle").textContent, "התזמון לא נשמר");
  assert.equal(ui.scheduleSaveButton.disabled, false);
});
