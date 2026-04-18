# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概覽

**AKR記帳本** — 仿 Zaim 風格的繁體中文 PWA 記帳 App。  
Owner: Akira (AKiRa)。語言：廣東話／繁體中文。

**單檔架構**：所有邏輯集中在 `index.html`（~1900 行），無 build tool，無 npm。  
直接用瀏覽器開啟或透過 HTTP server 運行。

## 開發與部署

### 本機開發
```bash
cd "D:\Claude code\zaim-like-app"
python -m http.server 8080
# 瀏覽器開 http://localhost:8080
```
Launch config 已存於 `.claude/launch.json`，可用 `preview_start` 工具啟動。

### 部署
推送至 GitHub repo，透過 GitHub Pages 或 Netlify Drop 自動部署。  
**每次部署新版本後，必須遞增 `sw.js` 的 `CACHE` 版本號**（e.g. `akr-ledger-v2` → `akr-ledger-v3`），否則用戶瀏覽器會持續顯示舊版本。

### 強制清除用戶端快取
設定 → 數據 →「🔄 清除 App 快取並更新」按鈕，會登出 SW、清除 Cache Storage 後重載。

## 技術架構

### 前端依賴（全部 CDN，無本地安裝）
- **React 18** UMD + **Babel Standalone**（JSX 在瀏覽器即時轉譯，`<script type="text/babel">`）
- **Tailwind CSS** Play CDN
- ~~Google Identity Services~~ — **已移除**，改用 GitHub Gist 同步

### 資料儲存
- **主資料**：`localStorage` key `"zaim_store_v3"`
- **GitHub Gist 同步狀態**：`localStorage` key `"akr-gist-state"`（存 `{ token, gistId, user, lastSync }`，token 為 GitHub PAT，持久有效）
- **資料結構**：
  ```js
  store = {
    entries: [],          // 記帳記錄
    categories: {
      expense: [...],     // 兩層結構：parent (無 parentId) + child (有 parentId)
      income: [...]
  },
    budgets: {},          // { [parentCatId]: monthlyAmount }（以 base 幣計）
    totalBudget: 0,       // 每月總預算
    settings: { baseCurrency: "MOP", rates: {...} }
  }
  ```

### 分類系統（兩層）
- **第一層**：無 `parentId` 屬性的分類（e.g. `{ id:"food", name:"飲食", ... }`）
- **第二層**：有 `parentId` 的子分類（e.g. `{ id:"lunch", parentId:"food", ... }`）
- 圖表、預算只顯示第一層
- 記帳記錄的 `category` 欄位存子分類 id（或父分類 id，如父分類無子項）

### 匯率換算
`rates[X]` = 1 單位 X 等於幾多 base 貨幣（e.g. base=MOP 時，`rates.HKD ≈ 1.03`）  
`toBase(amount, currency, rates)` = `amount * rates[currency]`  
線上同步用 `https://open.er-api.com/v6/latest/USD`（免費版，只支援 USD base），然後換算：`appRates[X] = usdRates[baseCurrency] / usdRates[X]`

### 結餘計算
- 有 `totalBudget`：`結餘 = totalBudget - 支出 + 收入`
- 無 `totalBudget`：`結餘 = 收入 - 支出`

## 主要組件結構（index.html 內）

| 區塊 | 說明 |
|---|---|
| `useDriveSync(store, setStore)` | Google Drive 同步 hook，處理 token 生命周期、靜默登入、自動同步 |
| `App` | 根組件，含 header（月份導航、Drive 狀態列）、底部 tab nav |
| `HomeView` | 首頁：支出概況卡、月度收支 + mini donut、記帳明細列表 |
| `CalendarView` | 月曆視圖，點擊日期顯示當日明細 |
| `ChartView` | 圖表：週/月/年切換、大圓餅、分類列表、預算進度條 |
| `EntryModal` | 新增/編輯記帳的 bottom sheet modal |
| `SettingsView` | 設定頁，子組件：`BasicSettings`、`CatSettings`、`BudgetSettings`、`DataSettings`、`AboutView` |
| `SortableList` | 使用 pointer events 實現的拖拉排序組件 |

## GitHub Gist 同步邏輯

**方案**：用戶在 GitHub 生成 Personal Access Token（只需 `gist` scope），貼入設定一次，永久有效，無 OAuth 彈窗。

### 連接流程（首次）
1. 用戶前往 `github.com/settings/tokens` 生成 PAT（勾選 `gist`）
2. 在設定 → 數據 → 雲端同步 貼入 Token，按「連接」
3. App 呼叫 `GET /user` 驗證 Token 並取得 username
4. 搜尋現有 Gist（`akr-ledger.json`）
   - **無**：建立新 Secret Gist，上傳現有資料
   - **有**：詢問「導入雲端 or 以本機覆蓋雲端」
5. Token + Gist ID + User 存入 `localStorage["akr-gist-state"]`，自動同步啟用

### 換機恢復
1. 輸入同一個 GitHub PAT
2. App 找到現有 Gist → 選擇導入 → 資料恢復完成

### 自動同步
- Store 任何變化 → 1.5 秒 debounce → `PATCH /gists/:id`
- PAT 存在 localStorage，頁面刷新後無需任何操作，直接繼續同步
- API 返回 401：清除 token，顯示「需重新輸入 Token」

### Hook 介面（`useGistSync`）
```js
{ gistToken, gistId, gistUser, lastSync, syncing, syncError,
  connect(token), disconnect(), syncNow() }
```

### UI 組件
- `GistSyncPanel` — 顯示連接狀態、上次同步、立即同步按鈕
- `GistConnect` — Token 輸入框 + 連接按鈕 + 生成 Token 鏈接

### 已知限制
- GitHub PAT 如被用戶手動撤銷，需重新輸入新 Token
- Gist 單檔最大 10MB，正常記帳數據遠低於此限制

## Zaim CSV 導入格式
```
日付, 方法, カテゴリ, カテゴリの内訳, 支払元, 入金先, 品目, メモ, お店, 通貨, 収入, 支出, 振替, 残高調整, 通貨変換前の金額, 集計の設定
```
- `振替 > 0` → 跳過（轉帳記錄）
- 未知分類自動建立（父分類 icon 預設 `📂`，子分類預設 `📌`）
- `通貨変換前の金額` 作為原始金額

## CSS 變數
```css
--brand: #FF6B8A
--brand-soft: #FFF0F3
--income: #2ECC71
--expense: #E74C3C
```

## Service Worker 快取策略（sw.js）
- **同源 HTML**：Network-first（確保新版本即時生效）
- **同源靜態資源**：Cache-first
- **CDN 資源**：Stale-while-revalidate
