# AKR 記帳本

> 仿 Zaim 風格的繁體中文個人記帳 PWA，支援多幣值、自訂分類、預算管理、圖表分析及跨裝置雲端同步。

🔗 **立即使用**：https://akira1102-creat.github.io/akr-ledger/

---

## 功能總覽

### 💰 記帳
- 收入／支出記錄，支援備註、日期、幣值選擇
- 自訂計算盤輸入金額（不彈出系統鍵盤），支援加減乘除運算
- 快速日期按鈕：今天 / 昨天 / 前天，一鍵填入
- 左滑記帳項目顯示紅色刪除按鈕，附確認彈窗防止誤觸
- 長按記帳項目快速複製為新記錄（自動帶入今日日期）

### 🔍 搜尋與分頁
- 首頁底部搜尋欄，即時過濾備注、分類名稱、金額
- 記帳列表以日期分組，今日／昨日顯示標籤，支援「顯示更多」分頁載入

### 🗂️ 分類管理
- 兩層分類結構：大類（圖示＋顏色）+ 子分類
- 新增、刪除、長按拖拉排序
- 記帳時以左右雙欄面板選擇大類與子分類
- 圖表與預算以大類為單位計算；記帳記錄儲存至子分類

### 📊 圖表分析
- 週／月／年切換，長條圖顯示收支走勢
- 圓餅圖（Donut）：按支出大類分佈，同色系自動去重避免撞色
- 點擊大類可鑽入子分類明細（sub-donut）
- 各大類預算進度條，超額顯示紅色警示

### 📅 月曆視圖
- 月曆點擊任意日期查看當日記錄
- 開啟月曆頁時自動顯示今天的記錄

### 🏠 主頁摘要
- 月份標題可點擊彈出月份選擇器，左右箭頭切換月份
- 本月收入／支出／結餘總覽，附迷你 Donut 圖顯示支出分類佔比
- 支出概況：本月／本週／今日預算使用進度，超支顯示紅色警示
  - 本週預算按當週實際天數靜態計算，每週日更新
  - 今日預算 = 月份剩餘預算 ÷ 本月剩餘天數（動態每日更新）
- 記帳列表按日期分組，金額數字變動時有滑入動畫

### 💳 預算管理
- 設定月度總預算，可選擇是否將預算納入結餘計算
- 各大類可設定獨立月度上限，圖表頁顯示進度條
- 超支時顯示橙色警示

### 💱 多幣值
- 支援 MOP、HKD、CNY、JPY、TWD
- 每筆記帳可選用不同幣值，自動換算至基準幣值顯示
- 手動編輯任一幣種匯率，其餘自動按比例調整
- 一鍵同步最新匯率（Open Exchange Rates）

### 🔔 記帳提醒
- 可開啟推送通知提醒
- 超過 1 日未記帳，下次開啟 App 時自動提示

### 🎨 主題
- **主題色**：珊瑚粉 / 天藍（預設），即時切換全局品牌色
- **深淺設定**：淺色 / 深色 / 跟隨系統，設定儲存於本機

### 📤 數據備份
- **CSV 匯出**：匯出所有記帳記錄為標準 CSV，可用 Excel 開啟
- **CSV 匯入**：支援 AKR 格式及 Zaim 格式 CSV 匯入
- **GitHub Gist 雲端同步**：免費跨裝置同步，詳見下方說明

### ☁️ 雲端同步（GitHub Gist）
- 免帳號，使用 GitHub Personal Access Token（PAT）
- 1.5 秒防抖自動上傳，啟動時自動比對雲端最新版本
- 支援手動立即同步，標頭顯示同步狀態與時間

### 📱 PWA
- 安裝到手機主畫面，完全離線可用
- 主畫面長按圖示可直接「新增記帳」（Shortcut 捷徑）
- Android：硬件返回鍵支援各層 back navigation
- iOS：左滑手勢返回上一層

---

## 安裝到手機

**Android（Chrome）**
1. 用 Chrome 開啟網址
2. 右上角選單 → 「加至主畫面」或「安裝應用程式」

**iOS（Safari）**
1. 用 **Safari** 開啟網址（iOS 限定 Safari 才支援 PWA）
2. 底部分享按鈕 → 「加入主畫面」

---

## 雲端同步設定（選用）

1. 登入 [GitHub](https://github.com)，前往 [Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens)
2. 點「Generate new token (classic)」，勾選 **`gist`** 權限，生成並複製 Token
3. 開啟 App → 設定 → 數據與同步 → 雲端同步 → 貼上 Token → 連接
4. 完成，之後每次修改會自動同步

**換機恢復**：在新裝置輸入同一個 Token，App 會自動找到備份並導入。

---

## 本機開發

```bash
git clone https://github.com/akira1102-creat/akr-ledger.git
cd akr-ledger
python -m http.server 8080
# 開啟 http://localhost:8080
```

無需 Node.js、npm 或任何 build 工具。

---

## 技術棧

| 技術 | 用途 |
|---|---|
| React 18 UMD + Babel Standalone | UI 框架（瀏覽器直接執行 JSX） |
| Tailwind CSS Play CDN | 樣式（Dark Mode via `class` 策略） |
| Service Worker | 離線快取（HTML 網路優先 / 靜態快取優先 / CDN SWR） |
| localStorage | 本機數據儲存 |
| GitHub Gist API | 雲端備份同步 |
| Open Exchange Rates | 匯率數據 |
| Web Notifications API | 記帳提醒推送 |

---

## 數據隱私

- 所有記帳數據儲存於**你的裝置本機**（localStorage）
- 雲端同步備份至**你自己的** GitHub Gist（私密），只有你能存取
- 不經過任何第三方伺服器，Token 只存在本機
