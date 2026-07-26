# 錢有數 PWA

繁體中文個人記帳 PWA，與 Android／iPhone 版共用同一個 Firebase 帳號、會員狀態及雲端帳本格式。

立即使用：https://akira1102-creat.github.io/akr-ledger/

## 功能

- 免費基本記帳、香港付款方式、快速範本、每週洞察、月曆、本月摘要、預算及 CSV 匯入／匯出
- Premium 完整圖表、多帳本、自訂分類與版面、自動匯率及 Google 雲端同步
- 使用 Firebase UID 辨認會員，換裝置及使用 PWA 時保持同一會籍
- 沿用 `akr_ledger` 雲端資料格式，相容舊式單帳本及多帳本文件
- 支援離線快取及安裝到手機主畫面

## 會員與購買

- 使用者必須先登入 Firebase 帳號，手機 App 才會顯示商店訂閱計劃。
- Google Play／Apple App Store 負責付款，RevenueCat webhook 由 Firebase 後端更新會員狀態。
- PWA 不直接出售 App Store／Google Play 訂閱，只會讀取已綁定 Firebase UID 的 Premium 會籍。
- 用戶端只可以讀取自己嘅會員文件，無權自行寫入或提升會籍。

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
