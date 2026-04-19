# AKR 記帳本

> 仿 Zaim 風格的繁體中文個人記帳 PWA，支援多幣值、自訂分類、預算管理、圖表分析及跨裝置雲端同步。

🔗 **立即使用**：https://akira1102-creat.github.io/akr-ledger/

---

## 功能總覽

### 💰 記帳
- 收入／支出記錄，支援備註與日期
- 自訂計算盤輸入金額（不彈出系統鍵盤），支援加減乘除
- 刪除記錄有確認彈窗防止誤觸

### 🗂️ 分類管理
- 兩層分類：大類（圖示＋顏色）+ 子分類
- 新增、刪除、長按拖拉排序
- 圖表與預算以大類為單位計算

### 📊 圖表分析
- 週／月／年切換，長條圖顯示收支走勢
- 圓餅圖（Donut）：按支出大類分佈
- 點擊大類可鑽入子分類明細（sub-donut）
- 各大類預算進度條

### 📅 月曆視圖
- 月曆點擊任意日期查看當日記錄
- 開啟月曆頁時自動顯示今天的記錄

### 🏠 主頁摘要
- 本週支出概況（週起始：星期日）
- 當月收入／支出／結餘總覽
- 最近記帳列表

### 💱 多幣值
- 支援 MOP、HKD、CNY、JPY、TWD
- 切換基準幣值不影響匯率數值
- 手動編輯任一幣種匯率，其餘自動按比例調整
- 一鍵同步最新匯率（Open Exchange Rates）
- 匯率輸入欄使用計算盤，不彈出系統鍵盤

### ☁️ 雲端同步（GitHub Gist）
- 免費跨裝置同步，無需帳號註冊
- 1.5 秒防抖自動上傳，啟動時自動比對雲端最新版本
- 支援手動立即同步

### 📱 PWA
- 安裝到手機主畫面，完全離線可用
- Android：硬件返回鍵支援（sub-donut → main donut → 關閉記帳 → 主頁）
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
3. 開啟 App → 設定 → 數據 → 雲端同步 → 貼上 Token → 連接
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
| Tailwind CSS Play CDN | 樣式 |
| Service Worker | 離線快取（網路優先 / 快取優先 / SWR 策略） |
| localStorage | 本機數據儲存 |
| GitHub Gist API | 雲端備份同步 |
| Open Exchange Rates | 匯率數據 |

---

## 數據隱私

- 所有記帳數據儲存於**你的裝置本機**（localStorage）
- 雲端同步備份至**你自己的** GitHub Gist（私密），只有你能存取
- 不經過任何第三方伺服器，Token 只存在本機
