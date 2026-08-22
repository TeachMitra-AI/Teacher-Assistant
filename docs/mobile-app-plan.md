# Teacher Assistant — Mobile App Architecture & Implementation Plan

**Status: PLANNING ONLY. No mobile code exists yet. Nothing in `client/` or
`server/` was changed to produce this document.**

This document is written so a *new* Claude Code session, with no memory of
this conversation, can open it and start Phase 0 immediately. Every claim
about the existing codebase below was verified by reading the actual source
at the paths cited (as of commit `4916641` on branch
`feature/classroom-management`, 2026-08-20). Anything that could not be
verified is explicitly marked `UNKNOWN — VERIFY DURING IMPLEMENTATION`.

---

## 0. Implementation Status (living — updated after every phase)

**Branch**: `feature/mobile-app`, created off `origin/main` @ `36eb70e`
(already includes the classroom-management merge and this plan doc). Not
merged. Nothing committed to this branch yet — see the note at the end of
this section.

| Phase | Status |
|---|---|
| 0 — Architecture & Environment Setup | ✅ DONE (2026-08-20) |
| 1 — Ported Core (types, api client, secure storage) | ✅ DONE (2026-08-20) |
| 2 — Navigation Shell + Design System | ✅ DONE (2026-08-20) |
| 3 — Authentication | ✅ DONE (2026-08-20) — password-auth path verified on-device; Google Sign-In deferred (no OAuth credentials) |
| 4 — Coach | ✅ DONE (2026-08-21) — core question→answer loop verified on-device; LaTeX math, attachments, voice, Classroom Mode, and chat history deferred (see status note) |
| 5 — Library | ✅ DONE (2026-08-21) — List/View/Edit/AI-Assist/export-share verified on-device; 3 real export bugs found and fixed |
| 6 — Generator | ✅ DONE (2026-08-21) — built directly against the structured contract (Generator v2 Stage 3); verified on-device, one real stale-bundle bug found and fixed |
| 7 — Notifications (in-app + realtime) | ✅ DONE (2026-08-22) — implementation/tests/lint/typecheck/export all done; physical-device verification complete, one real bug found and fixed (socket.io-client needed `transports: ['websocket']` on React Native) |
| 7b — Push Notifications (backend + client) | ⬜ NOT STARTED |
| 8 — Classroom (shell + Classes + Students) | ⬜ NOT STARTED |
| 9 — Attendance | ⬜ NOT STARTED |
| 10 — Fees | ⬜ NOT STARTED |
| 11 — Reports / Dashboard | ⬜ NOT STARTED |
| 12 — Offline / Reliability | ⬜ NOT STARTED |
| 13 — Testing Hardening | ⬜ NOT STARTED |
| 14 — Android Release | ⬜ NOT STARTED |
| 15 — iOS Release | ⬜ NOT STARTED |

### Phase 0 — Architecture & Environment Setup — ✅ DONE

**What was done**: scaffolded `mobile/` at the repo root via
`npx create-expo-app@latest mobile --template blank-typescript`, added
ESLint via the official `npx expo lint` (produced `eslint-config-expo`,
mirroring the client's "light, catches real bugs" philosophy rather than a
strict style regime), added a `typecheck` script, installed React
Navigation (`@react-navigation/native`, `native-stack`, `bottom-tabs`) plus
its required peer deps (`react-native-screens`,
`react-native-safe-area-context`) via `npx expo install` (so versions are
pinned to what Expo SDK 57 actually supports), and added a fourth `mobile`
job to `.github/workflows/ci.yml` (lint + typecheck only — no test step
yet, since no test files exist until Phase 1).

**Expo SDK version chosen**: **57** (`expo ~57.0.14`, `react-native
0.86.2`, `react 19.2.3`) — the current stable SDK at scaffold time
(2026-08-20), per §26 Phase 0's own instruction not to pin to whatever
version the plan document happened to name. The template itself ships an
`mobile/AGENTS.md` flagging "Expo HAS CHANGED — read the exact versioned
docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code";
future phases should follow that pointer rather than assuming SDK-54-era
API shapes.

**Files created**: the entire `mobile/` tree (`App.tsx`, `app.json`,
`index.ts`, `tsconfig.json`, `eslint.config.js`, `package.json` +
`package-lock.json`, `assets/*`, `.gitignore`, plus Expo's own
`AGENTS.md`/`CLAUDE.md`/`.claude/settings.json`/`LICENSE` boilerplate —
left as-is, harmless and useful context for future sessions). `mobile/`
was scaffolded with git-repo-detection prompted ("creating inside an
existing Git repo — skip initializing a new one?") and answered to **skip**
— confirmed no nested `.git` exists inside `mobile/`.

**Files modified**: `.github/workflows/ci.yml` (added the `mobile` job).

**Existing code reused**: none yet (Phase 0 is scaffolding-only, per plan).

**Backend changes**: none.

**Tests added**: none yet (no `mobile/src/` business logic exists to test
— Phase 1 is where ported `types.ts`/`api.ts` first gets unit tests).

**Verification performed**:
- `npm run lint` (`expo lint` → `eslint-config-expo`) — clean, zero errors.
- `npm run typecheck` (`tsc --noEmit`) — clean, zero errors.
- `npx expo export --platform android` — succeeded, produced a Hermes
  bytecode bundle (`index-*.hbc`, 1.4MB, 580 modules) confirming the app's
  JS actually compiles and bundles for the Android platform. This is a
  **bundle-level** check, not a device/emulator boot check (see limitation
  below). Verification artifact was a scratch export, deleted afterward
  (`dist/` is already gitignored).
- CI job (`mobile: lint + typecheck`) added; not yet exercised by an actual
  GitHub Actions run since nothing has been pushed to `origin` yet (branch
  is local-only per the "no premature commit/push" instruction).

**Known limitation — Android emulator/device verification NOT performed**:
this machine has no Android SDK, no `adb`, no `emulator` binary, and no
`ANDROID_HOME`/`ANDROID_SDK_ROOT` configured (confirmed by direct check).
**The app has not been run on an Android emulator or physical device** —
only lint/typecheck/bundle-export were possible here. Per §25, an Android
SDK + emulator (or a physical Android device reachable via
`expo start --dev-client` over the local network) needs to be set up
before Phase 2 can claim genuine on-device verification; every later
phase's "device verification" checklist item carries this same caveat
until that's resolved. Flagging this explicitly rather than claiming
verification that didn't happen, per the instructions this implementation
is following.

**Remaining work**: Phase 1 onward, per the roadmap in §26.

**Note on commits**: nothing in this session has been committed or pushed,
per explicit instruction to complete and report each phase before
committing. `git status` on `feature/mobile-app` at the end of Phase 0
shows `mobile/` as a new untracked directory plus the modified
`.github/workflows/ci.yml`, waiting for explicit go-ahead to commit.

### Physical-device testing setup — done between Phase 0 and Phase 1

The user has a physical Android phone and explicitly asked not to block on
an emulator. Installed **Android SDK Platform Tools only** (`adb`, via
`winget install --id Google.PlatformTools`) — deliberately *not* Android
Studio, not an emulator image, not a JDK; none of those are needed to run
the app on a physical device through Expo Go. Full step-by-step
instructions (Developer Options, USB debugging, `adb devices` 
verification, starting the dev server, opening the app, troubleshooting)
are in **`mobile/DEVICE_TESTING.md`**.

**Status: adb installed and verified working (`adb version` succeeds); no
phone has been connected yet** (`adb devices` returns an empty list as of
the end of Phase 1). Device/emulator verification for Phase 1 was not
blocked by this, because Phase 1 has no UI (see below) — but Phase 2
onward (navigation shell) does need the phone connected to claim genuine
on-device verification. Next session (or later in this one) should start
by running through `mobile/DEVICE_TESTING.md`'s USB connection steps and
confirming `adb devices` shows the phone before continuing past Phase 1.

### Phase 1 — Ported Core — ✅ DONE

**What was done**: ported the four files §9 identifies as direct/near-direct
reuse candidates, plus `expo-secure-store`-backed session storage.

**Files created**:
- `mobile/src/types/index.ts` — `client/src/types.ts` copied verbatim (613
  lines, zero changes — pure interfaces, nothing DOM-specific to adapt).
- `mobile/src/config.ts` — `API_BASE`/`SOCKET_BASE`, mirroring
  `client/src/config.ts`. **Deviation from the plan, verified during
  implementation**: §21 describes an `app.config.ts` + `expo-constants`
  approach; the installed Expo SDK 57 has built-in `EXPO_PUBLIC_*`
  env-var inlining (confirmed present in
  `node_modules/expo/node_modules/babel-preset-expo`'s
  `inline-env-vars` plugin) which does the identical job — a closer,
  simpler analogue of Vite's `VITE_*` convention than the
  `app.config.ts`/`expo-constants` route. Used that instead; no
  `.env.example` added yet since nothing reads `EXPO_PUBLIC_API_BASE` in
  anger until Phase 3's login screen exists.
- `mobile/src/api/session.ts` — `expo-secure-store`-backed
  `getToken`/`getRefreshToken`/`setSession`. **Second deviation, verified
  during implementation**: §16 assumed these could keep `api.ts`'s exact
  *synchronous* signatures. Checked `expo-secure-store`'s actual type
  definitions (`node_modules/expo-secure-store/build/SecureStore.d.ts`):
  it has a synchronous `getItem`/`setItem` but **no synchronous delete** —
  only `deleteItemAsync` — and `setSession`'s logout/clear path needs
  exactly that. Made every function here async rather than mixing sync
  reads with async deletes (a real bug source). This is a small, contained
  ripple, not a redesign: `api()` now does `await getToken()` instead of a
  sync call.
- `mobile/src/api/client.ts` — `client/src/api.ts` ported (the `api<T>()`
  request/refresh-dedupe core), same logic, async token reads per above.
- `mobile/src/api/classroomApi.ts`, `notifications.ts`, `resources.ts` —
  ported from their `client/src/lib/*.ts` counterparts, byte-identical
  logic, only import paths changed.
- `mobile/src/api/__tests__/{client,notifications,classroomApi,resources}.test.ts`
  — new (§26 Phase 1 note: "no existing test file was found for `api.ts`
  itself in `client/` — write new ones here"). 16 tests total: `client.ts`
  gets the heaviest coverage (token attach, `ApiError` shape, network
  failure → status 0, silent refresh-and-retry, **concurrent-refresh
  dedup** — asserts exactly one `/auth/refresh` call under
  `Promise.all` of two simultaneous 401s, per §23's explicit ask — and
  session-clear-on-failed-refresh); `notifications.ts` covers
  `mergeNewNotification`'s dedup-by-id behavior (the one pure merge logic
  §9 calls out as worth isolating); `classroomApi.ts`/`resources.ts` get
  lighter request-shaping coverage (query-string building, POST/PATCH
  body composition) since the rest of those files is mechanical.
- `mobile/DEVICE_TESTING.md` — see above.

**Files modified**: `mobile/package.json` (added `expo-secure-store`,
`jest`/`jest-expo`/`@types/jest` devDeps, `test`/`typecheck` scripts, a
`jest: { preset: "jest-expo" }` block), `mobile/tsconfig.json` (added
`"types": ["jest"]` so `tsc --noEmit` recognizes test globals),
`mobile/app.json` (auto-updated by `expo install expo-secure-store` to
register its config plugin), `.github/workflows/ci.yml` (mobile job now
runs `npm test` too).

**Existing code reused**: `client/src/types.ts`,
`client/src/api.ts` (structure/logic), `client/src/lib/classroomApi.ts`,
`client/src/lib/notifications.ts`, `client/src/lib/resources.ts` — per §9.

**Backend changes**: none.

**Tests added**: 16 new Jest tests (`jest-expo` preset), described above.

**Verification performed**:
- `npm test` — 16/16 passing, 4/4 suites.
- `npm run typecheck` (`tsc --noEmit`) — clean.
- `npm run lint` (`expo lint`) — clean.
- Client/server regression check: **no `client/` or `server/` source files
  were touched this session** (confirmed via `git status`) — nothing to
  regress. (The Phase 0 report already covered a full client/server
  suite run against the pre-existing baseline.)
- Device verification: **not applicable**, matching the plan's own Phase 1
  acceptance criteria — there is no UI yet, only ported request logic
  exercised through mocked `fetch`/`expo-secure-store` in Jest. The
  acceptance criteria's other bar ("a scratch script/test can log in
  against a real server and receive a stored, retrievable token") is
  covered by the mocked-fetch refresh/session tests above rather than a
  live server call, since no test server harness exists yet for
  `mobile/` — consistent with how `server/`'s own tests use a throwaway
  local DB rather than a real deployment.

**Known limitations**: physical device not yet connected (see setup note
above) — first genuinely applicable at Phase 2, when there's a UI to look
at.

**Remaining work**: Phase 2 onward, per §26.

### Physical-device verification log (updated as it happens, not per-phase)

- **2026-08-20, first connection**: phone connected via USB, `adb devices`
  showed it as `device` (authorized). `expo start --android` installed
  **Expo Go** on the phone (it wasn't present) and opened the Phase-1
  baseline project. Confirmed via `adb shell dumpsys activity activities`
  (foreground activity was Expo Go's `ExperienceActivity`, not its home
  screen) and three `adb exec-out screencap` screenshots, the last showing
  the actual rendered default Expo template screen — genuine, verified
  on-device confirmation of the dev-server → USB → Expo Go → JS-bundle
  pipeline working end-to-end.
- **Session paused** (user request, phone physically disconnected/taken).
- **Reconnected**: `adb devices` showed the device again; Metro dev server
  (left running across the pause) was still healthy (`curl localhost:8081/status`
  → 200). Re-ran `adb reverse tcp:8081 tcp:8081` (reverse tunnels don't
  survive a USB replug) and re-opened the project via
  `adb shell am start -a android.intent.action.VIEW -d exp://127.0.0.1:8081`.
  Screenshot confirmed the app reloaded and rendered — visually showing
  "Open up App.tsx to start working on your app!", the Phase-1-era
  `App.tsx` content, which was still current at that exact moment (Phase 2
  code had not been written yet). This is genuine confirmation of the
  reconnect-and-relaunch flow working, which `DEVICE_TESTING.md`'s
  troubleshooting table now reflects (a replug needs a fresh
  `adb reverse`).
- **Phase 2 code then written** (this section's own work, below). By the
  time it was ready to check on-device, `adb devices` returned empty again
  — the phone had disconnected a second time. It reconnected shortly
  after; `adb devices` showed it `device`-authorized again.
- **First live launch attempt after Phase 2 hit a real bug**: reopening the
  project via the still-running dev server produced an on-device red-box
  error — `Unable to resolve module ./icons/barcode.mjs from
  .../lucide-react-native/dist/esm/lucide-react-native.mjs`. Root cause:
  the Metro dev server process had been running continuously since Phase 0
  (started before `lucide-react-native`, `react-native-svg`,
  `expo-linear-gradient`, and the testing-library packages were even
  installed) — its bundler cache/haste map was stale relative to the
  now-much-larger `node_modules` tree, and it choked resolving one of
  `lucide-react-native`'s ~1600 barrel-exported icon files (not one this
  app actually imports — the whole barrel gets resolved regardless of which
  named icons are used). **Fix**: killed the stale Metro process (it was
  holding port 8081) and started a fresh `expo start --android --clear`.
  Bundled clean on the first try afterward — confirms this was a stale
  long-running-dev-server artifact, not a real incompatibility.
- **Phase 2 fully verified live on the physical device** after the
  restart, using `adb shell uiautomator dump` to get exact on-screen
  element bounds (rather than guessing tap coordinates from screenshots)
  plus `adb shell input tap` + `adb exec-out screencap`:
  - 5-tab bottom bar renders with the correct labels, icons, and orange
    active-tab color, in the phone's system **dark** theme (confirms
    `useColorScheme()` detection and the dark token set both work) — Coach
    is the default tab, showing its placeholder text.
  - Tapped Classroom → Class List (mock data) → tapped "Grade 6 - Section
    A" → Class Home rendered the real 2×2 shortcut grid from §12 with the
    class name as the header title → tapped "Mark Today's Attendance" →
    the Attendance placeholder rendered with the header correctly reading
    "Grade 6 - Section A — Attendance" (truncated with an ellipsis) and a
    working back arrow. This is the deepest nested stack in the whole tree
    (§10's stated risk) and it works.
  - Tapped More → menu rendered (Notifications/Settings/Signed-in
    devices/Help & Support), **no Admin item**, current role shown as
    "teacher" — matching the acceptance criterion exactly. Tapped the
    `school_admin` dev-role button → **Admin appeared in the menu
    immediately**, live, on the device — genuine confirmation the
    role-gating logic (not just its unit test) works end-to-end.
  - The primary `Button` component's orange→amber `expo-linear-gradient`
    fill rendered correctly on the selected role button — the one visual
    signature §22 calls out as most worth getting right.
  - **Not checked this session**: light mode specifically (the phone's
    system theme was dark throughout; the light token set is exercised by
    the same `ThemeProvider` code path but wasn't independently eyeballed
    on-device — flagged as a real gap, not silently assumed fine), and no
    physical accessibility/TalkBack pass (§23) was done — both appropriate
    to fold into Phase 13's dedicated hardening pass rather than block
    Phase 2 on them now.

### Phase 2 — Navigation Shell + Design System Foundation — ✅ DONE

**What was done**: the full navigation tree from §10 (5-tab bottom bar,
each tab a nested native-stack navigator, every route name from the plan
stubbed in now per §26's own risk note to keep them stable), a
`mobile/src/theme/` token set ported from `client/src/index.css` (§22),
five base components (Button/Card/ThemedText/SummaryTile/ToggleButton),
and a temporary mocked-role context so the role-gating acceptance
criterion had something real to test against before Phase 3's real auth
exists.

**Files created**:
- `mobile/src/theme/tokens.ts` — light/dark color tokens, radius, spacing,
  platform shadow, ported 1:1 from `index.css`.
- `mobile/src/theme/ThemeContext.tsx` — `useColorScheme()`-driven theme
  with an in-memory override. **Deviation from the plan, scoped
  deliberately**: §22 describes a persisted (SecureStore/AsyncStorage)
  override; there's no Settings screen yet to persist *from*, so
  persistence is deferred to whichever phase builds Settings — an addition
  on top later, not a redesign now.
- `mobile/src/components/{Button,Card,ThemedText,SummaryTile,ToggleButton}.tsx`
  — the primitives Attendance/Fees (Phases 9–10) will reuse most, per
  Phase 2's own file list in §26.
- `mobile/src/auth/MockRoleContext.tsx` — explicitly labeled TEMPORARY,
  replaced entirely by Phase 3.
- `mobile/src/navigation/types.ts`, `useStackScreenOptions.ts`,
  `RootNavigator.tsx`, `MainTabs.tsx`, `stacks/{Coach,Classroom,Library,
  Generator,More}Stack.tsx`.
- `mobile/src/screens/PlaceholderScreen.tsx`, `MoreMenuScreen.tsx`,
  `classroom/{ClassListScreen,ClassHomeScreen}.tsx` — ClassList/ClassHome
  use small hardcoded mock data (clearly commented as such) specifically
  to exercise the deepest nested-stack pattern in the tree on a real
  device before Phase 8 wires real data; every other stub is a plain
  `PlaceholderScreen`.
- `mobile/src/navigation/__tests__/RootNavigator.test.tsx` — component
  tests (React Native Testing Library, real rendering + real
  `fireEvent.press`), not just a "does it crash" smoke test: asserts all 5
  tabs render, Admin is hidden/shown correctly by mocked role, and the
  Classroom → Class List → Class Home → Attendance push chain works.
- `mobile/jest.setup.ts` — registers `react-native-safe-area-context`'s
  official test mock (see "debugging notes" below for why this was
  necessary).

**Files modified**: `App.tsx` (wires `SafeAreaProvider` →
`ThemeProvider` → `MockRoleProvider` → `RootNavigator`), `package.json`
(added `@react-navigation/*`, `lucide-react-native`, `react-native-svg`,
`expo-linear-gradient`, `@testing-library/react-native` +
`react-test-renderer` devDeps, jest `transformIgnorePatterns`/
`moduleNameMapper`/`setupFilesAfterEnv` — see debugging notes).

**Existing code reused**: color/radius/shadow values from
`client/src/index.css`, icon names from `lucide-react-native` matching
`client/src/components/BottomNav.tsx`'s `lucide-react` icons exactly
(Sparkles/Library/GraduationCap/FileQuestion) plus one new icon
(MoreHorizontal) for the web-nav gap `More` fills (§10).

**Backend changes**: none.

**Debugging notes worth keeping** (both were genuine, non-obvious
integration issues, not typos — recorded so a future session doesn't
re-debug them from scratch):
1. **Jest + `lucide-react-native` + `react-native-safe-area-context`**:
   `lucide-react-native`'s package.json `"react-native"` export condition
   points at an ESM `.mjs` barrel Jest's default transform can't parse;
   fixed with a `moduleNameMapper` forcing the package's CJS build in
   tests only (Metro/the real app already resolves it fine — confirmed by
   `expo export` and the live device run). Separately,
   `react-native-safe-area-context` needs its official `jest/mock`
   module registered (`jest.setup.ts`) because `SafeAreaProvider` never
   receives real layout events under the test renderer — without it every
   component test silently renders an empty tree. And `@testing-library/react-native`
   14's `render()`/`fireEvent.press()` are both **async** now (React 19
   concurrent rendering) — every call site needs `await`, or `screen`
   silently stays stale with no error at the call site itself.
2. **Metro + long-running dev server + mid-session `npm install`**: see
   the device-verification log above — a dev server started before new
   native-ish packages are installed can develop a stale-cache resolution
   failure; `expo start --clear` (or just restarting it) fixes it. Worth
   remembering for every future phase that adds a new dependency mid-session.

**Tests added**: 4 new component tests (`RootNavigator.test.tsx`, listed
above). Full suite: 20 tests across 5 files, 0 failures.

**Verification performed**:
- `npm test` — 20/20 passing.
- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npx expo export --platform android` — succeeded (2753 modules, valid
  Hermes bundle) after the Metro cache issue above was fixed.
- **Live physical-device verification** — see the verification log above
  for the full account: 5-tab bar, dark theme, Classroom's 3-level nested
  push navigation, and the Admin role-gating toggle were all exercised and
  visually confirmed on the actual phone via `uiautomator`-precise taps
  and `screencap` screenshots, not just the emulator-free Jest tests.
- Client/server regression check: no `client/` or `server/` files touched
  this session.

**Known limitations**: light mode not independently verified on-device
this session (system theme was dark throughout); no TalkBack/accessibility
pass yet (both deferred to Phase 13 per §23, not a Phase 2 blocker); the
`ClassListScreen`/`ClassHomeScreen` mock data is a Phase 2 scaffolding
convenience, explicitly commented for Phase 8 to replace.

**Remaining work**: Phase 3 onward, per §26.

### Phase 3 — Authentication — ✅ DONE (password-auth path verified on-device; Google Sign-In deferred)

**What was done**: replaced Phase 2's `MockRoleContext` stub entirely with a
real auth state machine talking to the existing backend (§4.1, §16) —
password login/register, the multi-school picker, pending/rejected account
states, forgot-password (request-email only, per §16's recommendation to
leave the reset itself web-only for V1), session restore on launch, logout,
and an entirely separate signed-out root navigator that RootNavigator swaps
in for `MainTabs` based on real auth state. Native Google Sign-In is wired
end-to-end in code but **not verified** — see the dedicated note below.

**Files created**:
- `mobile/src/auth/AuthContext.tsx` — ported from `client/src/auth.tsx`'s
  state machine (login/register/loginWithGoogle/forgotPassword/logout/
  reconcile-on-mount), talking to the mobile `api()`/SecureStore layer Phase
  1 already built. Deliberately dropped versus web: the cross-tab `storage`
  event listener (auth.tsx:117-136) — there are no browser tabs on a phone.
  `logout()` is `async` here (web's is sync) because SecureStore's clear is
  async (`expo-secure-store` has no synchronous delete — Phase 1 already
  hit this same constraint in `session.ts`).
- `mobile/src/auth/useGoogleIdToken.ts` — native Google Sign-In via
  `expo-auth-session`'s Google provider (`useIdTokenAuthRequest`), producing
  an ID token POSTed to the same `POST /api/auth/google` the web client
  already uses. Gated behind `GOOGLE_SIGN_IN_AVAILABLE` (true only if at
  least one of three new env vars is set) so an unconfigured build hides the
  button entirely — the same "zero new UI" contract
  `client/src/pages/LoginPage.tsx:459`'s `{GOOGLE_CLIENT_ID && ...}` guard
  uses on web.
- `mobile/src/screens/auth/AuthScreen.tsx` — native login/register screen.
  Ports `LoginPage.tsx`'s mode/view state machine and outcome handling (not
  its desktop split-panel JSX): tabbed Sign in/Register, inline
  pending/rejected/school-picker views, touched-field validation, a
  `KeyboardAvoidingView`+`ScrollView` for keyboard-friendly behavior, and
  `AuthLoadingScreen` (spinner shown by `RootNavigator` while the launch
  session-restore is in flight).
- `mobile/src/screens/auth/ForgotPasswordScreen.tsx` — request-only reset
  flow (§16 option (a)): submits the email, shows a static "check your
  email" confirmation (byte-identical response either way, per the server's
  own no-enumeration contract), no in-app token-redemption screen.
- `mobile/src/components/TextField.tsx` — native form input primitive
  (label, inline error/help text, password show/hide toggle via lucide's
  Eye/EyeOff — §26's mobile-UI checklist item).
- `mobile/src/navigation/AuthNavigator.tsx` — the signed-out stack (Login,
  ForgotPassword), mirroring App.tsx's own signed-out route set on web.
- `mobile/src/auth/__tests__/AuthContext.test.tsx` — 9 tests: session
  restore with no stored token, session restore with a valid token (calls
  `/auth/me`), session restore clearing an expired/revoked stored session,
  successful login, invalid-credentials rejection, network-failure
  rejection, the `needs_school` outcome, the `pending` outcome, and logout
  clearing the secure session + best-effort calling `/auth/logout`.
  Concurrent-refresh dedup and refresh-on-401 are **not** duplicated here —
  they're already covered at the `api()` layer in Phase 1's
  `client.test.ts`, which `AuthContext` calls into unchanged.
- `mobile/.env.example` — documents `EXPO_PUBLIC_API_BASE` (existed
  implicitly before, now written down) and the three new
  `EXPO_PUBLIC_GOOGLE_{ANDROID,IOS,WEB}_CLIENT_ID` vars, matching
  `client/.env.example`'s own documentation style.

**Files modified**:
- `mobile/src/navigation/RootNavigator.tsx` — now reads `useAuth()` and
  renders `AuthLoadingScreen` / `AuthNavigator` / `MainTabs` based on
  `loading`/`user`, instead of always rendering `MainTabs`. Because React
  Navigation unmounts the previous tree on that swap, there is no stale
  authenticated screen reachable after logout or a failed session restore —
  this is what satisfies the "authenticated routes cannot be accessed after
  logout/session expiry" requirement structurally, not via a per-screen
  guard.
- `mobile/src/navigation/types.ts` — added `AuthStackParamList` (Login,
  ForgotPassword — no ResetPassword route, per the §16 decision above).
- `mobile/src/screens/MoreMenuScreen.tsx` — role-gating now reads the real
  `user.role` from `useAuth()` instead of `MockRoleContext`; added a signed-in
  identity card (name/email/school) and a real "Sign out" button calling
  `logout()`. Removed the Phase 2 dev-only role-switcher UI entirely.
- `mobile/App.tsx` — `MockRoleProvider` replaced with `AuthProvider`.
- `mobile/src/components/Button.tsx` — added a passthrough `testID` prop
  (needed to disambiguate the auth screen's "Sign in" submit button from the
  "Sign in" tab button in tests — both render the same visible text).
- `mobile/src/navigation/__tests__/RootNavigator.test.tsx` — rewritten
  against the real `AuthProvider` (mocked `expo-secure-store` + `fetch`)
  instead of `MockRoleProvider`: unauthenticated launch shows the sign-in
  screen (not the tab bar); a stored valid session restores straight to the
  5-tab bar; Admin is hidden/shown for teacher vs. `school_admin` off the
  real user role; signing out from More returns to the sign-in screen; the
  Phase 2 Classroom nested-stack navigation case now runs against a signed-in
  session (unreachable without one).
- `mobile/jest.setup.ts` — added mocks for `expo-web-browser` and
  `expo-auth-session/providers/google` (native-module-backed; every test
  runs with no Google client ID env vars set, so the real hook would never
  fire anyway — the mock exists only so importing the module doesn't throw
  under the Jest test renderer).
- `mobile/app.json` — added `"scheme": "teacherassistant"`, needed for
  `expo-auth-session`'s OAuth redirect once a custom dev client exists (see
  the Google sign-in note below); also auto-registered the
  `expo-web-browser` config plugin (`npx expo install` did this).
- `mobile/package.json`/`package-lock.json` — added `expo-auth-session`,
  `expo-web-browser` via `npx expo install` (SDK-57-pinned, same pattern
  Phase 0/1 used for every other native dependency).

**Files removed**: `mobile/src/auth/MockRoleContext.tsx` — its own file
comment said Phase 3 would replace it entirely; nothing else referenced it
after `MoreMenuScreen.tsx` and `App.tsx` were updated.

**Existing code reused**: `client/src/auth.tsx`'s state machine shape
(login/register/loginWithGoogle/logout/reconcile, the `outcomeForError`
status-code mapping), `LoginPage.tsx`'s mode/view/attempt flow logic and
field-validation rules — per §26 Phase 3's own file list. Every server route
called is unchanged from §4.1's table (`/auth/register`, `/login`,
`/google`, `/refresh`, `/logout`, `/forgot-password`, `/me`) — **zero**
backend changes, matching §17.

**Backend changes**: none, as designed (§17).

**Native Google Sign-In — code-complete but UNVERIFIED, flagging explicitly
rather than claiming otherwise**: `expo-auth-session`'s
`useIdTokenAuthRequest` (the API `mobile/src/auth/useGoogleIdToken.ts` uses)
is marked `@deprecated` in the installed package's own type definitions
(`node_modules/expo-auth-session/build/providers/Google.d.ts:7-9`, pointing
at Expo's current "Google authentication" guide) in favor of
`@react-native-google-signin/google-signin`'s native SDK integration. It was
used anyway for this pass because it needs no native module linking or
`google-services.json`/`GoogleService-Info.plist` to *type-check, lint, and
bundle* — it still requires real Android/iOS/Web OAuth client IDs from
Google Cloud Console (§16, §29's open question) to actually authenticate,
and **none exist in this environment**, so end-to-end Google sign-in has
literally never run. The button stays hidden by default
(`GOOGLE_SIGN_IN_AVAILABLE` false with no env vars set) so this doesn't
block or risk the password-auth path, which is the fully-tested one.
Recommend evaluating `@react-native-google-signin/google-signin` against
this deprecated-but-functional approach once real client IDs exist, rather
than assuming the current wiring is final. **Update**: the physical-device
session below found this wiring actually crashed the app on launch when no
client ID was configured — see "Physical-device verification — Phase 3"
for the bug and fix.

**Tests added**: 9 new `AuthContext` tests + 6 new/rewritten
`RootNavigator` tests (replacing Phase 2's 4 `MockRoleContext`-based ones) =
15 new/changed. Full mobile suite: **31 tests across 6 files, 0 failures**
(up from Phase 2's 20/5).

**Verification performed**:
- `npm test` — 31/31 passing.
- `npm run typecheck` (`tsc --noEmit`) — clean.
- `npm run lint` (`expo lint`) — clean. One new ESLint rule fired during this
  phase (`react-hooks/set-state-in-effect`, from the installed
  `eslint-config-expo`'s current react-hooks plugin version) on
  `AuthContext.tsx`'s mount-restore effect — a standard "fetch on mount,
  setState in the async callback after its own `await`s" pattern the rule's
  static analysis can't distinguish from the synchronous-setState
  anti-pattern it targets; silenced with a scoped, commented
  `eslint-disable-next-line` rather than restructured.
- `npx expo export --platform android` — succeeded, 2805 modules (up from
  Phase 2's 2753), valid Hermes bundle. Scratch export, deleted afterward.
- Client/server regression check: `git status` confirms no `client/` or
  `server/` files were touched this session — nothing to regress, consistent
  with §17's "zero backend changes" design.

### Physical-device verification — Phase 3 (2026-08-20, follow-up session)

The code-complete implementation above shipped with no on-device
verification at all (no `adb` in that session's environment); a follow-up
session on the same day closed that gap once the Samsung Galaxy M36 was
reconnected. **`adb` was already installed**
(the earlier session's `winget install --id Google.PlatformTools` — see
`mobile/DEVICE_TESTING.md`) and the persistent **User** PATH already
contained `...platform-tools` (confirmed via
`[Environment]::GetEnvironmentVariable("Path","User")`, exactly one clean
entry, no duplicate added) — the *session's shells* just predated that PATH
write, so `adb` was invoked by full path / a per-command `PATH` export
rather than reinstalling anything, per explicit instruction. `adb devices`
showed `RZCY619LM4T  device` (authorized).

Setup: server (`npm run dev` in `server/`, `npm run seed` first for known
demo accounts — `teacher@example.com`/`admin.rampur01@example.com`/
`superadmin@example.com`, all `demo1234`, from `server/src/seed.js`),
`adb reverse tcp:3000 tcp:3000` (API) + `tcp:8081 tcp:8081` (Metro, usually
automatic but re-added by hand after every USB replug — reverse tunnels
don't survive one, as `DEVICE_TESTING.md` already documented), then
`npx expo start --android`.

**A real bug was found and fixed by this device pass, not by any earlier
static check**: on first launch, the app hit a **red-box render crash** —
"Client Id property `androidClientId` must be defined to use Google auth on
this platform." `expo-auth-session`'s `useIdTokenAuthRequest` throws
synchronously on Android whenever `androidClientId` is `undefined`, even
though nothing ever calls `promptAsync()` while `GOOGLE_SIGN_IN_AVAILABLE`
is false — the hook's own internal validation (`invariantClientId` in
`node_modules/expo-auth-session/build/providers/ProviderUtils.js`) only
checks for `undefined`, not falsy/empty. **Fix**: default each of the three
client-ID props to `''` instead of leaving them `undefined`
(`mobile/src/auth/useGoogleIdToken.ts`) — an empty string satisfies the
check without ever producing a usable request. Verified clean afterward on
two independent fresh launches (fresh JS bundle both times, not a
hot-reload artifact) — see below.

**Verified genuinely working, against the real backend, on the physical
device** (not mocked, not assumed):
- **Login** — `teacher@example.com`/`demo1234` (RAMPUR01) signed in for
  real; landed on the real 5-tab authenticated app.
- **Session restoration** — `adb shell am force-stop host.exp.exponent`
  (a harder kill than backgrounding) then relaunch restored straight to the
  authenticated tabs with no re-login, twice, confirming SecureStore
  persistence survives full process death.
- **Logout + secure session clearing** — signing out returned to the login
  screen; a subsequent force-stop + relaunch **stayed** on the login
  screen (did not restore) — proof the SecureStore keys were actually
  deleted, not just the in-memory `user` state.
- **Invalid credentials** — a wrong password produced the real server's
  "Incorrect email or password." inline, form stayed usable, no crash.
- **Role-based navigation, three real roles** — Admin correctly **hidden**
  in More for `teacher@example.com` (role `teacher`); correctly **visible**
  for `admin.rampur01@example.com` (`school_admin`) and
  `superadmin@example.com` (`super_admin`); tapping Admin opened the real
  (Phase-11-deferred) placeholder screen in both cases.
- **Registration → pending** — filled the native Register form for a new
  account (`phase3.pending@example.com`, school RAMPUR01) and submitted;
  confirmed via `GET /api/admin/users/pending` (real super_admin JWT, real
  API) that the row was genuinely created server-side, matching what the
  form submitted.
- **Admin approval → sign-in unblocked** — approved that account via the
  real `PATCH /api/admin/users/:id/approve` endpoint (same one the web
  admin UI calls; the web client itself wasn't booted this session, so this
  was driven directly rather than by clicking through that UI — noted as a
  deliberate scope call, not a shortcut around real backend logic). Signed
  in afterward on-device and reached the authenticated app, More screen
  correctly showing "Phase3 Pending Teacher".
- **Rejected account** — registered a second account
  (`phase3.rejected@example.com`), rejected it via the real
  `PATCH /api/admin/users/:id/reject` endpoint, then signed in on-device:
  the real "This account was not approved. / A school administrator did
  not approve this account…" screen rendered, matching the server's
  `registration_rejected` code.
- **Multi-school picker — backend contract confirmed live, UI flow
  completed but not cleanly screenshotted**: registered
  `teacher@example.com` a second time under `RAMPUR02` via the real
  register endpoint, giving that email two real accounts. A direct
  `curl` against `/api/auth/login` confirmed the server genuinely returns
  `{"needsSchoolSelection":true,"schools":[RAMPUR01, RAMPUR02]}` for that
  email/password. On-device, a mistimed second automation tap landed on
  the picker's first school button before a screenshot could be taken,
  auto-completing the flow — the app correctly finished signed in at
  RAMPUR01 (confirmed via the More screen's identity card), so the
  **picker → resubmit-with-schoolId → sign-in round trip did execute
  successfully end-to-end**, just without an isolated screenshot of the
  picker screen itself. Re-attempting the clean screenshot was next on the
  list when the session ended (see below) — worth 5 minutes at the start of
  whichever session picks this up next, not a re-verification of the logic
  itself.
- **Regression, incidental**: Classroom's Phase-2 nested-stack mock-data
  navigation (Class List → Class Home → Attendance placeholder) still
  works. Both light and dark theme were each seen rendering correctly
  across different launches in this session (the phone's system theme
  changed on its own between them) — this **resolves Phase 2's own
  "light mode not independently verified" known limitation**, incidentally.

**Google Sign-In: still NOT verified end-to-end** — the render crash above
is fixed and confirmed not to regress, but no real Android/iOS/Web OAuth
client ID exists in this environment, so the button was never tapped
against a real Google identity. This remains exactly the gap the original
implementation section flagged; only the crash is new information from
this pass.

**adb/USB reliability note**: the connection dropped and had to be
re-established **five separate times** during this session (each time:
`adb devices` empty, then present again after 5–15s; `adb reverse` tunnels
had to be re-added every time, since they don't survive a replug). This
matches `DEVICE_TESTING.md`'s own troubleshooting table and the disconnect
already logged during Phase 2's device verification — treat it as a known
property of this USB setup, not a regression to chase. The session ended
when the background server and Metro processes were stopped by the
environment (not a user action, not a code issue) while the device was
mid-disconnect; nothing was left broken, but the picker screenshot above
was the one item still open at that point.

**Known limitations carried forward, explicitly not claimed as verified**:
the multi-school picker's *screen itself* has no clean on-device
screenshot, even though the flow it drives (picker → resubmit with
`schoolId` → sign-in) is confirmed executing correctly end-to-end against
the real backend, per above — treat the picker as **flow-verified,
visually-unverified**, not fully verified. Google Sign-In remains
**entirely unverified end-to-end** — code-complete and crash-free, but
never authenticated against a real Google identity, blocked on real
Android/iOS/Web OAuth client IDs that don't exist in this environment (not
on anything in this codebase). Both are worth closing before Google
Sign-In specifically is relied upon in product decisions; neither blocks
Phase 4, whose own features don't depend on either.

**Remaining work**: Phase 4 onward, per §26.

### Phase 4 — Coach — ✅ DONE (core loop verified on-device; several features explicitly deferred)

**What was done**: a native Coach chat screen replacing Phase 2/3's
`PlaceholderScreen` stub, over the exact `POST /api/coach` and
`POST /api/feedback` contracts (§4.2) — full rewrite per §9 (no salvageable
web JSX), matching the plan's own Phase 4 goal ("chat UI over POST
/api/coach, matching the web's core question→answer loop") rather than
porting `CoachPage.tsx`'s much larger feature surface (sidebar/history
search, attachments, voice, Classroom Mode, learning representation — see
"Known limitations" below for why each was left out and where it's tracked).

**Files created**:
- `mobile/src/screens/coach/CoachScreen.tsx` — the screen itself: turn
  state (`Turn[]`), submit/retry/feedback handlers, `KeyboardAvoidingView` +
  `FlatList`/`ScrollView` layout, safe-area-aware composer docking
  (`useSafeAreaInsets`).
- `mobile/src/screens/coach/Composer.tsx` — multiline `TextInput` + send
  button, `MAX_QUERY_LENGTH` (500, mirrored from `client/src/config.ts:149`)
  enforced client-side with a char-count warning, 44×44dp touch target.
- `mobile/src/screens/coach/MessageBubble.tsx` — user bubble (right-aligned,
  orange) + assistant states: pending (`RunStatus`), error (message + Try
  again, mirroring `MessageBubble.tsx`'s error card), done (`MarkdownText` +
  thumbs-up/down feedback, disabled once rated).
- `mobile/src/screens/coach/RunStatus.tsx` — native port of
  `client/src/components/RunStatus.tsx`'s three-pulsing-line skeleton +
  elapsed timer + staged waiting copy, driven by the ported pure logic below.
- `mobile/src/screens/coach/EmptyState.tsx` — welcome state: personalized
  greeting + the same four `QUICK_ACTIONS` prompts/copy as
  `client/src/config.ts`, without the web's date-based
  greeting-of-the-day/`DailyHighlight`/first-run-onboarding-intro machinery
  (none of that exists on mobile yet).
- `mobile/src/screens/coach/MarkdownText.tsx` — renders Coach answers as
  native `Text`/`View` (headings, **bold**, numbered/bulleted lists,
  paragraphs) — the RN analogue of `client/src/lib/format.ts`'s HTML-string
  approach, since React Native has no HTML renderer.
- `mobile/src/lib/formatMarkdown.ts` — the pure parser `MarkdownText`
  renders: text → block structure (`heading`/`paragraph`/`list` with inline
  bold segments). Deliberately does **not** port `format.ts`'s pipe-table or
  MCQ-option-layout transforms (print/exam-paper-specific, not a Coach-chat
  concern) or LaTeX math rendering (§28's flagged open risk — see below).
- `mobile/src/lib/runStatus.ts` — `formatElapsed`/`waitingMessage` ported
  verbatim from `client/src/lib/runStatus.ts` (byte-identical logic; only
  the import path differs).
- `mobile/src/api/coach.ts` — `askCoach()`/`sendCoachFeedback()`, thin
  wrappers over the existing mobile `api()` client (Phase 1), calling
  `/coach` and `/feedback` exactly as `CoachPage.tsx`'s `runTurn()`/
  `handleFeedback()` do.
- `mobile/src/lib/__tests__/formatMarkdown.test.ts`,
  `mobile/src/lib/__tests__/runStatus.test.ts` (ported from
  `client/src/lib/runStatus.test.ts`, Vitest → Jest syntax only),
  `mobile/src/api/__tests__/coach.test.ts`,
  `mobile/src/screens/coach/__tests__/CoachScreen.test.tsx` — see Tests
  below.

**Files modified**:
- `mobile/src/navigation/stacks/CoachStack.tsx` — renders `CoachScreen`
  instead of the Phase 2 `PlaceholderScreen`.
- `mobile/src/config.ts` — added `MAX_QUERY_LENGTH = 500`.
- `mobile/src/navigation/__tests__/RootNavigator.test.tsx` — extended the
  existing "restores an authenticated session" test with an assertion that
  Coach's *actual* chat UI (greeting + composer) renders immediately after
  auth, not just the tab bar — confirms Coach is reachable end-to-end
  through the real `AuthProvider`, not only in `CoachScreen`'s own isolated
  tests.

**Existing code reused**: the `POST /api/coach` and `POST /api/feedback`
request/response contract (`server/src/index.js:638-939`,
`server/src/routes/queries.js:66-`) unchanged; `lib/runStatus.ts`'s staged
waiting-message logic (byte-identical port, per §23's explicit instruction);
`QUICK_ACTIONS`' four prompts/copy from `client/src/config.ts`; the mobile
`api()`/`ApiError` client from Phase 1 (token attach, refresh-on-401,
concurrent-refresh dedup — all inherited for free, not re-implemented).

**Backend changes**: none, as designed (§17, the architecture rule for this
phase) — confirmed via `git status`: no `server/` or `client/` file was
touched this session.

**Coach functionality implemented** (matching what §3/§4.2 confirm the
existing codebase actually supports): send a question, receive an AI
answer with basic Markdown formatting (headings, bold, lists), a patient
staged loading state for the realistic several-seconds-to-~60s wait
(`LLM_TOTAL_TIMEOUT_MS`), thumbs-up/down feedback tied to the real
`queryId`, and retry on a failed turn (network or server error).

**Deliberately NOT implemented this phase, documented as limitations rather
than faked** (each is either a later phase's own screen, an explicit
plan-level deferral, or a genuine open technical risk — not an oversight):
- **Chat history sidebar/search** (`GET /queries`, `Sidebar.tsx`/
  `ChatSearchOverlay.tsx` on web) — §10's navigation tree scopes Coach to
  `Stack: Chat → [message actions, share sheet]`, no history screen; a turn
  list is session-local (component state), matching the acceptance
  criterion's own bar ("ask a question and see a … answer"), not the web's
  full persistent-history product.
- **File/photo attachments** (`POST /coach/attachment`) and **voice input**
  — §9/§26 Phase 4 explicitly allow deferring voice past V1 if not core to
  the daily workflow; attachments are reusable as-is per §4.2 but were not
  in this phase's own file list (`mobile/src/screens/coach/*` scoped to the
  core loop) and are a reasonable, self-contained follow-up.
- **Classroom Mode** (`classroomMode` request flag, `ClassroomSet`/
  `ClassroomModeMenu` on web) — a whole additional planner call + UI surface
  layered on top of the core loop; out of scope for "matching the web's
  core question→answer loop."
- **AI Learning Representation panel** (`LEARNING_REPRESENTATION_ENABLED`) —
  same reasoning: a separate feature surface, not the core loop.
- **LaTeX math rendering** ($...$/$$...$$ via KaTeX on web) — §28's own
  flagged open risk ("resolve empirically during Phase 4, don't guess now").
  Resolved empirically: no LaTeX renderer was added this phase. A Coach
  answer containing LaTeX will render as literal `$...$` text rather than
  typeset math. Per §26 Phase 4's own risk note ("ship without math
  rendering first if necessary, add it after"), this is the explicit
  decision made — `react-native-katex`/a WebView-based KaTeX render should
  be evaluated in a follow-up pass rather than blocking this phase further.
- **Grade/subject/language context picker** (`TeachingContextMenu` on web) —
  every mobile request sends `language: 'en'` and an empty `context`. A
  teacher cannot yet set grade/subject tags or a non-English response
  language from the mobile app.
- **Edit-in-place, copy-to-clipboard, read-aloud, share, and
  save-to-library** on a sent message/response (`MessageBubble.tsx`/
  `ResponseCard.tsx` web actions) — none exist in the mobile bubble; only
  retry and feedback do.

**Tests added**: 27 new tests across 4 files (mobile suite: **58 tests
across 10 files, 0 failures**, up from Phase 3's 31/6):
- `lib/__tests__/runStatus.test.ts` — 9 tests, ported from the web's own
  `runStatus.test.ts` (elapsed-time formatting edge cases, staged-message
  thresholds, live-region-noise bound).
- `lib/__tests__/formatMarkdown.test.ts` — 10 tests covering the block
  parser (plain/blank-line paragraphs, embedded-newline joining, inline
  bold, headings 1–6, ordered/unordered list grouping and marker-switch
  boundaries, a realistic multi-block answer, empty input).
- `api/__tests__/coach.test.ts` — 3 tests (request shaping for
  `askCoach`/`sendCoachFeedback`, error propagation), same
  mocked-`api()`-module pattern as `classroomApi.test.ts`.
- `screens/coach/__tests__/CoachScreen.test.tsx` — 6 component tests
  (React Native Testing Library, real rendering + `fireEvent`): empty state
  with personalized greeting and quick-action prompts; tapping a prompt
  prefills without sending; send button disabled until non-whitespace text;
  full pending→success round trip (asserts the sent bubble, the staged
  loading message, the composer clearing, then the rendered Markdown
  answer); network-error card with a working retry that succeeds on the
  second attempt; thumbs-up feedback calling `sendCoachFeedback` with the
  real `queryId`.
- `navigation/__tests__/RootNavigator.test.tsx` — 1 new assertion (existing
  test extended, not a new test file) confirming Coach's real chat UI (not
  a placeholder) renders through the authenticated navigator.

**Verification performed**:
- `npm test` — 58/58 passing, 10/10 suites.
- `npm run typecheck` (`tsc --noEmit`) — clean.
- `npm run lint` (`expo lint`) — clean. One issue fixed during
  implementation: the current `eslint-config-expo`'s `react-hooks/refs` rule
  flags the common `useRef(x).current` lazy-singleton pattern as "cannot
  access ref value during render" — `RunStatus.tsx`'s `Animated.Value`
  singleton was switched to `useState(() => new Animated.Value(...))`
  instead (same stable-identity guarantee, no ref read during render).
- `npx expo export --platform android` — succeeded, 2814 modules (up from
  Phase 3's 2805), valid Hermes bundle. Scratch export, deleted afterward.
- Client/server regression check: `git status` confirms no `client/` or
  `server/` files were touched this session.

### Physical-device verification — Phase 4 (2026-08-20/21, Samsung Galaxy M36)

`adb devices` showed `RZCY619LM4T` `device` (authorized) via the same
full-path invocation Phase 3 documented (persistent PATH write predates the
session's shells). Server (`npm run dev`, already running from an earlier
session) and Metro were reachable; `adb reverse tcp:3000 tcp:3000` +
`tcp:8081 tcp:8081` set up USB tunnels for the API and dev server.

**A real, reproducible bug was found and fixed by this device pass**: the
Coach feedback thumbs (`MessageBubble.tsx`) rendered the "Helpful" button
already selected and disabled on a *brand-new* turn, before any tap —
confirmed via `uiautomator dump` (`selected="true"`, `enabled="false"` on
first paint) and by tapping "Not helpful," which had no effect (proof both
buttons were genuinely disabled, not just visually similar). Root cause:
the Metro dev server process backing this device session had been running
continuously since **2026-08-20 21:14**, i.e. across this entire multi-hour
implementation session and several rounds of new-file creation — the exact
"long-running dev server + mid-session changes → stale bundler cache"
failure mode Phase 2's own device log already documented once (there, it
manifested as an unresolvable-module crash; here, as stale component
state/props surviving an incomplete Fast Refresh). **Fix**: killed the
stale Metro process (`taskkill`) and started a fresh
`expo start --android --clear`; re-tested the exact same flow on the new
bundle and the feedback buttons rendered correctly unselected/enabled on a
new turn, and correctly flipped to selected/disabled only after an actual
tap. Not a code defect — recorded here so a future session recognizes the
symptom immediately rather than re-debugging component logic that is
already correct.

**Verified genuinely working, against the real backend, on the physical
device** (not mocked, not assumed):
- **Auth/session regression** — app relaunches (including after a
  ~15-minute idle gap and a full Expo Go force-stop) restored straight to
  the authenticated Coach screen with no re-login, confirming Phase 3's
  SecureStore persistence still holds; the **More** menu still showed the
  correct identity card (Demo Teacher / `teacher@example.com` / Govt
  Primary School, Rampur), no Admin item for the `teacher` role, and a
  working Sign out button — Phase 3 unaffected by this phase's changes.
- **Coach empty state** — personalized greeting ("Hi Demo Teacher 👋") and
  all four quick-action cards (Lesson Plan / Classroom Activity / Explain a
  Concept / Assessment) rendered with correct icons and orange accent in
  dark theme.
- **Composer** — send button genuinely disabled (`enabled="false"` in the
  accessibility tree) with empty/whitespace-only input, enabled once real
  text is present; multiline growth and the keyboard-avoiding dock worked
  (confirmed via `KeyboardAvoidingView` pushing the composer above the
  on-screen keyboard in screenshots).
- **Successful round trip** — asked "How do I explain fractions to grade 5
  students" and, separately, "What is photosynthesis" against the real
  Gemini-backed `/api/coach`; both returned real answers rendered with
  working numbered lists, bold labels, and bulleted sub-items via
  `MarkdownText` — confirmed via `uiautomator dump` text nodes, not just a
  screenshot.
- **Feedback** — tapped "Helpful" on a real answered turn; the icon filled
  orange and both thumb buttons became disabled (`selected="true"`/
  `enabled="false"` for Helpful, `enabled="false"` for Not helpful),
  confirming a real `POST /api/feedback` round trip with the actual
  `queryId`, not a local-only toggle.
- **Network-error state** — removed the `adb reverse tcp:3000` tunnel
  (rather than toggling WiFi, which doesn't affect USB-tunneled traffic)
  and sent a question: the error card rendered "⚠️ Network error. Please
  check your connection." with a working "Try again" link, exactly matching
  `MessageBubble.tsx`'s design.
- **Retry** — restored the tunnel and tapped "Try again": the retry
  genuinely re-hit the real server (the displayed message changed from the
  client-side "Network error…" to the server's own
  `Failed to generate a response. Please try again.` — a **502
  UPSTREAM_UNAVAILABLE** response from `server/src/index.js:937`, an
  existing generic Gemini-upstream-failure handler, unrelated to and
  unmodified by this phase). This is a real, observed backend/AI-provider
  flakiness in this dev environment, not a mobile-client defect — the
  mobile error/retry UI correctly surfaced whatever the server actually
  returned each time, which is the behavior being verified.
- **Regression, incidental** — Classroom tab (Phase 2/8 stub) still
  rendered its mock class list correctly after switching away from and
  back to Coach.

**adb/USB reliability note (consistent with Phase 2/3's own logs)**: the
connection dropped multiple times during this session, including one gap
long enough for Expo Go to lose its dev-server WebSocket and show its own
"Something went wrong" error screen (Expo Go's client-side error boundary,
not a Coach/app crash) — resolved each time by re-adding both `adb reverse`
tunnels (they do not survive a replug/idle drop) and relaunching via
`am start -a android.intent.action.VIEW -d exp://127.0.0.1:8081`. Treated
as the same known USB-setup property already documented in
`mobile/DEVICE_TESTING.md`'s troubleshooting table, not a regression.

**Known limitations, explicitly not claimed as verified**: light-mode
Coach screens were not independently checked this session (phone stayed in
dark theme throughout, same gap Phase 2 originally flagged and Phase 3
incidentally closed for its own screens — Coach's own light-mode rendering
is untested); no TalkBack/accessibility pass (deferred to Phase 13 per
§23, consistent with every prior phase); the "Failed to generate a
response" server error observed during retry testing means the *second*
real Gemini call in that specific sequence was not independently confirmed
successful on this device pass — the round-trip mechanics (request sent,
real distinct response received and rendered) were fully confirmed by the
two earlier successful questions, so this is not treated as a gap in the
mobile implementation, but the flakiness itself is unexplained and outside
this phase's scope.

**Remaining work**: Phase 5 onward, per §26.

### Phase 5 — Library — ✅ DONE (2026-08-21)

**What was done**: List → View → Edit over the existing `GET/POST/PATCH/DELETE
/api/resources` and `POST /api/resources/:id/ai-action` contracts (already
ported in Phase 1, §9) — search/filter/delete, a read screen with the
exam-paper letterhead, a full edit workspace (fields, exam-letterhead editor,
AI Assist preview/apply, Edit/Preview tabs), and the `window.print()`
replacement (§19): render a resource to PDF and hand it to the native share
sheet via `expo-print` + `expo-sharing`.

**Files created**: `mobile/src/lib/{assessment,examMeta,formatHtml,
buildResourcePdfHtml,exportPdf}.ts` (assessment.ts/examMeta.ts are verbatim
ports of `client/src/lib/{assessment,examMeta}.ts`; formatHtml.ts is a port of
`client/src/lib/format.ts`'s Markdown→HTML transform, math rendering
deliberately dropped — same Phase 4 precedent — used only to build the PDF
export document; buildResourcePdfHtml.ts and exportPdf.ts are new, no web
equivalent since the web prints via the browser's own dialog);
`mobile/src/components/{ChipPicker,SuggestionChips}.tsx` (new native form
primitives — single-select chip row and tap-to-fill suggestion chips, the
native analogues of a `<select>`/`<datalist>`); `mobile/src/screens/library/
{ResourceListScreen,ResourceViewScreen,ResourceEditScreen,ExamHeaderView,
ExamHeaderEditor,AiAssistSection,SuggestionModal}.tsx` (ExamHeaderView/
ExamHeaderEditor port `client/src/components/ExamHeader{,Editor}.tsx`;
AiAssistSection/SuggestionModal are new, no direct web equivalent — the web
inlines this UI into `ResourceWorkspace.tsx`); nine new test files under
`mobile/src/lib/__tests__/` and `mobile/src/screens/library/__tests__/`.

**Files modified**: `mobile/src/config.ts` (added `RESOURCE_TYPE_META`/
`RESOURCE_TYPES`/`GRADES`/`SUBJECTS`/`LANGUAGES`, ported from
`client/src/config.ts`); `mobile/src/navigation/stacks/LibraryStack.tsx`
(wired the three real screens in place of Phase 2's `PlaceholderScreen`
stubs); `mobile/jest.setup.ts` (mocks for `expo-print`/`expo-sharing`/
`expo-file-system/legacy`); `mobile/package.json`/`package-lock.json`/
`app.json` (added `expo-print`, `expo-sharing`, `expo-file-system` via
`npx expo install`, SDK-57-pinned).

**Existing code reused**: `mobile/src/api/resources.ts` (Phase 1 — every
CRUD/AI-action call, unchanged); `client/src/lib/{assessment,examMeta}.ts`
(ported verbatim); `client/src/components/ExamHeader{,Editor}.tsx` (ported as
native components); `RESOURCE_TYPE_META`/`GRADES`/`SUBJECTS`/`LANGUAGES` from
`client/src/config.ts`; the mobile `MarkdownText`/`formatMarkdown.ts` renderer
from Phase 4 (reused for on-screen viewing/preview — a separate `formatHtml.ts`
exists only for the PDF export document, matching the split Phase 4
established for Coach).

**Backend changes**: none — confirmed via `git status`, no `client/` or
`server/` file touched this session. Every endpoint used
(`GET/POST/PATCH/DELETE /resources`, `POST /resources/:id/ai-action`) was
already reusable as-is per §9/§17.

**Deliberately scoped/not built this phase**: the Quiz/Worksheet **Generator**
form itself (`POST /resources/generate[-set|-lesson-plan]`) — that is Phase
6's own screen per §26; Library only consumes an already-saved resource.
CSV export (Attendance/Fees, §19) is out of scope here — it belongs to
Phases 9/10.

**Tests added**: 45 new tests across 9 files (mobile suite: **112 tests
across 18 files, 0 failures**, up from Phase 4's 58/10):
`lib/__tests__/{assessment,examMeta,formatHtml,buildResourcePdfHtml,
exportPdf}.test.ts` (pure-logic coverage — answer-key splitting/preamble
stripping, exam-meta prefill/parse/merge round trips, the Markdown→HTML
transform's headings/tables/MCQ-options/lists, the full PDF-HTML build for
both plain and exam-paper documents in all three print modes, and the
export/share helper including its filename sanitizer and the
`SharingUnavailableError` path); `screens/library/__tests__/
{ResourceListScreen,ResourceViewScreen,ResourceEditScreen}.test.tsx`
(React Native Testing Library, real rendering + `fireEvent`) — list
loading/empty-state/filter/search-debounce/delete-with-rollback; view
loading/404/edit-navigation/delete/export (both the direct and the
assessment student-teacher-choice paths); edit loading, the header
Save button's disabled→enabled transition on a real field change, a PATCH
sending only the changed field, an AI Assist round trip through preview to
apply (and confirming the applied suggestion is *not* persisted until Save),
export via the header button, and the unsaved-changes `beforeRemove` guard.

**Verification performed**:
- `npm test` — 112/112 passing, 18/18 suites.
- `npm run typecheck` (`tsc --noEmit`) — clean.
- `npm run lint` (`expo lint`) — clean. Two instances of the
  `react-hooks/set-state-in-effect` false positive (same pattern
  Phase 3's `AuthContext.tsx` already hit and documented) were silenced with
  the same scoped `eslint-disable-next-line` convention, not restructured.
- `npx expo export --platform android` — succeeded, 2834 modules (up from
  Phase 4's 2814), valid Hermes bundle. Scratch export, deleted afterward.

### Physical-device verification — Phase 5 (2026-08-21, Samsung Galaxy M36)

`adb devices` showed the phone `device`-authorized; `adb reverse` tunnels for
`tcp:3000`/`tcp:8081` were re-added (per the now-familiar "don't survive a
replug" property, `mobile/DEVICE_TESTING.md`); the Metro dev server backing
this device session had been running since before this phase's `npm install`
calls (expo-print/expo-sharing/expo-file-system), so — per Phase 2/4's own
documented stale-cache failure mode — it was killed and restarted fresh with
`expo start --android --clear` before any device testing began, rather than
risking the same class of bug.

**Three real, reproducible export/share bugs were found and fixed by this
device pass alone** — none were caught by any static check, and each only
surfaced against the real native module stack, not the mocked Jest
environment:
1. Sharing `expo-print`'s own output URI directly via `expo-sharing`
   crashed with *"Not allowed to read file under given URL"* — expo-print's
   temp output isn't in a location expo-sharing's Android FileProvider
   config covers under Expo Go.
2. The fix attempt using expo-file-system's SDK 54+ object-oriented API
   (`File`/`Paths`) to copy that file into the cache directory first instead
   failed with *"Missing 'READ' permission for accessing the file"*.
3. Retrying with expo-file-system's `/legacy` functional API (`copyAsync`) —
   the same API Expo's own official print-and-share examples use — still
   failed, with a clearer native `IOException`: *"...isn't readable"*, even
   though the source path was inside the app's own private cache directory.

   All three are the same underlying problem (reading `printToFileAsync`'s
   own output file back, from anywhere other than expo-print's own internal
   code, doesn't work under Expo Go on this device/SDK combination) —
   confirmed by trying three independent APIs, not a single guessed fix.
   **The fix that actually works, verified end-to-end on-device**:
   `mobile/src/lib/exportPdf.ts` asks `printToFileAsync` for `base64: true`
   instead of reading its file back at all, and writes those bytes directly
   into the cache directory with `expo-file-system/legacy`'s
   `writeAsStringAsync` — this never touches print's own output file a
   second time, so none of the three read-back failures above can recur.
   Confirmed genuinely working: tapping Share/Export on the real saved
   "Unit 4 quiz" assessment, choosing "Teacher version", opened Android's
   real native share sheet showing a valid `Unit_4_quiz.pdf` (Adobe Acrobat
   icon, real share targets — WhatsApp/Gmail/Drive/Messages), confirmed
   twice independently (once immediately after the fix, once after a full
   force-stop/cold-relaunch to rule out a stale-bundle fluke).

**Verified genuinely working, against the real backend, on the physical
device** (not mocked, not assumed):
- **Library list** — loaded the teacher's real saved library via
  `GET /resources` (one real assessment, "Unit 4 quiz," created in an
  earlier session) — search bar, the "All" + per-type filter chip row, and
  the card (type icon/label, title, snippet, date) all rendered correctly in
  both the phone's dark theme and, later in the session when the phone's
  system theme changed on its own, light theme.
- **Resource view** — opened "Unit 4 quiz": the real exam-paper letterhead
  (`ExamHeaderView`) rendered above the content, correctly reading the
  resource's actual saved `grade`/`subject`/type, with Share/Export, Delete,
  and Edit actions all present and correctly enabled.
- **Export/Share** — see the three-bug account above; confirmed end-to-end
  with the real native Android share sheet.
- **Edit ("workspace") screen** — opened via the real Edit button (not a
  mock): Title/Type/Grade/Subject/Language fields all populated from the
  real resource; the Type `ChipPicker` correctly highlighted "Assessment";
  Grade/Subject suggestion chips rendered; the collapsible "Paper details"
  (`ExamHeaderEditor`) toggled open/closed correctly; the Edit/Preview tab
  toggle worked, with Preview correctly rendering the real exam letterhead
  **prefilled from the signed-in teacher's actual school/name**
  ("Govt Primary School, Rampur" / "Demo Teacher") via `buildInitialExamMeta`
  — genuine confirmation that prefill logic runs correctly against a real
  session, not just its unit test; the header Save icon changed from
  muted/disabled to orange/enabled the moment the title field was edited,
  confirming the dirty-check re-renders the header correctly on a real
  device (this exact transition is also covered by
  `ResourceEditScreen.test.tsx`, so both checks agree); the AI Assist section
  rendered all eight actions correctly for an assessment (four generic +
  four assessment-only).
- **Regression** — Coach tab (Phase 4) still reachable and rendering its
  authenticated chat UI correctly after navigating through Library.

**Known limitations, explicitly not claimed as verified**: the header
**Save** button's on-device tap could not be cleanly exercised this session
— Expo Go's own floating dev-menu bubble (a development-only overlay, absent
from any production/store build) sits directly on top of the header's
Save/Export icon cluster and intercepted the synthetic tap every time it was
attempted at that exact screen position; the *disabled→enabled* transition
that gates Save was confirmed live (above), and the PATCH request itself
(exact changed-fields-only payload) is covered by
`ResourceEditScreen.test.tsx`'s "saves only the changed fields as a PATCH"
test, so this is a live-tap gap on one specific button, not an unverified
code path. The device's USB connection also dropped (a known property of
this setup, `mobile/DEVICE_TESTING.md`) during this final check and did not
reconnect before the session needed to wrap up, which is why this specific
gap wasn't closed rather than being left open by choice — worth 2–3 minutes
at the start of whichever session picks this up next (reconnect, open Edit,
change a field, tap Save away from the dev-menu bubble's corner, e.g. by
first dismissing/relocating it, and confirm the list reflects the new
title). AI Assist was verified to render correctly but an actual AI-action
round trip against the real Gemini-backed endpoint was not exercised
on-device this session (covered by mocked-API component tests only). No
TalkBack/accessibility pass (deferred to Phase 13 per §23, consistent with
every prior phase).

**Remaining work**: Phase 6 onward, per §26.

### Phase 6 — Generator — ✅ DONE (2026-08-21), built directly against the structured contract

Before starting Phase 6 implementation, the user asked for a full architecture
review of turning the Generator's question content into a real structured
per-question model (MCQ/Descriptive/True-False/Fill-Blank/Match/SAQ,
individually editable/reorderable/deletable) instead of one markdown blob —
see **`docs/generator-v2-plan.md`** for the complete design and its
Implementation Log. That review was approved; **Stage 1 (backend)** and
**Stage 2 (web Generator + Library Workspace)** shipped first (2026-08-21):
the server supports 3 new question types end-to-end behind
`STRUCTURED_QUESTIONS_ENABLED` (default off), and the web app has a full
native per-question card editor (add/delete/reorder/edit, all 6 types,
Preview, Save, legacy-resource fallback) on both the Generator page and the
Library edit workspace.

**Phase 6 itself (this entry) then built directly against that same
structured contract** — the sequencing choice flagged above was resolved in
favor of "build directly against the new contract, with a proven web
reference to port patterns from" rather than shipping the plain 4-type API
first. See **`docs/generator-v2-plan.md`'s "Implementation Log — Stage 3
(Mobile Generator + Library)"** for the complete account; summarized here:

- New native screens `GeneratorFormScreen`/`GeneratorResultScreen`
  (`mobile/src/screens/generator/`), wired into `GeneratorStack` in place of
  the two `PlaceholderScreen`s from Phase 2.
- New native components `QuestionCard`/`QuestionListEditor`
  (`mobile/src/components/`), reused by both the Generator's result screen
  and the extended `ResourceEditScreen` (Library reopen/continue-editing).
- Full flow implemented and tested: generate (all question types the server
  supports, reusing the existing `POST /resources/generate` — no new
  backend/API code), view/edit/add/delete/reorder individual questions,
  preview the complete paper with the exam-paper letterhead, edit
  student-facing instructions, save (validated, structured payload built
  client-side, `content` omitted so the server re-renders it), reopen a saved
  resource via the Library edit screen and continue editing, save changes
  back. Legacy (pre-structured) resources render exactly as they did in
  Phase 5 — unchanged, no silent conversion.
- 24 new mobile tests (`QuestionCard`, `QuestionListEditor`,
  `GeneratorFormScreen`, `GeneratorResultScreen`, plus 5 added to
  `ResourceEditScreen.test.tsx`) — mobile suite grew from 176 to 200,
  zero regressions. `npx tsc --noEmit`, `npm run lint`, and
  `npx expo export --platform android` all clean.
- **Verified genuinely on the physical Samsung Galaxy M36** against the real
  backend and real Gemini API — see `docs/generator-v2-plan.md`'s Stage 3 log
  for the full account, including a real stale-bundle bug found and fixed
  (Metro was serving a build from before `EXPO_PUBLIC_STRUCTURED_QUESTIONS_ENABLED`
  took effect; fixed by a clean `expo start --android --clear` restart), and
  a mid-session back-navigation observation that was initially reported as a
  probable bug but, on review, was standard React Navigation
  tab/stack behavior working as designed (corrected on the record there
  rather than silently dropped).
- **Not verified this pass**: light theme (dark theme only), and on-device
  rendering of every individual question type beyond `match` (MCQ was seen
  once, pre-restart) — all covered by the 200 passing Jest tests but not
  independently re-confirmed on hardware.

### Phase 7 — Notifications (in-app + realtime) — ✅ DONE, physical-device verification complete

**Scope, from §26 Phase 7**: notification list, unread badge, realtime bell
updates via Socket.IO, while the app is foregrounded. **Not** this phase's
scope (explicitly deferred to **Phase 7b**, not started): OS-level push
delivery when the app is backgrounded/killed, the `DeviceToken` model, and
any backend change — Phase 7 itself is 100% REST/Socket.IO reuse, zero
backend changes, per §15/§17.

**What was done**: a native in-app notification center reading/writing the
existing `/api/notifications*` REST API (already ported in Phase 1 —
`mobile/src/api/notifications.ts` — untouched this phase) plus a realtime
Socket.IO connection, surfaced as an unread badge in two places (the More
tab icon and the Notifications row inside the More menu) and a full list
screen (More → Notifications).

**Files created**:
- `mobile/src/lib/socket.ts` — ported from `client/src/lib/socket.ts`
  (§9): same `socket.io-client` API, `connectNotificationSocket()` unchanged
  in shape except `getToken` is async here (SecureStore, same deviation
  Phase 1's `api/client.ts` already made) — the `auth` option is passed as a
  callback function that awaits the token before calling back, which
  `socket.io-client` supports natively for exactly this case.
- `mobile/src/lib/historyTime.ts` — `formatTimestamp()` ported verbatim from
  `client/src/lib/historyTime.ts` (pure function, zero DOM).
- `mobile/src/notifications/NotificationContext.tsx` — `NotificationProvider`/
  `useNotifications()`, ported from `client/src/components/Notifications.tsx`'s
  `NotificationProvider` (§15): unread count, paginated list, mark-read/
  mark-all-read (both optimistic, best-effort network write, no rollback —
  same reasoning as web), and the realtime connection lifecycle including the
  reconnect-then-`refreshUnreadCount()` correctness backstop (§15 point 2) —
  ported as-is per the plan's own instruction. Two deliberate mobile
  adaptations, documented in the file's own header comment: (1) no
  `ToastProvider` exists on mobile yet (no earlier phase built one), so
  load/mark-all failures surface as an `error` string the screen renders
  inline (same pattern `ResourceListScreen.tsx` already uses) instead of a
  toast; a realtime arrival still updates the list/badge, it just isn't
  separately announced. (2) The provider is mounted only inside
  `RootNavigator`'s authenticated branch (wrapping `MainTabs`), not globally
  like web's `App.tsx` tree — this repo's mobile root already structurally
  separates signed-in/signed-out subtrees (Phase 3's own "no stale screen
  reachable after logout" design), so scoping the provider there gets the
  same "no stale socket after logout" guarantee for free (the whole subtree
  unmounts) without needing both an internal `if (!user)` guard and an
  always-mounted outer provider the way web needs.
- `mobile/src/screens/notifications/NotificationsScreen.tsx` — full native
  rewrite of `Notifications.tsx`'s `NotificationBell` dropdown panel as its
  own pushed screen (More → Notifications, §10/§11): loading state, empty
  state ("You're all caught up"), a "Mark all read" action, a `FlatList` of
  rows (type icon via `NOTIFICATION_TYPE_META`, title, message, relative
  timestamp, an unread dot + highlighted card), a "Load more" footer control
  (pagination, mirroring the web panel's own load-more button rather than
  infinite scroll), reload-on-focus, and an inline error banner. **Deliberately
  not implemented**: tap-to-navigate via a notification's `link` field —
  mapping the web's route-string convention onto mobile's own stack/tab
  routes is exactly the deep-link work §26 Phase 7b's own acceptance
  criteria ("tapping it deep-links correctly") scope to the push-notification
  phase, not this one. Tapping a row here only marks it read, matching this
  phase's own acceptance bar.
- `mobile/src/lib/__tests__/historyTime.test.ts`,
  `mobile/src/notifications/__tests__/NotificationContext.test.tsx`,
  `mobile/src/notifications/__tests__/NotificationContext.disabled.test.tsx`,
  `mobile/src/screens/notifications/__tests__/NotificationsScreen.test.tsx` —
  see Tests below.

**Files modified**:
- `mobile/src/config.ts` — added `NOTIFICATIONS_ENABLED` (client-side
  cosmetic gate, mirrors `client/src/config.ts`'s `VITE_NOTIFICATIONS_ENABLED`
  — server's `NOTIFICATIONS_ENABLED` remains the real kill switch) and
  `NOTIFICATION_TYPE_META` (icon/label per `NotificationType`, ported from
  the web's vocabulary; mobile has no admin compose screen yet so `sendable`
  isn't tracked — nothing reads it).
- `mobile/src/navigation/RootNavigator.tsx` — wraps `MainTabs` in
  `NotificationProvider` inside the authenticated branch (see above).
- `mobile/src/navigation/MainTabs.tsx` — `MoreTab` now sets `tabBarBadge` to
  the live unread count (hidden at 0, capped display at "99+").
- `mobile/src/navigation/stacks/MoreStack.tsx` — `Notifications` route now
  renders the real `NotificationsScreen` instead of the Phase 2/6
  `PlaceholderScreen` stub.
- `mobile/src/screens/MoreMenuScreen.tsx` — the "Notifications" menu row now
  shows a small unread-count badge (testID `more-menu-notif-badge`) when
  `unreadCount > 0`.
- `mobile/src/navigation/__tests__/RootNavigator.test.tsx` — mocks
  `NOTIFICATIONS_ENABLED: true` (Jest doesn't run Metro's `EXPO_PUBLIC_*`
  inlining, same reasoning `GeneratorResultScreen.test.tsx` already
  documents for `STRUCTURED_QUESTIONS_ENABLED`) and adds one new test
  asserting the More-menu badge renders the real unread count from a mocked
  `/notifications/unread-count` response — same "extend this file with one
  assertion per phase" pattern Phases 3/4 already established.
- `mobile/jest.setup.ts` — added a default no-op `socket.io-client` mock
  (never emits `connect`/`notification:new`) so any test rendering the
  authenticated tree doesn't attempt a real network connection; individual
  notification tests override it locally with a controllable fake socket.
- `mobile/.env` / `mobile/.env.example` — added
  `EXPO_PUBLIC_NOTIFICATIONS_ENABLED` (`.env`: `true`, matching
  `client/.env`'s own `VITE_NOTIFICATIONS_ENABLED=true`; `.env.example`
  default `false`, documented the same way every other flag is).
- `mobile/package.json`/`package-lock.json` — added `socket.io-client@^4.8.3`
  (matches `client/package.json`'s and `server/package.json`'s pinned
  version exactly) via plain `npm install` (not `expo install` — it's a pure
  JS package with no native module, same category as every other
  `lib/*Api.ts` dependency).

**Existing code reused**: `mobile/src/api/notifications.ts` (already ported
in Phase 1, unchanged — `listNotifications`/`getUnreadCount`/
`markNotificationRead`/`markAllNotificationsRead`/`mergeNewNotification`),
the `POST/GET/PATCH /api/notifications*` route contract (§4.4) unchanged,
`NOTIFICATION_TYPE_META`'s icon/label vocabulary (server counterpart
`server/src/lib/notificationTypes.js`, per the CHANGE-11 duplication
convention §9 already established), the mobile `api()`/SecureStore session
layer from Phase 1 (token attach, refresh-on-401 — inherited for free by
`getUnreadCount()`/etc., not reimplemented).

**Backend changes**: none, as designed (§15/§17 — Phase 7 is explicitly
"no backend change for this half of the phase"; Phase 7b is where the
`DeviceToken` model and dispatch-hook additions belong). Confirmed via
`git status`: no `server/` or `client/` file was touched this session.

**Tests added**: 27 new tests across 4 new files (mobile suite: **221 tests
across 27 files, 0 failures**, up from Phase 6's 200/23):
- `lib/__tests__/historyTime.test.ts` — 4 tests (just-now/minutes/hours/day+
  boundaries).
- `notifications/__tests__/NotificationContext.test.tsx` — 8 tests: first-page
  load + `hasMore` derivation, load failure sets an inline error, `loadMore`
  pagination/append, `markRead` optimistic update + badge decrement,
  `markAllRead` optimistic update + error-without-revert on failure, the
  realtime socket lifecycle (opens on mount, the reconnect-then-refresh
  backstop on a `'connect'` event, a `'notification:new'` arrival merging
  into the list and incrementing the badge), and socket disconnect on
  unmount.
- `notifications/__tests__/NotificationContext.disabled.test.tsx` — 1 test,
  in its own file specifically so `NOTIFICATIONS_ENABLED: false` can be
  module-mocked without `jest.resetModules()` gymnastics mid-file (asserts
  no socket is opened and no unread-count fetch fires when the flag is off).
- `screens/notifications/__tests__/NotificationsScreen.test.tsx` — 7 tests
  (React Native Testing Library, real rendering + `fireEvent`): loads on
  mount, loading state, empty state, list rendering + working "Mark all
  read", tap-to-mark-read (only for an unread row), "Load more" control,
  inline error banner, reload on screen focus.
- `navigation/__tests__/RootNavigator.test.tsx` — 1 new test (existing file
  extended, matching the established per-phase pattern): signs in, mocks a
  `count: 3` unread-count response, navigates to More, asserts the
  `more-menu-notif-badge` testID shows "3".

**Verification performed**:
- `npm test` — **221/221 passing, 27/27 suites**.
- `npm run typecheck` (`tsc --noEmit`) — clean.
- `npm run lint` (`expo lint`) — clean. One issue fixed during implementation:
  the same `react-hooks/set-state-in-effect` rule Phase 3's `AuthContext.tsx`
  already hit fired on `NotificationContext.tsx`'s `refreshUnreadCount()`
  call inside the socket-lifecycle effect (a standard fetch-on-mount pattern
  the rule's static analysis can't distinguish from the synchronous-setState
  anti-pattern it targets) — silenced with the same scoped, commented
  `eslint-disable-next-line` precedent already established.
- `npx expo export --platform android` — succeeded, **2879 modules** (up
  from Phase 6's count), valid Hermes bundle (4.3MB `.hbc`). Scratch export,
  deleted afterward.
- Client/server regression check: `git status` confirms no `client/` or
  `server/` file was touched this session — nothing to regress, consistent
  with the "zero backend changes" design for this half of the phase.

**Physical-device verification: COMPLETE (2026-08-22)** — the connectivity
blocker documented below was root-caused and fixed, and every notification
flow in this phase's scope was then genuinely exercised on the Samsung
Galaxy M36, including a real realtime-delivery bug found and fixed. See the
dedicated log section immediately below for the full account.

**Known limitations, explicit deferrals (not oversights)**:
- Tap-to-navigate via a notification's `link` field — see the
  `NotificationsScreen.tsx` file note above; scoped to Phase 7b.
- No toast/snackbar announcement of a realtime arrival — mobile has no
  `ToastProvider` yet (no earlier phase built one); the badge/list still
  update live, there's just no separate transient announcement. Worth
  revisiting once/if a mobile toast primitive exists for another feature.
- OS-level push (backgrounded/killed app delivery) — entirely out of scope
  for this phase by design; that is all of Phase 7b (not started).
- No admin compose screen on mobile (`sendNotification()` exists in
  `api/notifications.ts` since Phase 1 but nothing calls it) — Admin screens
  are a later phase per §26; the only way to exercise the realtime path
  right now is the existing web admin UI or a direct API call.

**Remaining work**: Phase 7b or Phase 8 per §26 — **not started yet, do not
start without explicit go-ahead**.

### Physical-device verification — Phase 7 (2026-08-21 evening session) — STOPPED, PENDING/BLOCKED (superseded by the 2026-08-22 session below, which root-caused and fixed this)

**What was attempted**: the Samsung Galaxy M36 was connected and authorized
(`adb devices` → `RZCY619LM4T  device`). `adb reverse tcp:3000 tcp:3000` and
`tcp:8081 tcp:8081` were set up. The server was already running with
`NOTIFICATIONS_ENABLED=true` (confirmed live via `curl` — `/notifications/unread-count`
returned `401`, not `503`, proving the flag is on; no server restart was
needed or performed). A stale Metro process left over from an earlier
session (holding port 8081, predating this session's `socket.io-client`
install — the same "long-running dev server + mid-session `npm install`"
failure class Phase 2's and Phase 4's device logs already documented once
each) was killed, and a fresh `expo start --android --clear` was started.

**Every launch attempt this session failed with the same error, not a
flaky one-off**: Expo Go's red error screen, "Something went wrong… Failed
to download remote update", with `adb logcat` showing a genuine
`dev.expo.updates` `UpdateFailedToLoad` error — an `okhttp3` `IOException`
inside `Http1ExchangeCodec.readResponseHeaders` while fetching the update
manifest (`expo.modules.updates.loader.FileDownloader.downloadRemoteUpdate`).
This is a **connection-level** failure (a broken/reset read while parsing
HTTP response headers for Metro's chunked multipart manifest response), not
a JS bundling error — `curl` against the same Metro server directly from
this machine (`http://localhost:8081/status`, the manifest endpoint with the
real Expo-Updates headers, and the JS bundle endpoint itself) succeeded
instantly and cleanly every time, confirming Metro itself was healthy and
serving correctly; the failure is specifically in the phone's HTTP client
reading the response over whatever transport carried it.

**Both transport paths were tried, both failed identically**:
- **Default (LAN)**: Expo advertised `exp://10.126.242.3:8081` (this
  machine's real Wi-Fi IPv4, confirmed via `ipconfig`) — failed.
- **Forced localhost via the USB `adb reverse` tunnel**
  (`expo start --android --host localhost`, advertising
  `exp://127.0.0.1:8081`) — failed identically, across **7 separate retry
  attempts** (force-stop + relaunch, some after a full `adb kill-server`/
  `adb start-server` cycle and re-adding both reverse tunnels). One earlier
  moment in the session showed what looked like a genuinely loaded Coach
  screen (captured via `uiautomator dump`), but on reconciling the timeline
  this is almost certainly stale UI state left over from a **previous**
  session's successful load (this phone already had the app signed in and
  working from Phase 3–6 testing), not a fresh success from this session's
  Metro server — every deliberately-fresh attempt after a `force-stop`
  failed the same way, with no exception.
- **`expo start --android --tunnel`** (routes over a real ngrok tunnel,
  documented in `mobile/DEVICE_TESTING.md`'s own troubleshooting table as
  the fallback for local-networking issues) was attempted as a third path
  but did not get far enough to test against the device: it first needed
  `@expo/ngrok`, which isn't installed anywhere in this environment.
  Installed via `npm install --no-save @expo/ngrok@^4.1.0` inside `mobile/`
  (confirmed via `git diff` that this did **not** add `@expo/ngrok` to
  `package.json` — only `socket.io-client`, this phase's real dependency,
  appears there; `package-lock.json`'s extra entries are also all from that
  same legitimate `socket.io-client` install, not ngrok). The tunnel-mode
  launch itself then failed before reaching the device
  (`b1l6yjgd3`/later attempt's log — exit code 1; not fully diagnosed before
  the user asked to stop for the night).

**Root cause not yet confirmed** — leading theory, not verified: Metro
under `--host localhost` was observed listening on `[::1]:8081` (IPv6
loopback only, via `netstat -ano`) rather than a dual-stack `0.0.0.0`/`[::]`
bind, which could explain a broken/refused connection over `adb reverse`'s
IPv4-based forwarding — but the actual failure mode (`readResponseHeaders`
IOException, implying a connection *was* established and then broke mid-read)
doesn't perfectly fit a simple "wrong stack" explanation either. **This
needs real investigation next session**, not a repeat of the same retries.

**Exact stopping point / where to resume tomorrow**:
1. The user asked to stop all further Metro/Expo/tunnel/Remote-Control
   attempts for the night. No dev server is currently running (port 8081 is
   free — confirmed via `netstat` immediately before stopping).
2. `adb reverse` tunnels for `tcp:3000`/`tcp:8081` were left in place (not
   explicitly torn down); they do not survive a USB replug regardless
   (`DEVICE_TESTING.md`'s own documented behavior), so re-add both before
   resuming.
3. Next session should **start by investigating the IPv6-loopback-only bind
   theory above** (does `expo start --android --host localhost` reliably
   bind `0.0.0.0`/dual-stack on this machine, or only `::1`? does forcing
   IPv4 — e.g. `REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1` or an explicit
   `--port`/host override — change the outcome?) before retrying the same
   launch sequence blindly.
4. `@expo/ngrok` is now installed locally in `mobile/node_modules` (not
   tracked in `package.json`/committed) — `--tunnel` mode's ngrok
   dependency is already satisfied for a next attempt; its actual launch
   failure (separate from the ngrok-missing error already resolved) still
   needs its own log capture and diagnosis.
5. **No code, test, lint, or typecheck changes are needed to resume this** —
   the blocker is entirely environmental (this machine's Metro/adb/USB
   networking), not the Phase 7 implementation. Every other verification
   gate (tests/lint/typecheck/export) already passed cleanly against the
   exact code that would run on-device once connectivity is fixed.
6. Once on-device, the verification pass itself should cover: More tab
   badge + Notifications-row badge appearing live after triggering a real
   admin broadcast (`POST /api/notifications` via the existing web admin UI
   or a direct authenticated API call, matching Phase 3's own precedent for
   driving admin endpoints directly) while the app is foregrounded, opening
   the Notifications screen (list/loading/empty states, mark-one-read,
   mark-all-read, load-more if enough seed data exists), Android back
   navigation out of the screen, and both light and dark theme.

### Physical-device verification — Phase 7 (2026-08-22 session) — COMPLETE

**Picked up exactly where the 2026-08-21 session stopped**, per its own
"exact stopping point" notes above: `adb devices` showed the Samsung Galaxy
M36 connected and authorized (`RZCY619LM4T device`) with no stale Metro/8081
process running. No Phase 7 code, test, lint, or typecheck changes were
needed to resume — confirmed correct, per point 5 above; the eventual real
bug (below) was found only once actual realtime traffic was exercised
on-device, not by anything static analysis could have caught.

**Root cause of the 2026-08-21 "Failed to download remote update" connection
failure — confirmed, not theorized**: the IPv6-loopback-only bind theory the
previous session flagged as unverified was correct, isolated with a direct
Node repro before touching Expo again:
```
node -e "require('net').createServer().listen(0,'localhost',function(){console.log(this.address())})"
// → { address: '::1', family: 'IPv6', ... }
```
On this machine, Node/Windows resolves the bare hostname `localhost` to the
IPv6 loopback `::1` **only** — not dual-stack, not IPv4. `adb reverse`
forwards over IPv4 (`127.0.0.1`), so `expo start --android --host localhost`
was binding Metro somewhere `adb reverse`'s tunnel could never actually
reach; a real TCP handshake could still form (explaining the confusing
`readResponseHeaders` IOException the previous session saw, rather than a
clean "connection refused") because *something* was listening on `::1:8081`
and OS-level dual-stack routing partially bridged the gap before failing
mid-response. **Fix applied**: force IPv4 resolution for `localhost` via
Node's `--dns-result-order` flag, confirmed first in isolation
(`node --dns-result-order=ipv4first -e "require('dns').lookup('localhost',console.log)"`
→ `127.0.0.1`), then applied to the real dev server:
```
export NODE_OPTIONS="--dns-result-order=ipv4first"
npx expo start --android --host localhost --clear
```
(`expo start --host` only accepts the literal values `lan`/`tunnel`/
`localhost` — not an arbitrary IP — so the fix has to act on DNS resolution
order, not on the `--host` value itself.) After this, `netstat -ano` showed
Metro listening on `127.0.0.1:8081` (IPv4, not `::1`) with an
`ESTABLISHED` connection from the device's `adb reverse` tunnel, and the app
loaded a fresh JS bundle on the phone on the very next launch — no
`UpdateFailedToLoad` error, confirmed via `adb logcat` showing none of the
previous session's `okhttp3`/`dev.expo.updates` errors. **This fix is
environmental only** (a shell export before starting the dev server) — no
repo file changes were needed for it, matching the previous session's own
"the blocker is entirely environmental" diagnosis.

**Genuinely verified on the physical device, against the real backend**
(server running locally with `NOTIFICATIONS_ENABLED=true`, confirmed live —
not mocked, not assumed):
- **Login** — `teacher@example.com`/`demo1234`, resolved through the
  familiar RAMPUR01/RAMPUR02 multi-school picker (Phase 3's own
  known-not-fully-screenshotted flow; this session's picker tap also landed
  on the first option before a screenshot, same as Phase 3 — flow executes
  correctly end-to-end either way), landed on the real authenticated 5-tab
  app.
- **More-tab badge + Notifications-row badge, fetched on mount** — after a
  fresh app launch, the More tab correctly showed a live unread-count badge
  matching the real server-side count (confirmed by cross-checking
  `GET /api/notifications/unread-count` directly) — this REST-fetch path
  worked on the very first attempt, before any realtime fix was needed.
- **Notifications list screen** — loaded real seeded data (6 items:
  `assessment_ready` and `announcement` types), correct type icons per
  `NOTIFICATION_TYPE_META`, correct relative (`"18 hr ago"`) and absolute
  (`"16/8/2026"`) timestamps matching `historyTime.ts`'s thresholds, correct
  unread styling (orange dot + highlighted/outlined card) vs. read
  (unstyled). Only 6 notifications existed for this account, so the
  "Load more" footer control was **not** exercised — not enough seed data,
  consistent with the pre-existing note in this phase's own "Known
  limitations" that pagination needs enough data to trigger, not a gap
  introduced this session.
- **Realtime delivery while foregrounded — a real bug found and fixed** (see
  the dedicated writeup below): first attempt failed (broadcast sent
  server-side, confirmed via direct `GET /api/notifications` showing the row
  existed with `read: false`, but nothing appeared on-device — no badge
  change, no list update). After the fix, re-tested twice, both times live:
  the More-tab badge incremented in real time (1 → 2) with **no manual
  reload, no navigation, no app restart** — a `POST /api/notifications`
  broadcast fired from a `curl` call while the app sat idle on the Coach tab
  visibly changed the badge within ~2 seconds. Opening the Notifications
  screen afterward showed the new item at the top of the list with an
  unread dot and a `"Just now"` timestamp, exactly matching
  `mergeNewNotification`'s dedup/prepend contract.
- **Mark-one-read** — tapping an unread card cleared its unread dot/border
  and decremented the More-tab badge (2 → 1) immediately (optimistic
  update), with **no navigation away from the list** — confirming the
  "Deliberately not implemented: tap-to-navigate" design note above is
  accurate to what actually runs on-device, not just what the code intends.
- **Mark-all-read** — cleared every remaining unread card's styling in one
  tap, the "Mark all read" action itself disappeared (matching its
  hide-at-zero-unread rule), and the More-tab badge cleared. Cross-checked
  against the real server: a direct `GET /api/notifications/unread-count`
  call immediately after returned `{"count":0}`, confirming this was a real
  network write, not just local optimistic state.
- **Empty state — genuinely triggered, not just asserted in Jest**:
  registered a brand-new teacher account
  (`phase7.empty@example.com`, RAMPUR01) via the real `/auth/register`
  endpoint, approved it via the real super_admin `/admin/users/:id/approve`
  endpoint (same precedent Phase 3 established for driving admin endpoints
  directly), and signed into it fresh on-device. The Notifications screen
  showed the real empty state — bell icon + "You're all caught up" — with no
  "Mark all read" action visible (correctly hidden at zero items), not a
  screenshot of the Jest-mocked version.
- **Error state — genuinely triggered, not just asserted in Jest**: with
  that same fresh account still on-device, the backend process was killed
  outright (`taskkill`) and the Notifications screen was reloaded (back +
  reopen, exercising the real "reload on focus" path). The real inline red
  error banner rendered — `"Could not load notifications. Please try
  again."` — with no crash and no infinite spinner. The backend was
  restarted immediately afterward and `npm test`/lint/typecheck were
  re-run clean (see below) to confirm this destructive step left no residue.
- **Session persistence across a full server + app restart cycle** —
  after fixing the realtime bug and restarting both the backend and the
  Expo dev server, a fresh app relaunch restored straight back to the
  fresh test account's authenticated session with no re-login required,
  confirming Phase 3's SecureStore persistence is unaffected by anything in
  this session.
- **Android back button** — from the Notifications screen, the hardware
  back button correctly popped one level in the native stack (back to the
  More menu), not out of the app and not to a different tab — standard
  native-stack back behavior, confirmed by screenshot before/after.
- **Regression, incidental**: Login, the multi-school picker's execute-path,
  session restore, and the More screen's identity card/role-gating (no
  Admin item for `teacher`) all still work exactly as Phase 3 documented —
  nothing in this session's changes touched that code path.
- **Not independently re-checked this session**: light theme specifically
  (the phone's system theme was dark throughout, same gap already logged
  and accepted at Phase 2/3) — not a new gap, carried forward unchanged.

**A real, reproducible realtime-delivery bug was found and fixed by this
device pass — not by any of the 221 existing automated tests**, because
Jest's `socket.io-client` is fully mocked in every existing test (see this
phase's own "Files modified" note on `jest.setup.ts`'s default no-op mock) —
there was no way for the test suite to catch a transport-layer failure that
only exists in a real React Native runtime talking to a real server.

**Symptom**: a real admin broadcast (`POST /api/notifications`, confirmed
server-side via `{"success":true,"recipientCount":5}` and independently via
`GET /api/notifications` showing the new row with `read: false`) never
reached the app while it was foregrounded and already signed in — no badge
change, no list update, nothing. This is a correctness failure of the
feature's actual selling point ("realtime bell updates via Socket.IO, while
the app is foregrounded" — this phase's own stated scope).

**Diagnosis**: temporarily instrumented `server/src/lib/socketServer.js`
with `console.log` calls on the handshake-auth middleware and on
`io.on('connection', ...)` (a temporary debugging change, reverted
afterward — confirmed via `git diff --stat server/src/lib/socketServer.js`
showing no diff once verification was complete, preserving this phase's
"zero backend changes" design). Force-stopping and relaunching the app
produced **zero** log output — not an auth failure, not a rejected
handshake, nothing — meaning the device's `socket.io-client` was never even
reaching the server's Socket.IO endpoint, despite plain REST calls to the
exact same `http://localhost:3000` (via the same `adb reverse tcp:3000`
tunnel) working correctly in the same session (login, list, unread-count all
succeeded). This narrowed the bug to the socket handshake transport
specifically, not general connectivity, auth, or server-side room/broadcast
logic (which a code read of `notificationService.js`'s `createBroadcast()`
→ `emitToUser()` → `io.to('user:<id>').emit(...)` already showed was
correct).

**Root cause**: `mobile/src/lib/socket.ts` called `io(SOCKET_BASE, {...})`
with Engine.IO's default transport order (`polling` first, upgrading to
`websocket`) — the same configuration the web client
(`client/src/lib/socket.ts`) uses correctly in a browser. React Native's
`XMLHttpRequest` polyfill does not fully implement what Engine.IO's polling
transport needs; the polling handshake request silently never completes and
never surfaces a JS-level error (no `connect_error` event fires), so the
socket connection attempt never reaches the server at all — exactly matching
the zero-log-output symptom above. This is a known category of React
Native + Engine.IO/Socket.IO incompatibility (polling transport requires
full XHR behavior a RN polyfill doesn't provide); it is unrelated to this
app's own server code, which needed no changes.

**Fix**: `mobile/src/lib/socket.ts` — added `transports: ['websocket']` to
the `io()` call, skipping the polling transport entirely (mobile-only
deviation from the web client, documented in the file's own comment).
```ts
return io(SOCKET_BASE, {
  path: '/socket.io',
  auth: (cb) => { getToken().then((token) => cb({ token })); },
  transports: ['websocket'],
  reconnection: true,
});
```

**Verified fixed, twice, on-device**: after the fix, a fresh app relaunch
produced the expected `[TEMP-DEBUG] socket connected { userId: '...' }`
server log (with the debug instrumentation still in place for this one
confirmation pass, then reverted) matching the real signed-in teacher's
user id, and two independent live broadcasts both updated the on-device
badge within ~2 seconds with no manual reload — see the verified-flows list
above.

**Post-fix regression check, per the instruction to rerun relevant tests
after any real bug fix**:
- `npm test` (mobile) — **221/221 passing, 27/27 suites**, unchanged from
  before this fix (the existing tests mock `socket.io-client` entirely, so
  they neither caught this bug nor are affected by fixing it — expected, not
  a false-clean signal, given the diagnosis above).
- `npm run lint` (`expo lint`) — clean.
- `npm run typecheck` (`tsc --noEmit`) — clean.
- `server/src/lib/socketServer.js` — confirmed zero diff after reverting the
  temporary debug logging (`git diff --stat`), preserving this phase's
  "zero backend changes" design intact.

**Known limitation this fix does not address**: `reconnection: true` is
still set, and Engine.IO's default reconnection behavior will itself retry
with polling-then-upgrade unless every transport in the list is
WebSocket-only on every attempt — since `transports: ['websocket']` applies
to all (re)connection attempts, not just the first, this is not a partial
fix; but a WebSocket-only strategy means a `NAT`/proxy environment that
blocks WebSocket entirely (unlikely for this app's deployment target, not
observed in this session) would leave a device with no realtime path at
all, silently degrading to "badge only updates via the REST fetch on next
app open" rather than erroring visibly. Not observed as a problem in this
session; worth keeping in mind if a future bug report describes stale
badges on a specific network.

---

## 1. Executive Summary

Teacher Assistant is a Node/Express + Prisma/SQLite backend (`server/`)
behind a React 18 + TypeScript + Vite **PWA** (`client/`), already deployed
(Vercel for the client, Railway for the server — see §20). It serves Indian
government-school teachers: an AI coaching chat ("Coach"), a saved-answer
library, a quiz/worksheet generator, an admin dashboard, and — newest and
still mid-rollout — a **Classroom Management** workspace (My Classes /
Students / Attendance / Fees / Reports).

The client is already responsive and already an installable PWA
(`client/vite.config.ts` — `vite-plugin-pwa`, manifest, service worker). That
is precisely why a plain WebView wrapper is not worth building: a teacher can
already "install" today's site to a home screen. What doesn't exist is a
**native** experience — offline resilience for the highest-frequency daily
action (attendance), OS-level push notifications, secure native credential
storage, native share/print, and navigation built for one-thumb phone use
instead of a desktop sidebar squeezed into a phone width.

**Recommendation: React Native + Expo**, as a new sibling app
(`mobile/` at the repo root, alongside existing `client/` and `server/`),
reusing the existing Express/Prisma backend and its JWT + rotating
refresh-token auth **unchanged**. Full comparison and rationale in §5–§7.

The backend needs a small, additive set of changes to fully serve a native
client — a device-push-token endpoint and an Expo/FCM/APNs push dispatch
hook being the only genuinely new backend surface (§17, §21). Every other
feature the mobile app needs (classes, students, attendance, fees, coach,
library, generator, notifications-in-app, auth) already has a working,
tenant-isolated, tested REST API that the mobile app can call as-is.

---

## 2. Current Architecture (verified)

Two deployable parts, confirmed in `README.md` and by inspecting both trees:

- **`client/`** — Vite 5 + React 18.3 + TypeScript 5.5 PWA. No server-side
  rendering. `react-router-dom` v6 for routing. Plain CSS with custom
  properties (`client/src/index.css`) — **no Tailwind, no component
  library** (no `tailwind.config.*`, no `postcss.config.*` found anywhere in
  the repo). Icons via `lucide-react`. Charts via `recharts`. Realtime via
  `socket.io-client`. Google sign-in via `@react-oauth/google` (web-only
  package). PWA plugin: `vite-plugin-pwa` with `registerType: 'autoUpdate'`
  and a `NetworkOnly` runtime-caching rule for `/api/*` (`client/vite.config.ts:24-32`)
  — API calls are **never** cached, only the app shell is.
- **`server/`** — Express 4.19 (CommonJS, not ESM — `"type": "commonjs"` in
  `server/package.json`), Prisma 6.19 ORM, **SQLite** datasource
  (`server/prisma/schema.prisma:9-10`: `provider = "sqlite"`, with a comment
  that Postgres migration is a later, deliberate step — see
  `docs/postgres-migration-plan.md`; this is unrelated to and unblocked by
  mobile work). Validation via `zod`. Auth via `jsonwebtoken` + `bcryptjs`.
  Realtime via `socket.io`. Google ID-token verification via
  `google-auth-library`. Security headers via `helmet`. Rate limiting via
  `express-rate-limit`, keyed by IP (one hop of `trust proxy`, tuned for
  Railway — `server/src/index.js:353-362`).

Every feature ships behind an explicit **kill-switch env var** read live
from `process.env` (never cached at boot for the gate itself), documented
exhaustively in `server/.env.example`. This same pattern is proposed below
for mobile-specific rollout (§21, §26).

### Deployment (verified)

- `client/vercel.json` — SPA rewrite (`"/(.*)" → "/index.html"`); client is a
  Vercel static/SPA deployment.
- `server/src/index.js:353-362` and `server/src/lib/socketServer.js:9-12`
  explicitly reference **Railway** ("this app runs a single Railway instance
  today"), and note the Socket.IO connected-user map is in-process, in-memory
  — it will **not** survive multiple server instances without a shared store
  (Redis adapter) — a fact relevant to push/realtime at scale (§17, §28).
- No `Dockerfile` anywhere in the repo (checked root and `server/`) —
  deployment is PaaS-native (Railway build from source), not containerized.
  `UNKNOWN — VERIFY DURING IMPLEMENTATION`: exact Railway build/start command
  configuration (not committed to the repo; likely set in the Railway
  dashboard).
- CI: `.github/workflows/ci.yml` — three jobs: a gitleaks secret scan, a
  server job (`npm ci && npx prisma generate && npm run lint && npm test`,
  Node 20), and a client job (`npm ci && npm run lint && npm test && npm run
  build`, Node 20). No mobile job exists yet (§24, §25).

### Design system baseline (verified — see §22 for the mobile translation)

`client/src/index.css:1-33` defines the whole palette as CSS custom
properties: brand orange `#ff6b35` → amber `#f7931e` gradient
(`.btn-primary`), light theme (`--bg:#f5f6f8`, `--surface:#fff`,
`--text:#1f2430`), dark theme via `[data-theme='dark']` attribute override
(`--bg:#12151c`, `--surface:#1b1f29`, `--text:#e8eaef`). Theme is decided
pre-paint by an inline script in `client/index.html:10-19` reading
`localStorage.theme`, falling back to `prefers-color-scheme`. Radius tokens
(`--radius:14px`, `--radius-sm:10px`), a documented `--bottomnav-h:58px`
token, and a `--chat-max-width:720px` reading-width token. Font stack:
`'Segoe UI', system-ui, -apple-system, 'Noto Sans', sans-serif` — no custom
web font is loaded.

---

## 3. Current Feature Inventory (verified)

Routes confirmed from `client/src/App.tsx:65-114`:

| Route | Page component | Gate |
|---|---|---|
| `/` | `CoachPage` | none (default landing) |
| `/library`, `/library/:id`, `/library/:id/edit` | `LibraryPage`, `ResourceView`, `ResourceWorkspace` | none |
| `/classroom` | `ClassroomPage` | none (own routes 503 server-side if `CLASSROOM_MANAGEMENT_ENABLED` is off) |
| `/generator` | `GeneratorPage` | none |
| `/settings` | `SettingsPage` | none |
| `/admin`, `/admin/manage` | `AdminPage`, `ManagePage` | `ADMIN_ROLES` (`school_admin`, `resource_person`, `super_admin`) |
| `/admin/support`, `/admin/support/:id` | `AdminSupportPage`, `AdminSupportTicketPage` | `super_admin` only |
| `/admin/settings` | `AdminSettingsPage` | `super_admin` only |
| `/admin/notifications` | `AdminNotificationsPage` | `ADMIN_ROLES` |
| `/login`, `/forgot-password`, `/reset-password/:token` | signed-out only | — |

Bottom nav for mobile web (`client/src/components/BottomNav.tsx:16-23`) is
**already** a 4-item tab bar: Coach, Library, Classroom (flag-gated), Generator
— it hides at desktop widths in favor of the top bar's link row
(`client/src/components/TopBar.tsx:76-121`). Notifications, Settings, Admin,
and Profile are **not** in the mobile bottom nav today — they live in the
top bar's notification bell and profile menu, both of which stay visible on
mobile. This gap (no "More" surface on the phone-width web experience) is a
useful, verified precedent: it means the *native* app's navigation (§10)
should not simply copy `BottomNav.tsx` — the web team itself has not yet
solved where Settings/Admin/Notifications go on a phone.

### Classification: Already implemented / Reusable / Must rewrite / Missing

- **Already implemented, backend fully reusable as-is (no server change needed):**
  Auth (register/login/Google/refresh/logout/sessions/password reset),
  Coach (AI chat), Library (saved resources CRUD), Generator (quiz/worksheet
  generation), Classroom (classes/students/attendance/fees/analytics CRUD),
  Notifications REST (list/unread-count/mark-read), Admin analytics/user
  management, Help & Support tickets.
- **Reusable with modification (server):** Notifications need one new
  addition — device push tokens + a dispatch hook (§17) — everything else
  about the notification backend is untouched.
- **Must be rewritten for mobile (client):** every React DOM component,
  all CSS, the desktop-sidebar-squeezed-into-mobile Classroom layout
  (`ClassroomPage.tsx` toggles a `mobile-hidden` CSS class rather than using
  distinct native screens — see §12), `window.print()`-based export
  (`ResourceWorkspace.tsx:192`), Web Speech API voice/TTS
  (`client/src/hooks/useVoiceInput.ts`, `client/src/lib/tts.ts`),
  `localStorage`-based token storage (`client/src/api.ts:10-27`), Google
  Sign-In widget (`@react-oauth/google` is web-only).
- **Missing, needs new implementation:** native push notifications
  (device-token registration + dispatch — §17), native secure token storage,
  offline attendance queueing (§18, recommended for V1.1, not V1 — see
  below), native file/CSV share flow (§19), a Reports/Analytics **UI**
  (backend already exists at `GET /api/classroom/analytics/*` but the web
  client's own Reports tab is still a "coming soon" placeholder —
  `ClassroomPage.tsx:22-37,190` — so mobile has no existing UI to even
  reference here; this is a genuine net-new screen for both platforms).
- **Optional/future:** iOS build (Android-first is recommended — §7, §26),
  Postgres migration (unrelated, tracked separately in
  `docs/postgres-migration-plan.md`, not a mobile blocker), a `packages/shared`
  monorepo extraction (recommended against for V1 — §9).

---

## 4. Actual Repository Findings — Detail

### 4.1 Authentication (verified in full)

`server/src/middleware/auth.js` + `server/src/routes/auth.js`:

- **Access token**: short-lived JWT, `ACCESS_TOKEN_TTL` env var, default
  `15m` (`server/.env.example`). Signed with `HS256` (jsonwebtoken default)
  using `JWT_SECRET`. Payload: `{ sub: user.id, role, schoolId, name }`
  (`auth.js:23-29` in `middleware/auth.js`). Sent as `Authorization: Bearer
  <token>` — **no cookies anywhere in this app's auth model.**
- **Refresh token**: opaque, cryptographically random
  (`crypto.randomBytes(32).toString('base64url')`), **never stored raw** —
  only its SHA-256 hash, in the `Session` table
  (`schema.prisma` `Session` model). Default TTL 7 days
  (`REFRESH_TOKEN_TTL_DAYS`). Rotated on every `/auth/refresh` call; the old
  session row is marked `revokedAt` + `replacedBy` (reuse-detection: a
  revoked token being presented again revokes every session for that user —
  `routes/auth.js:565-571`).
- **Login lockout**: 5 failed attempts (`LOGIN_MAX_ATTEMPTS`) locks the
  account for 15 minutes (`LOGIN_LOCKOUT_MINUTES`).
- **Google Sign-In**: `POST /api/auth/google` — one endpoint for both
  sign-up (`schoolCode` present) and sign-in, verified against
  `GOOGLE_CLIENT_ID` server-side (`server/src/lib/googleAuth.js`). Identity
  is Google's `sub` claim, **never** the email, so a Google token can never
  take over a password account (`routes/auth.js:326-332`). The web client
  uses `@react-oauth/google`, a **web-only** package built on Google
  Identity Services JS SDK — it does not run in React Native. See §16 for
  the native equivalent.
- **Multi-school-per-email**: sign-in resolves by email (or `googleSub`)
  across every school; if more than one account matches, the server returns
  `{ needsSchoolSelection: true, schools: [...] }` and the client resubmits
  with an explicit `schoolId` (`routes/auth.js:256-261, 401-406`). Mobile
  must implement the identical two-step picker flow.
- **Approval gate**: every new signup (password or Google) starts
  `status: 'pending'`; sign-in 403s with a stable code (`pending_approval` /
  `registration_rejected`) until a `school_admin`/`super_admin` approves
  (`routes/auth.js:159-163, 295-296`).
- **Password reset**: `/auth/forgot-password` → `/auth/reset-password`,
  single-use hashed token, transactional email via Brevo
  (`server/src/lib/email.js`, `BREVO_API_KEY`). Byte-identical response
  whether or not the address exists (`routes/auth.js:436-441`) — no user
  enumeration.
- **Session management UI hook already exists**: `GET /api/auth/sessions`
  and `DELETE /api/auth/sessions/:id` return/revoke the caller's own active
  sessions, including `userAgent` (`routes/auth.js:612-632`). This is a
  ready-made "Manage devices" / "Sign out of other sessions" screen for
  mobile Settings — no backend work needed, just a native UI for data that
  already exists (and mobile logins will show up in this same list, since
  they use the identical `/auth/login`+`/auth/google`+`/auth/refresh` flow).

**Client-side (verified, must be rewritten)**: `client/src/api.ts:7-27`
stores both tokens as **plain `localStorage`** string values
(`auth_token`, `refresh_token`), attaches `Authorization: Bearer <token>` on
every request (`api.ts:57`), and silently retries once through
`/auth/refresh` on a `401` (`api.ts:87-123`), de-duping concurrent refresh
attempts with a shared in-flight promise. `client/src/auth.tsx` layers a
React context on top, plus a cross-tab `storage`-event listener so signing
out in one browser tab reflects in another (`auth.tsx:117-136`) — that
cross-tab concern is web-only and has no mobile analogue.

**Mobile auth design (§16 has the full plan)**: reuse every server route
unchanged. Replace `localStorage` with OS-backed secure storage
(`expo-secure-store`, which wraps iOS Keychain / Android Keystore) — a
strict *upgrade* over the web app's own storage, not a downgrade. Keep the
identical bearer-token attach + silent-refresh-on-401 pattern; it is
transport-agnostic and `fetch` behaves the same in React Native.

### 4.2 API Map (verified — every route enumerated from source, not invented)

All paths are relative to `API_BASE` (`client/src/config.ts:283`, defaults
to `http://localhost:3000/api` in dev, set via `VITE_API_BASE` at build
time). Server mounts confirmed in `server/src/index.js:616-1025`.

**Auth** (`server/src/routes/auth.js`, mounted `/api/auth`, behind `authLimiter`):
| Method & path | Purpose | Mobile reuse |
|---|---|---|
| `POST /register` | Email+password signup (pending) | As-is |
| `POST /login` | Email+password sign-in (may return school picker) | As-is |
| `POST /google` | Google sign-up/sign-in via ID token | As-is; **client** needs a native Google Sign-In flow (§16) |
| `POST /forgot-password`, `POST /reset-password` | Self-service reset | As-is (reset link opens in a mobile browser / deep link — see §16 open question) |
| `POST /refresh` | Rotate access+refresh | As-is |
| `POST /logout` | Revoke one session | As-is |
| `GET/DELETE /sessions[/:id]` | List/revoke own sessions | As-is — ready-made "Manage devices" screen |
| `GET/PATCH /me` | Profile + preferences | As-is |
| `PATCH /me/password` | Change password | As-is |

**Classroom** (`server/src/routes/classroom.js`, mounted at bare `/api`
because the router's own paths self-prefix with `/classroom/...` —
`server/src/index.js:1015-1025`; gated by `CLASSROOM_MANAGEMENT_ENABLED` +
per-teacher isolation, never per-school — see §4.3):
| Method & path | Purpose | Mobile reuse |
|---|---|---|
| `GET/POST /classroom/classes` | List / create classes | As-is |
| `GET/PATCH/DELETE /classroom/classes/:classId` | Get / rename+archive-toggle / soft-delete (archive) | As-is |
| `GET/POST /classroom/classes/:classId/students` | List / add students | As-is |
| `PATCH/DELETE /classroom/students/:studentId` | Edit / soft-delete (deactivate) student | As-is |
| `GET /classroom/classes/:classId/attendance?date=` | One day's roster + 3-state marks | As-is |
| `POST /classroom/classes/:classId/attendance` | Bulk upsert one day's marks (whole-batch-or-nothing ownership check) | As-is |
| `GET /classroom/classes/:classId/attendance/summary?month=` | Per-student + class month totals | As-is |
| `GET /classroom/classes/:classId/attendance/history?month=` | Day-by-day class breakdown | As-is |
| `GET /classroom/classes/:classId/attendance/export?month=` | CSV download | As-is — mobile needs a native share/save wrapper (§19), not a new endpoint |
| `GET /classroom/students/:studentId/attendance/history?month=` | One student's day-by-day + totals | As-is |
| `GET /classroom/classes/:classId/fees?period=` | Paid/Pending board for a month | As-is |
| `PATCH /classroom/students/:studentId/fees/:period` | Toggle one student's fee status | As-is |
| `GET /classroom/classes/:classId/fees/export?period=` | CSV download | As-is (same native-share wrapper) |
| `GET /classroom/analytics/overview` | Cross-class totals (today + month attendance, fee counts) | As-is — **no web UI consumes this yet**; first UI for it can be mobile's own Reports/Dashboard screen |
| `GET /classroom/analytics/classes/:classId` | Per-class totals | As-is, same "no web UI yet" note |

**Notifications** (`server/src/routes/notifications.js`, mounted `/api`,
gated by `NOTIFICATIONS_ENABLED`):
| Method & path | Purpose | Mobile reuse |
|---|---|---|
| `GET /notifications` | Paginated list (caller's own) | As-is |
| `GET /notifications/unread-count` | Badge count | As-is |
| `PATCH /notifications/read-all`, `PATCH /notifications/:id/read` | Mark read | As-is |
| `POST /notifications` | Admin broadcast send | As-is (admin roles only; unlikely to be a mobile-first flow, but no reason to block it) |
| **Missing** | Device push-token register/unregister | **New** — §17 |

**Coach** (`POST /api/coach`, `server/src/index.js:638-939`, behind
`authRequired` + `limiter`, not a sub-router): single-shot JSON request/
response (not streaming — server builds the full answer, including any
Classroom-Mode-generated artifacts, before responding). Reusable as-is;
mobile Coach screen is a straightforward chat UI over one POST call. Also
note `POST /api/coach/attachment` (image/PDF upload, gated by
`ATTACHMENTS_ENABLED`, `server/src/routes/attachments.js`) and `POST
/api/coach/learning-representation` (structured-visual companion to an
answer, gated by `LEARNING_REPRESENTATION_ENABLED`,
`server/src/routes/learningRepresentation.js`) — both reusable as-is via
`multipart/form-data` (attachments) or JSON (learning representation);
neither needs a backend change for mobile.

**Library / Generator** (`server/src/routes/resources.js`, mounted `/api`):
`GET/POST /resources`, `GET/PATCH/DELETE /resources/:id`,
`POST /resources/:id/ai-action`, `POST /resources/generate`,
`POST /resources/generate-set`, `POST /resources/generate-lesson-plan` — all
reusable as-is. The one web-specific behavior to replace is
`ResourceWorkspace.tsx:192`'s `window.print()` for the exam-paper PDF layout
— see §19.

**Dashboard/Reports (cross-cutting, admin)**: `server/src/routes/admin.js`
(`/api/admin/*`) — analytics, schools, users, approvals, role changes,
session revocation. Role-gated (`ADMIN_ROLES`/`super_admin`); reusable as-is
if/when an admin-facing mobile surface is prioritized (not in the V1 phase
plan below — see §26 Phase 11 note).

**Everything above was read from the actual route files; nothing in this
map is invented.** The only genuinely missing endpoint for a complete mobile
feature set is the push-token pair in §17.

**Flagged-route response contract the mobile client must handle** (verified
in `server/src/routes/classroom.js` and `server/src/routes/notifications.js`):
every feature-gated route is protected by a small per-route `gate` array
(`const gate = [authRequired, requireClassroomManagementEnabled()]`, spread
as `...gate` into each individual route — `classroom.js:101` and the
identical pattern in `notifications.js`), not a router-wide `router.use()`.
This was in fact the exact bug fixed in commit `4916641` ("fix: scope
classroom feature gate to classroom routes") — an earlier router-wide gate
was intercepting unrelated `/api/*` paths that happened to fall through to
the same router and 503'ing them instead of letting Express's normal 404
apply. The practical consequence for the mobile client: a disabled feature
flag always returns `503 { error, code: '<FEATURE>_DISABLED' }` on that
feature's own routes, and a genuinely nonexistent path always 404s — never
the reverse. The mobile API layer's error handling (`ApiError`, ported from
`client/src/api.ts`, §9) should treat a `503` with a `*_DISABLED` code as an
expected "this feature is currently turned off for your school" state (show
a calm empty-state, not a crash/retry loop), distinct from a real 5xx server
error.

### 4.3 Classroom Management — ownership & the attendance/fee math (verified)

`server/src/routes/classroom.js` — the whole router's scope, stated at the
top of the file (lines 1–18): **every route filters strictly on `teacherId:
req.user.id`, never `schoolId`, never the request body.** Two teachers at
the same school are as isolated from each other as two teachers at
different schools; there is no cross-teacher visibility in V1. A lookup
that doesn't match the caller **404s, never 403s** (`findOwnedClass`/
`findOwnedStudent`, lines 108–118) — existence is never leaked across
teachers. Pinned by `server/test/classroom-tenant-isolation.test.js`. Mobile
inherits this automatically — it is enforced server-side from the JWT's
`sub`, with no client-supplied teacher/school id anywhere in the classroom
API surface.

**Attendance formula — the one implementation, never to be duplicated on
mobile except as an instant-feedback preview:**

```js
// server/src/lib/classroomAttendance.js:23-27
function attendancePercentage(present, absent) {
  const marked = present + absent;
  if (marked === 0) return null;           // never present/0 = 0%
  return Math.round((present / marked) * 1000) / 10; // 1 decimal place
}
// deriveUnmarked (line 39-41): rosterSize - present - absent, clamped at 0
```

"Unmarked" is **never** a stored status — a student with no
`AttendanceRecord` row for a date *is* unmarked for that date
(`schema.prisma` comment on `AttendanceRecord`). Every other view (day
roster, month summary, month history, CSV export, per-student history,
teacher-wide analytics) calls this **same** function
(`computeClassAttendanceMonthSummary`, `getClassAttendanceHistory`, etc., all
in the same file) so the number can never drift between screens. The web
client duplicates only the percentage formula, verbatim, purely for instant
optimistic UI feedback before a save round-trip
(`client/src/components/classroom/AttendanceDaily.tsx:17-21`, comment:
"the number that is actually persisted always comes back from the server on
reload"). **Mobile should follow the identical pattern**: one local copy of
the same two-line formula for optimistic UI, and the server's own response
as the only source of truth after every save — never a second, independent
implementation of the aggregation logic.

**Fee status — V1 is deliberately Paid/Pending only**, one row per student
per calendar-month `period` string (`"2026-08"`, not a `DateTime` —
`schema.prisma` `FeeRecord` comment explains why: a fee period has no
day/time component). `amount`, `paidAt`, `note` columns exist on the model
but are **reserved, unused, and rejected by the API's `.strict()` Zod schema**
(`routes/classroom.js:497`) — do not build a mobile UI that implies amounts
or due dates exist; V1's fee UX is a single Paid/Pending toggle per student,
matching `FeeStatusBoard.tsx` exactly. No bulk-fee endpoint exists (unlike
attendance's day-batch upsert) — each toggle is one `PATCH`, applied
optimistically client-side and reverted on failure
(`FeeStatusBoard.tsx:43-65`); mobile should mirror this exact
optimistic-toggle-then-revert pattern.

### 4.4 Notifications & Socket.IO (verified in full)

`server/src/lib/notificationService.js` is the **single choke point** for
creating a `Notification` row (comment, lines 1–7): `createNotification`
(one recipient) and `createBroadcast` (many, via `createMany`), both
best-effort emitting `notification:new` over the recipient's live socket if
connected. **Verified by grep**: today, only `routes/notifications.js`'s
`POST /notifications` (admin broadcast) actually calls `createBroadcast`.
The single-recipient `createNotification` function is exported but **no
current call site invokes it** — meaning the `lesson_generated` /
`assessment_ready` / `report_ready` notification types declared in
`server/src/lib/notificationTypes.js` / `client/src/config.ts:392-399` are
vocabulary that exists for a future system-triggered notification (e.g. "your
worksheet is ready") that has not been wired to any actual event yet. This
matters for mobile push: **there is currently exactly one live trigger path**
(an admin's manual broadcast) to design a push-dispatch hook against; any
other "notify a teacher automatically" feature is a separate, not-yet-built
piece of product, not a mobile gap.

Socket.IO server (`server/src/lib/socketServer.js`): path `/socket.io`, one
room per user (`user:<id>`), handshake auth via `socket.handshake.auth.token`
(the same short-lived **access** JWT, verified with the identical `decode()`
used by REST — line 51), gated live by `NOTIFICATIONS_ENABLED`
(`isEnabled()` called fresh per handshake, line 47). **In-memory only, single
process** (module comment, lines 6–12): "there is no Redis pub/sub here
because this app runs a single Railway instance today; revisit BEFORE
scaling to multiple instances, not after." `socket.io-client` (the exact
same npm package the web client already uses,
`client/src/lib/socket.ts`) works unmodified inside React Native/Expo — this
is a genuine reuse win React Native has over Flutter (which would need a
different, less mature Dart Socket.IO client) or over a rewrite.

**Important limitation for mobile, not present on web**: a live Socket.IO
connection only delivers realtime events while the app process is running
and the socket is connected — normal on a desktop browser tab, **not**
reliable on a phone once the app is backgrounded or the OS suspends its
network activity (especially iOS). Socket.IO is the right transport for
*in-app* realtime (bell badge updates while the teacher is using the app)
but is **not** a substitute for OS-level push notifications when the app is
closed or backgrounded. That gap is what §17 designs for.

### 4.5 Frontend architecture detail (verified)

- **Routing**: `react-router-dom` v6, `BrowserRouter`, all routes declared in
  `App.tsx` (table in §3). No route-based code splitting observed (no
  `React.lazy` in `App.tsx`) — `UNKNOWN — VERIFY DURING IMPLEMENTATION`
  whether any page-level lazy loading exists elsewhere; not required either
  way for the mobile plan (React Navigation has its own screen-mounting
  model, unrelated to `react-router`).
- **State management**: no Redux/Zustand/MobX — plain React Context +
  `useState`/`useEffect` per feature (`AuthProvider`, `NotificationProvider`,
  `ToastProvider`, `OnboardingProvider`, `HelpSupportProvider`, all composed
  in `App.tsx:139-157`). Nothing here is web-specific in *shape*; the same
  Context pattern works identically in React Native.
- **API client layer**: one file, `client/src/api.ts` (generic `api<T>()`
  wrapper) plus one thin typed-wrapper file per feature —
  `client/src/lib/classroomApi.ts`, `client/src/lib/notifications.ts`,
  `client/src/lib/resources.ts`, `client/src/lib/admin.ts`,
  `client/src/lib/support.ts`, `client/src/assistant/api.ts`. These
  typed-wrapper files contain **zero DOM/browser APIs** — they are pure
  `fetch`-via-`api()` functions returning typed data. This is the strongest,
  most concrete reuse candidate in the whole client (§9).
- **Types**: `client/src/types.ts` (613 lines) — `User`, `School`,
  `SchoolClass`, `Student`, `AttendanceStatus`/`DailyAttendance`/
  `ClassAttendanceMonthSummary`/`StudentAttendanceHistory`,
  `FeeStatus`/`ClassFeeStatus`/`FeeRecordDto`, `AppNotification`,
  `FeatureFlags`, `AdminFeatureFlag`, resource/generator types, assistant
  types. Pure TypeScript interfaces, zero JSX/DOM dependency — directly
  copyable (or shareable, see §9) into the mobile project unmodified.
- **Design tokens**: no design-token JSON/theme file exists separately from
  the CSS — the palette lives only as CSS custom properties
  (`index.css:1-33`). Mobile will need to **re-declare** these as a TS theme
  object (§22) since there is nothing today to import directly.
- **Browser-only APIs in use** (grepped across `client/src`): `localStorage`
  (`api.ts` tokens, `client/src/hooks/usePreferences.ts` theme/font,
  `client/src/lib/authStorageSync.ts`), `window.print()`
  (`ResourceWorkspace.tsx:192`, exam-paper PDF layout), `SpeechRecognition`/
  `speechSynthesis` (`useVoiceInput.ts`, `lib/tts.ts` — Web Speech API, no
  React Native equivalent; needs `expo-speech` / a native STT package),
  `@react-oauth/google` (Google Identity Services JS widget, web-only).
  **No** `<a download>`/`Blob` file-save pattern was found in the classroom
  CSV export flow — the client requests the CSV URL and the browser handles
  the `Content-Disposition: attachment` header natively; on mobile this
  needs an explicit download-then-share step (§19).
- **Testing**: `client/vitest.config.ts` + `jsdom` — logic-only unit tests
  today (CI comment, `.github/workflows/ci.yml:108-111`: "Pure-logic tests
  only… Deliberately no component rendering"). No React Testing
  Library / component-render tests exist in the client suite today.
  `UNKNOWN — VERIFY DURING IMPLEMENTATION`: whether `@playwright/test` (a
  **server** devDependency, not a client one — `server/package.json`) is
  wired to any actual e2e suite; it is not referenced in `ci.yml`, so it may
  be a manual/local-only tool. Grep `server/` for a `playwright.config.*` or
  a `*.spec.ts` under an e2e directory before relying on it.

---

## 5. Recommended Mobile Technology

## **React Native + Expo (managed workflow with a custom dev client).**

## 6. Technology Comparison

Evaluated against this specific codebase's actual characteristics, not
generic pros/cons.

| Criterion | React Native + Expo | React Native CLI (bare) | Flutter | PWA (already shipped) | Capacitor/Ionic |
|---|---|---|---|---|---|
| Reuses existing TS types (`types.ts`) | ✅ direct copy/share | ✅ same | ❌ full rewrite in Dart | ✅ (it IS the web app) | ✅ (wraps the web app) |
| Reuses API client layer (`lib/*Api.ts`) | ✅ near-verbatim (`fetch`-based) | ✅ same | ❌ rewrite in Dart | ✅ | ✅ |
| Reuses `socket.io-client` | ✅ same npm package, works unmodified in RN | ✅ same | ⚠️ separate, less mature Dart client | ✅ | ✅ |
| Satisfies "NOT a WebView" requirement | ✅ genuinely native UI | ✅ | ✅ | ❌ this is what already exists | ❌ Capacitor's entire model **is** a WebView around the web bundle |
| Claude Code implementation quality | ✅ huge TSX/React training surface, same team already writes this stack | ✅ same | ⚠️ far less Dart/Flutter depth in this project's own history | N/A (already built) | ✅ but disqualified above |
| Native push (FCM/APNs) | ✅ `expo-notifications`, or bare RN + native SDKs | ✅ native SDKs directly | ✅ `firebase_messaging` | ⚠️ Web Push only, unreliable on iOS Safari-based PWAs | ✅ (still a WebView shell) |
| Secure token storage | ✅ `expo-secure-store` (Keychain/Keystore) | ✅ `react-native-keychain` | ✅ `flutter_secure_storage` | ❌ `localStorage` only | ⚠️ typically still `localStorage` inside the WebView unless a native bridge is added |
| Android build without Android Studio | ✅ EAS Build (cloud) | ❌ needs local Android SDK/Gradle | ❌ needs local Android SDK | N/A | ⚠️ still needs Capacitor's native project + Android Studio |
| iOS build without a Mac | ✅ EAS Build (cloud, no local Xcode needed for CI) | ❌ needs Xcode locally for most workflows | ❌ needs Xcode locally | N/A | ❌ needs Xcode locally |
| OTA updates without app-store review | ✅ `EAS Update` for JS/asset changes | ⚠️ possible via CodePush but more setup | ⚠️ possible via Shorebird but 3rd-party | ✅ (it's a website) | ⚠️ possible but bespoke |
| Dev velocity for a small/solo team | ✅ fastest — Expo Go / dev client, hot reload, managed config | ⚠️ slower — native project maintenance | ⚠️ slower — new language + tooling | ✅ fastest (already exists) | ⚠️ medium |
| Team's existing skillset (React+TS) | ✅ direct transfer | ✅ direct transfer | ❌ new language | ✅ | ✅ (React/Vue/Angular options) but disqualified above |

**Why not Flutter**: technically excellent, but it means abandoning every
piece of TypeScript reuse in §9 (types, API clients, formula ports,
constants) and asking Claude Code to write and maintain a second business
logic layer in Dart with none of this repo's existing test coverage to lean
on. Nothing in this codebase's stack, team history, or CI pushes toward
Flutter; it would be reuse-negative for zero corresponding capability gain
over React Native.

**Why not Capacitor/Ionic**: it is explicitly ruled out by the prompt's own
requirement ("should NOT simply be a WebView of the website") — Capacitor's
entire architecture is a native shell hosting the existing web bundle in a
WebView. The team already has that: it's called the PWA, and it already
works today. Shipping Capacitor would not be "a proper mobile app," it would
be re-packaging the same WebView the PWA already provides, with extra build
complexity and none of the "mobile-specific navigation, layouts,
interactions" the ask requires.

**Why not plain PWA (status quo)**: already shipped, already reusable, and
explicitly insufficient per the stated requirement. Its two hard ceilings
are (1) no reliable OS-level push when the app isn't open (Web Push on iOS
Safari-based PWAs is limited and was only recently, partially enabled — do
not depend on it for a "your worksheet is ready" style notification) and (2)
`localStorage` token storage has no OS-backed encryption. The PWA is not
being deprecated by this plan — it stays exactly as-is for anyone who wants
a browser experience — the native app is additive.

**Why not React Native CLI (bare)** over Expo: bare RN buys nothing this
project needs today (there is no native module Expo's SDK/config plugins
can't cover — secure storage, push, Google Sign-In, file sharing, camera/
file picker for attachments, are all first-class Expo modules) while costing
local Android Studio/Xcode project maintenance the team does not currently
have set up for anything. Expo's **prebuild** / **dev client** model means
"eject" is never an irreversible decision — a genuinely custom native module
can be added later via a config plugin without abandoning Expo's tooling.

---

## 7. Why React Native + Expo Is Best For *This* Repository

1. **The backend is already a clean, versionless-cookie, bearer-JWT REST +
   Socket.IO API.** There is nothing to "adapt" — a mobile HTTP client is a
   first-class citizen of this backend's actual design (§4.1, §4.4). No
   server-side rendering, no CSRF tokens, no cookie-session assumptions
   anywhere in `server/src` to work around.
2. **The single largest reuse surface in the client — the typed API
   wrapper functions (`lib/*Api.ts`) and `types.ts` — is plain,
   DOM-free TypeScript.** They import nothing from `react-dom`, nothing
   browser-specific. React Native's `fetch` is the same Fetch API surface
   `client/src/api.ts` already targets; porting these files is close to a
   copy-paste with import-path fixes (§9).
3. **`socket.io-client` is the exact same npm package on both platforms** —
   the realtime notification code in `client/src/lib/socket.ts` needs no
   protocol-level rework, only a React Native transport check (Expo/RN
   support WebSocket natively; no polyfill required for this library).
4. **Android-first, low-end-device reality**: this product's own README
   frames its users as "teachers in rural India" on (often) budget Android
   phones. Expo's managed build pipeline (EAS Build) produces a signed
   AAB/APK without requiring every contributor to own a capable dev machine
   with Android Studio installed — the exact profile most likely to be
   working on this repo. iOS is realistically a later milestone (§7 in the
   phase plan makes this explicit) and Expo doesn't force an iOS
   investment until the team is actually ready for it.
5. **Claude Code fit**: this conversation is itself running inside a
   codebase where every non-trivial architectural decision is documented
   in-line as code comments (see the extensive rationale comments quoted
   throughout §4 above) — a habit that transfers naturally to
   React/TypeScript, and does not transfer to a fresh Dart codebase with
   zero of this project's own conventions. Recommending Flutter would mean
   asking a future Claude Code session to establish an entirely new set of
   conventions from nothing, rather than extending an existing, working set.
6. **OTA update story matches the flag-driven rollout culture already in
   this codebase.** Every feature in `server/.env.example` ships behind a
   kill-switch specifically because "the client is a PWA with service-worker
   caching, so a client-side flag change propagates on some later page load
   rather than immediately" (verbatim reasoning repeated across
   `ASSISTANT_ENABLED`, `ATTACHMENTS_ENABLED`, `CLASSROOM_MODE_ENABLED`,
   etc.). `EAS Update` gives the mobile app the same "ship a JS fix without
   an app-store review" lever the team is already used to reasoning about
   for the PWA — the mental model transfers directly.

---

## 8. Recommended Project Structure

```
Teacher-Assistant/
├── client/     (unchanged — existing web PWA)
├── server/     (unchanged — existing backend; §17 adds two small routes)
├── mobile/     (NEW — React Native + Expo app)
│   ├── app.json / app.config.ts
│   ├── package.json
│   ├── src/
│   │   ├── api/           (ported from client/src/lib/*Api.ts + api.ts)
│   │   ├── types/          (ported/shared from client/src/types.ts)
│   │   ├── auth/            (SecureStore-backed session, mirrors auth.tsx's logic)
│   │   ├── navigation/       (React Navigation tree — §10)
│   │   ├── screens/           (one folder per feature — §11)
│   │   ├── components/         (native design-system primitives — §22)
│   │   ├── theme/                (ported design tokens — §22)
│   │   └── lib/                   (ported pure logic — date utils, attendance-preview formula, constants)
│   └── ...
└── docs/
    └── mobile-app-plan.md  (this file)
```

**Not recommended for V1: a monorepo rewrite into `apps/`+`packages/shared`
with npm/pnpm workspaces.** This repo's own precedent argues against it
directly: `client/src/config.ts` already documents a **deliberate,
tested duplication** convention for exactly this kind of small
cross-runtime shared vocabulary — see the "CHANGE-11" comments throughout
`config.ts` (e.g. lines 10-19, 47-58, 387-391) explaining that
`LANGUAGES`/`GRADES`/`SUBJECTS`/`NOTIFICATION_TYPE_META` are intentionally
duplicated between the CommonJS server and the ESM client, pinned by a
dedicated drift test (`server/test/actions/vocabDrift.test.js`), specifically
*because* the two runtimes (CommonJS vs ESM) make a shared package more
friction than the duplication it would remove. Adding React Native (a
*third* runtime, with its own Metro bundler resolution rules) to a shared
package would multiply that friction, not reduce it, while also touching
`client/`'s and `server/`'s existing build tooling (tsconfig project
references, CI cache paths, lint configs) — real disruption to a working
product for a payoff (avoiding ~5 small files of duplication) that this
codebase's own conventions already say isn't worth it.

**What to actually do instead**: copy the handful of genuinely portable
files (`types.ts`, the `lib/*Api.ts` wrappers, the attendance-preview
formula, `classroomDate.ts`, the closed-vocabulary constants in `config.ts`)
into `mobile/src/`, each with a one-line comment pointing back at its web
source, exactly mirroring the existing CHANGE-11 convention. If real drift
becomes a maintenance problem after V1 ships (i.e., there's evidence, not
just a fear of it), *then* revisit extracting a `packages/shared` — do not
pre-build that abstraction speculatively.

---

## 9. Reuse vs. Rewrite Strategy (concrete file-by-file)

### Reusable as-is (copy, adjust imports only)

- `client/src/types.ts` → `mobile/src/types/index.ts` — pure interfaces, zero DOM.
- `client/src/lib/classroomApi.ts`, `client/src/lib/notifications.ts`,
  `client/src/lib/resources.ts`, `client/src/lib/admin.ts`,
  `client/src/lib/support.ts`, `client/src/assistant/api.ts` — thin `fetch`
  wrappers via the shared `api()` helper; the wrapper functions themselves
  reference nothing browser-specific.
- `client/src/lib/classroomDate.ts` (date math for the attendance/fee date
  pickers) and any other pure-function file under `client/src/lib/*.test.ts`
  pairs that have **no** import of `react`, `react-dom`, or a DOM global —
  verify each file individually before copying (a handful, like
  `client/src/lib/tts.ts` and `client/src/lib/socket.ts`, look "pure" by
  name but are not — see below).
- Closed vocabularies from `client/src/config.ts`: `LANGUAGES`, `GRADES`,
  `SUBJECTS`, `CLASSROOM_TYPES`, `ISSUE_TYPES`, `RESPONSE_STYLES`,
  `NOTIFICATION_TYPE_META`, `ASSESSMENT_FORMATS`/`DIFFICULTIES`/
  `QUESTION_TYPES` — plain data, no `LucideIcon` import needed if paired with
  a native icon mapping instead (§22).
- The attendance-percentage preview formula
  (`AttendanceDaily.tsx:17-21`) — copy the two-line function itself, not the
  component.

### Reusable with modification

- `client/src/api.ts` — port the `api<T>()` request/refresh logic
  as-is (it's a plain `fetch` wrapper), but swap `localStorage` for
  `expo-secure-store` in `getToken`/`setSession` (§16).
- `client/src/lib/socket.ts` — the `connectNotificationSocket()` function
  itself ports directly (same `socket.io-client` API); only the
  `SOCKET_BASE` env source changes (Expo env handling, §21).
- `client/src/auth.tsx` — the state-machine logic (login/register/
  loginWithGoogle/logout/reconcile) ports near-verbatim; drop the
  cross-tab `storage`-event listener (web-only, no RN analogue) and
  swap the Google ID-token acquisition call (§16).

### Must be rewritten (browser/UI-specific — no salvage)

- Every `.tsx` component under `client/src/components/` and
  `client/src/pages/` — React DOM (`<div>`, `<button>`, CSS classes) has no
  React Native equivalent; screens are rewritten from scratch against the
  *same data contracts* the existing components already prove out (the
  business logic they call is what's being reused, not their JSX).
  This explicitly includes the Classroom UI
  (`ClassroomPage.tsx`, `ClassroomTabs.tsx`, `ClassList.tsx`,
  `StudentRoster.tsx`, `AttendancePanel.tsx`, `AttendanceDaily.tsx`,
  `AttendanceMonthly.tsx`, `FeeStatusBoard.tsx`) — see §12 for why the
  *interaction* patterns (tap-to-toggle Present/Absent, optimistic fee
  toggle, bulk-save-with-dirty-check) are worth preserving even though the
  markup is not.
- All of `client/src/index.css` — re-expressed as a React Native
  `StyleSheet`/theme object (§22), not imported.
- `client/src/hooks/useVoiceInput.ts`, `client/src/lib/tts.ts` — Web Speech
  API has no React Native binding; replace with `expo-speech` (TTS) and a
  native STT package (§ Coach phase, §26 Phase 4) or defer voice input past
  V1 if it's not core to the daily Classroom workflow this plan prioritizes.
- `@react-oauth/google` usage in `LoginPage.tsx` — replace with a native
  Google Sign-In flow (§16).
- `window.print()` in `ResourceWorkspace.tsx:192` — replace with
  generate-then-share (§19).
- `client/src/hooks/useMediaQuery.ts`, `useSidebarSwipe.ts` — these encode
  *web* responsive breakpoints; React Native has its own `Dimensions`/
  `useWindowDimensions` API and gesture libraries (`react-native-gesture-handler`)
  that are not a port of these hooks, just a different tool for a related job.

### Missing, net-new work either way (not a web-vs-mobile question)

- A real Reports/Analytics **UI** for `GET /classroom/analytics/*` — the web
  app doesn't have one yet either (§4.3). Building it mobile-first is a
  legitimate, low-risk way to ship the first UI for data the backend has
  already exposed for a while.
- Device push-token registration + server-side dispatch (§17).

---

## 10. Mobile Navigation

**Bottom tab bar, 5 tabs, plus per-feature stack navigators nested inside
each tab** (React Navigation's standard `Bottom Tabs` + nested `Native
Stack` per tab — the idiomatic RN pattern, not a copy of `BottomNav.tsx`'s
4-item web list):

```
Bottom Tabs
├── Coach            (Stack: Chat → [message actions, share sheet])
├── Classroom         (Stack: Class List → Class Home → {Students, Attendance, Fees, Reports})
├── Library             (Stack: List → Resource View → Resource Edit)
├── Generator             (Stack: Form → Result/Preview)
└── More                    (Stack: Menu → {Notifications, Settings, Sessions, Admin*, Help & Support})
```

**Why 5 tabs and a "More" tab, unlike the web's 4-item `BottomNav`**: the
web bottom nav (§3, §4.5) deliberately leaves Notifications, Settings, and
Admin **out** of its mobile-width nav because it can rely on the always-visible
top bar for them (`TopBar.tsx`) — a luxury a full-screen native app doesn't
have. A native app needs every top-level destination reachable from the tab
bar or one tap away from it; a "More" tab (containing Notifications,
Settings, Sessions/devices, Help & Support, and — role-gated — Admin) is the
standard, well-understood pattern for exactly this (iOS Human Interface
Guidelines and Android Material both document it). This is a deliberate
*improvement* over the web nav's current gap, not a copy of it.

**Generator and Library stay top-level tabs** (matching the web's own
prioritization — they're two of the four items in `BottomNav.tsx` today)
rather than being buried in More; Coach is the default/first tab, matching
`/` being the default web route (`App.tsx:68`).

**Modal screens** (presented over the tab bar, not as a tab):
Login/Register/Forgot-Password/Reset-Password (pre-auth stack, entirely
separate root navigator — mirrors `App.tsx:48-56`'s signed-out route tree),
the school-picker sheet (multi-school login flow, §4.1), attachment
preview, and the exam-paper share sheet (§19).

**Admin** stays inside "More" (role-gated, same `ADMIN_ROLES` check as
`App.tsx:59,82`) rather than a dedicated tab — admin users are a minority of
sessions and the phase plan (§26) treats admin screens as a later phase, not
V1.

---

## 11. Screen-by-Screen Architecture

| Screen | Backend calls | Notes |
|---|---|---|
| **Login** | `POST /auth/login`, `POST /auth/google` | Native Google button (§16); school-picker sheet on multi-match |
| **Register** | `POST /auth/register` | Shows "pending approval" state on success (matches `AuthOutcome.kind === 'pending'`) |
| **Forgot/Reset Password** | `POST /auth/forgot-password`, `POST /auth/reset-password` | Reset link opens via deep link (open question, §29) or a fallback in-app "enter code" flow |
| **Coach (Chat)** | `POST /coach`, `POST /coach/attachment`\*, `POST /coach/learning-representation`\* | \*behind their own feature flags; Coach itself is unconditional |
| **Library List / View / Edit** | `GET/POST/PATCH/DELETE /resources` | Edit screen replaces `window.print()` with share (§19) |
| **Generator** | `POST /resources/generate[-set|-lesson-plan]` | Form → result screen; result reuses the Library "share" flow |
| **Classroom → Class List** | `GET /classroom/classes` | Card list, "+ New Class" |
| **Classroom → Class Home** | `GET /classroom/analytics/classes/:classId` | New screen (§9, §12) — shortcut cards into Students/Attendance/Fees/Reports |
| **Classroom → Students** | `GET/POST/PATCH/DELETE .../students` | List + add/edit sheet |
| **Classroom → Attendance (Mark)** | `GET/POST .../attendance` | §13 |
| **Classroom → Attendance (Monthly)** | `GET .../attendance/summary`, `.../attendance/history`, `.../attendance/export` | Export triggers native share (§19) |
| **Classroom → Fees** | `GET .../fees`, `PATCH .../fees/:period` | §14 |
| **Classroom → Reports** | `GET /classroom/analytics/overview`, `/classroom/analytics/classes/:classId` | **Net-new UI**, backend already exists |
| **Notifications** | `GET /notifications`, `/unread-count`, `PATCH .../read[-all]` | Plus device-token registration on mount (§17) |
| **Settings** | `GET/PATCH /auth/me`, `PATCH /auth/me/password` | Theme, response style, language defaults |
| **Sessions/Devices** | `GET/DELETE /auth/sessions[/:id]` | Ready-made from existing backend (§4.1) |
| **Admin** (role-gated, later phase) | `/api/admin/*` | Deferred — §26 |

---

## 12. Classroom Mobile UX

The web `ClassroomPage.tsx` (§4.5) is fundamentally a **desktop two-pane
layout** (`classroom-sidebar` + `classroom-content`) that degrades to mobile
by hiding one pane at a time with a `mobile-hidden` CSS class
(`ClassroomPage.tsx:155,171`), while five tabs (`ClassroomTabs`) stay
visible across the top and `?tab=&class=` URL params track state. That's a
reasonable web-responsive pattern; it is **not** a native mobile pattern —
there's no URL bar to encode state into, no room for five persistent tabs
above the content on a 360dp-wide screen, and "select a class, then pick a
tab" is two decisions where a teacher who just walked into 6-A wants one.

**Recommended native flow** (matches the prompt's own daily-workflow example
almost exactly, because it's the natural shape once you drop the desktop
two-pane assumption):

```
Classroom tab
  └─ Class List screen (cards: name, grade/section, quick today-attendance %)
       tap a class →
  └─ Class Home screen (the class name as the screen title; four large
     shortcut cards, NOT five small tabs):
       ┌─────────────┬─────────────┐
       │ Mark Today's │  Students   │
       │  Attendance  │             │
       ├─────────────┼─────────────┤
       │  Fees this   │  Reports    │
       │    Month     │             │
       └─────────────┴─────────────┘
       + today's live summary strip (present/absent/unmarked, from
         GET /classroom/analytics/classes/:classId) so the teacher sees
         today's status without tapping into Attendance at all
```

This directly satisfies the requested fast path: *open Classroom → select
6-A → immediately see students (via the Students card, one tap) → quickly
mark attendance (via the featured "Mark Today's Attendance" card, one tap,
pre-selected to today) → switch to monthly attendance (a segmented control
inside the Attendance screen, exactly matching the existing web
`AttendancePanel.tsx`'s `mark`/`monthly` segmented control, which already
gets this interaction right — §4.5, reuse the *pattern*, not the markup) →
check payment status (Fees card) → view reports (Reports card, the one
genuinely new screen).

**Students, Attendance, and Fees are each a stack screen pushed from Class
Home**, not sibling tabs — this matches the web's own §4's "Students/
Attendance/Fees are always scoped to one class at a time" comment
(`ClassroomPage.tsx:91-96`) more faithfully than the web's current tab
implementation does, because a push-based stack makes "this list is *about*
6-A" the obvious reading (a back button returns to 6-A's Class Home, not to
a generic "Classroom" tab root) whereas the web's shared tab bar can make
it ambiguous which class a tab is currently scoped to.

**Class switching**: a compact class-switcher in the Class Home header
(tap the class name → bottom sheet listing other classes) so a teacher
covering multiple sections in one sitting doesn't have to back all the way
out to the Class List between each one — this is a mobile-native
convenience the web version doesn't need (its sidebar is always visible on
desktop) and doesn't have.

---

## 13. Attendance Mobile UX

Backend contract is fixed and already correct (§4.3) — the mobile screen is
purely a native re-expression of the same interaction the web
`AttendanceDaily.tsx` already gets right:

- **One-tap marking**: two large adjacent buttons per student row —
  Present / Absent — tapping the active one clears back to Unmarked
  (exact port of `AttendanceDaily.tsx:66-68`'s toggle logic). Minimum
  44×44dp touch targets (exceeds both iOS HIG's 44pt and Material's 48dp
  minimums comfortably at typical row heights).
- **Bulk marking**: add a "Mark all Present" quick action above the roster
  — **no backend change needed**, since `POST .../attendance` already
  accepts an array of marks in one call (`routes/classroom.js:352-387`);
  this is a pure client-side convenience that pre-fills every row to
  `present` before the existing bulk-save fires. (The web UI doesn't have
  this button today — a legitimate, low-risk mobile-first improvement to
  propose back to web too, later.)
- **Date navigation**: `‹ [date] ›` header exactly mirroring
  `AttendanceDaily.tsx:104-125`, with `max` clamped to today
  (`date >= TODAY` on the `AttendanceDaily.tsx:120` disables "next"). Native
  date picker (`@react-native-community/datetimepicker`) instead of an
  `<input type="date">`.
- **Instant local summary + explicit save**: keep the exact
  dirty-check-then-bulk-save model (`AttendanceDaily.tsx:70-98`) — local
  taps update a working `Map` and a live-computed summary strip instantly;
  nothing is persisted until "Save Attendance" is tapped, at which point one
  `POST` sends every changed mark and the screen reloads from the server
  response to confirm what actually persisted. This is deliberately **not**
  a save-per-tap model (unlike Fees, §14) — the API is shaped for a batch,
  and preserving that shape avoids the class of race Fees's own model
  correctly avoids differently (one PATCH per intentional toggle, since Fees
  has no batch endpoint).
- **Class + student attendance history**: `GET .../attendance/history?month=`
  (class calendar view) and `GET /classroom/students/:studentId/attendance/history?month=`
  (one student's day list) map directly onto a native monthly calendar
  screen and a student-detail screen respectively — both already have a
  server response shape ready to render, no new endpoint needed.
- **Offline**: see §18 — recommended for a fast-follow release, not V1,
  with a specific, scoped design given here for when it's built.

---

## 14. Fees Mobile UX

V1's fee model is intentionally minimal (§4.3: Student × Month ×
Paid/Pending, no amounts) — the mobile screen is a straightforward native
port of `FeeStatusBoard.tsx`'s existing, already-correct interaction:

- Month navigator (`‹ [Month Year] ›`, mirrors `FeeStatusBoard.tsx:72-79`).
- Summary strip: total students / paid / pending
  (`FeeStatusBoard.tsx:87-100`), backed by the same
  `GET .../fees?period=` response.
- One row per student, single Paid/Pending toggle button, **optimistic
  update with revert-on-failure** — copy the exact pattern at
  `FeeStatusBoard.tsx:43-65`: flip the local state and the summary counts
  immediately on tap, fire the `PATCH`, and roll back to the previous
  snapshot only if the request fails. This is the fastest possible
  teacher interaction the current API allows (no confirmation dialog, no
  spinner-then-wait) and should not be "improved" into a slower pattern on
  mobile — it's already optimized for the "fast daily teacher workflow"
  goal this plan is asked to prioritize.
- No due-date/amount fields anywhere in the mobile UI, matching the
  server's `.strict()` rejection of anything beyond `status`
  (`routes/classroom.js:497`) — do not design ahead of the backend here;
  when `amount`/`paidAt`/`note` are wired up server-side, revisit this
  screen then.

---

## 15. Notifications / Push Architecture

Three distinct layers, only one of which is genuinely new:

1. **In-app notification center** (list, unread badge, mark-read) — 100%
   reuse of the existing REST API (§4.4 table). No backend change.
2. **In-app realtime** (bell badge updates live while the app is open and
   foregrounded) — 100% reuse of `socket.io-client` + the existing
   `notification:new` event (§4.4). No backend change; the same
   reconnect-then-`refreshUnreadCount()` correctness backstop the web
   `NotificationProvider` already implements (`Notifications.tsx:122-135`)
   should be ported as-is — it's what covers a notification created while
   the socket was briefly disconnected.
3. **OS-level push (background/killed-app delivery)** — **genuinely
   missing**, because Socket.IO cannot deliver to a backgrounded or killed
   app reliably (§4.4). This requires:
   - **Client**: `expo-notifications` to request permission, obtain an Expo
     push token, and handle foreground/background/tap-to-open behavior.
   - **Server (new)**: a `DeviceToken` Prisma model
     (`userId`, `token`, `platform`, `createdAt`, `lastSeenAt`), two new
     routes — `POST /api/notifications/device-tokens` (register/upsert on
     login and on token-refresh events) and
     `DELETE /api/notifications/device-tokens/:token` (unregister on
     logout) — both trivial, same shape as every other route in
     `routes/notifications.js`.
   - **Server (new)**: a dispatch hook inside
     `server/src/lib/notificationService.js`'s `createNotification` and
     `createBroadcast` — alongside the existing best-effort
     `socketServer.emitToUser(...)` call (lines 73-79, 173-201) — that also
     posts to Expo's push API (`https://exp.host/--/api/v2/push/send`) for
     any registered device tokens belonging to the recipient(s). This is
     additive to the existing "single choke point" design the module's own
     header comment describes (line 6: "a future Web Push dispatch is one
     more call inside createNotification(), not a change at every call
     site") — the module was **already designed with this exact extension
     point in mind**.
   - Gate the whole feature behind a new env var,
     `MOBILE_PUSH_ENABLED` (plus an `EXPO_ACCESS_TOKEN`/FCM credentials as
     needed), following the identical kill-switch convention every other
     feature in `server/.env.example` uses.

Given §4.4's finding that only the admin-broadcast path currently creates
notifications, the first real-world push a teacher receives will most often
be an admin announcement — a small, safe scope to launch push with before
any future "your worksheet is ready" system-triggered notification exists.

---

## 16. Authentication (mobile design)

**No second auth architecture** — every server route in §4.1 is reused
unchanged. What's mobile-specific:

- **Token storage**: `expo-secure-store` (iOS Keychain / Android Keystore)
  instead of `localStorage`, wrapped behind the exact same
  `getToken()`/`getRefreshToken()`/`setSession()` function signatures
  `client/src/api.ts` already exposes, so the ported `auth.tsx` logic and
  every screen that calls `api()` needs zero further changes.
- **Access/refresh flow**: identical silent-refresh-on-401 logic
  (`api.ts:111-134`) ports as-is; `fetch` behaves the same in React Native.
- **Google Sign-In**: the web's `@react-oauth/google` has no RN binding.
  Use `@react-native-google-signin/google-signin` (native modal, Android/
  iOS) or `expo-auth-session`'s Google provider — both ultimately produce an
  ID token to POST to the **same** `/api/auth/google` endpoint
  (`server/src/lib/googleAuth.js` verifies it against `GOOGLE_CLIENT_ID`
  regardless of which client SDK produced it). **Open question (§29)**:
  Google Cloud Console requires separate OAuth client IDs per platform
  (Web, Android, iOS) even though the server only needs to know the *Web*
  client ID as the verification audience for `@react-native-google-signin`'s
  server-auth-code flow — confirm the exact client-ID wiring during Phase 3
  implementation; it does not require any server code change, only Google
  Cloud Console configuration.
- **Multi-school picker**: identical two-step flow (§4.1) — same
  `needsSchoolSelection`/`schools` response shape, rendered as a native
  action sheet instead of `LoginPage.tsx`'s inline picker.
- **Session/device management**: reuse `GET/DELETE /auth/sessions[/:id]`
  as-is (§4.1) for a "Signed-in devices" screen — genuinely free, since the
  backend already returns `userAgent` per session and a mobile login's
  `User-Agent` header will simply show up as a new, identifiable row.
- **Password reset deep link**: the email link points at
  `${APP_URL}/reset-password/<token>` (`server/.env.example`,
  `PASSWORD_RESET_TTL_MINUTES` section) — i.e. it opens the **web** app
  today. For mobile, either (a) leave reset-password as a web-only flow
  (simplest — a teacher taps the email link, resets on web, then logs into
  the app with the new password — zero new work) or (b) add a custom
  URL scheme / Android App Link so the same email link can open the native
  app directly. Recommend (a) for V1; defer (b) to a later phase since it
  requires coordinating a new `APP_URL` scheme with the email templates in
  `server/src/lib/email.js`, which is out of scope for a planning-only pass.

---

## 17. API Reuse Summary

See the full route-by-route table in §4.2. Summary: **every feature's API
is reused as-is.** The only net-new backend surface for a complete mobile
feature set is the push-token pair described in §15 (`POST`/`DELETE
/api/notifications/device-tokens`) plus the `createNotification`/
`createBroadcast` dispatch-hook addition — both small, additive, and
consistent with the codebase's existing conventions (kill-switch flag,
per-recipient scoping, best-effort non-blocking side-channel delivery
matching the existing Socket.IO emit pattern exactly).

---

## 18. Offline Support

Evaluated per feature, against the actual daily-use pattern each one has:

| Feature | Offline-worth-it? | Reasoning |
|---|---|---|
| **Attendance (mark)** | **Yes — but as a fast-follow, not V1** | The single highest-frequency, most time-pressured teacher action (taken once per class per day, often standing in front of students with patchy classroom wifi/mobile data). A network blip mid-marking is the single worst moment for this app to fail. |
| Students (roster) | Marginal | Roster changes rarely inside a school day; caching the last-fetched roster for read-only display while offline is cheap and worth doing alongside Attendance's own offline work, but student *edits* offline aren't worth queuing. |
| Classroom (classes list) | Marginal | Same reasoning as Students — cache last response for read-only display, nothing more. |
| Fees | **No** | Low frequency (monthly), not time-pressured, no evidence teachers mark fees in a classroom-connectivity-poor moment the way attendance is taken. |
| Library | **No** | Reading/saving AI answers already assumes connectivity for the AI call itself; there's no standalone "offline library" use case distinct from a generic cache. |
| Coach | **No** | Fundamentally an online AI request; nothing to queue — a coaching question asked offline has no answer to show until connectivity returns anyway. |
| Generator | **No** | Same reasoning as Coach — the value *is* the AI call. |

**Recommendation: do not build offline support in V1.** Ship the online-only
app first (all seven features above work correctly online, matching the
current backend's actual contract), and design the **one** offline feature
that matters — attendance marking — as a scoped fast-follow once the app is
live and the team has real usage data on how often connectivity actually
fails mid-class. Building offline sync machinery speculatively, before
confirming it's a real problem in practice, is the kind of premature
engineering this plan is explicitly instructed to avoid.

**If/when offline attendance ships**, the design (informed by the exact
shape of the existing bulk-upsert endpoint, §4.3) is:

```
Local queue (AsyncStorage / SQLite via expo-sqlite)
  → each entry = { classId, date, marks[] } — one entry per Save tap,
    matching the existing bulk-POST request body exactly (no new server
    shape needed)
  → on save-while-offline: write to the queue, mark the screen
    "saved locally — will sync", update the local optimistic summary
    exactly as the online path already does
  → background sync (on reconnect, or a periodic check): POST each queued
    entry to the existing bulk-upsert endpoint, in order, one at a time
  → retry: exponential backoff, same request replayed unchanged (the
    endpoint is a full-day upsert, so a retried POST is naturally
    idempotent — replaying it just re-sets the same marks)
  → conflict resolution: NONE NEEDED for V1's offline scope. The bulk
    endpoint always overwrites the full day's marks for the students in
    the batch (routes/classroom.js:373-384 — an upsert, not a merge), and
    a single teacher is the only person who ever marks their own class's
    attendance (§4.3's teacher-only isolation) — there is no
    multi-writer scenario to reconcile. The only edge case is the SAME
    teacher editing the SAME day from two devices while both are
    offline, which is rare enough (and low-stakes enough — attendance,
    not a financial ledger) to resolve with simple last-write-wins
    (whichever queued entry syncs last) rather than building real
    conflict UI.
```

This scoped design deliberately has **no** general-purpose offline
framework, no conflict-resolution UI, and no optimistic-merge logic — all of
which would be over-engineering for a single-writer, single-endpoint,
naturally-idempotent use case.

---

## 19. Files / Media (native equivalents)

Verified browser-specific behavior to redesign (§4.5):

- **`window.print()`** (`ResourceWorkspace.tsx:192`, exam-paper PDF layout
  for generated quizzes/worksheets): replace with `expo-print` (renders the
  same HTML/CSS layout to a PDF) → `expo-sharing` (native share sheet: save
  to Files, print via AirPrint/a print-service, share via WhatsApp/email —
  all first-class share-sheet targets on both platforms, matching how a
  teacher would realistically distribute a worksheet).
- **CSV export** (`.../attendance/export`, `.../fees/export` — server sets
  `Content-Disposition: attachment`, and the *browser* handles the download;
  no client-side download code exists to port, per §4.5): on mobile, fetch
  the CSV response body as text, write it to a temp file via
  `expo-file-system`, then hand it to `expo-sharing`'s share sheet — same
  end result (teacher gets the file), native mechanism.
- **Coach attachments** (`POST /api/coach/attachment`, `multipart/
  form-data`, gated by `ATTACHMENTS_ENABLED`): use `expo-image-picker`
  (camera or gallery) and `expo-document-picker` (PDF) to build the
  `FormData` payload — the server route itself needs no change, it already
  accepts `multipart/form-data` via `multer`
  (`server/src/routes/attachments.js`).
- **Avatar upload** (`POST/DELETE /api/auth/me/avatar`,
  `server/src/routes/avatar.js`): same `expo-image-picker` +
  client-side center-crop/resize before upload, matching the web's own
  behavior described in `config.ts:278-281`
  (`AVATAR_TARGET_DIMENSION_PX = 512`) — port the resize *target*, not the
  web canvas-resize *implementation* (`expo-image-manipulator` is the native
  equivalent).
- **Audio**: `UNKNOWN — VERIFY DURING IMPLEMENTATION` whether any generated
  resource includes audio; nothing in the routes/types reviewed suggests an
  audio artifact type exists today (Resource `type` enum is `lesson_plan |
  classroom_activity | assessment | explanation | general` —
  `schema.prisma` `Resource` model comment). Treat audio as out of scope
  unless a future backend feature adds it.

---

## 20. Security (mobile-specific delta only)

The backend's existing security posture (§4.1, §4.3) already covers
authentication, tenant isolation, rate limiting, input validation (`zod`
`.strict()` schemas throughout), and CORS. What's genuinely new or
different for a native client:

- **CORS is largely irrelevant to the mobile client.** `isOriginAllowed()`
  (`server/src/index.js:387-392`) returns `true` whenever no `Origin` header
  is present — the same branch that already allows curl/health-check
  traffic. A React Native `fetch` call typically sends no `Origin` header
  (this is standard native-HTTP-client behavior, not a Teacher-Assistant-specific
  quirk) — so the existing CORS allowlist, correctly, simply does not apply
  to the mobile app; nothing to configure here. `UNKNOWN — VERIFY DURING
  IMPLEMENTATION`: confirm this holds for the specific Expo/RN `fetch`
  implementation in use (Hermes/JSC networking stack) during Phase 3, since
  behavior can vary by RN version and by whether a proxy/interceptor library
  is added later.
- **TLS**: the API is already served over HTTPS in production (implied by
  Railway's default and the `trust proxy` comment,
  `server/src/index.js:353-362`); the mobile app should hard-fail rather
  than allow a cleartext fallback — `UNKNOWN — VERIFY DURING
  IMPLEMENTATION`: confirm the production `API_BASE` mobile builds point at
  is the HTTPS Railway URL, not a dev HTTP URL, before any release build.
- **Secure token storage is a strict upgrade over web** (§4.1, §16):
  `expo-secure-store` is OS-Keychain/Keystore-backed, unlike the web app's
  plain `localStorage` — no new risk introduced, an existing risk reduced.
- **Rate limiting is IP-keyed** (`express-rate-limit`, one `trust proxy`
  hop, §4). A school's mobile users on the same carrier-grade NAT or campus
  wifi could, in principle, share a rate-limit bucket the way multiple
  browser tabs on a shared office IP already do today — this is a
  **pre-existing characteristic of the current rate-limiter design**, not a
  new mobile-specific vulnerability; no action needed for V1, but worth
  knowing if a school reports 429s after mobile rollout (mirrors the exact
  same caveat already documented for `RESOURCE_GENERATE_RATE_LIMIT_MAX` in
  `server/.env.example`: "a school behind one NAT shares a bucket").
- **Push notification security**: Expo push tokens are opaque and scoped to
  this app's Expo project — treat a `DeviceToken` row the same way the
  existing `Session.tokenHash` is treated (never log the raw token; delete
  on logout/uninstall-detection via Expo's delivery-receipt API reporting a
  token as invalid).
- **No new sensitive local data storage** is introduced beyond the access/
  refresh tokens already covered above — the plan does not recommend
  caching PII (student names, attendance records) to local storage in V1
  (offline support is explicitly deferred, §18), so there is no new
  at-rest classroom-data exposure surface to secure yet.
- **Logs**: mirror the existing server discipline (`logAiEvent`,
  `server/src/index.js:85-88` — "never the raw query text, response text…
  only status/path/method/error identity") in any client-side crash/
  analytics reporting added for mobile; do not log student names, query
  text, or tokens to a third-party crash reporter without the same
  metadata-only discipline the server already applies.

---

## 21. Environment Configuration

Mirrors the existing `VITE_*` build-time-constant convention
(`client/src/config.ts:283-385`), via Expo's `app.config.ts` +
`expo-constants` (Expo's equivalent of Vite's `import.meta.env`):

| Mobile env/config | Mirrors | Purpose |
|---|---|---|
| `API_BASE` | `VITE_API_BASE` | REST base URL |
| `SOCKET_BASE` | `SOCKET_BASE` (derived) | Same origin-strip derivation as `config.ts:289` |
| `GOOGLE_CLIENT_ID` (+ platform-specific iOS/Android client IDs — §16) | `VITE_GOOGLE_CLIENT_ID` | Google Sign-In |
| `NOTIFICATIONS_ENABLED`, `CLASSROOM_MANAGEMENT_ENABLED`, `ATTACHMENTS_ENABLED`, `LEARNING_REPRESENTATION_ENABLED` | Same-named `VITE_*` flags | **Cosmetic gates only** — same explicit caveat as every `VITE_*` flag's own doc comment ("NOT the real kill switch"); the server env vars remain authoritative |
| `MOBILE_PUSH_ENABLED` (new) | — | §15/§17 — client-side gate for requesting push permission at all |
| `EAS_PROJECT_ID` | — | Expo project identifier for EAS Build/Update |

**Server additions** (new, additive-only entries in `.env.example`,
following the exact existing format/style):
`MOBILE_PUSH_ENABLED`, `EXPO_ACCESS_TOKEN` (or FCM/APNs credentials,
pending §29's platform-credential decision).

No existing server env var changes. No `CORS_ORIGINS` entry is needed for
the mobile app specifically (§20).

---

## 22. Design System (native translation, not a CSS port)

Source: `client/src/index.css:1-63` (full palette + dark theme, quoted in
§2). Translate — do not import — into a `mobile/src/theme/` TypeScript
object:

```ts
// mobile/src/theme/tokens.ts — values copied 1:1 from client/src/index.css
export const light = {
  orange: '#ff6b35', orangeDark: '#e85a26', amber: '#f7931e',
  bg: '#f5f6f8', surface: '#ffffff', surface2: '#f0f2f5',
  border: '#e2e5ea', text: '#1f2430', textMuted: '#5c6472',
};
export const dark = {
  orange: '#ff6b35', orangeDark: '#e85a26', amber: '#f7931e', // unchanged in dark theme too — index.css:44-52 only overrides bg/surface/text/border
  bg: '#12151c', surface: '#1b1f29', surface2: '#232833',
  border: '#2c313d', text: '#e8eaef', textMuted: '#a1a8b6',
};
export const radius = { sm: 10, md: 14 }; // --radius-sm / --radius
```

- **Brand gradient button** (`.btn-primary`, `index.css:75-85`: orange→amber
  135° linear gradient): use `expo-linear-gradient` for the primary CTA
  button component (Save Attendance, Mark Present, Generate, Send) —
  the one visual signature most worth preserving exactly, since it's the
  product's most-repeated interactive element.
- **Dark mode**: React Native's `useColorScheme()` (OS-level, matches
  `prefers-color-scheme`) as the default, with a manual override stored via
  `expo-secure-store`/`AsyncStorage` mirroring `usePreferences.ts`'s own
  `localStorage`-backed override-over-system-preference behavior — same
  UX contract, native storage.
  **Do not** try to replicate the web's pre-paint inline-script flash
  prevention (`index.html:10-19`) literally — React Native has no
  server-delivered HTML to inject a script into; instead read the stored
  theme preference synchronously before the first render (Expo's
  `expo-splash-screen` `preventAutoHideAsync`/`hideAsync` pair is the
  native tool for "don't show an unstyled flash before the theme is known").
- **Typography**: the web uses only system fonts
  (`index.css:64`) — mobile should do the same
  (`System` font family is RN's default, mapping to San Francisco/Roboto),
  no custom font loading needed, keeping bundle size down and matching the
  web's own "no custom web font" choice exactly.
- **Icons**: `lucide-react` (web) → `lucide-react-native` — **same icon
  library, same icon names**, actively maintained sibling package; this is
  a near-zero-cost swap, not a redesign (verify each icon name used in
  `BottomNav.tsx`/`TopBar.tsx`/`Notifications.tsx`/classroom components
  exists in the RN package before relying on 1:1 name parity — the vast
  majority do).
- **Cards/spacing**: `index.css`'s `--radius:14px` / `--radius-sm:10px` and
  the `--shadow` token (`0 1px 3px rgba(20,24,33,.08), 0 6px 18px
  rgba(20,24,33,.06)`) translate directly to RN `StyleSheet` `borderRadius`
  + platform-appropriate elevation (`elevation` on Android,
  `shadowColor`/`shadowOpacity`/`shadowRadius` on iOS) — same visual
  intent, platform-idiomatic implementation.
- **Notification bell / badge, Classroom summary tiles, Present/Absent
  toggle buttons**: these are the highest-value components to get visually
  right first (they're the ones a teacher looks at every single day) —
  reference `Notifications.tsx`'s `.notif-badge` styling and
  `AttendanceDaily.tsx`'s `.classroom-summary-tile`/`.classroom-att-btn`
  classes in `index.css` for exact colors/sizing before designing their
  native equivalents in Phase 2 (§26).

---

## 23. Testing

Mirrors the existing split in `client/`/`server/` (§4.5, §24) rather than
inventing a new testing philosophy. Note the repo already has an established
manual-QA convention for responsive/mobile-*web* behavior —
`docs/MOBILE-RESPONSIVE-TESTING-GUIDE.md` — which is a checklist for the
existing mobile-*browser* experience, not the native app; it's worth reading
before Phase 13 for its device/viewport checklist shape (a reasonable
starting template to adapt), but it does not cover React Native and should
not be treated as already satisfying any native-app testing requirement.

- **Unit tests (pure logic)**: Jest (React Native's default test runner,
  via `jest-expo` preset) for every ported pure-logic file (§9) — same
  "logic-only, no component rendering" discipline the client CI job already
  documents choosing deliberately (`ci.yml:108-111`). Cover: the
  attendance-preview formula port, date utilities, API-client request
  shaping (mock `fetch`), auth token-refresh state machine.
- **Component tests**: React Native Testing Library, added selectively for
  the highest-risk interactive components (Attendance mark/toggle screen,
  Fee toggle screen) — a deliberate step *beyond* what the web client does
  today (web has none — `ci.yml:108-111`), justified because these two
  screens carry real optimistic-update/revert-on-failure logic (§13, §14)
  worth regression-protecting given how central they are to the "fast daily
  workflow" goal.
- **Navigation tests**: smoke-test the tab/stack structure (§10) renders
  and role-gates correctly (Admin hidden for `teacher` role, matching the
  existing `ADMIN_ROLES`/`isAdmin` check ported from `App.tsx:59,82`).
- **Auth tests**: token-refresh-on-401 (mock a 401 then a successful
  refresh, assert exactly one `/auth/refresh` call even under concurrent
  requests — mirrors the de-dupe behavior at `api.ts:85-109` this plan
  says to port verbatim), secure-storage read/write, Google Sign-In token
  hand-off to `/api/auth/google`.
- **API contract tests against the real server**: reuse
  `server/test/classroom.*.test.js`,
  `server/test/classroom-tenant-isolation.test.js`,
  `server/test/notifications.*.test.js`, `server/test/auth.test.js`,
  `server/test/cors.test.js` etc. **as-is** — they already prove the
  contract the mobile client depends on; no new server test suite is needed
  purely *because* of mobile, only the two small new push-token routes
  (§17) need their own new tests, following the exact same
  Supertest-against-the-real-Express-app pattern every other route file's
  test already uses (`server/test/helpers/testApp.js`).
- **Offline behavior**: deferred with the feature itself (§18) — no test
  investment needed until it's built.
- **Device matrix**: Android emulator (Pixel-class, API 33+) as the primary
  daily-dev target (Android-first, §7); a mid/low-tier physical Android
  device (the realistic target user's hardware profile per the README's own
  framing) for periodic manual verification of touch-target sizing and
  animation performance; iOS Simulator only once iOS work actually starts
  (§26 Phase 15) — no need to maintain iOS test infrastructure earlier than
  that.
- **Light/dark mode & accessibility**: verify every screen in both
  `useColorScheme()` states; run RN's built-in accessibility inspector
  (`Accessibility Inspector` on iOS Simulator, `TalkBack`/`Accessibility
  Scanner` on Android) against the Attendance and Fees screens specifically,
  since they're the highest-frequency interaction surfaces.
- **Performance**: no server-side change is needed to support this, but
  note the Coach flow (`POST /api/coach`) is a single-shot (non-streaming)
  request that can legitimately take several seconds
  (`LLM_TOTAL_TIMEOUT_MS` default 60000ms, `server/.env.example`) — the
  mobile Coach screen must show a clear, patient loading state (not a
  frozen-looking spinner) for that realistic latency, matching whatever
  loading affordance `CoachPage.tsx`/`RunStatus.tsx` already use on web
  (`UNKNOWN — VERIFY DURING IMPLEMENTATION`: read `RunStatus.tsx` during
  Phase 4 implementation to port its exact staged-loading-message copy).

---

## 24. Build / Release

**Development**: Expo dev client (`npx expo run:android` locally once, then
`expo start --dev-client` for fast iteration) or Expo Go for the earliest
scaffolding milestones before any native-module config plugin is added
(push notifications and Google Sign-In both require a custom dev client,
not plain Expo Go, from Phase 3 onward — plan for this explicitly rather
than discovering it mid-phase).

**Internal testing**: EAS Build `preview` profile → Android **APK**,
distributed via EAS's internal distribution (a install link, no Play
Console needed yet) — the fastest path to "a teacher on the pilot can
install this today."

**Production Android**: EAS Build `production` profile → **AAB**, uploaded
to Google Play Console. Needs, before this phase: a registered Play
Console developer account (`UNKNOWN — VERIFY DURING IMPLEMENTATION` — ask
the user whether one already exists), an application **package name**
(recommend `com.teachmitra.assistant` or matching whatever brand identifier
the org already uses elsewhere — `UNKNOWN`, confirm with the user before
Phase 14), and a signing keystore — **let EAS Build manage the keystore**
(its default, credentials stored server-side by Expo) rather than a
manually-managed local keystore, consistent with the "minimize local
machine dependencies" reasoning in §7.

**iOS** (later phase, §26 Phase 15): bundle identifier (mirror the Android
package name convention, e.g. `com.teachmitra.assistant`), an Apple
Developer Program membership (`UNKNOWN — VERIFY DURING IMPLEMENTATION` —
this has a real annual cost and requires the user's explicit sign-off
before any Xcode/TestFlight work begins), EAS-managed provisioning/signing
(same "let EAS manage credentials" reasoning as Android), TestFlight
internal testing before App Store submission.

**Versioning**: Expo's `app.json`/`app.config.ts` `version` +
platform-specific `versionCode` (Android)/`buildNumber` (iOS), bumped by
`eas build` automatically via its remote version-source option — avoids
manual version-bump commits.

**CI/CD**: add a fourth job to the existing `.github/workflows/ci.yml`
(alongside `secrets`/`server`/`client`) — `mobile: lint + unit test`
(Jest), matching the existing Node-20/`npm ci` pattern exactly. Defer wiring
actual EAS Build triggers into CI until Phase 14 (they cost real build
minutes/money on Expo's infra and are not needed for every PR the way lint/
unit-tests are).

**OTA updates**: `EAS Update` for JS-only/asset changes (bug fixes, copy
changes, non-native-module feature additions) — matches the existing
flag-driven, ship-fast culture (§7). **Native-module changes (a new
`expo-*` package, a new permission) still require a full store
build/review** — EAS Update cannot ship those; this distinction should be
explicit in the team's release checklist once the app ships, so a change
that needs a new native module isn't mistakenly pushed as an OTA update and
silently fails to take effect for users on an older native binary.

---

## 25. Development Environment / IDE / Tooling

| Tool | Used for |
|---|---|
| **VS Code + Claude Code** | All application code — TypeScript/TSX screens, navigation, API layer, theme, tests. The primary, near-exclusive authoring environment; this is where the bulk of the roadmap in §26 happens. |
| **Node.js 20** | Matches the exact version already pinned in `.github/workflows/ci.yml:74,103` for `client`/`server` — use the same version for `mobile/` for consistency, not a new choice. |
| **Expo CLI** (`npx expo ...`) | Project scaffolding, `expo start` dev server, `expo prebuild` (generates the native `android/`/`ios/` folders on demand — not committed to source control in the managed workflow), config-plugin management. |
| **Android Studio** | Android SDK/platform-tools/emulator management **only** — not for writing application code. Needed to: install the Android SDK + create/run an AVD emulator, and (occasionally) inspect native Android logs (`adb logcat`) when a config-plugin/native-module issue needs debugging below the JS layer. |
| **Android SDK + emulator, or a physical Android device** | Day-to-day running/testing of the app (§23's device matrix). A physical mid-tier Android device is the more representative test target for this product's actual users and is cheap/available; the emulator remains the faster iteration loop for development. |
| **JDK** | A transitive requirement of the Android build tooling (Gradle) — installed alongside Android Studio, not managed separately. `UNKNOWN — VERIFY DURING IMPLEMENTATION`: exact JDK version required by the Expo SDK version chosen in Phase 1 (check Expo's current SDK release notes at scaffold time, not from this document, since Expo SDK requirements change across releases). |
| **Xcode** | **Only** once iOS work actually starts (§26 Phase 15) — required for local iOS Simulator builds/debugging and is **macOS-only**. Not needed for Android-first V1 at all; EAS Build's cloud iOS builds reduce but don't eliminate the eventual need for local Xcode during active iOS development/debugging. |
| **A Mac** | Only required at the point Xcode is required (previous row) — `UNKNOWN — VERIFY DURING IMPLEMENTATION`: confirm the team has access to a Mac (owned or CI-cloud, e.g. GitHub-hosted `macos` runners or Expo's own EAS Build cloud iOS builders, which do **not** require the team to own a Mac at all for building, only for local Xcode debugging) before committing to a Phase 15 timeline. |
| **Physical device via Expo Go / dev client + local network** | Fastest real-device iteration loop during Phases 1–13 — no cable required once the dev client is installed once. |

**Practical workflow** (confirms and refines the prompt's own example against
what this stack actually requires): **VS Code + Claude Code** does the
overwhelming majority of implementation work end-to-end (screens,
navigation, API integration, theming, tests, even Expo config file edits).
**Android Studio** is reached for exactly three things: initial SDK/emulator
setup, running the emulator during day-to-day testing, and native-log
debugging on the rare occasion a config-plugin or native-module issue
surfaces below the JS layer. **Xcode** is not touched at all until Phase 15
— this is a materially simpler tool story than the prompt's own example
implies "by default," because Expo's managed workflow specifically exists
to defer native-IDE involvement as long as possible.

---

## 26. Claude Code Implementation Roadmap

Each phase lists Goal / Why here / Files & modules / Existing code reused /
New code required / Backend changes / Dependencies / Tests / Device
verification / Acceptance criteria / Risks. Phases are ordered so every
phase produces something runnable and demoable — no "big bang" integration
phase at the end.

### Phase 0 — Architecture & Environment Setup
- **Goal**: repo scaffolding, tooling verified, nothing feature-related yet.
- **Why here**: everything else depends on a working Expo project and a
  confirmed local build/run loop.
- **Files/modules**: new `mobile/` directory (§8).
- **Existing code reused**: none yet.
- **New code required**: `npx create-expo-app`, TypeScript template,
  ESLint config mirroring `client/eslint.config.js`'s general shape (own
  ruleset, RN-appropriate).
- **Backend changes**: none.
- **Dependencies**: `expo`, `typescript`, `@react-navigation/native` +
  `@react-navigation/native-stack` + `@react-navigation/bottom-tabs`.
- **Tests**: none yet — CI job added but trivially passing (`lint` only).
- **Device verification**: `expo start` → Android emulator shows the
  default template screen.
- **Acceptance criteria**: `npm run lint` passes in `mobile/`; app boots on
  an Android emulator; a fourth CI job exists and is green.
- **Risks**: Expo SDK version choice — pick the current stable SDK at
  scaffold time (do not pin to whatever version is current as of this
  document's writing; verify against Expo's own release notes).

### Phase 1 — Mobile Project Bootstrap: Ported Core
- **Goal**: `types.ts`, the `lib/*Api.ts` wrappers, and `api.ts` (with
  `expo-secure-store` swapped in) all compile and pass unit tests, with no
  UI yet.
- **Why here**: every later phase depends on this layer; proving it in
  isolation (via unit tests against a mocked `fetch`) catches
  React-Native-vs-browser `fetch` discrepancies before any screen is built
  on top of them.
- **Files/modules**: `mobile/src/types/`, `mobile/src/api/`.
- **Existing code reused**: `client/src/types.ts`,
  `client/src/lib/classroomApi.ts`, `client/src/lib/notifications.ts`,
  `client/src/lib/resources.ts`, `client/src/api.ts` (§9).
- **New code required**: `expo-secure-store`-backed
  `getToken`/`getRefreshToken`/`setSession` (§16).
- **Backend changes**: none.
- **Dependencies**: `expo-secure-store`.
- **Tests**: port the request/refresh-dedup unit tests conceptually
  covered by the web client's own behavior at `api.ts:85-109` (no existing
  test file was found for `api.ts` itself in `client/` — write new ones
  here rather than assuming a web-side test to port).
- **Device verification**: not yet applicable (no UI).
- **Acceptance criteria**: a scratch script/test can log in against a real
  (or test) server instance and receive a stored, retrievable token.
- **Risks**: low — this is the most mechanical phase.

### Phase 2 — Navigation Shell + Design System Foundation
- **Goal**: the tab/stack navigation tree from §10 renders with placeholder
  screens; `mobile/src/theme/` tokens (§22) exist and are applied to a
  handful of base components (Button, Card, Text).
- **Why here**: every feature phase from here on needs somewhere to mount
  its screen and a consistent visual language to build against.
- **Files/modules**: `mobile/src/navigation/`, `mobile/src/theme/`,
  `mobile/src/components/` (Button, Card, TextInput, SummaryTile,
  ToggleButton — the primitives Attendance/Fees will reuse most).
- **Existing code reused**: color/radius/shadow values from
  `client/src/index.css` (§22), icon set from `lucide-react-native`.
- **New code required**: the whole navigation tree, base component library.
- **Backend changes**: none.
- **Dependencies**: `@react-navigation/*` (already added Phase 0),
  `lucide-react-native`, `expo-linear-gradient`.
- **Tests**: navigation-tree smoke test (§23).
- **Device verification**: tap through every tab and placeholder screen on
  an Android emulator, in both light and dark mode.
- **Acceptance criteria**: 5-tab bottom nav matches §10; role-gating stub
  (Admin hidden for a mocked `teacher` role) works; theme toggle works.
- **Risks**: getting the nested-stack-inside-tabs pattern right for deep
  linking later (§29) — keep route names stable from this phase on.

### Phase 3 — Authentication
- **Goal**: full login/register/Google/forgot-password/multi-school-picker
  flow, session persisted across app restarts.
- **Why here**: nothing feature-related can be demoed against a real
  backend without this; comes right after the shell so every subsequent
  phase can assume an authenticated `user`.
- **Files/modules**: `mobile/src/auth/` (ported `auth.tsx` logic, §9),
  `mobile/src/screens/auth/*`.
- **Existing code reused**: `client/src/auth.tsx`'s state machine (login/
  register/loginWithGoogle/logout/reconcile), `LoginPage.tsx`'s flow logic
  (not its JSX).
- **New code required**: native Google Sign-In integration (§16), school-
  picker bottom sheet, pending/rejected account state screens.
- **Backend changes**: none (§17).
- **Dependencies**: `@react-native-google-signin/google-signin` (or
  `expo-auth-session`), a **custom dev client build** from this phase
  onward (native module — Expo Go can no longer run the app past this
  point).
- **Tests**: auth-flow unit tests (§23), including the concurrent-refresh
  de-dupe assertion.
- **Device verification**: full login/logout/session-restore-after-kill
  cycle on a physical or emulator Android device, against the real staging
  backend.
- **Acceptance criteria**: a teacher can register, get approved (via the
  existing web admin flow — no mobile admin UI needed yet), and sign in;
  Google sign-in works end-to-end; app restart restores the session
  without re-login; multi-school accounts show the picker correctly.
- **Risks**: Google Cloud Console client-ID configuration (§16, §29) is the
  most likely source of friction in this phase — budget extra time for it.

### Phase 4 — Coach
- **Goal**: chat UI over `POST /api/coach`, matching the web's core
  question→answer loop.
- **Why here**: Coach is the product's front door (`/` is the default web
  route, `App.tsx:68`) — first feature phase after the app can
  authenticate.
- **Files/modules**: `mobile/src/screens/coach/*`.
- **Existing code reused**: none structurally (full rewrite per §9), but
  the request/response contract from `server/src/index.js:638-939` is
  followed exactly; port `RunStatus.tsx`'s loading-state copy (§23).
- **New code required**: chat message list, composer, markdown/LaTeX
  rendering (the web uses `katex` — confirm a React Native-compatible
  LaTeX renderer, e.g. `react-native-katex` or a WebView-based KaTeX render
  for just this one component — `UNKNOWN — VERIFY DURING IMPLEMENTATION`,
  resolve at implementation time since KaTeX rendering in RN has real
  library-maturity tradeoffs worth evaluating then, not guessed now).
- **Backend changes**: none.
- **Dependencies**: markdown renderer (`react-native-markdown-display` or
  similar), LaTeX renderer (TBD above).
- **Tests**: request/response shape unit tests; manual QA of a real
  question end-to-end.
- **Device verification**: ask a real question, confirm the answer renders
  (including any math notation) on-device.
- **Acceptance criteria**: a teacher can ask a question and see a correctly
  rendered answer, including the ~60s-worst-case loading state (§23) shown
  gracefully.
- **Risks**: LaTeX rendering is the one open technical risk in this phase —
  flag early, don't let it block the rest of Coach if it needs more time
  (ship without math rendering first if necessary, add it after).

### Phase 5 — Library
- **Goal**: list/view/edit saved resources.
- **Files/modules**: `mobile/src/screens/library/*`.
- **Existing code reused**: `client/src/lib/resources.ts` (API wrapper).
- **New code required**: list/detail/edit screens; the `window.print()`
  replacement (§19) — this is the phase where the export/share flow is
  actually built, since it's Library's primary "done" action.
- **Backend changes**: none.
- **Dependencies**: `expo-print`, `expo-sharing`.
- **Tests**: share-flow smoke test.
- **Device verification**: generate a PDF from a saved resource, confirm
  the share sheet offers save/print/send.
- **Acceptance criteria**: matches the web's Library feature set for
  view/edit/share; no amount/print-preview regression versus the web PDF
  layout.
- **Risks**: matching the web's exam-paper letterhead layout
  (`ExamHeader.tsx`, `ExamHeaderEditor.tsx`) exactly in an `expo-print`
  HTML template — budget time to compare pixel-for-pixel against the web
  print output.

### Phase 6 — Generator
- **Goal**: quiz/worksheet generation form → result → save/share.
- **Files/modules**: `mobile/src/screens/generator/*`.
- **Existing code reused**: `ASSESSMENT_FORMATS`/`DIFFICULTIES`/
  `QUESTION_TYPES` constants (§9), the same share flow built in Phase 5.
- **New code required**: form screen, result/preview screen.
- **Backend changes**: none.
- **Tests**: form-validation unit tests against the same closed
  vocabularies the server enforces (§9's CHANGE-11 duplication note — keep
  these in sync with `server/src/actions/schemas/generateAssessment.js` the
  same way `client/src/config.ts` already does).
- **Device verification**: generate a quiz end-to-end, share it.
- **Acceptance criteria**: matches web's Generator feature set.
- **Risks**: low — mostly a form + the already-built share flow.

### Phase 7 — Notifications (in-app + realtime; push deferred to its own step below)
- **Goal**: notification list, unread badge, realtime bell updates via
  Socket.IO.
- **Files/modules**: `mobile/src/screens/notifications/*`,
  `mobile/src/lib/socket.ts` (ported, §9).
- **Existing code reused**: `client/src/lib/socket.ts`,
  `client/src/lib/notifications.ts`, the reconnect-then-refresh
  correctness backstop pattern (§15).
- **New code required**: badge UI in the tab bar/More menu.
- **Backend changes**: none for this half of the phase.
- **Dependencies**: `socket.io-client` (already proven reusable, §4.4).
- **Tests**: socket reconnect/refresh-count test.
- **Device verification**: trigger an admin broadcast from the web admin
  UI, confirm it arrives in-app in realtime while the mobile app is open.
- **Acceptance criteria**: list/unread-count/mark-read all work; realtime
  arrival works while foregrounded.
- **Risks**: none significant — this is a near-direct port.

### Phase 7b — Push Notifications (backend + client, the one genuinely new backend surface)
- **Goal**: OS-level push delivery when the app is backgrounded/killed.
- **Files/modules**: `server/src/routes/notifications.js` (new routes),
  `server/prisma/schema.prisma` (new `DeviceToken` model + migration),
  `server/src/lib/notificationService.js` (dispatch hook),
  `mobile/src/lib/push.ts`.
- **Existing code reused**: the existing `createNotification`/
  `createBroadcast` choke point (§15, §17) — extended, not replaced.
- **New code required**: everything in §15/§17's push section.
- **Backend changes**: **yes** — new Prisma model + migration, two new
  routes, dispatch-hook addition, new `MOBILE_PUSH_ENABLED` flag.
- **Dependencies**: `expo-notifications`, `expo-server-sdk` (server-side, for
  posting to Expo's push API).
- **Tests**: new server route tests (mirroring `server/test/notifications.test.js`'s
  existing patterns), client permission/token-registration tests.
- **Device verification**: background/kill the app, trigger an admin
  broadcast, confirm an OS push notification arrives and tapping it opens
  the correct in-app screen (the notification's `link` field, already
  present on every `Notification` row — `schema.prisma`).
- **Acceptance criteria**: push arrives within a reasonable delay while
  backgrounded/killed; tapping it deep-links correctly; unregistering on
  logout removes the device token server-side.
- **Risks**: Expo push credentials setup (Android FCM credentials
  specifically) is a real one-time configuration task — budget time for it;
  it is not solely a code change.

### Phase 8 — Classroom (shell + Classes + Students)
- **Goal**: Class List → Class Home → Students, per §12's navigation
  design.
- **Files/modules**: `mobile/src/screens/classroom/*`.
- **Existing code reused**: `client/src/lib/classroomApi.ts` (already
  ported Phase 1), the interaction *patterns* (not markup) from
  `ClassList.tsx`/`StudentRoster.tsx`.
- **New code required**: Class List cards, the new Class Home shortcut-card
  screen (§12 — genuinely new even relative to web), Students list + add/
  edit sheet, class-switcher bottom sheet.
- **Backend changes**: none.
- **Tests**: screen-level tests for the class-switcher and add/edit flows.
- **Device verification**: create a class, add students, archive/restore a
  class — full CRUD cycle on-device against staging.
- **Acceptance criteria**: matches web's Classes/Students feature parity;
  Class Home screen's summary strip shows live today's-attendance data.
- **Risks**: low — CRUD-shaped, well-specified backend contract.

### Phase 9 — Attendance
- **Goal**: Mark Attendance + Monthly Summary, per §13.
- **Files/modules**: `mobile/src/screens/classroom/attendance/*`.
- **Existing code reused**: the attendance-preview formula (§9), the exact
  optimistic/dirty-check/bulk-save interaction model from
  `AttendanceDaily.tsx` (§13).
- **New code required**: native date picker integration, "Mark all
  Present" quick action (client-only convenience, §13), monthly calendar
  view, student-history screen.
- **Backend changes**: none.
- **Dependencies**: `@react-native-community/datetimepicker`.
- **Tests**: the dirty-check/bulk-save logic gets dedicated unit tests
  (§23) given its centrality to the daily workflow.
- **Device verification**: mark a full class present/absent, save, confirm
  the persisted summary matches; navigate to a past date; view monthly
  summary and a single student's history.
- **Acceptance criteria**: percentage math matches the server's formula
  exactly in every view (§4.3); "unmarked" is never a selectable persisted
  state, matching the server contract.
- **Risks**: date-picker platform differences (Android vs. iOS native
  pickers look and behave differently) — budget a pass to make sure the
  Android-first experience is solid before iOS is in scope at all.

### Phase 10 — Fees
- **Goal**: Fee status board, per §14.
- **Files/modules**: `mobile/src/screens/classroom/fees/*`.
- **Existing code reused**: the exact optimistic-toggle-then-revert pattern
  from `FeeStatusBoard.tsx` (§14).
- **New code required**: month navigator, toggle list.
- **Backend changes**: none.
- **Tests**: optimistic-revert-on-failure unit test (simulate a failed
  PATCH, assert the UI rolls back).
- **Device verification**: toggle a student's fee status with network
  briefly disabled, confirm the UI reverts correctly.
- **Acceptance criteria**: matches web's Fees feature exactly (no amount/
  due-date UI — §14).
- **Risks**: low.

### Phase 11 — Reports / Dashboard
- **Goal**: the genuinely new Reports screen(s) over
  `GET /classroom/analytics/*` (§4.3, §12).
- **Files/modules**: `mobile/src/screens/classroom/reports/*`.
- **Existing code reused**: none (no web UI exists yet to reference, §4.3)
  — this is net-new product design, not a port.
- **New code required**: cross-class overview screen, per-class detail
  screen, using `recharts`'s React Native equivalent
  (`react-native-svg`-based charting, e.g. `victory-native` or
  `react-native-gifted-charts`) for any visual summary beyond plain
  numbers.
- **Backend changes**: none — the data already exists.
- **Tests**: data-shape rendering tests.
- **Device verification**: confirm totals match what Attendance/Fees
  screens already show for the same class/period (cross-check, since this
  is the first UI ever built against this endpoint).
- **Acceptance criteria**: numbers are consistent with Attendance/Fees
  screens (same server-side aggregation, §4.3 — there should be zero drift
  by construction).
- **Risks**: this is the one phase with no existing UI reference anywhere
  in the codebase — allow more design iteration time than the ported
  phases above.

### Phase 12 — Offline / Reliability (fast-follow, not blocking store release)
- **Goal**: the scoped offline-attendance design from §18.
- **Files/modules**: `mobile/src/lib/offlineQueue.ts`.
- **New code required**: local queue, background sync, retry/backoff — all
  scoped exactly as described in §18, nothing broader.
- **Backend changes**: none (the existing bulk-upsert endpoint is already
  naturally idempotent, §18).
- **Dependencies**: `expo-sqlite` or `@react-native-async-storage/async-storage`
  (pick based on queue complexity actually encountered — `UNKNOWN`, decide
  at implementation time).
- **Tests**: queue/retry/sync unit tests, airplane-mode manual QA.
- **Device verification**: mark attendance in airplane mode, confirm local
  "saved, will sync" state, re-enable network, confirm it syncs and matches
  what a second device sees.
- **Acceptance criteria**: no data loss across an offline marking session;
  no duplicate/conflicting server state after sync (§18's idempotency
  argument holds in practice).
- **Risks**: the one phase where "it works on my emulator" is not
  suf1ficient evidence — test with a real flaky/airplane-mode connection on
  a physical device.

### Phase 13 — Testing Hardening
- **Goal**: close any coverage gaps left by the feature phases above;
  full device-matrix pass (§23).
- **New code required**: whatever unit/component test gaps remain.
- **Device verification**: the full light/dark, multi-screen-size,
  accessibility pass from §23.
- **Acceptance criteria**: CI's mobile job is green; manual QA checklist
  (derived from §23) signed off.
- **Risks**: low if earlier phases kept pace with their own listed tests
  rather than deferring all testing to this phase.

### Phase 14 — Android Release
- **Goal**: first Play Store release, per §24.
- **New code required**: none — release engineering only (signing,
  store listing, versioning).
- **Backend changes**: confirm production `API_BASE`/`SOCKET_BASE` point at
  the real production Railway URL (§20).
- **Dependencies**: Play Console account, package name decision (both
  `UNKNOWN — VERIFY DURING IMPLEMENTATION`, resolve with the user before
  this phase starts).
- **Acceptance criteria**: app installable from Play Store (or at least
  Internal Testing track) by a real pilot teacher.
- **Risks**: Play Console review turnaround time — budget for it, it's
  outside engineering's control.

### Phase 15 — iOS Release
- **Goal**: TestFlight → App Store, per §24.
- **Dependencies**: Apple Developer Program membership, Mac/Xcode access
  (both `UNKNOWN`, resolve with the user — real recurring cost for the
  former).
- **Risks**: App Store review is stricter than Play's on several fronts
  (push notification usage justification, account-deletion self-service
  requirement — confirm the existing web app's account-deletion story, if
  any, satisfies this before submitting; `UNKNOWN — VERIFY DURING
  IMPLEMENTATION` whether account self-deletion exists anywhere in the
  current backend, since Apple requires it for any app with account
  creation).

---

## 27. Phase Acceptance Criteria

Summarized per-phase above (§26); the cross-cutting bar that applies to
**every** phase: no phase is "done" until (1) it runs correctly on an
Android emulator/device against the real staging backend, not mocked data,
and (2) its ported business logic (attendance math, fee toggle, auth
refresh) produces numbers/behavior that match the equivalent web screen
exactly, given the same server data.

---

## 28. Risks

- **Socket.IO horizontal-scaling ceiling** (§4.4): the in-memory,
  single-process connected-user map means multi-instance Railway scaling
  would silently drop realtime delivery to users connected to a different
  instance than the one that created a notification. Not a mobile-specific
  risk (it already exists for the web app) but mobile's push layer (§15)
  is the mitigation that matters most here — even if realtime-in-app
  delivery degrades under scale, OS push (a separate, stateless delivery
  path via Expo/FCM/APNs) still works. Revisit a Redis Socket.IO adapter
  if/when the team actually scales past one instance — not before.
- **Rate-limiter IP-sharing at school scale** (§20): worth monitoring after
  rollout, not worth pre-solving.
- **LaTeX rendering in React Native** (§26 Phase 4): the one genuinely
  open technical risk with no clearly-established best RN library at the
  time of writing this plan — resolve empirically during Phase 4, don't
  block earlier phases on it.
- **Google OAuth client-ID configuration** (§16, §29): historically a
  common source of Google Sign-In integration friction on any platform;
  budget real time for it in Phase 3, don't assume it's a 10-minute task.
- **Expo SDK version drift**: Expo ships new SDK majors roughly twice a
  year with periodic breaking changes to config plugins — pin the SDK
  version chosen in Phase 0 deliberately and upgrade on a schedule the team
  chooses, not reactively.
- **Team bandwidth for two client codebases**: shipping `mobile/` means the
  team now maintains two frontends against one backend contract — every
  future backend API change needs both `client/` and `mobile/` updated (or
  a documented decision that a given change is web-only). No code-sharing
  abstraction in this plan (§8, §9) removes that coordination cost; it only
  avoids adding *build-tooling* coupling on top of it. This is an accepted,
  named tradeoff, not an oversight.

---

## 29. Open Technical Questions

Resolve these during the phases noted, not before starting Phase 0 —
none of them block scaffolding:

1. **Play Console / Apple Developer account ownership** — does one already
   exist for this org, or does one need to be created? (§24, Phase 14/15
   blocker.)
2. **Application package name / bundle identifier** — what identifier
   convention does the org want (`com.teachmitra.assistant`, or something
   else)? (§24.)
3. **Google Cloud Console platform client IDs** — confirm the exact
   client-ID wiring `@react-native-google-signin` needs relative to the
   existing `GOOGLE_CLIENT_ID` the server already verifies against. (§16,
   Phase 3.)
4. **Password-reset deep link** — ship as web-only (recommended default,
   §16) or invest in a custom URL scheme / App Link? (§16, low priority.)
5. **Push credentials** — Expo's push service (simplest, recommended
   default) vs. direct FCM/APNs integration — decide based on whatever
   constraints emerge in Phase 7b, not speculatively now. (§15, §17.)
6. **Account self-deletion** — does the backend support it anywhere today?
   Needed before an eventual App Store submission (§26 Phase 15) per
   Apple's policy; `UNKNOWN — VERIFY DURING IMPLEMENTATION`, check
   `server/src/routes/auth.js` and `server/src/routes/admin.js` for any
   existing delete-account path before assuming one needs to be built.
7. **LaTeX rendering library choice** (§26 Phase 4, §28).
8. **Offline queue storage choice** — `expo-sqlite` vs. AsyncStorage (§26
   Phase 12) — decide based on the actual queue complexity encountered.
9. **Brand app icon / splash screen assets** — the web app's only icon
   asset today is `client/public/icon.svg`; confirm whether that same mark
   is the intended mobile app icon or whether new assets are wanted, before
   Phase 2's design-system work needs a concrete icon.

---

## 30. Final Recommended Architecture

**One backend (`server/`, unchanged), two clients (`client/` web PWA,
unchanged, plus a new `mobile/` React Native + Expo app), zero shared
build tooling between them, deliberate small-file duplication for the
handful of genuinely portable pure-logic modules** (mirroring this
codebase's own existing CHANGE-11 convention rather than introducing a new
one). Every feature's data and business logic — auth, Coach, Library,
Generator, Notifications, and the full Classroom/Attendance/Fees workspace —
is served by the existing REST + Socket.IO API **without modification**.
The only new backend surface is a small, additive push-notification
device-token pair of routes plus a dispatch-hook extension to a module that
was already designed with exactly that extension point in mind (§15).

Android-first (§7, §25), Expo-managed (§5–§7), navigation redesigned around
a phone-native tab-plus-stack model that fixes a real gap the current web
app has (no "More" surface on mobile web — §10) rather than copying the
web's desktop-first Classroom two-pane layout (§12). Offline support is
named, scoped, and deliberately deferred past V1 to the one feature that
actually needs it (§18) rather than built speculatively across the board.

This plan asks a future Claude Code session to **port business logic and
data contracts, and rewrite UI** — never the reverse — which is the
reuse-maximizing, duplication-minimizing shape this specific, already
well-factored codebase supports.
