# Product Engineering Delivery Preferences

Use this material when turning a product request into implementation work, especially for small web apps, PWAs, and user-facing operational tools.

## Requirement Assessment

- Infer the real data and workflow boundary behind the requested UI. If the user asks for a separate person, account, workspace, or profile, determine whether they need truly isolated data rather than a filtered view of shared data.
- Preserve existing user data and established behavior unless the request explicitly requires a migration or breaking change.
- Trace a feature across every affected layer: visible UI, local persistence, cached state, authentication, cloud storage, synchronization metadata, redirects, auxiliary keys, build output, and deployment behavior.
- Prefer the smallest implementation that fully satisfies the operational need. Avoid unrelated refactors and speculative features.
- Ask a question only when an unresolved choice would materially change behavior, risk data, or expand scope. Otherwise, make a conservative decision and implement it.
- Treat reports such as a blank screen, failed save, stale content, or missing update as urgent end-to-end delivery defects, not merely local code issues.

## Repeated Corrections to Remember

- Do not stop after editing source files. Build, verify the actual delivery surface, commit, and push when the repository has a configured remote.
- Do not claim that an update is complete until the deployed or publishable entry point references valid built assets.
- Update the visible version identifier whenever an app release changes, and use the current date when the project's version convention is date-based.
- Bump the service-worker or asset-cache version whenever cached or built assets change.
- Do not let a service worker silently keep users on an obsolete app version. Provide a clear update and reload path when a new version is available.
- Do not swallow operational errors with empty exception handlers. Surface failures through a consistent user notification and retain enough diagnostic context for debugging.
- Do not hand-build delimited exports field by field. Apply one shared escaping helper to every exported value.
- Do not rely on runtime CDN compilation for a production app when a local build can bundle its dependencies and assets.
- When introducing multiple profiles or workspaces, scope every local and cloud key consistently. Partial scoping is unacceptable because it can leak or mix data.

## Preferred Workflow

1. Inspect the repository, current branch, worktree state, build scripts, publishing layout, version convention, cache strategy, and configured remote.
2. Pull the latest remote changes before implementation when the user asks to start from the latest repository state.
3. Read the existing implementation and follow its established architecture and UI patterns.
4. Identify all state boundaries and delivery surfaces affected by the request before editing.
5. Make narrowly scoped source changes while preserving unrelated user work.
6. Update the app version and cache identifier when required by the changed assets.
7. Run the lightest targeted checks that provide credible confidence, then run the production build for user-facing app changes.
8. Verify the generated or published entry point and its referenced assets, not only the source development entry point.
9. Check the working-tree diff for accidental generated files, unrelated changes, secrets, and version inconsistencies.
10. Create one intentional commit per task using the user's preferred language, then push immediately unless told not to.
11. Report the user-visible outcome, verification performed, commit, and push status concisely.

## Quality Standards

- A feature is complete only when it works across UI, persistence, synchronization, cache, build, and publish boundaries that it touches.
- Existing data must remain accessible after upgrades unless a deliberate migration is part of the request.
- Distinct users or workspaces must have distinct storage and backup payloads while shared authentication may remain shared.
- Error states must be visible and actionable. Never let the interface imply success after a failed save, backup, import, export, cache update, or synchronization attempt.
- Production entry points must load without runtime compilation dependencies and must reference files that exist in the published output.
- Exported data must remain valid when any field contains commas, quotes, line breaks, or future free-form content.
- The active account, profile, or workspace should be visible wherever an action could otherwise affect the wrong dataset.
- Destructive profile or data actions require explicit confirmation and must protect the primary or legacy dataset when appropriate.
- Implementation should match the existing visual language and remain efficient on both mobile and desktop.
- Documentation and release identifiers must agree with the actual shipped build.

## Testing and Acceptance Habits

- Prefer focused validation proportional to risk: targeted logic checks for narrow changes, a production build for frontend changes, and browser or static-server checks for delivery-sensitive changes.
- For static or PWA releases, confirm that the root page, JavaScript, CSS, manifest, icons when relevant, and service worker all return successfully from the same publish layout users receive.
- Test the real user flow, including refresh, profile switching, save, reload, synchronization, and update activation where those behaviors changed.
- Test both the default legacy path and at least one newly created isolated profile or workspace.
- Verify that data written under one profile does not appear under another, locally or in cloud backup state.
- Confirm that a failed operation produces a visible error rather than false success.
- Inspect the built output for stale source references, CDN runtime dependencies, missing hashed assets, and mismatched cache versions.
- Do not treat a successful compiler exit code as sufficient when the defect concerns rendering, routing, caching, or deployment.
- Acceptance evidence should be concrete: successful build output, valid HTTP responses, an exercised interaction, clean repository status, and confirmed push.

## Unacceptable Approaches

- Declaring completion after source edits without building or checking the publishable result.
- Leaving changes only on the local machine when the standing workflow requires a push.
- Replacing a true data-isolation requirement with labels, filters, or cosmetic profile switching.
- Sharing storage, sync state, redirect state, or cloud document identifiers between supposedly isolated profiles.
- Breaking legacy data access to simplify a new storage model.
- Silently catching errors or presenting success when persistence or synchronization failed.
- Serving source-only development entry points to a static production host.
- Updating cached assets without changing the cache/version identifier.
- Manually escaping only selected export columns.
- Reverting, overwriting, or committing unrelated user changes.
- Adding broad abstractions or redesigns that are not required for the requested outcome.

## Examples of Excellent Results

### Separate household bookkeeping

A user asks to keep records for another family member while using the same sign-in. The result creates a genuinely blank, separately persisted ledger; keeps the existing ledger intact; separates local data, synchronization state, and cloud backup payloads; clearly displays the active ledger; supports safe switching and management; and verifies that entries never cross between ledgers.

### Production frontend modernization

A large runtime-compiled page is moved to a normal production build with bundled dependencies and modular source files. The published root page references generated assets that exist, offline behavior still works, the cache identifier is bumped, update activation is visible to users, and a static-server check confirms every required resource loads successfully.

### Reliable data export

CSV generation uses one shared escaping function for every field. Tests cover commas, quotes, line breaks, empty values, and ordinary text, ensuring both current and future columns remain valid without special-case handling.

### Honest failure handling

Save, cache, exchange-rate, and synchronization failures pass through a consistent error-reporting path. The user sees that the action failed, the app does not display false success, and diagnostic details remain available without exposing sensitive information.

### Complete delivery

The change preserves existing data, passes targeted checks and the production build, works through the actual published entry point, uses matching release and cache versions, has a focused commit, is pushed to the configured remote, and leaves the worktree clean.
