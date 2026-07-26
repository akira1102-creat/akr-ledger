import test from "node:test";
import assert from "node:assert/strict";
import { hasActivePremiumMembership, mergeCloudProfiles } from "./cloudAccount.js";

test("永久 Premium 會員有效", () => {
  assert.equal(hasActivePremiumMembership({
    entitlement: "premium",
    status: "active",
    lifetime: true,
  }), true);
});

test("過期或停用會員無效", () => {
  assert.equal(hasActivePremiumMembership({
    entitlement: "premium",
    status: "active",
    expiresAt: "2020-01-01T00:00:00.000Z",
  }), false);
  assert.equal(hasActivePremiumMembership({
    entitlement: "premium",
    status: "inactive",
    lifetime: true,
  }), false);
});

test("合併雲端舊帳本並保留本機名稱", () => {
  const merged = mergeCloudProfiles(
    [{ id: "main", name: "自己", createdAt: "2026-01-01T00:00:00.000Z" }],
    [
      { id: "main", name: "主要帳本", createdAt: "2025-01-01T00:00:00.000Z" },
      { id: "profile_old", name: "舊帳本 1", createdAt: "2025-02-01T00:00:00.000Z" },
    ],
  );
  assert.deepEqual(merged.map(item => item.id), ["main", "profile_old"]);
  assert.equal(merged[0].name, "自己");
  assert.equal(merged[1].name, "舊帳本 1");
});

test("帳本索引可由舊式 JSON 清單讀取", async () => {
  const fakeDb = {
    collection: name => ({
      doc: () => ({
        get: async () => name === "qys_memberships"
          ? { exists: true, data: () => ({ entitlement: "premium", status: "active", lifetime: true }) }
          : { exists: true, data: () => ({ profilesJson: '[{"id":"main","name":"自己"}]' }) },
      }),
    }),
  };
  const { readAccountCloudState } = await import("./cloudAccount.js");
  const state = await readAccountCloudState(fakeDb, "test-uid");
  assert.equal(state.isPremium, true);
  assert.equal(state.cloudProfiles[0].id, "main");
});
