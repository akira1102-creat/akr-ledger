import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_RETENTION_DAYS,
  backupBeforeUpload,
  buildBackupData,
  getBackupDate,
  getBackupDates,
  getBackupDocId,
  readCloudBackups,
  restoreCloudBackup,
  selectBackupDocuments,
  stripCloudMetadata,
  validateBackupData,
  writeCloudWithBackup,
} from "./cloudBackups.js";

const snapshot = (id, data, ref = null) => ({
  id,
  exists: Boolean(data),
  data: () => data,
  ref,
});

const makeBackupFakeDb = (config = {}, calls = []) => {
  const ledgerData = config.ledger || null;
  const backups = new Map(Object.entries(config.backups || {}));
  const ledgerRef = {
    get: async () => snapshot(config.ledgerId || "uid-1", ledgerData, ledgerRef),
    set: async data => {
      calls.push({ type: "ledger-set", data });
      if (config.ledgerSetError) throw config.ledgerSetError;
    },
    collection: name => {
      assert.equal(name, "backups");
      return backupCollection;
    },
  };
  const backupRef = id => ({
    id,
    get: async () => snapshot(id, backups.get(id) || null, backupRef(id)),
    create: async data => {
      calls.push({ type: "backup-create", id, data });
      if (config.backupSetError) throw config.backupSetError;
      if (backups.has(id)) {
        const error = new Error("already exists");
        error.code = "already-exists";
        throw error;
      }
      backups.set(id, data);
    },
    set: async data => {
      calls.push({ type: "backup-set", id, data });
      if (config.backupSetError) throw config.backupSetError;
      backups.set(id, data);
    },
    delete: async () => {
      calls.push({ type: "backup-delete", id });
      backups.delete(id);
    },
  });
  const backupCollection = {
    doc: id => backupRef(id),
    get: async () => ({
      docs: [...backups.entries()].map(([id, data]) => snapshot(id, data, backupRef(id))),
    }),
  };
  return {
    collection: name => {
      assert.equal(name, "akr_ledger");
      return { doc: () => ledgerRef };
    },
    batch: () => ({
      delete: ref => calls.push({ type: "batch-delete", id: ref.id }),
      commit: async () => calls.push({ type: "batch-commit" }),
    }),
  };
};

test("同一天使用同一個 UTC 快照文件 ID", () => {
  assert.equal(getBackupDate(new Date("2026-08-14T23:59:00Z")), "2026-08-14");
  assert.equal(getBackupDocId(new Date("2026-08-14T00:01:00Z")), "2026-08-14");
  assert.equal(BACKUP_RETENTION_DAYS, 7);
});

test("快照保存完整帳本但移除雲端控制欄位", () => {
  const source = {
    entries: [{ id: "e1" }],
    _ownerUid: "wrong",
    _cloudSyncedAt: "old",
  };
  const stripped = stripCloudMetadata(source);
  const result = buildBackupData(source, {
    uid: "uid-1",
    ledgerId: "uid-1",
    backupDate: "2026-08-14",
    backupCreatedAt: "now",
  });

  assert.deepEqual(stripped, { entries: [{ id: "e1" }] });
  assert.deepEqual(result.entries, [{ id: "e1" }]);
  assert.equal(result._ownerUid, "uid-1");
  assert.equal(result._sourceLedgerId, "uid-1");
  assert.equal(result._cloudSyncedAt, undefined);
  assert.equal(result._backupDate, "2026-08-14");
});

test("只保留最近七個日曆日並列出待刪除文件", () => {
  const docs = [
    "2026-08-14",
    "2026-08-13",
    "2026-08-12",
    "2026-08-11",
    "2026-08-10",
    "2026-08-09",
    "2026-08-08",
    "2026-08-07",
  ].map(id => ({ id }));
  const result = selectBackupDocuments(docs, new Date("2026-08-14T12:00:00Z"));

  assert.deepEqual(result.keep.map(item => item.id), [
    "2026-08-14",
    "2026-08-13",
    "2026-08-12",
    "2026-08-11",
    "2026-08-10",
    "2026-08-09",
    "2026-08-08",
  ]);
  assert.deepEqual(result.remove.map(item => item.id), ["2026-08-07"]);
  assert.deepEqual(getBackupDates(new Date("2026-08-14T12:00:00Z")), [
    "2026-08-14",
    "2026-08-13",
    "2026-08-12",
    "2026-08-11",
    "2026-08-10",
    "2026-08-09",
    "2026-08-08",
  ]);
});

test("錯誤 UID 或帳本路徑的快照不合格", () => {
  assert.equal(
    validateBackupData({ _ownerUid: "other", _sourceLedgerId: "uid-1" }, "uid-1", "uid-1"),
    false,
  );
  assert.equal(
    validateBackupData({ _ownerUid: "uid-1", _sourceLedgerId: "other" }, "uid-1", "uid-1"),
    false,
  );
  assert.equal(
    validateBackupData({ _ownerUid: "uid-1", _sourceLedgerId: "uid-1" }, "uid-1", "uid-1"),
    true,
  );
});

test("主文件存在時先備份再覆蓋", async () => {
  const calls = [];
  const db = makeBackupFakeDb({
    ledger: { entries: [{ id: "old" }], _ownerUid: "uid-1", _cloudSyncedAt: "old-sync" },
  }, calls);

  await writeCloudWithBackup(db, {
    uid: "uid-1",
    ledgerId: "uid-1",
    data: { entries: [{ id: "new" }] },
    now: new Date("2026-08-14T12:00:00Z"),
  });

  const backupIndex = calls.findIndex(call => ["backup-create", "backup-set"].includes(call.type));
  const ledgerIndex = calls.findIndex(call => call.type === "ledger-set");
  assert.equal(backupIndex >= 0, true);
  assert.equal(backupIndex < ledgerIndex, true);
});

test("備份失敗時不會寫入主文件", async () => {
  const calls = [];
  const db = makeBackupFakeDb({
    ledger: { entries: [{ id: "old" }], _ownerUid: "uid-1" },
    backupSetError: new Error("backup failed"),
  }, calls);

  await assert.rejects(() => writeCloudWithBackup(db, {
    uid: "uid-1",
    ledgerId: "uid-1",
    data: { entries: [] },
    now: new Date("2026-08-14T12:00:00Z"),
  }), /backup failed/);
  assert.equal(calls.some(call => call.type === "ledger-set"), false);
});

test("同一日期已存在快照時不會以後來版本覆蓋原始快照", async () => {
  const calls = [];
  const db = makeBackupFakeDb({
    ledger: { entries: [{ id: "old" }], _ownerUid: "uid-1" },
    backups: {
      "2026-08-14": {
        entries: [{ id: "first-old" }],
        _ownerUid: "uid-1",
        _sourceLedgerId: "uid-1",
      },
    },
  }, calls);

  await backupBeforeUpload(db, {
    uid: "uid-1",
    ledgerId: "uid-1",
    now: new Date("2026-08-14T12:00:00Z"),
  });

  assert.equal(calls.some(call => call.type === "backup-create" || call.type === "backup-set"), false);
});

test("同一日期快照 metadata 不合格時停止覆蓋", async () => {
  const db = makeBackupFakeDb({
    ledger: { entries: [{ id: "old" }], _ownerUid: "uid-1" },
    backups: {
      "2026-08-14": {
        entries: [{ id: "wrong" }],
        _ownerUid: "other",
        _sourceLedgerId: "uid-1",
      },
    },
  });

  await assert.rejects(() => backupBeforeUpload(db, {
    uid: "uid-1",
    ledgerId: "uid-1",
    now: new Date("2026-08-14T12:00:00Z"),
  }), /ownership mismatch/);
});

test("只返回目前帳本最近七日且資料合法的快照摘要", async () => {
  const db = makeBackupFakeDb({
    backups: {
      "2026-08-14": {
        entries: [{ id: "e1" }],
        _ownerUid: "uid-1",
        _sourceLedgerId: "uid-1",
        _backupDate: "2026-08-14",
        _backupCreatedAt: "2026-08-14T01:00:00.000Z",
      },
      "2026-08-07": {
        entries: [{ id: "old" }],
        _ownerUid: "uid-1",
        _sourceLedgerId: "uid-1",
        _backupDate: "2026-08-07",
      },
      "other": {
        entries: [{ id: "wrong" }],
        _ownerUid: "other",
        _sourceLedgerId: "uid-1",
      },
    },
  });

  const result = await readCloudBackups(db, {
    uid: "uid-1",
    ledgerId: "uid-1",
    now: new Date("2026-08-14T12:00:00Z"),
  });
  assert.deepEqual(result.map(item => item.id), ["2026-08-14"]);
  assert.equal(result[0].entryCount, 1);
});

test("還原前先保存目前主文件並返回選定快照", async () => {
  const calls = [];
  const db = makeBackupFakeDb({
    ledger: { entries: [{ id: "current" }], _ownerUid: "uid-1", _cloudSyncedAt: "current-sync" },
    backups: {
      "2026-08-13": {
        entries: [{ id: "restored" }],
        _ownerUid: "uid-1",
        _sourceLedgerId: "uid-1",
        _backupDate: "2026-08-13",
      },
    },
  }, calls);

  const result = await restoreCloudBackup(db, {
    uid: "uid-1",
    ledgerId: "uid-1",
    backupId: "2026-08-13",
    now: new Date("2026-08-14T12:00:00Z"),
  });

  assert.deepEqual(result.entries, [{ id: "restored" }]);
  assert.equal(typeof result._lastModified, "string");
  assert.equal(calls.some(call => call.type === "ledger-set"), true);
});
