# Firestore 最近 7 日每日快照設計

**日期：** 2026-08-14  
**狀態：** 待實作

## 目標

修正手機或其他裝置以較新本機 `_lastModified` 覆蓋 Firestore 主資料時的資料遺失風險。每個帳戶、每個副帳本每日最多保存一份「覆蓋前的完整版本」，只保留最近 7 個日曆日，並讓用戶可以在 PWA 設定頁查看及還原。

## 已確認的現有根因

- `src/main.jsx` 目前以 `set()` 整份寫入 `akr_ledger/{ledgerId}`。
- 啟動同步以本機與雲端 `_lastModified` 比較；本機時間戳較新時會直接上傳本機整份資料。
- 現時沒有歷史版本，因此錯誤上傳會覆蓋唯一雲端副本。
- Firestore 規則現時只允許 `akr_ledger` 主集合及帳本索引；備份子集合需要新增明確的擁有者規則。

## 採用方案

使用主帳本文件底下的 Firestore 子集合，不把歷史資料塞回主文件，也不另建跨帳戶的頂層備份集合。

### 路徑

```text
akr_ledger/{ledgerId}
  backups/{YYYY-MM-DD}
```

`ledgerId` 沿用現有規則：主帳本為 Firebase UID，副帳本為 `UID__profile__{profileId}`。備份文件 ID 使用 UTC 日期 `YYYY-MM-DD`，同一天重複同步使用同一文件，避免無限增加。

### 備份文件內容

備份文件保存被覆蓋前主文件的完整帳本欄位（排除 `_ownerUid`、`_cloudSyncedAt`），並加入：

```js
{
  _backupDate: "YYYY-MM-DD",
  _backupCreatedAt: "ISO timestamp",
  _sourceCloudSyncedAt: "ISO timestamp|null",
  _sourceLastModified: "ISO timestamp|null",
  _ownerUid: "same Firebase UID",
  _sourceLedgerId: "same ledgerId",
  _entryCount: 0,
  ...storeData
}
```

備份文件的 `_sourceLedgerId` 及 `_ownerUid` 必須與路徑／登入帳戶一致，避免副帳本或其他用戶資料混入。

## 寫入流程

所有會覆蓋主帳本的路徑（啟動同步、登入後選擇保留本機、手動立即同步、自動 debounce 上傳、還原）統一經過 `backupBeforeUpload()`：

1. 讀取目前主文件。
2. 如果主文件不存在，直接建立主文件，不產生空備份。
3. 如果主文件存在且內容有效，先以當日文件 ID寫入／更新備份。
4. 查詢該帳本備份，刪除超過最近 7 個日曆日的文件。
5. 備份及清理成功後才 `set()` 主文件。
6. 任一步驟失敗，停止主文件覆蓋並顯示同步錯誤。

同一帳本在同一天多次寫入只更新當日快照；快照代表當天第一次需要被覆蓋的舊版本，後續同日覆蓋不再失去原始版本。

## 啟動同步安全策略

保留現有用戶選擇「雲端／本機」的流程，但本機覆蓋雲端前必須先完成備份。若讀取雲端失敗、備份失敗、帳本識別未解析或 `_ownerUid` 不一致，禁止上傳本機資料，避免把不完整或錯誤帳本寫入雲端。

## 還原流程

設定頁新增「雲端版本還原」區塊：

- 顯示目前帳本最近 7 日的快照日期、記帳筆數及來源修改時間。
- 用戶按某一日期後，先顯示確認內容（目前版本會被替換）。
- 還原前先以同一 `backupBeforeUpload()` 保存目前主文件。
- 將選定快照寫回主文件，更新 `_lastModified`／`_cloudSyncedAt`，再更新本機 store。
- 還原失敗時不改變本機 store，並顯示可重試錯誤。

還原不會刪除被選取的快照；清理只按 7 日保留規則執行。

## Firestore 安全規則

在 Firebase rules 加入（建立、讀取、更新、刪除分開判斷，避免在文件不存在時讀取 `resource.data`）：

```text
match /akr_ledger/{ledgerId}/backups/{backupId} {
  allow get, list: if ownsLedgerId(ledgerId)
    && resource.data._ownerUid == request.auth.uid
    && resource.data._sourceLedgerId == ledgerId;

  allow create: if ownsLedgerId(ledgerId)
    && request.resource.data._ownerUid == request.auth.uid
    && request.resource.data._sourceLedgerId == ledgerId;

  allow update: if ownsLedgerId(ledgerId)
    && resource.data._ownerUid == request.auth.uid
    && resource.data._sourceLedgerId == ledgerId
    && request.resource.data._ownerUid == request.auth.uid
    && request.resource.data._sourceLedgerId == ledgerId;

  allow delete: if ownsLedgerId(ledgerId)
    && resource.data._ownerUid == request.auth.uid
    && resource.data._sourceLedgerId == ledgerId;
}
```

建立時 `resource` 可能不存在，因此實作規則時需分開 `create`、`get/list`、`update`、`delete` 條件，避免誤用不存在的 `resource.data`。規則只允許同一 Firebase UID 操作自己的帳本備份。

## 介面與錯誤處理

- 同步狀態沿用現有 `syncing`／`syncError`。
- 備份失敗訊息要明確指出「雲端版本未被覆蓋」，而不是只顯示一般同步失敗。
- 沒有快照時顯示空狀態，不建立虛假版本。
- 備份列表載入失敗不會清除本機資料，也不會自動覆蓋雲端。
- 只顯示日期、筆數及修改時間；不在列表中展開或記錄敏感內容。

## 測試範圍

新增純函式／假的 Firestore 測試，覆蓋：

1. 主文件存在時，覆蓋前會先保存完整舊版本。
2. 同一日期重複備份使用同一文件，不增加第二份。
3. 超過 7 個日曆日的備份會被清理，最近 7 日保留。
4. 主文件不存在時不建立空備份。
5. 備份寫入失敗時不呼叫主文件 `set()`。
6. 備份／還原只接受相同 UID 及相同 `ledgerId`。
7. 還原前會保存目前主文件，還原成功後返回選定版本。

現有 `npm.cmd test`、`npm.cmd run build` 及 `git diff --check` 必須保持通過。更新 PWA 快取版本；本階段不部署 Firebase rules 或 PWA，待測試完成及用戶確認後另行部署。

## 不在本次範圍

- 不會修改、刪除或嘗試修復現有 Firestore 主資料。
- 不會自動還原已遺失的舊資料。
- 不會保存超過 7 個日曆日的備份。
- 不會重新加入 RevenueCat、Premium 或 mobile app 功能。
