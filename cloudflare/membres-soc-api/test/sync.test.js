import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMutation, SyncError } from "../src/sync.js";

test("normalise une mutation GAS valide", () => {
  const mutation = normalizeMutation({
    id: "mutation-1",
    source: "GAS",
    entityType: "MEMBER",
    entityId: "member-1",
    operation: "UPDATE_INFO",
    changedAt: "2026-08-12T20:00:00.000Z",
    payload: { member: { id: "member-1" } }
  });
  assert.equal(mutation.target, "D1");
  assert.equal(mutation.entityId, "member-1");
});

test("refuse une mutation sans identifiant stable", () => {
  assert.throws(() => normalizeMutation({
    source: "GAS",
    entityType: "MEMBER",
    entityId: "member-1",
    changedAt: "2026-08-12T20:00:00.000Z",
    payload: {}
  }), SyncError);
});

test("refuse une date de mutation non interprétable", () => {
  assert.throws(() => normalizeMutation({
    id: "mutation-1",
    source: "GAS",
    entityType: "MEMBER",
    entityId: "member-1",
    changedAt: "demain",
    payload: {}
  }), /Date de mutation invalide/);
});
