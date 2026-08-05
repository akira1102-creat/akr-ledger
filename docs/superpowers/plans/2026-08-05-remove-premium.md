# Remove Premium and Subscription Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove Premium and RevenueCat from the PWA, make all existing features available to every user, stop reading Firebase membership state, then safely delete only the current account membership document and retire the mobile GitHub repository after live verification.

**Architecture:** Keep the existing local-storage ledger model, Google/Firebase authentication, Firestore `akr_ledger` profile-scoped documents, and `akr_ledger_profiles` index. Remove the subscription state machine and all UI branches that depend on it; account metadata reads will fetch only the profile index.

**Tech Stack:** React 18, Vite, Firebase compat Auth/Firestore, Node test runner, GitHub Pages.

## Global Constraints

- Do not modify or delete `akr_ledger` or `akr_ledger_profiles` data.
- Delete only the current authenticated user's `qys_memberships/{uid}` document after the new PWA is live-verified.
- Do not deploy Firestore rules in this task.
- Delete only the exact GitHub repository `akira1102-creat/akr-ledger-mobile`, after PWA push and live verification; stop if GitHub authentication is unavailable.
- Keep cloud sync explicitly opt-in through Google/Apple login; local-only users must still access every feature.
- Update both `public/sw.js` and root `sw.js`, `CLAUDE.md`, app version, and generated root assets for the release.
- Never include credentials, tokens, UIDs, or private keys in source, tests, commits, or reports.

---

### Task 1: Remove membership reads from account metadata

**Files:**
- Modify: `src/cloudAccount.js`
- Test: `src/cloudAccount.test.js`

**Interfaces:**
- `readAccountCloudState(db, uid)` returns `{ cloudProfiles }` and reads only `akr_ledger_profiles/{uid}`.
- `mergeCloudProfiles`, `isKnownProfile`, and `resolveActiveProfile` remain unchanged.

- [ ] **Step 1: Write the failing test**

Extend the fake Firestore database in `src/cloudAccount.test.js` so it records every requested collection and add:

```js
test("account cloud state does not read subscription membership", async () => {
  const requested = [];
  const fakeDb = {
    collection: name => {
      requested.push(name);
      return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ profiles: [] }) }) }) };
    },
  };

  const { readAccountCloudState } = await import("./cloudAccount.js");
  const state = await readAccountCloudState(fakeDb, "test-uid");

  assert.deepEqual(state, { cloudProfiles: [] });
  assert.deepEqual(requested, ["akr_ledger_profiles"]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run `npm.cmd test -- src/cloudAccount.test.js`.

Expected failure: the current implementation requests `qys_memberships` and returns an `isPremium` field.

- [ ] **Step 3: Implement the minimal production change**

Remove `MEMBERSHIP_COLLECTION`, `toExpiryMs`, `hasActivePremiumMembership`, the membership request, and the `isPremium` return field from `src/cloudAccount.js`. Keep the profile-index fallback parsing intact.

- [ ] **Step 4: Run the focused and complete tests**

Run `npm.cmd test -- src/cloudAccount.test.js` and then `npm.cmd test`.

Expected result: all tests pass and no test requests `qys_memberships`.

- [ ] **Step 5: Commit the account metadata change**

```powershell
git add src/cloudAccount.js src/cloudAccount.test.js
git commit -m "移除 Firebase 會籍讀取"
```

---

### Task 2: Remove subscription state and unlock every PWA feature

**Files:**
- Modify: `src/main.jsx`
- Delete: `src/PremiumView.jsx`
- Delete: `src/subscription.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- `useFirebaseSync(store, setStore, activeProfile, enabled)` keeps its existing API and receives `activeProfileReady` as the only access guard.
- `SettingsView`, `ProfileSettings`, `BasicSettings`, and `DataSettings` render their existing controls without `isPremium`, `subscription`, `onUpgrade`, or `PremiumGate` props.

- [ ] **Step 1: Write the failing access-policy test**

Create `src/accessPolicy.test.js` with:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { allFeaturesEnabled } from "./accessPolicy.js";

test("all features are enabled without membership state", () => {
  assert.equal(allFeaturesEnabled(), true);
  assert.equal(allFeaturesEnabled(null), true);
  assert.equal(allFeaturesEnabled({ status: "inactive" }), true);
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run `npm.cmd test -- src/accessPolicy.test.js`.

Expected failure: `./accessPolicy.js` does not exist.

- [ ] **Step 3: Implement the minimal access policy and remove subscription branches**

Create `src/accessPolicy.js`:

```js
export const allFeaturesEnabled = () => true;
```

In `src/main.jsx`:

1. Remove `PremiumView`, `PremiumBadge`, `PremiumGate`, `useSubscription`, membership imports, paywall state, `openPremium`, `closePremium`, membership snapshot effects, `refreshMembership`, and the Premium settings menu item.
2. Import `allFeaturesEnabled` and use one `const featuresEnabled = allFeaturesEnabled();` value only for compatibility with child components that still need a boolean during the same edit; remove those compatibility props once the child branches are direct.
3. Pass `activeProfileReady` (not subscription state) to `useFirebaseSync`.
4. Render `ChartView`, `LayoutSettings`, and `CatSettings` directly.
5. Let `createProfile` always create a profile; remove the paywall branch.
6. Fetch automatic exchange rates for every user using the existing once-per-day local key.
7. Replace the header Premium badge with the existing cloud-login/sync status only.
8. Make `ProfileSettings` always show the new-account form, `BasicSettings` always fetch rates, and `DataSettings` always show `FirebaseSyncPanel` plus local CSV backup controls.
9. Remove `FirebaseMembershipLogin` and all remaining strings containing `Premium`, `會員會籍`, `購買`, `恢復購買`, or App Store/Google Play subscription management from the PWA UI.
10. Remove the paywall overlay render and the `premium` layer entry if no other code uses it.

Delete `src/PremiumView.jsx` and `src/subscription.js` only after `rg -n "PremiumView|PremiumGate|PremiumBadge|useSubscription|subscription\." src` returns no runtime imports.

Remove `@revenuecat/purchases-capacitor` from `package.json` and `package-lock.json` with `npm.cmd uninstall @revenuecat/purchases-capacitor --package-lock-only` followed by a package-file check; do not remove Firebase Auth.

- [ ] **Step 4: Run tests and build**

Run `npm.cmd test` and `npm.cmd run build`.

Expected result: all tests pass, Vite build exits 0, and the generated root assets contain no Premium/paywall code.

- [ ] **Step 5: Inspect the source for leftover subscription UI**

Run:

```powershell
rg -n -i "premium|revenuecat|qys_memberships|membership|purchase|restore|paywall|subscription" src package.json package-lock.json
```

Expected result: no runtime or package references; historical design/spec text may mention the migration only outside the app source.

- [ ] **Step 6: Commit the free-access PWA change**

```powershell
git add src package.json package-lock.json
git commit -m "全面開放 PWA 功能並移除訂閱層"
```

---

### Task 3: Update user-facing documentation and cached release metadata

**Files:**
- Modify: `README.md`
- Modify: `public/privacy.html`
- Modify: `public/terms.html`
- Modify: `public/sw.js`
- Modify: `sw.js`
- Modify: `CLAUDE.md`
- Modify: `src/main.jsx` app version row
- Generated: `index.html`, `assets/*`

- [ ] **Step 1: Update the documentation copy**

Describe all app functionality as available to every user. Keep the existing statement that Firebase sync requires explicit login and remove paid-plan, subscription, RevenueCat, App Store billing, and Premium cancellation language.

- [ ] **Step 2: Bump release identifiers**

Use `v2.4.17` for the app and `qys-ledger-mobile-v2417` for both service workers and `CLAUDE.md`.

- [ ] **Step 3: Build and verify generated assets**

Run `npm.cmd run build`, then verify `index.html` references an existing hashed JavaScript asset and both service workers contain `qys-ledger-mobile-v2417`.

- [ ] **Step 4: Commit the release metadata**

```powershell
git add README.md public/privacy.html public/terms.html public/sw.js sw.js CLAUDE.md src/main.jsx index.html assets package.json package-lock.json
git commit -m "更新免費版文件及 PWA 快取版本"
```

---

### Task 4: Verify and push the PWA before destructive cleanup

**Files:**
- Verify only: all committed files in `D:\Vibe Coding\akr-ledger`

- [ ] **Step 1: Run the full verification set**

Run `npm.cmd test`, `npm.cmd run build`, `git diff --check`, and `git status --short --branch`.

- [ ] **Step 2: Push the PWA**

Run `git push origin master`.

- [ ] **Step 3: Verify GitHub Pages with cache busting**

Request `https://akira1102-creat.github.io/akr-ledger/?v=2.4.17` and `/akr-ledger/sw.js?v=2.4.17`; confirm HTTP 200, the new hashed asset, and `qys-ledger-mobile-v2417`.

- [ ] **Step 4: Confirm no source-level subscription surface remains**

Run `rg -n -i "premium|revenuecat|qys_memberships|membership|purchase|restore|paywall|subscription" src public README.md package.json package-lock.json`; any result must be a deliberate migration note, not shipped UI or runtime code.

---

### Task 5: Delete the current membership document

**Files:**
- External Firebase document: `qys_memberships/{current authenticated uid}` only

- [ ] **Step 1: Confirm the current authenticated UID without printing it**

Use the existing authenticated Firebase session or console to resolve the current account UID. Do not place the email or UID in output, source, or commits.

- [ ] **Step 2: Read the exact document metadata**

Confirm the document exists in `qys_memberships` and belongs to the current UID. If it does not exist or ownership is ambiguous, stop without deleting anything.

- [ ] **Step 3: Delete only that document**

Delete `qys_memberships/{current uid}` through the authorized Firebase console/session. Do not use a collection-wide query or batch delete.

- [ ] **Step 4: Verify deletion and ledger preservation**

Read back the target membership document as missing, and confirm `akr_ledger` and `akr_ledger_profiles` were not modified by this operation.

---

### Task 6: Retire the mobile GitHub repository

**Files:**
- External repository: `https://github.com/akira1102-creat/akr-ledger-mobile`

- [ ] **Step 1: Confirm the PWA remote is pushed and clean**

Run `git status --short --branch` in `D:\Vibe Coding\akr-ledger` and confirm `master` matches `origin/master`.

- [ ] **Step 2: Check GitHub authentication**

Run `gh auth status`. If it is not authenticated, stop and ask the user to authenticate; never put a token in a command or file.

- [ ] **Step 3: Delete only the exact mobile repository**

Run `gh repo delete akira1102-creat/akr-ledger-mobile --yes` after the authenticated check. Do not delete the local `D:\Vibe Coding\akr-ledger-mobile` directory.

- [ ] **Step 4: Verify the repository is gone**

Run `gh repo view akira1102-creat/akr-ledger-mobile`; expect a not-found result, and report that the local directory remains untouched.
