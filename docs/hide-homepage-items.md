# Hide the Manage and Support Inbox cards on the homepage

**Branch:** `remove/hide-homepage-items`
**Date:** 2026-08-15
**Status:** Done — implemented and verified

## Goal

The homepage shows three admin shortcut cards under the "Admin" heading:

- Dashboard — "Usage analytics and teaching insights"
- Manage — "Schools, users, and roles"
- Support Inbox — "Bug reports and feedback from teachers"

Hide **Manage** and **Support Inbox**, leaving only Dashboard. This is a
UI-crowding fix on the homepage only.

## Explicitly NOT in scope

The features stay fully working and reachable. Nothing below is touched:

| Untouched | Why it matters |
|---|---|
| `App.tsx` routes `/admin/manage`, `/admin/support`, `/admin/support/:id` | The pages still load |
| `components/AdminTabs.tsx` | Overview \| Manage \| Support \| Settings tabs remain the access point on every admin page |
| `pages/ManagePage.tsx`, `pages/AdminSupportPage.tsx`, `pages/AdminSupportTicketPage.tsx` | Page code untouched |
| `super_admin` route guards in `App.tsx` | Permissions unchanged |

## Approach: comment out, not delete

Requested explicitly so the cards can be re-enabled later without rewriting
them.

### The constraint that shapes this

`client/tsconfig.json` sets **`noUnusedLocals: true`** and
**`noUnusedParameters: true`** (L16–17). These are *build errors*, not
warnings — `npm run build` runs `tsc -b` and fails on anything left unused.
So commenting out a card is not enough on its own; whatever it leaves
dangling (an import, a prop) must be handled in the same edit or the build
breaks.

ESLint is the lenient one here (`no-unused-vars` is `'warn'`), so the
compiler is the binding constraint.

### Edits

| # | File | Change |
|---|---|---|
| 1 | `config.ts` L117 | Comment out the **Manage** entry in `ADMIN_SHORTCUTS`, with a restore note. `ShieldCheck` stays imported — still used by `ONBOARDING_FEATURES` L102, so no unused-import error. |
| 2 | `config.ts` L120–127 | **`SUPER_ADMIN_SHORTCUT` left completely intact.** It is an `export`, and exports are never "unused" to the compiler — so it can stay fully defined and ready, with nothing commented out at all. |
| 3 | `WelcomeScreen.tsx` L3 | Drop `SUPER_ADMIN_SHORTCUT` from the import (original line kept commented above). Required — an unused import is a build error. |
| 4 | `WelcomeScreen.tsx` L21 | `const shortcuts = ADMIN_SHORTCUTS;` with the original conditional kept commented above. |
| 5 | `WelcomeScreen.tsx` L20 | Remove `isSuperAdmin` from the destructured parameters. **Keep it in the `WelcomeScreenProps` interface** — an unused interface field is legal, an unused binding is not. This means `CoachPage.tsx` keeps passing `isSuperAdmin` and needs no edit at all. |

Point 5 is the deliberate one: leaving the prop in the interface keeps
`CoachPage.tsx` (the largest, most-reviewed file in the product) entirely out
of this change, and makes restoring a single-file edit.

### To restore later

Uncomment three marked lines — `config.ts` L117, `WelcomeScreen.tsx` L3 and
L21 — and add `isSuperAdmin` back to the destructuring on L20. Each site
carries a comment saying so.

## Known trade-off

Commented-out code is invisible to the compiler and to tests, so it drifts
out of date silently as the surrounding code changes. This is acceptable for
a deliberate "maybe later" hide, but it is **not** an on/off switch. If these
cards need to be toggled repeatedly, or toggled by an admin without a deploy,
the right mechanism is a feature flag — the app already has that pattern
(`CLASSROOM_MODE_ENABLED`, `HELP_SUPPORT_ENABLED`,
`LEARNING_REPRESENTATION_ENABLED`, plus admin-toggleable flags via
`lib/featureFlags.ts`). Raised with the user; commenting out was chosen
knowingly for speed.

## Test plan

1. `npm run build` — `tsc -b` proves nothing was left dangling. This is the
   check that matters, given the strict-unused settings above.
2. `npm test` — full vitest suite. Baseline: **24 files, 421 tests.**
3. `npm run lint` — expect 0 errors (1 known pre-existing warning in
   `hooks/useClassroomQueue.ts` L223, unrelated).
4. Grep to confirm routes, tabs and pages are untouched.

## Results

Implemented exactly as planned — all five edits landed, no surprises, no
extra files needed.

### Files changed

```
M  client/src/config.ts
M  client/src/components/WelcomeScreen.tsx
A  docs/hide-homepage-items.md
```

Two source files. `CoachPage.tsx` stayed out of the change as intended
(point 5 above), and no route, page or guard was touched.

### Verification

| Check | Result |
|---|---|
| `npm run build` (`tsc -b && vite build`) | **Pass** — built in 2.18s. The meaningful check: with `noUnusedLocals`/`noUnusedParameters` on, a dangling import or binding would have failed the build. |
| `npm test` (vitest) | **Pass** — 24 files, 421 tests, identical to baseline |
| `npm run lint` (eslint) | **0 errors.** 1 pre-existing warning, `hooks/useClassroomQueue.ts` L223 — untouched file, unrelated |
| Routes intact | `App.tsx` L76/80/84 — `/admin/manage`, `/admin/support`, `/admin/support/:id` all present |
| Tabs intact | `AdminTabs.tsx` L18/19/21/26 — Overview, Manage, Support, Settings all present |

### Net effect

The homepage "Admin" section now renders a single card, Dashboard. Manage and
Support Inbox are reachable exactly as before via the admin tabs on any admin
page, with unchanged `super_admin` gating on Support.

### Not verified

Not opened in a browser. The change is a list-contents change with no CSS
involved, and the grid renders whatever `shortcuts` contains, so a one-card
row needs no layout adjustment — but this was reasoned, not seen. Worth an
eyeball on the next dev run.

### Restore checklist

1. `config.ts` — uncomment the `Manage` entry in `ADMIN_SHORTCUTS`.
2. `WelcomeScreen.tsx` — swap the import line back to the commented version
   that includes `SUPER_ADMIN_SHORTCUT`.
3. `WelcomeScreen.tsx` — add `isSuperAdmin` back to the destructured params.
4. `WelcomeScreen.tsx` — swap `const shortcuts = ADMIN_SHORTCUTS;` back to the
   commented conditional above it.

`SUPER_ADMIN_SHORTCUT` in `config.ts` needs no change — it was left whole.
