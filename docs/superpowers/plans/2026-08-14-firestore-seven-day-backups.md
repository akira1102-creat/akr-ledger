# Firestore 最近 7 日每日快照實作計劃

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改變現有主帳本格式的前提下，為每個帳戶／副帳本加入最近 7 日每日完整快照、覆蓋前保護及 PWA 還原介面。

**Architecture:** 新增純函式模組處理快照日期、資料剝離、保留期及備份文件驗證；`useFirebaseSync` 把所有主文件覆蓋集中經過備份閘門。備份放在 `akr_ledger/{ledgerId}/backups/{YYYY-MM-DD}`，主文件仍留在 `akr_ledger/{ledgerId}`。設定頁只顯示最近 7 份摘要，還原前再次備份目前主文件。

**Tech Stack:** React 18、Vite、Firebase compat Auth/Firestore、Node `node:test`、GitHub Pages PWA；Firestore rules 位於 `D:\Vibe Coding\akr-ledger-mobile\firestore.rules`。

## Global Constraints

- 每日最多 1 份完整快照，保留最近 7 個 UTC 日曆日。
- 備份寫入或清理失敗時，不得覆蓋主文件。
- 備份及還原只可使用目前 Firebase UID 及目前 `ledgerId`。
- 不修改、刪除或嘗試修復目前 Firebase 主資料。
- 不部署 Firebase rules 或 PWA；本回合只完成程式、測試及本機驗證。
- 不修改 mobile app 程式；只在需要時更新其 Firestore rules 原始檔，保留本機資料夾。
- 所有 cached frontend 變更必須同步更新 `package.json` 版本、`public/sw.js`、root `sw.js` 及生成資產的快取識別碼。
- 不新增任何密碼、API key、Token 或私鑰到檔案、測試或輸出。

---

### Task 1: 建立快照純函式與失敗測試

**Files:**
- Create: `D:\Vibe Coding\akr-ledger\src\cloudBackups.js`
- Create: `D:\Vibe Coding\akr-ledger\src\cloudBackups.test.js`

**Interfaces:**
- `BACKUP_RETENTION_DAYS = 7`
- `getBackupDate(date = new Date()) -> string`
- `getBackupDocId(date = new Date()) -> string`
- `stripCloudMetadata(data) -> object`
- `buildBackupData(storeData, metadata) -> object`
- `validateBackupData(data, uid, ledgerId) -> boolean`
- `getBackupDates(now = new Date(), retentionDays = 7) -> string[]`
- `selectBackupDocuments(documents, now = new Date(), retentionDays = 7) -> { keep, remove }`

- [ ] **Step 1: Write failing tests**

```js
test("同一天使用同一個 UTC 快照文件 ID", () => {
  assert.equal(getBackupDocId(new Date("2026-08-14T23:59:00Z")), "2026-08-14");
  assert.equal(getBackupDocId(new Date("2026-08-14T00:01:00Z")), "2026-08-14");
});

test("快照保存完整帳本但移除雲端控制欄位", () => {
  const result = buildBackupData(
    { entries: [{ id: "e1" }], _ownerUid: "wrong", _cloudSyncedAt: "old" },
    { uid: "uid-1", ledgerId: "uid-1", backupDate: "2026-08-14", backupCreatedAt: "now" },
  );
  assert.deepEqual(result.entries, [{ id: "e1" }]);
  assert.equal(result._ownerUid, "uid-1");
  assert.equal(result._sourceLedgerId, "uid-1");
  assert.equal(result._cloudSyncedAt, undefined);
});

test("只保留最近七個日曆日並列出待刪除文件", () => {
  const docs = ["2026-08-14", "2026-08-13", "2026-08-12", "2026-08-11", "2026-08-10", "2026-08-09", "2026-08-08", "2026-08-07"]
    .map(id => ({ id }));
  const result = selectBackupDocuments(docs, new Date("2026-08-14T12:00:00Z"));
  assert.deepEqual(result.keep.map(item => item.id), [
    "2026-08-14", "2026-08-13", "2026-08-12", "2026-08-11", "2026-08-10", "2026-08-09", "2026-08-08",
  ]);
  assert.deepEqual(result.remove.map(item => item.id), ["2026-08-07"]);
});

test("錯誤 UID 或帳本路徑的快照不合格", () => {
  assert.equal(validateBackupData({ _ownerUid: "other", _sourceLedgerId: "uid-1" }, "uid-1", "uid-1"), false);
  assert.equal(validateBackupData({ _ownerUid: "uid-1", _sourceLedgerId: "other" }, "uid-1", "uid-1"), false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- src/cloudBackups.test.js`  
Expected: FAIL because `src/cloudBackups.js` and its exports do not yet exist.

- [ ] **Step 3: Implement the minimal pure functions**

Use UTC date formatting with zero-padded month/day. `getBackupDates` must return exactly seven date IDs from today backwards. `selectBackupDocuments` must keep only IDs in that set and return all other documents in `remove`, with no mutation of input arrays. `buildBackupData` must strip `_ownerUid` and `_cloudSyncedAt` before adding validated source metadata.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm.cmd test -- src/cloudBackups.test.js`  
Expected: all focused tests pass with zero failures.

- [ ] **Step 5: Commit the pure helper**

```powershell
git add src/cloudBackups.js src/cloudBackups.test.js
git commit -m "加入 Firestore 七日快照工具"
```

### Task 2: 加入 Firestore 備份閘門與快照讀取／還原 API

**Files:**
- Modify: `D:\Vibe Coding\akr-ledger\src\main.jsx` in `useFirebaseSync`
- Modify: `D:\Vibe Coding\akr-ledger\src\cloudBackups.js`
- Modify: `D:\Vibe Coding\akr-ledger\src\cloudBackups.test.js`

**Interfaces:**
- `backupBeforeUpload(db, { uid, ledgerId, data, now }) -> Promise<void>`
- `readCloudBackups(db, { uid, ledgerId }) -> Promise<Array<BackupSummary>>`
- `restoreCloudBackup(db, { uid, ledgerId, backupId, now }) -> Promise<StoreData>`
- `uploadFb(uid, data, options?) -> Promise<void>` where `options.skipBackup` is only used by the internal restore write after the current data has already been backed up.

- [ ] **Step 1: Add failing fake-Firestore tests**

Add a fake Firestore implementation that records collection/doc `get`, `set`, `delete`, and batch `commit` calls. Export `backupBeforeUpload`, `readCloudBackups`, and `restoreCloudBackup` from `src/cloudBackups.js` so the orchestration can be tested without a browser or Firebase SDK. Cover these assertions:

```js
test("主文件存在時先備份再覆蓋", async () => {
  const calls = [];
  const db = makeBackupFakeDb({
    ledger: { entries: [{ id: "old" }], _ownerUid: "uid-1", _cloudSyncedAt: "old-sync" },
  }, calls);
  await backupBeforeUpload(db, {
    uid: "uid-1",
    ledgerId: "uid-1",
    data: { entries: [{ id: "new" }] },
    now: new Date("2026-08-14T12:00:00Z"),
  });
  assert.equal(calls.findIndex(call => call.type === "backup-set") < calls.findIndex(call => call.type === "ledger-set"), true);
});

test("備份失敗時不會寫入主文件", async () => {
  const calls = [];
  const db = makeBackupFakeDb({ backupSetError: new Error("backup failed") }, calls);
  await assert.rejects(() => backupBeforeUpload(db, {
    uid: "uid-1",
    ledgerId: "uid-1",
    data: { entries: [] },
    now: new Date("2026-08-14T12:00:00Z"),
  }), /backup failed/);
  assert.equal(calls.some(call => call.type === "ledger-set"), false);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm.cmd test -- src/cloudBackups.test.js`  
Expected: FAIL because Firestore backup orchestration functions do not exist.

- [ ] **Step 3: Implement backup orchestration**

Before each main-document `set`, read the current document; if it exists, create/update `backups/{today}` from the old data, query the backup subcollection, delete documents outside the seven-date allowlist, then write the main document. All operations must use the existing `withTimeout` boundary. The old metadata must not be copied into the snapshot as authoritative cloud metadata.

- [ ] **Step 4: Route every upload path through the gate**

Replace direct `uploadFb` calls in login choice, startup sync, manual sync, debounce sync, and restore with the gated path. Keep the explicit `skipBackup` option private to the already-protected restore write. If backup or cleanup rejects, preserve local state and set a user-facing error saying the cloud version was not overwritten.

- [ ] **Step 5: Add list and restore behavior**

`readCloudBackups` must read only the current ledger's subcollection, validate owner/path metadata, sort newest first, and return summaries (`id`, `entryCount`, `_sourceLastModified`, `_backupCreatedAt`). `restoreCloudBackup` must read one validated snapshot, call `backupBeforeUpload` for current data, write the selected store with a fresh `_lastModified`, and return the normalized store for `setStore`.

- [ ] **Step 6: Run all tests and verify GREEN**

Run: `npm.cmd test`  
Expected: all existing and new tests pass with zero failures.

- [ ] **Step 7: Commit the sync layer**

```powershell
git add src/main.jsx src/cloudBackups.js src/cloudBackups.test.js
git commit -m "同步前保存 Firestore 七日快照"
```

### Task 3: 加入設定頁快照清單及還原互動

**Files:**
- Modify: `D:\Vibe Coding\akr-ledger\src\main.jsx` Firebase settings panel and related state
- Modify: `D:\Vibe Coding\akr-ledger\src\styles.css` only if the existing settings layout needs a small responsive rule
- Modify: `D:\Vibe Coding\akr-ledger\src\main.jsx` UI tests only if an existing test harness covers rendered settings

**Interfaces:**
- `fbDrive.backups`, `fbDrive.backupsLoading`, `fbDrive.loadBackups`, `fbDrive.restoreBackup`
- A settings panel action must never call restore without an explicit `window.confirm` confirmation.

- [ ] **Step 1: Add a visible-state regression test or deterministic render assertion**

If the existing project has no React DOM harness, add a pure view-model test for summary ordering and use the real browser smoke check in Step 4. The test must assert that an empty list renders an empty state and that a seven-item list renders seven restore choices, not raw ledger contents.

- [ ] **Step 2: Implement the settings panel**

Show the section only for a connected Firebase user. Load summaries on account/profile changes and on an explicit refresh action. Render date, entry count, and source modification time. Keep long content vertically contained on phone widths.

- [ ] **Step 3: Implement explicit restore confirmation and state update**

After confirmation, call `fbDrive.restoreBackup(summary.id)`, replace the active store only after the cloud write succeeds, update local persistence through the existing `store` effect, reload the list, and show success/error feedback. Disable all restore buttons while syncing.

- [ ] **Step 4: Run the full test suite and a local browser smoke check**

Run: `npm.cmd test` and `npm.cmd run dev -- --host 127.0.0.1`. In a browser, verify connected settings show the section, empty state is readable, restore requires confirmation, and the page remains usable at a practical phone width. Do not use real account data for the write path; use a fake Firestore or a disposable local test account only.

- [ ] **Step 5: Commit the UI**

```powershell
git add src/main.jsx src/styles.css
git commit -m "新增雲端版本還原介面"
```

### Task 4: 更新 Firestore rules 原始檔

**Files:**
- Modify: `D:\Vibe Coding\akr-ledger-mobile\firestore.rules`
- Test/verify: `D:\Vibe Coding\akr-ledger-mobile\firebase.json` target and local rules syntax if Firebase CLI is available

- [ ] **Step 1: Add the backup subcollection match**

Use separate `get/list`, `create`, `update`, and `delete` conditions. Reads and deletes require existing `_ownerUid` and `_sourceLedgerId`; creates require request data; updates require both old and new metadata to remain owned by the current user.

- [ ] **Step 2: Run read-only rules/config checks**

Run: `firebase.cmd firestore:rules --help` (or the installed Firebase CLI equivalent) and inspect the final diff. Do not deploy. If no rules emulator is available, disclose that syntax was reviewed but not emulator-executed.

- [ ] **Step 3: Commit the rules source separately**

```powershell
git -C "D:\Vibe Coding\akr-ledger-mobile" add firestore.rules
git -C "D:\Vibe Coding\akr-ledger-mobile" commit -m "允許帳本七日快照存取"
```

### Task 5: 版本、整合驗證及交付檢查

**Files:**
- Modify: `D:\Vibe Coding\akr-ledger\package.json`
- Modify: `D:\Vibe Coding\akr-ledger\package-lock.json`
- Modify: `D:\Vibe Coding\akr-ledger\public\sw.js`
- Modify: `D:\Vibe Coding\akr-ledger\sw.js`
- Modify: `D:\Vibe Coding\akr-ledger\src\main.jsx` app version row
- Generated: `D:\Vibe Coding\akr-ledger\index.html`, `D:\Vibe Coding\akr-ledger\assets\*` via build script

- [ ] **Step 1: Bump the PWA version and cache identifier**

Increment `2.4.17` to `2.4.18` and update every `qys-ledger-mobile-v2417` reference to `qys-ledger-mobile-v2418`, then run the existing build script so root generated assets match source.

- [ ] **Step 2: Run fresh verification**

Run all of:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
git status --short
```

Expected: tests pass with zero failures, build exits 0, diff check has no whitespace errors, and only the planned files are modified.

- [ ] **Step 3: Inspect final diff and commit PWA changes**

```powershell
git diff --stat
git diff -- src/cloudBackups.js src/main.jsx src/package.json public/sw.js sw.js
git add package.json package-lock.json public/sw.js sw.js index.html assets src docs/superpowers/plans
git commit -m "加入 Firestore 七日備份與還原"
```

- [ ] **Step 4: Stop before deployment**

Do not push or deploy until the user separately confirms the rules deployment and PWA release. Report local test/build status, changed files, and the remaining deployment requirement.
