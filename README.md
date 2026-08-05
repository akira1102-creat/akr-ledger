# 錢有數 PWA

繁體中文個人記帳 PWA，使用 Firebase 帳號登入並同步雲端帳本。

立即使用：https://akira1102-creat.github.io/akr-ledger/

## 功能

- 免費基本記帳、香港付款方式、快速範本、每週洞察、月曆、本月摘要、預算及 CSV 匯入／匯出
- 完整圖表、多帳本、自訂分類與版面、自動匯率及 Google 雲端同步
- 使用 Firebase UID 辨認帳號，換裝置及使用 PWA 時可同步同一批雲端帳本
- 沿用 `akr_ledger` 雲端資料格式，相容舊式單帳本及多帳本文件
- 支援離線快取及安裝到手機主畫面

## 雲端同步

- 所有功能均可直接使用；登入 Firebase 帳號後，使用者可在「設定 → 數據與同步」主動啟用雲端同步。
- 本機記帳資料預設留在裝置；雲端同步只會讀寫目前登入帳號及所選帳本的資料。
- 用戶端只可以讀取及更新自己嘅帳本文件，無權存取其他帳號資料。

## 本機開發

```powershell
npm.cmd install
npm.cmd run dev
```

正式建立及發布根目錄靜態檔案：

```powershell
npm.cmd run build
```

Firebase Web 設定存放於本機 `.env`，唔會加入 Git。
