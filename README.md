# AKR 記帳本

> 仿 Zaim 風格的繁體中文個人記帳 PWA，支援多幣值、分類預算、跨裝置雲端同步。

---

## 功能特色

- 💰 **多幣值記帳**：MOP、HKD、CNY、USD 等，自動換算基準幣
- 🗂️ **兩層分類**：自訂大類與子分類，可新增、刪除、拖拉排序
- 📊 **圖表分析**：週／月／年切換，圓餅圖 + 分類預算進度
- 📅 **月曆視圖**：按日期查看每日消費
- 📱 **PWA 離線使用**：安裝到手機主畫面，完全離線可用
- ☁️ **GitHub Gist 同步**：免費跨裝置同步，無需帳號註冊
- 🔒 **數據隱私**：所有資料儲存於本機，雲端備份加密在你自己的 GitHub Gist

---

## 安裝到手機

無需下載，直接從瀏覽器安裝：

**Android（Chrome）**
1. 用 Chrome 開啟網址
2. 右上角三點選單 → 「安裝應用程式」或「加至主畫面」

**iOS（Safari）**
1. 用 **Safari** 開啟網址（iOS 限定 Safari 才支援 PWA）
2. 底部分享按鈕 → 「加入主畫面」

🔗 **網址**：https://akira1102-creat.github.io/akr-ledger/

---

## 雲端同步設定（選用）

同步功能使用 **GitHub Gist**，只需一個免費 GitHub 帳號，無需任何伺服器。

### 步驟

1. 登入 [GitHub](https://github.com)，前往 [Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens)
2. 點「Generate new token (classic)」
3. 勾選 **`gist`** 權限，生成 Token 並複製
4. 開啟 App → 設定 → 數據 → 雲端同步 → 貼上 Token → 連接
5. 完成，之後每次修改會自動同步

### 換機恢復

在新裝置輸入**同一個 Token**，App 會自動找到備份並導入。

---

## 本機開發

```bash
git clone https://github.com/akira1102-creat/akr-ledger.git
cd akr-ledger
python -m http.server 8080
# 開啟 http://localhost:8080
```

無需 Node.js、無需 npm、無需 build。

---

## 技術棧

| 技術 | 用途 |
|---|---|
| React 18 UMD + Babel Standalone | UI 框架（瀏覽器直接執行 JSX） |
| Tailwind CSS Play CDN | 樣式 |
| GitHub Gist API | 雲端備份同步 |
| Service Worker | 離線快取 |
| localStorage | 本機數據儲存 |

---

## 數據隱私

- 所有記帳數據儲存於**你的裝置本機**（localStorage）
- 雲端同步備份至**你自己的** GitHub Gist（私密），只有你能存取
- 不經過任何第三方伺服器
- Token 只存在本機，不會上傳至代碼或任何地方

---

## 版本

目前版本：**v1.0.260418**
