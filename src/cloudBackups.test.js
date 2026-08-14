import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_RETENTION_DAYS,
  buildBackupData,
  getBackupDate,
  getBackupDates,
  getBackupDocId,
  selectBackupDocuments,
  stripCloudMetadata,
  validateBackupData,
} from "./cloudBackups.js";

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
