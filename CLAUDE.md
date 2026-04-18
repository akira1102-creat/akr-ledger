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

- Single file: all logic in `index.html` (~2000 lines). No build tool, no npm.
- Stack: React 18 UMD + Babel Standalone + Tailwind CSS Play CDN
- Deploy: GitHub Pages at `https://akira1102-creat.github.io/akr-ledger/`
- **After every deploy: bump `sw.js` cache version** (`akr-ledger-v5` → `v6`) or users see stale app.

## Dev

```bash
python -m http.server 8080
```

Push to `https://github.com/akira1102-creat/akr-ledger`.

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

**Balance:** `totalBudget > 0 ? totalBudget - exp + inc : inc - exp`

**Rates:** fetch `open.er-api.com/v6/latest/USD`; `appRates[X] = usdRates[baseCurrency] / usdRates[X]`; `toBase(amount, currency, rates) = amount * rates[currency]`.

**Categories:** parent `{ id, name, icon, color }`, child adds `parentId`. Charts/budgets use parents only; entry `category` stores child id (or parent if no children).

## Components (all in `index.html`)

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

## SW Cache (`sw.js`) — current: `akr-ledger-v7`

HTML: network-first · static: cache-first · CDN: stale-while-revalidate

## Key Constraints

- `loadStore`: always default `budgets:{}`, `totalBudget:0`
- `EntryModal`: no auto-focus on mount (keyboard collapse bug); use `dvh` + `min-h-0`
- Amount input: `min-w-0` + dynamic font size (no horizontal overflow)
- Debounce sync: PAT always from localStorage, never OAuth/popup
