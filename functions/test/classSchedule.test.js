"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DocumentReference, Firestore, Timestamp } = require("@google-cloud/firestore");
const { DEFAULT_CLASS_DURATION_MS, getClassWindow, sanitizeClassWindow, assertClassWindowOpen } = require("../src/lib/classSchedule");
process.env.GCLOUD_PROJECT = "demo-class-schedule";
const functions = require("../src/index");

const base = Date.UTC(2026, 9, 8, 10);
const scheduledClass = {
  opensAt: Timestamp.fromMillis(base), closesAt: Timestamp.fromMillis(base + DEFAULT_CLASS_DURATION_MS)
};

test("a new schedule defaults to opening now for 45 minutes", () => {
  assert.deepEqual(sanitizeClassWindow({}, base), { opensAtMs: base, closesAtMs: base + 2700000 });
  assert.deepEqual(sanitizeClassWindow({ opensAtMs: base }), { opensAtMs: base, closesAtMs: base + 2700000 });
});

test("invalid, empty, reversed and zero-length schedules are rejected", () => {
  for (const data of [
    { opensAtMs: null }, { closesAtMs: "tomorrow" }, { opensAtMs: NaN },
    { opensAtMs: Infinity }, { opensAtMs: base, closesAtMs: base },
    { opensAtMs: base, closesAtMs: base - 1 }, { opensAtMs: 1e16, closesAtMs: 1e16 + 2700000 }
  ]) assert.throws(() => sanitizeClassWindow(data), { code: "invalid-argument" });
});

test("entry is allowed at opening and blocked exactly at closing", () => {
  assert.throws(() => assertClassWindowOpen(scheduledClass, base - 1), (error) => {
    assert.equal(error.details.reason, "CLASS_NOT_OPEN_YET");
    return true;
  });
  assert.doesNotThrow(() => assertClassWindowOpen(scheduledClass, base));
  assert.doesNotThrow(() => assertClassWindowOpen(scheduledClass, base + DEFAULT_CLASS_DURATION_MS - 1));
  assert.throws(() => assertClassWindowOpen(scheduledClass, base + DEFAULT_CLASS_DURATION_MS), (error) => {
    assert.equal(error.details.reason, "CLASS_WINDOW_CLOSED");
    return true;
  });
});

test("unscheduled classes keep working and legacy expiry is honored", () => {
  assert.deepEqual(getClassWindow({}), { opensAtMs: null, closesAtMs: null });
  assert.doesNotThrow(() => assertClassWindowOpen({}, base));
  assert.throws(() => assertClassWindowOpen({ expiresAt: Timestamp.fromMillis(base) }, base), { code: "failed-precondition" });
  assert.doesNotThrow(() => assertClassWindowOpen({ ...scheduledClass, expiresAt: Timestamp.fromMillis(base - 1) }, base));
});

for (const endpoint of ["getSeatMap", "joinActivity", "restoreActivity", "generateImage"]) {
  test(`${endpoint} blocks requests outside the class window on the server`, async (t) => {
    t.mock.method(DocumentReference.prototype, "get", async function () {
      if (this.path === "studentSessions/test-student") {
        return { exists: true, data: () => ({ classCode: "CLASS123", lessonKey: "image-lab" }) };
      }
      assert.equal(this.path, "classAccessCodes/CLASS123");
      return { exists: true, data: () => ({
        lessonKey: "image-lab", isActive: true,
        opensAt: Timestamp.fromMillis(Date.now() + 60000),
        closesAt: Timestamp.fromMillis(Date.now() + 2760000)
      }) };
    });
    t.mock.method(DocumentReference.prototype, "set", () => assert.fail("Blocked entry must not write records"));
    t.mock.method(Firestore.prototype, "runTransaction", () => assert.fail("Blocked entry must not claim a seat"));
    await assert.rejects(functions[endpoint].run({ data: {
      classCode: "CLASS123", lessonKey: "image-lab", sessionId: "test-student", studentName: "Student", seatNumber: 1
    } }), (error) => {
      assert.equal(error.code, "failed-precondition");
      assert.equal(error.details.reason, "CLASS_NOT_OPEN_YET");
      return true;
    });
  });
}

test("joining rechecks the window inside the seat transaction", async (t) => {
  t.mock.method(DocumentReference.prototype, "get", async () => ({
    exists: true, data: () => ({ lessonKey: "image-lab", isActive: true, seatCount: 25 })
  }));
  t.mock.method(Firestore.prototype, "runTransaction", async (callback) => callback({
    get: async () => ({ exists: true, data: () => ({ closesAt: Timestamp.fromMillis(Date.now() - 1) }) }),
    set: () => assert.fail("An expired class must not claim a seat"),
    update: () => assert.fail("An expired class must not update its counters")
  }));
  await assert.rejects(functions.joinActivity.run({ data: {
    classCode: "CLASS123", lessonKey: "image-lab", studentName: "Student", seatNumber: 1
  } }), (error) => {
    assert.equal(error.details.reason, "CLASS_WINDOW_CLOSED");
    return true;
  });
});

function mockAdminAndClass(t, initialClass = null) {
  let data = initialClass;
  const saved = [];
  t.mock.method(DocumentReference.prototype, "get", async function () {
    if (this.path === "adminSessions/test-admin") {
      return { exists: true, data: () => ({ expiresAt: Timestamp.fromMillis(Date.now() + 60000) }) };
    }
    assert.equal(this.path, "classAccessCodes/CLASS123");
    return { id: "CLASS123", exists: data !== null, data: () => data };
  });
  for (const method of ["set", "update"]) {
    t.mock.method(DocumentReference.prototype, method, async function (value) {
      if (this.path.startsWith("adminSessions/")) return;
      saved.push(value);
      data = { ...data, ...value };
    });
  }
  return saved;
}

test("admin creation saves a default 45-minute window", async (t) => {
  const writes = mockAdminAndClass(t);
  const result = await functions.adminUpsertClass.run({ data: { sessionToken: "test-admin", classCode: "CLASS123" } });
  assert.equal(result.item.closesAtMs - result.item.opensAtMs, DEFAULT_CLASS_DURATION_MS);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].opensAt instanceof Timestamp);
});

test("existing class updates preserve schedules when no times are supplied", async (t) => {
  const writes = mockAdminAndClass(t, scheduledClass);
  const result = await functions.adminUpsertClass.run({ data: { sessionToken: "test-admin", classCode: "CLASS123" } });
  assert.equal(result.item.opensAtMs, base);
  assert.equal(Object.hasOwn(writes[0], "opensAt"), false);
});

test("admins can update an existing class schedule without changing manual access", async (t) => {
  const writes = mockAdminAndClass(t, { isActive: false, lessonKey: "image-lab" });
  const result = await functions.adminSetClassSchedule.run({ data: {
    sessionToken: "test-admin", classCode: "class123", opensAtMs: base, closesAtMs: base + DEFAULT_CLASS_DURATION_MS
  } });
  assert.equal(result.item.opensAtMs, base);
  assert.equal(result.item.closesAtMs, base + DEFAULT_CLASS_DURATION_MS);
  assert.equal(result.item.isActive, false);
  assert.equal(Object.hasOwn(writes[0], "isActive"), false);
});

test("schedule changes require admin authentication and an existing class", async (t) => {
  await assert.rejects(functions.adminSetClassSchedule.run({ data: { classCode: "CLASS123" } }), { code: "permission-denied" });
  const writes = mockAdminAndClass(t);
  await assert.rejects(functions.adminSetClassSchedule.run({ data: {
    sessionToken: "test-admin", classCode: "CLASS123", opensAtMs: base
  } }), { code: "not-found" });
  assert.equal(writes.length, 0);
});
