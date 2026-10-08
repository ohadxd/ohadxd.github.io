"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");

const script = readFileSync(resolve(__dirname, "../../js/admin-console.js"), "utf8")
  .replace(/^import\s*\{[\s\S]*?\}\s*from\s*"[^"]+";/, "");

function element() {
  return {
    children: [], listeners: {}, attributes: {}, disabled: false,
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}

function loadUi(confirm, deleteClass) {
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
    adminDeleteClassCallable: deleteClass
  });
  vm.runInContext(`${script}\nglobalThis.testUi = { state, buildClassCard };`, context);
  const { state, buildClassCard } = context.testUi;
  state.sessionToken = "test-session";
  state.items = [
    { code: "CLASS123", label: "Morning class", isActive: true },
    { code: "OTHER456", label: "Other class", isActive: false }
  ];
  const card = buildClassCard(state.items[0]);
  const [toggleButton, deleteButton] = card.children[2].children;
  return { state, elements, toggleButton, deleteButton };
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
