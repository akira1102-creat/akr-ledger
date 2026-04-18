# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Output Rules (嚴格執行，每次回覆都適用)

- 廣東話回覆（除非用戶用英文問）
- 零廢話：無開場白、無結語、無"好的！"、無"我來幫你"、無"完成了！"
- 唔好重複用戶講過嘅嘢
- 唔好問"需要繼續嗎？"——明確任務直接做
- 無解釋，除非用戶要求——淨係做
- Markdown（headers/bullets/bold）只係喺需要列表或代碼時先用
- Edit代替整個檔案重寫——只顯示改咗嘅部分
- 答案夠晒一句就唔好寫段落
- 唔好寫"我發現X個問題"之類嘅前言——直接列問題

## Project

**AKR記帳本** — Zaim-style Traditional Chinese PWA expense tracker. Owner: Akira. Language: Cantonese/Traditional Chinese.

- Single-file architecture: all logic in `index.html` (~2000 lines). No build tool, no npm.
- Stack: React 18 UMD + Babel Standalone (in-browser JSX) + Tailwind CSS Play CDN
- Deploy: GitHub Pages at `https://akira1102-creat.github.io/akr-ledger/`
- **After every deploy: bump `sw.js` CACHE version** (`akr-ledger-v3` → `v4`, etc.) or users see stale app.

## Dev

```bash
cd "D:\Claude code\zaim-like-app"
python -m http.server 8080
```

Push to `https://github.com/akira1102-creat/akr-ledger` (git already configured).

## Data

**localStorage keys:**
- `"zaim_store_v3"` — main store
- `"akr-gist-state"` — `{ token, gistId, user, lastSync }` (GitHub PAT, persists forever)

**Store shape:**
```js
{
  entries: [],
  categories: { expense: [...], income: [...] }, // two-level: parent (no parentId) + child (has parentId)
  budgets: { [parentCatId]: monthlyAmount },      // base currency
  totalBudget: 0,
  settings: { baseCurrency: "MOP", rates: { MOP:1, HKD:1.03, ... } }
}
```

**Balance:** `totalBudget > 0 ? totalBudget - exp + inc : inc - exp`

**Exchange rates:** fetch `open.er-api.com/v6/latest/USD` (USD base only); convert: `appRates[X] = usdRates[baseCurrency] / usdRates[X]`. `toBase(amount, currency, rates) = amount * rates[currency]`.

## Categories

- Parent: `{ id, name, icon, color }` (no `parentId`)
- Child: `{ id, name, icon, color, parentId }`
- Charts/budgets: parents only. Entry `category` field stores child id (or parent id if no children).

## Components (all in `index.html`)

| Component | Role |
|---|---|
| `useGistSync(store, setStore)` | GitHub Gist sync hook |
| `App` | Root: header (month nav, sync bar), tab nav |
| `HomeView` | Summary card, monthly totals, entry list |
| `CalendarView` | Calendar, tap date → entries |
| `ChartView` | Week/month/year chart, donut, category budgets |
| `EntryModal` | Add/edit bottom-sheet modal |
| `SettingsView` | Tabs: `BasicSettings`, `CatSettings`, `BudgetSettings`, `DataSettings`, `AboutView` |
| `GistSyncPanel` / `GistConnect` | Sync UI in DataSettings |
| `SortableList` | Pointer-events drag-to-reorder |

## GitHub Gist Sync (`useGistSync`)

**No OAuth — uses GitHub PAT stored in localStorage.**

**Startup sync (mount-only `useEffect([])`):**
1. `downloadGist` → get `{ storeData, syncedAt: _cloudSyncedAt, gistUpdatedAt }`
2. `cloudMs = _cloudSyncedAt ?? gistUpdatedAt` (fallback for old gists without embedded timestamp)
3. `cloudMs > localLastSync + 3s` → `setStore(cloudData)` (cloud wins); else → `uploadGist(localStore)`
4. Set `startupDoneRef.current = true` → enables debounce effect

**Debounce sync (`useEffect([store, gistToken, gistId])`):**
- Skips until `startupDoneRef.current = true`
- 1.5s debounce → `PATCH /gists/:id` with `{ ...store, _cloudSyncedAt: now }`
- `justImportedRef` prevents re-upload immediately after cloud import

**`_cloudSyncedAt`** — embedded in every upload for reliable cross-device timestamp comparison.

**Hook API:** `{ gistToken, gistId, gistUser, lastSync, syncing, syncError, connect(token), disconnect(), syncNow() }`

**connect(token):** validate via `GET /user` → search existing gist → create or import/overwrite → sets `startupDoneRef.current = true`

**401 response:** clears `gistToken` in state + localStorage.

## Zaim CSV Import

Columns: `日付(0), カテゴリ(2), カテゴリの内訳(3), 通貨(9), 収入(10), 支出(11), 振替(12), 通貨変換前の金額(14)`
- Skip if `振替 > 0`
- Unknown categories auto-created: parent icon `📂`, child icon `📌`
- Use column 14 as amount

## CSS Variables

```css
--brand: #FF6B8A;  --brand-soft: #FFF0F3;
--income: #2ECC71; --expense: #E74C3C;
```

## SW Cache (`sw.js`)

- Same-origin HTML: network-first
- Same-origin static: cache-first
- CDN: stale-while-revalidate
- Current version: `akr-ledger-v3`

## Key Constraints

- `loadStore`: always ensure `budgets:{}` and `totalBudget:0` on missing fields
- Mobile `EntryModal`: no auto-focus on mount (keyboard collapse bug); use `dvh` + `min-h-0` for sheet height
- Amount input: `min-w-0` + dynamic font size to prevent horizontal overflow
- Debounce sync never calls OAuth/popup — PAT is always available from localStorage