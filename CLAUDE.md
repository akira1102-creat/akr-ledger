# CLAUDE.md

## Output Rules

- Reply in Cantonese unless user writes in English
- No filler: no greetings, closings, "Sure!", "I'll help", "Done!"
- Don't repeat what user said
- Don't ask "Should I continue?" — just do it
- No explanations unless asked
- Markdown only when listing or showing code
- Edit files (don't rewrite); show only changed parts
- One sentence answer if one sentence suffices
- No preamble like "I found X issues" — just list them

## Project

**AKR Ledger** — Zaim-style Cantonese PWA expense tracker. Owner: Akira.

- Vite app: entry in `index.html`, logic in `src/main.jsx`, CSS in `src/styles.css`.
- Stack: React 18 + Vite + Tailwind CSS
- Deploy: GitHub Pages at `https://akira1102-creat.github.io/akr-ledger/`
- **After EVERY edit to `index.html` or `sw.js`: bump `sw.js` cache version** (line 3, e.g. `akr-ledger-v37` → `v38`). Do this before finishing any change, not just on deploy.

## Dev

```bash
python -m http.server 8080
```

## Deploy

After every change to app code, built/cached assets, or `sw.js`:
1. Bump `sw.js` cache version (line 3)
2. Update `## SW Cache` version in this file
3. Update app version in `src/main.jsx`: search `"版本","v1.1.` → update date to `yymmdd` format (e.g. `v1.1.260530`)
4. Commit and push:

```bash
git add .
git commit -m "description"
git push origin master
```

GitHub Pages auto-deploys from `master` branch to `https://akira1102-creat.github.io/akr-ledger/`.

## Data

**localStorage:** `"zaim_store_v3"` (main store), `"akr-gist-state"` (`{ token, gistId, user, lastSync }`)

**Store shape:**

```js
{
  entries: [],
  categories: { expense: [...], income: [...] }, // parent (no parentId) + child (has parentId)
  budgets: { [parentCatId]: monthlyAmount },      // base currency
  totalBudget: 0,
  settings: { baseCurrency: "MOP", rates: { MOP:1, HKD:1.03, CNY:1.11, ... } }
}
```

**Balance:** `budgetInBalance && totalBudget > 0 ? totalBudget + inc - exp : inc - exp`

**Rates:** fetch `open.er-api.com/v6/latest/USD`; `appRates[X] = usdRates[baseCurrency] / usdRates[X]`; `toBase(amount, currency, rates) = amount * rates[currency]`.

**Categories:** parent `{ id, name, icon, color }`, child adds `parentId`. Charts/budgets use parents only; entry `category` stores child id (or parent if no children).

## Components (in `src/main.jsx`)

| Component | Role |
|---|---|
| `useGistSync(store, setStore)` | GitHub Gist sync hook |
| `App` | Root: header, tab nav |
| `HomeView` | Summary card, monthly totals, entry list |
| `CalendarView` | Calendar → tap date → entries |
| `ChartView` | Week/month/year chart, donut, budgets |
| `EntryModal` | Add/edit bottom-sheet modal |
| `SettingsView` | `BasicSettings`, `CatSettings`, `BudgetSettings`, `DataSettings`, `AboutView` |
| `GistSyncPanel` / `GistConnect` | Sync UI |
| `SortableList` | Drag-to-reorder |

## Gist Sync (`useGistSync`)

No OAuth — PAT stored in localStorage.

**Startup (`useEffect([])`):**
1. `downloadGist` → `{ storeData, _cloudSyncedAt, gistUpdatedAt }`
2. `cloudMs = _cloudSyncedAt ?? gistUpdatedAt`
3. `cloudMs > localLastSync + 3s` → `setStore(cloudData)`; else → `uploadGist(localStore)`
4. `startupDoneRef.current = true` → enables debounce

**Debounce (`useEffect([store, gistToken, gistId])`):** 1.5s → `PATCH /gists/:id` with `{ ...store, _cloudSyncedAt: now }`. `justImportedRef` blocks re-upload after import.

**`connect(token)`:** `GET /user` → find/create gist → sets `startupDoneRef`. 401 clears token.

**Hook API:** `{ gistToken, gistId, gistUser, lastSync, syncing, syncError, connect, disconnect, syncNow }`


## CSS Variables

```css
--brand: #FF6B8A; --brand-soft: #FFF0F3; --income: #2ECC71; --expense: #E74C3C;
```

## SW Cache (`sw.js`) — current: `akr-ledger-v95`

HTML: network-first · static: cache-first · CDN: stale-while-revalidate

## Key Constraints

- `loadStore`: always default `budgets:{}`, `totalBudget:0`
- `EntryModal`: no auto-focus on mount (keyboard collapse bug); use `dvh` + `min-h-0`
- Amount input: `min-w-0` + dynamic font size (no horizontal overflow)
- Debounce sync: PAT always from localStorage, never OAuth/popup
