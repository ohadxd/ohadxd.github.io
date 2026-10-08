"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { DocumentReference, Firestore, Timestamp } = require("@google-cloud/firestore");
const { ACTIVITY_CONFIG } = require("../src/config/agentConfig");

process.env.GCLOUD_PROJECT = "demo-class-deletion";
const { adminDeleteClass, joinActivity } = require("../src/index");

function mockAdminSession(t, expiresAt = Timestamp.fromMillis(Date.now() + 60000)) {
  t.mock.method(DocumentReference.prototype, "get", async function () {
    assert.equal(this.path, "adminSessions/test-admin-session");
    return { exists: true, data: () => ({ expiresAt }) };
  });
  t.mock.method(DocumentReference.prototype, "set", async () => {});
}

test("class deletion rejects missing admin credentials before accessing class records", async (t) => {
  const transaction = t.mock.method(Firestore.prototype, "runTransaction", async () => {
    assert.fail("Unauthorized deletion must not start a transaction");
  });
  await assert.rejects(adminDeleteClass.run({ data: { classCode: "CLASS123" } }), { code: "permission-denied" });
  assert.equal(transaction.mock.callCount(), 0);
});

test("class deletion rejects expired admin sessions", async (t) => {
  mockAdminSession(t, Timestamp.fromMillis(0));
  t.mock.method(DocumentReference.prototype, "delete", async () => {});
  const transaction = t.mock.method(Firestore.prototype, "runTransaction", async () => {
    assert.fail("Expired sessions must not delete a class");
  });
  await assert.rejects(adminDeleteClass.run({ data: {
    classCode: "CLASS123", sessionToken: "test-admin-session"
  } }), { code: "permission-denied" });
  assert.equal(transaction.mock.callCount(), 0);
});

test("class deletion validates the class code", async (t) => {
  mockAdminSession(t);
  await assert.rejects(adminDeleteClass.run({ data: {
    classCode: "", sessionToken: "test-admin-session"
  } }), { code: "invalid-argument" });
});

test("class, seats and public map are deleted together while history stays untouched", async (t) => {
  mockAdminSession(t);
  const deleted = [];
  t.mock.method(Firestore.prototype, "runTransaction", async (callback) => callback({
    get: async (ref) => {
      if (ref.path === "classAccessCodes/CLASS123") return { exists: true };
      assert.equal(ref.path, "classAccessCodes/CLASS123/seats");
      return { docs: [
        { ref: { path: "classAccessCodes/CLASS123/seats/01" } },
        { ref: { path: "classAccessCodes/CLASS123/seats/02" } }
      ] };
    },
    delete: (ref) => deleted.push(ref.path)
  }));
  const result = await adminDeleteClass.run({ data: {
    classCode: " class123 ", sessionToken: "test-admin-session"
  } });
  assert.deepEqual(result, { ok: true, classCode: "CLASS123" });
  const mapId = createHash("sha256").update(`${ACTIVITY_CONFIG.activitySlug}|CLASS123`).digest("hex").slice(0, 24);
  assert.deepEqual(deleted, [
    "classAccessCodes/CLASS123/seats/01",
    "classAccessCodes/CLASS123/seats/02",
    `publicSeatMaps/${mapId}`,
    "classAccessCodes/CLASS123"
  ]);
});

test("a missing class returns not-found without deleting anything", async (t) => {
  mockAdminSession(t);
  t.mock.method(Firestore.prototype, "runTransaction", async (callback) => callback({
    get: async () => ({ exists: false }),
    delete: () => assert.fail("No deletion should occur for a missing class")
  }));
  await assert.rejects(adminDeleteClass.run({ data: {
    classCode: "CLASS123", sessionToken: "test-admin-session"
  } }), { code: "not-found" });
});

test("a transaction failure is reported instead of returning deletion success", async (t) => {
  mockAdminSession(t);
  t.mock.method(Firestore.prototype, "runTransaction", async () => { throw new Error("Commit failed"); });
  await assert.rejects(adminDeleteClass.run({ data: {
    classCode: "CLASS123", sessionToken: "test-admin-session"
  } }), /Commit failed/);
});

test("a student cannot recreate a class deleted after the initial join lookup", async (t) => {
  t.mock.method(DocumentReference.prototype, "get", async () => ({
    exists: true,
    data: () => ({ lessonKey: "image-lab", isActive: true, seatCount: 25 })
  }));
  t.mock.method(Firestore.prototype, "runTransaction", async (callback) => callback({
    get: async (ref) => {
      assert.equal(ref.path, "classAccessCodes/CLASS123");
      return { exists: false };
    },
    set: () => assert.fail("A deleted class must not create a student session or seat"),
    update: () => assert.fail("A deleted class must not be recreated")
  }));
  await assert.rejects(joinActivity.run({ data: {
    classCode: "CLASS123", studentName: "Student", lessonKey: "image-lab", seatNumber: 1
  } }), { code: "failed-precondition" });
});
