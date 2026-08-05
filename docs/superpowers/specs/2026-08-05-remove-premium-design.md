# Remove Premium and Subscription Management Design

**Goal:** Make every AKR Ledger PWA feature available to every user, remove the subscription-management surface, delete only the current account's Firebase membership document, and retire the separate mobile repository after the PWA release is verified.

## Approved approach

Use a full subscription-layer removal rather than forcing a permanent Premium flag. The PWA keeps Google authentication, Firestore account/profile-index access, and per-profile ledger synchronization. RevenueCat, membership reads, purchase/restore UI, Premium labels, and feature gates are removed so there is one access path for every user.

## Components and data flow

1. `src/main.jsx` remains responsible for the app shell and Firebase ledger sync. It will no longer create a subscription state, read `qys_memberships`, show a paywall, or branch feature rendering on Premium status. Existing profile and ledger state continues to use local storage and `akr_ledger` / `akr_ledger_profiles`.
2. `src/cloudAccount.js` becomes profile-index-only account metadata. It will keep profile merge and index persistence, while removing the membership collection constant, membership validation helper, and membership read from the account-state request.
3. `src/PremiumView.jsx` and `src/subscription.js` will be deleted because no runtime path will import them. The RevenueCat Capacitor dependency will be removed from `package.json` and `package-lock.json`.
4. `README.md`, `public/privacy.html`, and `public/terms.html` will describe free access and optional Firebase cloud synchronization without paid plans, App Store/Google Play billing, or RevenueCat processing.
5. `public/sw.js`, root `sw.js`, `CLAUDE.md`, the app version, and generated root assets will be updated as one PWA release. The service-worker cache identifier must change.

## Firebase and repository cleanup

- Delete only the authenticated current user's document at `qys_memberships/{uid}` after the new PWA is live-verified. Do not delete `akr_ledger`, `akr_ledger_profiles`, or membership documents for other users.
- Do not deploy new Firestore rules as part of this change. The PWA simply stops using the membership collection.
- The separate GitHub repository is exactly `akira1102-creat/akr-ledger-mobile`. Delete that remote repository only after the PWA commit is pushed and the live HTML/service worker serve the new release. If GitHub authentication is unavailable, stop and report the blocker rather than using credentials or deleting local data.

## Error handling and compatibility

- Existing local ledger data, profile records, Firebase auth state, and Firestore ledger documents remain untouched.
- A user without Google login can use every local feature. Cloud sync still requires the existing explicit Google login flow.
- Any old Premium-related local-storage state is ignored; it is not migrated into a new access-control model.
- Existing old service-worker caches are replaced by the new cache version during activation.

## Verification and acceptance

- Add/update unit tests so the cloud account reader no longer requests a membership document and the free-access policy has no gated branch.
- Run `npm.cmd test` and `npm.cmd run build` from `D:\Vibe Coding\akr-ledger`.
- Inspect the final diff and confirm no source or generated asset contains user credentials, tokens, or private keys.
- Verify the live GitHub Pages HTML, hashed app asset, and `sw.js` with a cache-busting request.
- Confirm the Git worktree is clean and `master` matches `origin/master` before the destructive cleanup steps.
