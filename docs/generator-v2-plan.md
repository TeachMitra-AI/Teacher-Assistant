# Structured Question Model — Architecture Plan (Generator v2)

**Status**:

| Stage | Status |
|---|---|
| Architecture review | ✅ APPROVED (2026-08-21) |
| Stage 1 — Backend | ✅ DONE (2026-08-21) — see Implementation Log below |
| Stage 2 — Web Generator + Workspace | ✅ DONE + **manually verified end-to-end** (2026-08-21) |
| Stage 3 — Mobile Generator + Library (the original Phase 6 ask) | ✅ DONE + **manually verified end-to-end on a physical device** (2026-08-21) |
| Flags flipped on in a real environment | ⬜ NOT STARTED (dev-only manual verification so far) |

Committed to `feature/mobile-app` — see the end of the Stage 3 Implementation
Log below for the exact commit (Stage 1 + Stage 2's own commit is noted at
the end of the Stage 2 log, further down this file).

---

## Implementation Log — Stage 3 (Mobile Generator + Library), 2026-08-21

Built directly on Stage 1's backend contract and Stage 2's web implementation
(explicitly the source of truth per this stage's own instructions) — no
backend changes, no new APIs, no separate mobile-only question model. Reused
`mobile/src/api/resources.ts`'s existing `Question`/`StructuredAssessmentDocument`
types and `mobile/src/lib/structuredQuestions.ts` (ported earlier in this same
session, before this log entry — see the file-level comments there), and
built native RN screens/components on top.

### What was built

- **`mobile/src/components/QuestionCard.tsx`** (new) + **`QuestionListEditor.tsx`**
  (new) — native RN port of the web components. Same behavior (editable vs.
  read-only mode, per-type fields, Move Up/Down/Delete, Add pair/Add question),
  RN primitives instead of DOM (`ChipPicker` for type/correct-answer pickers,
  custom radio circles for MCQ, a View-based 2-column table for read-only
  Match). 21 new component tests (`QuestionCard.test.tsx`, `QuestionListEditor.test.tsx`).
- **`mobile/src/screens/generator/GeneratorFormScreen.tsx`** (new) — the
  request form (format/topic/grade/subject/difficulty/questionType/count/
  language/instructions), native idioms throughout: `ChipPicker` for closed
  vocabularies (including the full, un-gated `QUESTION_TYPES` list — mirrors
  web's actual runtime behavior exactly, see the discrepancy note below), a
  native +/- stepper for question count (no on-device number keyboard), inline
  error banner on generation failure. 7 tests.
- **`mobile/src/screens/generator/GeneratorResultScreen.tsx`** (new) — receives
  the generate response via route params (not shared component state — see
  `navigation/types.ts`'s own comment on why a pushed screen uses params
  instead of a single-page tab switch like web's `GeneratorPage.tsx`).
  Structured vs. legacy branch exactly like web: `structuredQuestions !== null`
  renders `QuestionListEditor`, **never** falls back to the markdown textarea
  when a structured document is present. Save validates, builds the
  `structured` payload via `buildStructuredPayload`, omits `content` in
  structured mode (server re-renders it), and on success cross-tab-navigates
  to `LibraryTab`'s `ResourceEdit` screen for the new resource (`Reopen saved
  resource` requirement) via `navigation.getParent()?.navigate(...)`. Guards
  every back-navigation attempt with a "Discard this result?" confirmation
  until a save actually succeeds (`savedRef`, not a dirty-diff — a generated
  result took a real AI call, so it's guarded even before any hand edit). 12 tests.
- **`mobile/src/navigation/types.ts`** — `GeneratorStackParamList.GeneratorResult`
  gained real params (was `undefined`); **`mobile/src/navigation/stacks/GeneratorStack.tsx`**
  wired both real screens in place of the two `PlaceholderScreen`s.
- **`mobile/src/screens/library/ResourceEditScreen.tsx`** — extended for the
  "reopen saved resource / continue editing" requirement, mirroring
  `ResourceWorkspace.tsx`'s Stage 2 changes: on load, `resource.type ===
  'assessment' ? parseStructuredDocument(r.structured) : null` (schemaVersion
  gate, **not** the `STRUCTURED_QUESTIONS_ENABLED` flag — that flag only gates
  creating new structured content in the Generator, not viewing/editing a
  resource that already has it, exactly like web); extended `dirty`/`handleSave`
  to validate and rebuild the structured payload; extended `runAction`/
  `applySuggestion` to apply an AI-assist suggestion's `structured` field
  alongside `content`. One deliberate, narrow improvement over web: this
  screen's `structuredConfig` also carries `questionType`/`questionCount` —
  web's `ResourceWorkspace.tsx` does not, which would silently drop those two
  fields from `structured` on the next Library save (a real, if low-impact,
  pre-existing gap in the already-shipped web code, not something this stage
  was asked to fix there — flagging it here rather than silently diverging or
  silently copying a data-loss footgun). 5 new tests added to the existing
  `ResourceEditScreen.test.tsx` (legacy fallback unchanged — verified by the
  pre-existing tests in that file still passing byte-for-byte, no edits to
  their assertions were needed).
- **`mobile/.env.example`** — documented `EXPO_PUBLIC_STRUCTURED_QUESTIONS_ENABLED`
  (default `false`), matching the established `EXPO_PUBLIC_*` and web
  `VITE_STRUCTURED_QUESTIONS_ENABLED` documentation convention.

### A real discrepancy found between web's code and its own comment (not fixed — out of scope)

Web's `client/.env.example` and `config.ts` both comment that
`VITE_STRUCTURED_QUESTIONS_ENABLED=false` makes the question-type **picker**
"offer only the original 4 values" — but `GeneratorPage.tsx`'s actual picker
(`{QUESTION_TYPES.map(...)}`) does **no such filtering**; it always renders
all 7 values regardless of the flag, both in the currently-committed Stage 2
code and (per this document's own §2a) in `QUESTION_TYPES` itself, which is a
static array with no flag-based subset. The flag actually only gates whether
`GeneratorPage`/`ResourceWorkspace` **parse and render** an already-structured
document — never whether the new types can be *requested*, which the server's
own `STRUCTURED_QUESTIONS_ENABLED` 503s on regardless. Mobile's
`GeneratorFormScreen` deliberately mirrors the **actual runtime behavior**
(all 7 types always offered) rather than the stale comment, per "web is the
source of truth" — but this is a real, pre-existing doc/code mismatch on the
web side worth a follow-up correction there, out of scope for this mobile stage.

### A misdiagnosed "bug" during device testing, corrected on review (documented for the record)

Mid-session, real-device testing of `GeneratorResultScreen`'s back-guard
appeared to show the "Discard this result?" alert not firing on a genuine
Android hardware back-button press. On review (re-reading the exact sequence
of screenshots against the code, once the device session had ended), this was
**not a bug**: the screen instance in question had already been saved earlier
in the same test pass (`savedRef.current` was `true`), so the guard correctly
let the back-press through without a confirmation — there was nothing to
discard. A second, earlier no-alert case (leaving a *dirty* `ResourceEditScreen`
reached via cross-tab navigation) is also not a bug: with only one entry in
`LibraryStack`'s history, Android's hardware back has nothing to pop *within
that stack*, so React Navigation's bottom-tabs delegates to the tab
navigator's own `backBehavior: 'history'`, switching tabs without unmounting
or removing the screen — the edit is not lost (the screen stays mounted with
its state intact), it just isn't a "leave" in the `beforeRemove` sense. Both
are standard, already-existing React Navigation framework behavior, not
something this stage's code caused or could reasonably prevent without a
bespoke pattern nothing else in this app uses. No code change was made for
this; noted here transparently since the mid-session read (reported at the
time as a probable real bug) was wrong and is corrected on the record rather
than quietly dropped.

### Testing

- `npx tsc --noEmit` (mobile): clean throughout, after every file added.
- `npx jest` (mobile): **200/200**, 23 suites — zero regressions against the
  176 tests that existed before this stage.
- `npm run lint` (mobile, `expo lint`): 0 errors, 0 warnings.
- `npx expo export --platform android`: succeeds (2845 modules bundled, no errors).

### Physical-device verification — Stage 3 (2026-08-21, Samsung Galaxy M36)

Performed genuinely, against the real backend (already running) and real
Gemini API (`STRUCTURED_QUESTIONS_ENABLED=true` in `server/.env`,
`EXPO_PUBLIC_STRUCTURED_QUESTIONS_ENABLED=true` in a newly-created, gitignored
`mobile/.env`), via `adb`/`uiautomator` (tap/type/screenshot — no touch-screen
automation tool was available, so the device was driven entirely from the
shell) after the user connected the phone mid-session (it was not connected
at the start; confirmed via `adb devices` before proceeding).

- **A real, genuine bug was found and fixed during this pass**: the very
  first generation attempt showed the **legacy Markdown textarea** instead of
  the structured `QuestionListEditor`, even with both flags on. Root cause:
  Metro was started (via a background-tool `&`-backgrounding mistake) in a way
  that left a stale bundle running from before `mobile/.env` was fully in
  effect — the exact "Expo bakes `EXPO_PUBLIC_*` in at bundle time, not
  hot-reloaded" gotcha already documented elsewhere in this project. Fixed by
  killing the stray Metro process and restarting cleanly (`expo start
  --android --clear`), confirmed via the CLI's own `env: load .env` / `env:
  export EXPO_PUBLIC_STRUCTURED_QUESTIONS_ENABLED` log lines this time. A
  second, fresh generation (topic "Solar System", format Quiz, "Match the
  Following", 4 questions) then correctly rendered the real structured editor.
- **Verified genuinely working, end-to-end, against real Gemini output**:
  - **Generate** — real AI-generated Match-the-Following questions (e.g.
    "Match the planets with their most notable characteristics" with real
    Mars/Jupiter/Saturn/Venus pairs) rendered correctly in both Preview
    (read-only 2-column table, real exam-letterhead prefilled from the signed-
    in teacher's actual school/name) and Edit (editable pair rows).
  - **Edit** — live-edited a pair's text ("Saturn" → "Saturn edited"),
    confirmed the change reflected immediately.
  - **Delete** — removed a pair via its trash icon (4 pairs → 3, the
    type's minimum).
  - **Add** — added a new empty pair via "Add pair"; separately, on the
    Library copy, added a whole new question via the add-type picker (from
    the earlier "Fractions"/Mixed generation pass, before the clean-restart).
  - **Validation** — attempting to Save with an incomplete pair correctly
    blocked with a native `Alert` ("Fix questions" / "Fix the highlighted
    questions before saving.") **and** the `QuestionCard`'s own inline red
    error banner + red border, both driven by the same `validateQuestions`
    call already covered by Jest — confirmed identical behavior on real
    hardware.
  - **Save** — after fixing the validation error, Save succeeded: `createResource`
    was called, and the app correctly **cross-tab-navigated from the Generator
    tab to the Library tab's `ResourceEdit` screen** for the newly-created
    resource — genuine confirmation the `navigation.getParent()?.navigate(...)`
    cross-tab call (untestable by Jest's mocked-navigation-prop convention in
    this codebase) actually works on a real navigator tree.
  - **Reopen / continue editing** — the reopened `ResourceEditScreen` showed
    the structured `QuestionListEditor` (not the flat textarea) with the
    exact edited state persisted (the deleted pair stayed deleted, "Saturn
    edited" stayed edited) — genuine confirmation of the full round trip.
  - **Reorder** — Move Up on Q2 correctly swapped it with Q1 on the reopened
    resource; the header Save icon turned from muted to orange the instant
    the reorder happened, confirming the dirty-check re-renders correctly on
    real hardware (matching `ResourceEditScreen.test.tsx`'s equivalent
    assertion).
  - **Keyboard/touch targets** — the on-screen keyboard opened/dismissed
    correctly for every text field exercised (topic, match-pair text,
    instructions); every tappable control (chips, Move Up/Down/Delete icons,
    Add pair/Add question, header Save) was large enough to hit reliably via
    `adb`'s coordinate-based taps once the correct bounds were read from a
    `uiautomator` dump — no control required pixel-perfect precision beyond
    the deliberate exception below.
  - **Dark theme** — the whole session ran under the phone's dark theme;
    correct contrast/legibility throughout. **Light theme was not
    additionally toggled and re-checked this pass** — not claimed as verified.
- **Known limitation, explicitly not worked around**: the header Save
  button's synthetic tap was twice intercepted by Expo Go's own floating
  dev-menu bubble (a development-only overlay absent from any production/store
  build) sitting on the exact same header position — the identical limitation
  already documented for Phase 5's own device-verification log. Worked
  around by dragging the bubble aside first; not a product defect.
- **Reconnection handling**: the USB connection dropped once mid-session
  (the same known flaky-cable behavior already documented in
  `DEVICE_TESTING.md`). Per instruction, verification was **not** assumed to
  have continued correctly across the drop — `adb devices` was polled until
  the phone reappeared, `adb reverse` tunnels (which do not survive a replug)
  were re-added, and the screens already open were re-screenshotted and
  re-confirmed before any further interaction counted as verified.
- **Not verified this pass** (explicitly, not silently assumed): light
  theme; safe-area insets on a notch/cutout device (this phone doesn't have
  one prominent enough to distinguish visually from a screenshot); the
  `mixed` question-type end-to-end render (only exercised in the earlier,
  stale-bundle pass before the restart — the clean pass used a single
  concrete type, `match`, to make the structured-vs-legacy distinction
  unambiguous); Fill in the Blank/Descriptive/True-False/Short-Answer/MCQ
  types' on-device rendering specifically (MCQ was seen in the Preview tab of
  the pre-restart generation only) — all of these are covered by the 200
  passing Jest tests but not independently re-confirmed on hardware this pass.

### Files changed (Stage 3)

- `mobile/src/api/resources.ts` — `Question` union, `StructuredAssessmentDocument`,
  extended `QuestionType`/`GenerateAssessmentResult`/`GenerateSetResult`,
  `AiActionResult.structured` (ported from web, earlier in this session).
- `mobile/src/config.ts` — `ASSESSMENT_FORMATS`/`DIFFICULTIES`/`QUESTION_TYPES`
  (extended)/`QUESTION_COUNT_*`/`STRUCTURED_QUESTIONS_ENABLED` (ported earlier).
- `mobile/src/lib/structuredQuestions.ts` (new) + `.test.ts` (new) — ported earlier.
- `mobile/src/components/QuestionCard.tsx` (new) + `__tests__/QuestionCard.test.tsx` (new).
- `mobile/src/components/QuestionListEditor.tsx` (new) + `__tests__/QuestionListEditor.test.tsx` (new).
- `mobile/src/screens/generator/GeneratorFormScreen.tsx` (new).
- `mobile/src/screens/generator/GeneratorResultScreen.tsx` (new).
- `mobile/src/screens/generator/__tests__/GeneratorFormScreen.test.tsx` (new).
- `mobile/src/screens/generator/__tests__/GeneratorResultScreen.test.tsx` (new).
- `mobile/src/navigation/types.ts` — `GeneratorStackParamList.GeneratorResult` params.
- `mobile/src/navigation/stacks/GeneratorStack.tsx` — real screens wired in.
- `mobile/src/screens/library/ResourceEditScreen.tsx` — structured-resource support.
- `mobile/src/screens/library/__tests__/ResourceEditScreen.test.tsx` — 5 new tests added.
- `mobile/.env.example` — `EXPO_PUBLIC_STRUCTURED_QUESTIONS_ENABLED` documented.
- `mobile/.env` (new, gitignored, not committed) — created for this session's
  device testing (`EXPO_PUBLIC_STRUCTURED_QUESTIONS_ENABLED=true`); left in
  place for continued manual testing.
- `docs/generator-v2-plan.md` — this section, and the status table above.

No `server/` files, no Prisma schema/migration files, and no `client/` (web)
files were touched this stage — pure mobile + docs.

### Git status at the end of this session

Reviewed and committed to `feature/mobile-app` (this commit — see the
repository's own `git log` for the hash) and pushed to
`origin/feature/mobile-app`. Not merged to `main`, no force-push.

### Remaining work

- Light-theme device re-verification (dark theme only was exercised this pass).
- The web-side `QUESTION_TYPES`-picker doc/comment discrepancy noted above
  (a one-line comment fix on the web side, or an actual filtering
  implementation if the original intent is wanted — a decision for the web
  owner, not assumed here).
- Flipping either `STRUCTURED_QUESTIONS_ENABLED` flag on anywhere beyond this
  dev session remains explicitly out of scope until the §7 live-Gemini
  token-truncation check (flagged since Stage 1) is done for a large,
  token-heavy `mixed` request.
- Phase 7 (whatever mobile phase follows the Generator) has not been started,
  per this stage's own explicit instruction not to start it automatically.

---

## Post-Stage-2 manual verification, 2026-08-21

The user manually ran the real app end-to-end and hit a real configuration
gap this document's own Stage 2 log should have caught: **the client needs
its own `VITE_STRUCTURED_QUESTIONS_ENABLED=true` in `client/.env`** — a
completely separate variable from the server's `STRUCTURED_QUESTIONS_ENABLED`
— and Vite does not hot-reload `.env` changes, so the dev server needs
restarting after adding it. `client/.env.example` never documented this
variable (a real gap in the Stage 2 log's own file list, now fixed — see
below). Root-caused via static analysis (`GeneratorPage.tsx:346`'s
`STRUCTURED_QUESTIONS_ENABLED ? parseStructuredDocument(...) : null` gate,
`config.ts:409`'s `import.meta.env.VITE_STRUCTURED_QUESTIONS_ENABLED ===
'true'`) and confirmed live: called the real `POST /api/resources/generate`
directly from the browser console and inspected the JSON (`structured` was
already present and valid before any fix — the server side was always
correct), then reproduced the legacy-textarea fallback in the running app,
then re-verified after the user added the env var and a dev-server restart —
Edit now shows the real per-question card editor for all 6 types (generated
a real "Mixed" quiz on Fractions against live Gemini; Q1–Q10 covered every
type including a working Match pairs editor and MCQ radio-selected correct
option), confirmed via both page-text inspection and a screenshot.

**Fixed as part of this verification pass:**
- `client/.env.example` — added the missing `VITE_STRUCTURED_QUESTIONS_ENABLED`
  block, matching the existing `VITE_*_ENABLED` documentation convention
  (`VITE_CLASSROOM_MANAGEMENT_ENABLED`'s entry was used as the template).
- `client/src/pages/GeneratorPage.test.tsx` — a **real, if narrow, test-suite
  bug** surfaced by this exercise: the "legacy fallback" tests relied on the
  *ambient* `STRUCTURED_QUESTIONS_ENABLED` being false (ran with no explicit
  mock, trusting nothing would set `VITE_STRUCTURED_QUESTIONS_ENABLED` in
  `client/.env`). The moment the user legitimately set that variable to `true`
  in their own `client/.env` for manual testing, `npx vitest run` — which
  resolves `import.meta.env` from the same `.env` file Vite's dev server
  does — started failing that suite, because the *test's assumption*, not
  the app, was wrong. Fixed by forcing the flag explicitly via
  `vi.mock('../config', ...)` returning `STRUCTURED_QUESTIONS_ENABLED: false`
  (mirroring how `GeneratorPage.structured.test.tsx` already forces it
  `true`), so the suite is deterministic regardless of the developer's own
  `client/.env` contents. Re-ran clean afterward: 572/572.
- No application logic changed in this pass — both fixes are
  documentation/test-isolation only.

### Final full verification (server + client), post-fix
- `npx vitest run` (server): **2144/2145** — same 1 pre-existing/unrelated
  notification-test-isolation flake identified in Stage 1 (confirmed via
  `git stash` at the time), still untouched.
- `npx vitest run` (client): **572/572**, 35 files.
- `npx tsc --noEmit -p .` (client): clean.
- `npm run lint` (client): 0 errors, 1 pre-existing unrelated warning
  (`src/hooks/useClassroomQueue.ts`, untouched this session).
- `npm run build` (client): succeeds.

---

---

## Implementation Log — Stage 2 (Web Generator + Workspace), 2026-08-21

Built directly on Stage 1's backend contract (`structured` field on generate
responses, the server-side re-render-from-`structured.questions` rule, and
the structured AI-assist path). Everything in §§3, §5 below is the
ARCHITECTURE as approved; this section records what actually shipped and
where reality (or a fresh decision, each called out explicitly) diverged.

### What was built

- **New shared domain model** (not a numbered section in the original plan,
  but the natural foundation both pages needed):
  - `client/src/lib/resources.ts` — added the `Question` discriminated union
    (`McqQuestion | TrueFalseQuestion | ShortAnswerQuestion |
    DescriptiveQuestion | FillBlankQuestion | MatchQuestion`) and
    `StructuredAssessmentDocument`, plus `structured?: string` on
    `AiActionResult` (Stage 1 added this to the generate endpoints; Stage 2
    needed the ai-action one too, for §2f's structured suggestion-apply path).
  - `client/src/lib/structuredQuestions.ts` (new) — the client-side mirror of
    `server/src/lib/assessmentSchema.js`: `createEmptyQuestion`,
    `fromWireQuestion`/`toWireQuestion` (round-trip the flat wire shape ↔ the
    friendlier union), `parseStructuredDocument` (mirrors the server's
    `tryReadStructuredQuestions` byte-for-byte in spirit — schemaVersion 2 +
    a `questions` array, or null), `buildStructuredPayload`, and
    `validateQuestion`/`validateQuestions` (client-side pre-Save UX checks
    mirroring the server's per-type rules — never the source of truth).
    43 unit tests.
  - `client/src/components/QuestionCard.tsx` (new) — one question, editable
    or read-only, type-aware fields (mcq radio+4 options, true/false
    toggle, short answer/fill-blank single field, descriptive textarea,
    match pairs editor with add/remove respecting 3–8 bounds). Changing a
    question's type resets its type-specific fields rather than carrying
    over stale data. 14 component tests.
  - `client/src/components/QuestionListEditor.tsx` (new) — the list wrapper:
    add (type picker + button)/delete/reorder (Move Up/Down icon buttons,
    **not** drag-and-drop — see the deviation note below)/per-question error
    display, shared by both pages. 9 component tests.
- **`GeneratorPage.tsx`** (§3): after a successful generate, if
  `STRUCTURED_QUESTIONS_ENABLED` and `result.structured` parses, the page
  enters structured mode — Edit tab becomes the question-card list (+ a
  new "Instructions for students" field for the document's own instructions
  line, distinct from the pre-existing "Additional instructions" sent to the
  AI); Preview tab renders every question read-only via the same
  `QuestionListEditor`, directly from the in-memory array — **no markdown
  round-trip for the live preview** (confirms the plan's own §3 recommendation
  that a structured resource's on-screen preview should render straight from
  `Question[]`, not through `format.ts`). Save validates every question,
  blocks with a toast on any failure or an empty list, and sends
  `structured` (via `buildStructuredPayload`) while omitting `content`
  entirely — the server re-renders it. Regenerate's existing "you'll lose
  your edit" confirm now also fires on structured edits (a new
  `structuredDirty` flag alongside the pre-existing `contentDirty`). With
  the flag off, **or** with it on but the response having no parseable
  `structured`, the page is byte-for-byte the pre-existing markdown/textarea
  flow — nothing about that path was touched.
- **`ResourceWorkspace.tsx`** (§5): on load, if the resource `type ===
  'assessment'` and `structured` parses (schemaVersion 2), the same
  structured editor/preview replaces the flat textarea — independent of any
  client flag (once a resource has native structured questions, editing it
  keeps working even if the generation flag is later turned off, so a
  rollback can never orphan already-saved content — this is a deliberate
  design point, not an oversight). The dirty-check, Save, and AI-assist paths
  all extended in parallel with GeneratorPage's own logic:
  - Save always resends the *whole* structured document (questions +
    instructions + the config/examMeta it was loaded with) when anything in
    it changed, since the server only ever accepts/re-renders from the
    complete array — never a partial patch of just one field.
  - The 4 assessment-only AI-assist actions now carry a `structured` field
    (Stage 1's addition) in their response; **Apply** updates both the
    displayed suggestion and the live question cards together, so
    `structuredQuestions` state can never go stale relative to what's shown.
  - Legacy resources (no `schemaVersion`, or any non-assessment type)
    render exactly as before — confirmed by a dedicated legacy describe
    block in the new test file, including one resource whose `structured`
    has generator-config keys but no `schemaVersion` (the exact shape every
    resource saved before this feature existed already has).

### Deviations from the approved plan (and why)

- **§2b's "z.discriminatedUnion" note doesn't apply here** (that was Stage
  1/server); on the client, `Question` genuinely *is* a TypeScript
  discriminated union (unlike the server's flat-with-superRefine shape) —
  `fromWireQuestion`/`toWireQuestion` are the seam that translates between
  the two conventions.
- **Reorder uses Move Up/Down buttons on web too**, not the plan's suggested
  HTML5 native drag-and-drop (§3: "zero new dependency, a nice contrast to
  mobile"). Reasoning found during implementation, not assumed upfront:
  drag events are materially harder to drive reliably from
  `@testing-library/user-event` (no first-class drag simulation), and the
  button approach is *more* accessible (keyboard/screen-reader operable,
  drag-and-drop typically isn't without extra work) for the same zero-new-
  dependency cost. Both platforms now share the identical reorder affordance
  and identical test technique — a simplification, not a regression from the
  original suggestion.
- **No `QUESTION_TYPE_META` icon table** — `config.ts`'s existing
  `QUESTION_TYPES` array (extended in Stage 1 with labels) was enough for
  the picker and the read-only type badge; an icon-per-type table was
  speculative polish nothing in the 10-point task list asked for.
- **`format.ts` / print-export markdown rendering was NOT touched** — the
  plan (§3) flagged this as needed for on-screen preview of the 3 new types.
  It turned out not to be needed for Stage 2's actual scope: the live
  Generator/Workspace preview now renders directly from `Question[]`
  (bypassing `format.ts` entirely, a cleaner outcome than the plan
  anticipated), and `format.ts`'s *existing* pipe-table support already
  renders `match`'s two-column Markdown table (from Stage 1's renderer)
  reasonably on the printed/exported page without any change. **Known,
  accepted limitation**: `descriptive`'s italic hint line (`_(Write your
  answer in 2-4 sentences.)_`) may not render styled italics in the printed
  PDF/print output specifically (untested against the live print path this
  session — client-side print/PDF rendering was out of this stage's test
  scope) — a small, cosmetic, easily-fixed follow-up, not a functional gap.

### A new architectural decision made mid-session: reversing the client's "no component tests" policy

`client/vitest.config.ts` had an explicit, documented prior decision against
React component testing ("introducing a component-testing culture
mid-project is a separate initiative"). Testing "add/delete/reorder a
question" and "save, then reload" as real behavior needs real component
rendering — a pure-logic reimplementation of the pages' own state wiring
would just be a second, drift-prone copy of the component, not a test of it.
**Raised explicitly with the user before proceeding** (twice — once to
confirm adding `@testing-library/react` at all, once specifically flagging
the documented policy reversal) and confirmed both times. Shipped as:
- New devDependencies: `@testing-library/react`, `@testing-library/user-event`,
  `@testing-library/jest-dom`.
- `client/src/setupTests.ts` (new) — registers jest-dom matchers and RTL's
  `cleanup` in `afterEach` (this repo's test files import `afterEach`
  explicitly rather than using vitest's `globals` option, so RTL's automatic
  jest-global cleanup detection doesn't fire on its own — registered by hand
  instead).
- `client/vitest.config.ts` — `include` widened to add
  `src/pages/**/*.test.tsx` and `src/components/**/*.test.tsx`;
  `setupFiles` added. Every existing pure-logic `.test.ts` suite is
  unaffected (still matched by the original two glob entries).
- **A real gotcha hit and documented in-file**: `STRUCTURED_QUESTIONS_ENABLED`
  is a top-level `const` computed once from `import.meta.env` when
  `config.ts` first loads. `vi.stubEnv()` *after* that point cannot
  retroactively change an already-evaluated constant — confirmed by direct
  experimentation (a module-level `console.log` proved the binding really
  doesn't move). The fix, and the reason `GeneratorPage.structured.test.tsx`
  is a **separate file** from `GeneratorPage.test.tsx`: force the flag via a
  file-level `vi.mock('../config', ...)` (hoisted, applies to every test in
  that one file) rather than a per-test env stub. `ResourceWorkspace.test.tsx`
  needed no such trick, since its structured mode depends only on the loaded
  resource's own data, never a client flag.
- **A second real bug found via the same debugging process, unrelated to the
  mocking gotcha**: `client/src/lib/examMeta.ts`'s `buildInitialExamMeta`
  reads `user.school.name` unconditionally. A test's mocked `user` object
  without a `school` field throws inside `GeneratorPage.tsx`'s
  `handleGenerate` *after* `content`/`title`/`tab` state was already queued
  (so the Preview section still rendered, masking the failure) but *before*
  the structured-parsing lines ever executed — silently falling back to
  legacy mode with no visible error. This is a **pre-existing fragility in
  the original (Phase-3-era) code**, not something this session introduced,
  and real `User` objects always have a non-null `school` in production, so
  it's not a functional bug — but it is a real "an unhandled exception
  mid-handler silently discards later work" pattern worth knowing about.
  Not fixed (out of scope for Stage 2), only worked around in the new tests
  by giving the mocked user a `school` field.

### Tests added

- `client/src/lib/structuredQuestions.test.ts` — 43 tests (round-trips for
  all 6 types, `parseStructuredDocument`/`buildStructuredPayload`, every
  per-type validation rule including match's pair-count/duplicate-left
  checks and fill_blank's blank-marker detection).
- `client/src/components/QuestionCard.test.tsx` — 14 tests (every type's
  editable fields, type-change field reset, move/delete callbacks,
  disabled-at-the-ends reorder buttons, inline error display, and the
  read-only/preview variant for mcq/match/plain types).
- `client/src/components/QuestionListEditor.test.tsx` — 9 tests (add/
  delete/reorder produce the correct array, per-question errors reach the
  right card, empty-state message, read-only mode has no controls).
- `client/src/pages/GeneratorPage.test.tsx` — 4 tests, the **legacy**
  fallback (flag off; a `structured` field present but ignored; save sends
  plain `content`; regenerate-dirty confirm still fires).
- `client/src/pages/GeneratorPage.structured.test.tsx` — 9 tests (flag on):
  all 6 types render as cards; Preview is read-only; delete; reorder; add;
  save blocks on an invalid question; save sends `structured.questions` and
  omits `content`; save blocks on an empty list; regenerate-dirty confirm.
- `client/src/pages/ResourceWorkspace.test.tsx` — 11 tests: 8 for a
  structured resource (load → cards, Preview read-only, delete-then-save
  sends the reduced array, reorder-then-save sends the new order, Save
  disabled until dirty, save blocks on an invalid question, save-then-reload
  round trip, applying an AI-assist suggestion updates the cards) and 3 for
  legacy resources (flat textarea unchanged, plain-content save, and a
  `structured` blob with generator-config keys but no `schemaVersion` still
  falls back to legacy).
- **Total new/changed client tests this stage: 90**, across 6 new test
  files. Combined with Stage 1: the client suite grew from 482 (Stage 1
  baseline) to **572**.

### Verification performed

- `npx vitest run` (client, full suite): **572/572 passing**, 35 files (was
  482/29 after Stage 1 — no regressions, zero flakes observed across
  multiple runs).
- `npx tsc --noEmit -p .` (client): clean.
- `npm run lint` (client, ESLint): 0 errors, 1 pre-existing warning in
  `src/hooks/useClassroomQueue.ts` (a file untouched this session, unrelated
  to the Structured Question Model).
- `npm run build` (client, `tsc -b && vite build`): succeeds, 2753 modules
  transformed, output unchanged in kind from before (same pre-existing
  "chunk larger than 500kB" warning, not new).
- `npx vitest run` (server, full suite, re-run after Stage 2's client-only
  changes to confirm no cross-contamination): **2144/2145 passing**, the
  same 1 pre-existing/unrelated notification-test-isolation flake identified
  in Stage 1 (confirmed via `git stash` at the time) — untouched, unaffected.
- Manual dev-server verification: **not performed this session** (no browser
  tool invocation) — all verification is via the automated suites above plus
  direct source reading. Flagging explicitly rather than claiming a manual
  click-through happened.

### Files changed (Stage 2)

- `client/src/lib/resources.ts` — `Question` union, `StructuredAssessmentDocument`, `AiActionResult.structured`.
- `client/src/lib/structuredQuestions.ts` (new) + `.test.ts` (new).
- `client/src/components/QuestionCard.tsx` (new) + `.test.tsx` (new).
- `client/src/components/QuestionListEditor.tsx` (new) + `.test.tsx` (new).
- `client/src/pages/GeneratorPage.tsx` — structured mode wiring.
- `client/src/pages/GeneratorPage.test.tsx` (new), `GeneratorPage.structured.test.tsx` (new).
- `client/src/pages/ResourceWorkspace.tsx` — structured mode wiring.
- `client/src/pages/ResourceWorkspace.test.tsx` (new).
- `client/src/index.css` — new `.question-card`/`.question-list-*` styles, reusing existing tokens/conventions.
- `client/src/setupTests.ts` (new), `client/vitest.config.ts` — component-testing infrastructure.
- `client/package.json`/`package-lock.json` — `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom` added.
- `client/.env.example` — `VITE_STRUCTURED_QUESTIONS_ENABLED` documented (added post-verification — see "Post-Stage-2 manual verification" above).
- `docs/generator-v2-plan.md` — this section.

No `mobile/` files, no `server/` files, no Prisma schema/migration files were
touched this stage.

### Git status at the end of this session

Nothing has been committed or pushed. All Stage 1 + Stage 2 changes remain
uncommitted, on `feature/mobile-app`, awaiting review — per instruction,
this session does not commit or push.

### Remaining work

Stage 3 (Mobile Generator + Library — the original Phase 6 ask, §4) has not
been started. The same sequencing choice flagged at the end of Stage 1
remains open: build Phase 6 directly against this structured contract, or
ship first against the plain 4-type API and layer the upgrade on later.
Before flipping either flag on anywhere: the §7 live-Gemini token-truncation
check (never performed — all testing this session used mocked Gemini calls)
and a manual browser click-through of both pages (not performed this
session) are the two concrete open items.

---

## Implementation Log — Stage 1 (Backend), 2026-08-21

Everything in §§1–10 below is the ARCHITECTURE as approved. This section
records what actually shipped in Stage 1 and the handful of places
implementation surfaced something the architecture review couldn't have known
without writing the code.

### What was built

- **Question-type vocabulary extended** (§2a): response-level `QUESTION_TYPES`
  (`server/src/lib/assessmentSchema.js`) and request-level `QUESTION_TYPES`
  (`server/src/actions/schemas/generateAssessment.js`) both grew from 3/4
  values to include `descriptive`, `fill_blank`, `match`. `NEW_QUESTION_TYPES`
  exports just the 3 new ones, for the flag-gate check.
- **Per-type validation** (§2b): implemented as an extended `.superRefine()` on
  the existing single-object `questionSchema`, **not** `z.discriminatedUnion`
  as originally proposed — the existing "always-present, empty-when-N/A"
  field convention (already how `options`/`correctOptionIndex` work for
  `true_false`/`short_answer`) extends naturally to the 2 new fields
  (`modelAnswer`, `pairs`) without a bigger refactor, and Gemini's own
  structured-output schema has no real discriminated-union concept either —
  matching shapes on both sides was simpler than introducing one only
  Zod-side. Same validation outcomes as designed (fill_blank blank-marker
  check, match pair-count/uniqueness, descriptive non-empty modelAnswer).
- **LaTeX/math normalization and safety-rendering** (`normalizeAssessmentMath`,
  `sanitizeAssessmentDocument` in `lib/latexGuard.js`) extended to also walk
  `modelAnswer` and `pairs[].left`/`pairs[].right` — not called out as its own
  numbered section in the original plan, but required for the new fields to
  get the same math-notation repair and KaTeX-render safety check every other
  question-text field already gets.
- **Gemini response schema + prompts** (§2d/§7): `ASSESSMENT_RESPONSE_SCHEMA`
  extended with `modelAnswer`/`pairs`, both **required** fields (matching the
  existing convention that every question object states all fields, empty
  when not applicable, rather than making some fields conditionally absent).
  The per-type field-filling instructions previously existed as 2-3
  independent copies across `buildGeneratorPrompt`/`buildAssessmentSetPrompt`/
  `buildAssessmentActionPrompt` (not shared) — this session extracted them
  into one shared `QUESTION_TYPE_FIELD_RULES` constant instead of tripling the
  new-type instructions across 3 near-identical copies. `QUESTION_TYPE_CONTENT_RULES`
  gained a boot-time completeness assertion against the request-level
  `QUESTION_TYPES` (mirroring `assessmentFormats.js`'s own `FORMAT_META`
  assertion) instead of a separate new `QUESTION_TYPE_META` file — the
  server has no display-label need `QUESTION_TYPE_CONTENT_RULES` doesn't
  already fill; a client-facing label table only makes sense in
  `client/config.ts`/`mobile/config.ts` (Stage 2/3).
- **Renderer extended** (§2d): `renderAssessmentBody` gained rendering
  branches for `descriptive` (hint line + "Suggested answer:" in the key),
  `fill_blank` (blank already in the text, answer key unchanged shape), and
  `match` (a Markdown pipe-table for the two columns; answer key lists the
  pairing as `left — right`). Match-column shuffling for the printed student
  copy stays deferred, as planned.
- **Structured save/edit re-render rule** (§2c) — **the one real behavioral
  change**: `tryReadStructuredQuestions()`/`tryRenderFromStructured()` added
  to `routes/resources.js`; wired into both `POST /resources` and
  `PATCH /resources/:id`. When a request's `structured` parses to
  `{schemaVersion: 2, questions: [...]}`, the server validates it and
  re-renders `content` from it server-side, ignoring whatever `content` the
  client sent for that request. Invalid `structured.questions` → `400`.
  Anything without `schemaVersion: 2` (every existing resource) is untouched.
- **`POST /resources/generate` / `generate-set` response** (§2e): both now
  return an additive `structured` field (`{instructions, questions,
  schemaVersion: 2}` as a JSON string) alongside the unchanged `content`.
- **AI-assist actions** (§2f): `handleAssessmentAction` now branches once, at
  the top, on `tryReadStructuredQuestions(resource.structured)`. A
  new-style resource reads `{instructions, questions}` straight out of
  `structured` and skips `parseAssessmentBody`'s regex round-trip entirely
  (verified with a test that corrupts `content` beyond regex-parsing and
  confirms the action still succeeds); a legacy resource uses exactly
  today's `parseAssessmentBody` path, byte-for-byte unchanged. Both paths
  share every Gemini-call/validation/retry step below that branch — only how
  `doc` is obtained and how the final response is assembled differ. The
  response for a structured resource now additionally carries an updated
  `structured` JSON string alongside `suggestion`, so applying a suggestion
  can never leave `structured.questions` stale relative to the shown content.
  `checkAssessmentActionResult`'s `simplify_wording` answer-unchanged check
  extended with `descriptive`/`fill_blank`/`match` branches.
- **Feature flag** (§10): `STRUCTURED_QUESTIONS_ENABLED` added to
  `server/src/lib/flags.js` (`readStructuredQuestionsFlags`), mirroring
  `NOTIFICATIONS_ENABLED`'s simplest shape (single master switch, no
  allow-list yet — can add one later if a staged rollout needs it). Gates
  only `descriptive`/`fill_blank`/`match` on `POST /resources/generate` and
  `/generate-set` (`503 STRUCTURED_QUESTIONS_DISABLED` when off); the
  structured-edit re-render rule (§2c) is **not** flag-gated — once a
  resource has `schemaVersion: 2` (however it got that, flag-on at the time),
  editing it keeps working even if the flag is later turned off, so a
  rollback never orphans already-saved content. Documented in
  `server/.env.example`. `VITE_STRUCTURED_QUESTIONS_ENABLED` added to
  `client/src/config.ts` (constant only — no UI wired yet, that's Stage 2).

### What §2h resolved (the flagged open question)

The plan explicitly flagged as unverified whether the AI Action Router's
classifier prompt embeds `questionType`'s enum values the same way it's known
to embed `format`'s (`ROUTABLE_FORMATS`). **Confirmed empirically**: it does.
Widening `QUESTION_TYPES` alone broke
`test/assistant/recoveryIsolation.test.js`'s `FROZEN_PROMPT_SHA16` pin (a
live-eval-backed baseline the test explicitly forbids updating on a plain
constant edit — "a full live pass and a variance band, not a replay"). Fix,
mirroring the *already-existing* `ROUTABLE_FORMATS` pattern exactly: added
`ROUTABLE_QUESTION_TYPES = ['mcq','true_false','short_answer','mixed']` (the
original 4, frozen) in `generateAssessment.js`, and pointed
`descriptors/generateAssessment.js`'s `questionType` slot at it instead of the
full `QUESTION_TYPES`. The classifier prompt is now provably unchanged (test
passes as originally written, no baseline edit). A teacher can still request
any of the 3 new types directly through the Generator form — they are simply
not yet routable by name through the assistant, exactly like `exit_ticket`/
`homework` formats already aren't. Widening `ROUTABLE_QUESTION_TYPES` later
needs the same "budget a live eval pass" treatment `ROUTABLE_FORMATS` already
documents.

### Minimal client-side follow-through (not full Stage 2)

Extending `QUESTION_TYPES` server-side is pinned by an existing cross-package
drift-guard test (`server/test/assistant/contractDrift.test.js`, "question
types match") that reads `client/src/config.ts` as text and compares its
`QUESTION_TYPES` values against the server's — this test is **not** new, it
already existed to keep the two in sync, and it fails the moment the server
list grows unless the client list grows with it in the same commit (exactly
the discipline the file's own comments describe). To keep the existing suite
green, this session:
- Extended `client/src/config.ts`'s `QUESTION_TYPES` to the same 7 values
  (labels: `Descriptive`, `Fill in the Blank`, `Match the Following`, and
  `Short Answer (SAQ)` — see the terminology note below), and added the
  `STRUCTURED_QUESTIONS_ENABLED`/`VITE_STRUCTURED_QUESTIONS_ENABLED` pair.
- Widened `client/src/lib/resources.ts`'s `QuestionType` union and added an
  additive `structured?: string` field to `GenerateAssessmentResult`/
  `GenerateSetResult` (typed, not yet consumed by any screen).
- Widened `client/src/assistant/generatorPrefill.ts`'s hand-written
  `questionType` union (was narrower than the picker itself even before this
  change) to reuse `QuestionType` instead of a second copy, fixing a real
  `tsc --noEmit` failure this surfaced.
- **No UI changes** — `GeneratorPage.tsx`/`ResourceWorkspace.tsx` render
  exactly as they did before. This is intentionally *not* Stage 2 (§3) — just
  enough type-level truth to keep `tsc --noEmit` and the existing test suites
  green, since types are shared, load-bearing infrastructure this repo
  already pins across packages.
- **Mobile was NOT touched** — `mobile/src/config.ts`/`mobile/src/api/resources.ts`
  still have the original 4-value `QuestionType`. Nothing in the currently
  running test/typecheck suites pins mobile against the server's vocabulary
  (Phase 6 hasn't started, so nothing consumes it yet), so this was left for
  Stage 3, not done speculatively.

### Terminology decision (§8), as shipped

"SAQ" is a display label on the existing `short_answer` type, not a new type
— `QUESTION_TYPE label: 'Short Answer (SAQ)'` on the client picker. Flagged in
the plan as open for revision before implementation; nothing since has
suggested otherwise, so it shipped as designed.

### Tests added

- `server/test/lib/assessmentSchema.test.js`: +11 tests (all 6 types together,
  each new type's validation rules, match pair-count/duplicate-left checks,
  fill_blank blank-marker detection, and a check that a question object built
  without `modelAnswer`/`pairs` at all — exactly what the legacy
  content-parser constructs — still validates via the new fields' defaults).
- `server/test/resources.test.js`: +17 tests across three new `describe`
  blocks — (1) new-type generation: 503-when-flag-off, original 4 types
  unaffected by the flag, and each new type's `structured` response +
  rendering (descriptive hint/suggested-answer, fill_blank blank+key, match's
  pipe-table+key) with the flag on; (2) the save/edit re-render rule: POST
  with `structured.questions` renders `content` server-side and ignores
  client-sent `content`, invalid `structured.questions` → 400, a legacy
  `structured` payload (no `schemaVersion`) leaves `content` untouched, PATCH
  with an edited (question deleted) `structured.questions` re-renders and
  drops that question from `content`, and a legacy resource's plain
  content-edit PATCH is unaffected; (3) the ai-action structured path: a
  `make_harder` call on a `schemaVersion: 2` resource still succeeds after
  `content` is corrupted beyond regex-parsing (proving it read `structured`,
  not `content`) and returns an updated `structured` alongside `suggestion`,
  and `more_questions` correctly appends to (rather than replaces) the
  existing structured question array.
- No mobile or web UI tests were added — no UI code was written.

### Verification performed

- `npx vitest run` (full backend suite, from `server/`): **2144/2145
  passing** (84 files). The 1 failure
  (`test/resources.test.js > notification hook on save > creates exactly one
  lesson_generated notification...`) was verified **pre-existing** — it fails
  identically on the unmodified codebase (`git stash` + re-run, confirmed
  byte-for-byte the same assertion failure before any of this session's
  changes existed). Root cause (diagnosed, not fixed — out of scope for this
  session): the "create" `describe` block's `afterEach` only clears
  `prisma.resource`, never `prisma.notification`, and `NOTIFICATIONS_ENABLED=true`
  in `.env` means earlier successful `createFor()` calls in that block leak
  notification rows into the later "notification hook on save" block's count.
  Not touched, since it is unrelated to the Structured Question Model and
  fixing shared test fixtures wasn't asked for.
- `npx tsc --noEmit -p .` (from `client/`): clean.
- `npm test -- --run` (from `client/`): **482/482 passing** (29 files) — zero
  regressions from the minimal type-level changes above.
- Mobile: **not run** — no mobile files were touched this session.

### Files changed (Stage 1)

- `server/src/lib/assessmentSchema.js` — vocabulary, per-type schema, LaTeX-normalization extension.
- `server/src/lib/latexGuard.js` — `sanitizeAssessmentDocument` extended for `modelAnswer`/`pairs`.
- `server/src/lib/flags.js` — `readStructuredQuestionsFlags`.
- `server/src/actions/schemas/generateAssessment.js` — vocabulary + `ROUTABLE_QUESTION_TYPES`.
- `server/src/actions/descriptors/generateAssessment.js` — `questionType` slot now uses `ROUTABLE_QUESTION_TYPES`.
- `server/src/routes/resources.js` — prompts, response schema, renderer, flag gate, structured-read/render helpers, POST/PATCH wiring, `handleAssessmentAction` branch.
- `server/.env.example` — `STRUCTURED_QUESTIONS_ENABLED` documented.
- `server/test/lib/assessmentSchema.test.js`, `server/test/resources.test.js` — new tests (above).
- `client/src/config.ts` — vocabulary + labels + `STRUCTURED_QUESTIONS_ENABLED`.
- `client/src/lib/resources.ts` — `QuestionType`/`structured` field widening.
- `client/src/assistant/generatorPrefill.ts` — `questionType` type fixed to reuse `QuestionType`.

No `client/` or `mobile/` UI files, no Prisma schema/migration files, were
touched. `docs/mobile-app-plan.md` has a short pointer to this document added
under its Phase 6 status row; Phase 6 itself has not started.

### Git status at the end of this session

Nothing has been committed. All changes above are uncommitted, on
`feature/mobile-app`, awaiting review — per instruction, this session does not
commit or push.

### Remaining work

Stage 2 (Web Generator + Workspace UI, §3) and Stage 3 (Mobile Generator +
Library — the original Phase 6 ask, §4-5) have not been started. Recommend
reviewing this Stage 1 diff before either begins, and deciding then whether
Phase 6 should build directly against this new structured contract or ship
first against the original 4-type API per the plan's own sequencing note
(§10, bottom) — both remain valid, zero-rework-either-way paths per §6's
backward-compatibility guarantee.

---

# Approved Architecture (as reviewed, unchanged below)

## Context

The current Generator (web `GeneratorPage.tsx`, backend `POST /api/resources/generate`) produces one **markdown text blob** per request. The request-level `questionType` enum is only `mcq | true_false | short_answer | mixed`, and there is no per-question object model anywhere — not in the database, not in either client. Editing happens by retyping the whole markdown string in a `<textarea>` (`ResourceWorkspace.tsx` web, `ResourceEditScreen.tsx` mobile).

The user wants the Generator to eventually treat each question as a **real structured object** — MCQ, Descriptive, True/False, Fill-in-the-Blank, Match, SAQ — each individually editable, reorderable, deletable, and previewable, on **both** web and mobile, without breaking any resource already saved today. This document is the design for that, produced after reading (via 3 parallel research passes) the full `Resource` Prisma model, `server/src/routes/resources.js` (1382 lines), the assessment Zod schema/renderer (`assessmentSchema.js`, `assessmentFormats.js`), the AI Action Router's registry/descriptor coupling, the web Generator/Workspace/lib files, and the mobile Library screens/components/theme.

**The single most important finding**: Gemini is **already** asked to return structured JSON for every assessment generation and AI-assist call (`responseSchema` → `{instructions, questions: [{type, text, options, correctOptionIndex, correctAnswer}]}`, validated by `assessmentDocumentSchema`). The server renders that JSON to markdown and **threw it away** before responding, prior to this session. Building the structured model is therefore mostly about **keeping data the backend already produces**, not inventing new AI behavior — plus extending the type vocabulary from 3 types to 6, and giving both clients a real editor over the array instead of one `<textarea>`.

---

## 1. Database / schema changes

**Recommendation: zero new tables, zero new columns, zero new Prisma migration.**

`Resource.structured` (`server/prisma/schema.prisma:250`, `String?`) is already a JSON-as-string column, already used for exactly this kind of thing (`examMeta`, and today's flat `{format, difficulty, questionType, questionCount, topic}` generator config — `GeneratorPage.tsx:344`). This is the same "JSON string, no DB-level shape enforcement" convention used by `User.preferences`, `Query.context/classroomPlan/classroomArtifacts`, `Student.details`, `Event.metadata`, `Notification.metadata` — validated only in each route's Zod schema, never at the DB layer.

New shape stored in that same column, additive to the existing keys:
```jsonc
{
  "format": "quiz", "difficulty": "medium", "questionType": "mixed",
  "questionCount": 10, "topic": "Fractions", "examMeta": { ... },   // unchanged, existing keys
  "schemaVersion": 2,                                               // NEW — explicit marker
  "instructions": "...",                                            // NEW — the document's instructions line
  "questions": [                                                    // NEW — the structured array
    { "id": "q1", "type": "mcq", "text": "...", "options": ["...","...","...","..."], "correctOptionIndex": 1, "correctAnswer": "..." },
    { "id": "q2", "type": "fill_blank", "text": "The capital of France is _____.", "correctAnswer": "Paris" },
    { "id": "q3", "type": "match", "text": "Match the term to its definition.", "pairs": [{ "left": "...", "right": "..." }] },
    { "id": "q4", "type": "descriptive", "text": "...", "modelAnswer": "..." }
  ]
}
```
`schemaVersion: 2` is the authoritative "does this resource have structured questions" check (cheaper and more future-proof than `Array.isArray(structured.questions)` alone, though both are checked). Absent/undefined `schemaVersion` (every resource that exists today) means "legacy, markdown-only" — permanently, no backfill.

Per-question `id` (client-generated, e.g. `crypto.randomUUID()` on web / `expo-crypto` or a simple counter on mobile) exists purely so reorder/delete/edit can key a list without relying on array index — never sent to Gemini, never validated server-side beyond "is a non-empty string." (Not yet consumed — no client editor exists yet.)

**Why not a relational `Question` table** (considered and rejected for V1): would be the first true child-table-per-row model in this schema, needs a migration, an FK, cascade-delete handling, and multi-row transactional writes for reorder (delete+recreate or upsert-by-order) for zero current benefit — nothing today needs to query/analyze individual questions across resources, and the whole document is always read/written as one unit (exactly like `examMeta` today). If cross-resource question analytics or reuse is ever wanted, that's a clean additive migration later; nothing in this plan forecloses it.

**Size check**: `MAX_STRUCTURED = 50000` chars (`routes/resources.js:78`) already caps this column. A 30-question document with the richest type (`match`, several pairs) serializes to roughly 3-6 KB — comfortably under the cap; no change needed.

---

## 2. Backend API changes

All changes are **additive** to existing endpoints — no new routes, no URL changes. One genuine new behavior is called out explicitly (2c). **See the Implementation Log above for what actually shipped vs. this original design.**

### 2a. Question-type vocabulary (extend, don't replace)
- `server/src/lib/assessmentSchema.js:18` response-level `QUESTION_TYPES` grows from `['mcq','true_false','short_answer']` to `['mcq','true_false','short_answer','descriptive','fill_blank','match']`. ("SAQ" is a display label for `short_answer`, not a new type — see §8.)
- `server/src/actions/schemas/generateAssessment.js:73` request-level `QUESTION_TYPES` grows the same way (still keeps `'mixed'` as a request-only modifier meaning "let the model pick a mix across whichever types are eligible").
- **Same-commit discipline already established by this codebase** (`generateAssessment.js:30-36` comment) applies: `client/src/config.ts` and `mobile/src/config.ts`'s `QUESTION_TYPES` must change in the same commit, or the existing drift-guard tests fail — extend, don't bypass, that guard.
- `server/src/lib/assessmentFormats.js`-style boot-time assertion (that pattern's `84-98`) gets a twin: a new `QUESTION_TYPE_META` table (label, short hint, per-type field requirements) with a boot assertion that its keys match `QUESTION_TYPES` exactly — same fail-fast discipline already proven for `FORMAT_META`. **(Shipped instead as a completeness assertion on the existing `QUESTION_TYPE_CONTENT_RULES` — see Implementation Log.)**

### 2b. Per-type Zod payload (extend `questionSchema`, `assessmentSchema.js:209-256`)
Discriminated by `type` (**shipped as an extended `.superRefine()`, not `z.discriminatedUnion` — see Implementation Log**):
- `mcq` — unchanged: `options` exactly 4 (`OPTION_LETTERS` stays A-D), `correctOptionIndex`, `correctAnswer`.
- `true_false` — unchanged: `correctAnswer` ∈ `{'True','False'}`.
- `short_answer` (SAQ) — unchanged: short `correctAnswer` (≤500 chars).
- `descriptive` — **new**: `modelAnswer` (longer bound, e.g. ≤2000 chars) instead of `correctAnswer` — open-ended, paragraph-style expected response.
- `fill_blank` — **new**: `text` must contain a blank marker (`superRefine` requiring ≥3 consecutive underscores, matching the `____________` convention already used by `ExamHeaderView.tsx`'s blank placeholder); `correctAnswer` is the word/phrase that fills it.
- `match` — **new**, structurally different (no `options`/`correctOptionIndex`): `pairs: {left, right}[]`, bounded 3–8 pairs, `superRefine` rejecting duplicate `left` values. The correct mapping *is* the given pair order — no separate answer-key field needed.

### 2c. The one real behavioral change: server-side re-render on structured edits
Today `PATCH /resources/:id` overwrites whatever `content`/`structured` the client sends, verbatim (`routes/resources.js:870-885`). New rule, additive and narrow: **whenever a request (`POST /resources` create or `PATCH /resources/:id` update) includes a `structured` payload whose parsed JSON has a valid `questions` array, the server re-renders `content` from that array itself** (reusing `renderAssessmentMarkdown`/`renderAssessmentBody`, extended per §2d) **and ignores any `content` the client sent in the same request**. If `structured` has no `questions` array (every existing resource, and any non-assessment type), behavior is byte-for-byte unchanged.

Why here and not client-side rendering: `content` is the one thing three other subsystems already depend on unchanged — full-text search (`GET /resources?q=`, matches against `content`), PDF export (`buildResourcePdfHtml.ts`), and the legacy AI-assist regex-parser for old resources. Keeping "structured JSON → markdown" as a single, deterministic, server-owned function (exactly today's existing philosophy for generation) means `content` can never drift from `structured.questions`, and neither web nor mobile has to duplicate rendering logic just to keep `content` correct after a reorder/delete/edit. Both clients only ever send the edited `questions` array; the server computes what it has always computed.

### 2d. Renderer extension (`renderAssessmentMarkdown`/`renderAssessmentBody`, `resources.js:394-460`)
Add one rendering branch per new type, following the existing numbered-question + lettered-option convention:
- `fill_blank` — question text rendered as-is (it already contains `_____`); answer key line unchanged format.
- `descriptive` — question text + a line hint ("Write your answer in 3–5 sentences."); answer key shows "Suggested answer: …" instead of a short correct-answer line.
- `match` — two-column rendering ("Column A" / "Column B", `left`/`right` in the given order — see note below on shuffling); answer key lists the pairs as given.
- **Deferred, not V1**: shuffling the Match right-hand column for the printed *student* copy (vs. the answer key) so it's a genuine matching exercise rather than a pre-solved list. Small, self-contained follow-up once the base type ships — flagging it now so it isn't forgotten, not blocking this plan.

### 2e. `POST /resources/generate` / `generate-set` response shape
Extend the success response from `{ content, requestId }` to `{ content, structured, requestId }`, where `structured` is `{ questions, schemaVersion: 2 }` (the same object shape §1 describes, minus the fields the caller already has — `format`/`topic`/etc. — those stay client-side, assembled at save time exactly as `GeneratorPage.tsx:344` does today). Old callers (mobile Phase 5 already wired, any external script) that only read `.content` are unaffected — this is a pure additive field.

### 2f. AI-assist actions (`handleAssessmentAction`, `resources.js:894-1008`)
Branch on whether the resource already has `structured.questions` (schemaVersion 2):
- **New-style resource**: read `questions` directly from `structured` — skip `parseAssessmentBody`'s regex round-trip entirely. This removes a whole fragile-parsing failure class for any resource created after this ships, which is a genuine reliability win the research flagged independently.
- **Legacy resource** (no `structured.questions`): fall back to exactly today's `parseAssessmentBody` → Gemini → `checkAssessmentActionResult` → `renderAssessmentBody` pipeline, unchanged. Never force a legacy resource through the new path.
- `checkAssessmentActionResult` (`670-704`) gets new per-type invariant branches (e.g. `simplify_wording` must not touch `pairs`/`correctAnswer` for `match`/`fill_blank`, mirroring the existing "must not change any correct answer" rule).

### 2g. Feature-flag gate (kill-switch behavior, detail in §10)
If `STRUCTURED_QUESTIONS_ENABLED=false` server-side and a request's `questionType` (or a `generate-set` item's `questionType`) is one of the three genuinely new values (`descriptive`, `fill_blank`, `match`), the route returns `503 { error, code: 'STRUCTURED_QUESTIONS_DISABLED' }` — the same `*_DISABLED` contract already documented for Classroom/Notifications (mobile plan §4.2). `mcq`/`true_false`/`short_answer`/`mixed` keep working unconditionally (flag only gates the *new* vocabulary and the structured-edit re-render rule in §2c, never the existing 3-type behavior). **(Shipped: the re-render rule itself is NOT flag-gated — see Implementation Log for why.)**

### 2h. AI Action Router ripple (registry.js fail-fast coupling) — **RESOLVED, see Implementation Log**
`descriptors/generateAssessment.js`'s `questionType` slot `vocab`/`askOptions` must be updated in the same commit as §2a (the registry's `validateSlotsAgainstSchema` throws at boot otherwise — this is a hard, already-proven coupling, not new risk). The open question — whether the router's classifier prompt embeds the `questionType` vocabulary the same way `ROUTABLE_FORMATS` is "frozen" for `format` — was confirmed true during implementation; fixed via a new `ROUTABLE_QUESTION_TYPES` frozen subset, exactly mirroring `ROUTABLE_FORMATS`.

---

## 3. Web Generator impact

- `client/src/lib/resources.ts` — extend `QuestionType`, add discriminated `Question` union type (mirroring the new Zod union), extend `GenerateAssessmentResult`/`GenerateSetResult` to carry `structured?: { questions: Question[]; schemaVersion: number }`. **(`QuestionType`/`structured?: string` shipped in Stage 1 as minimal type-level follow-through; the `Question` union itself is still Stage 2 work.)**
- `client/src/config.ts` — extend `QUESTION_TYPES` (same commit as backend, per the existing drift-guard comment at `config.ts:201-214`), add `QUESTION_TYPE_META` (label/hint/icon per type, mirroring `RESOURCE_TYPE_META`'s existing label+icon-map convention). **(`QUESTION_TYPES` values/labels shipped in Stage 1; no icon map yet.)**
- `GeneratorPage.tsx` — when `VITE_STRUCTURED_QUESTIONS_ENABLED` and the generate response includes `structured.questions`, the Edit/Preview tabs are joined by a third mode: a per-question card list (add/reorder/delete/edit-in-place), built new (no existing web component does this — confirmed by research, no `Question[]`/reorder pattern exists anywhere in `client/src` today). Reordering can use plain HTML5 drag-and-drop (`draggable` attribute) — zero new dependency, a nice contrast to mobile where no drag library is installed (§4). **(Not started.)**
- `ResourceWorkspace.tsx` (`/library/:id/edit`) — on load, if `parseExamMeta`-style read of `structured` shows `schemaVersion: 2` with a `questions` array, render the same new per-question editor instead of the flat `<textarea>`; otherwise render exactly what exists today (this is the backward-compatibility fork — §6). Save still does the existing minimal-diff PATCH (`handleSave`, `ResourceWorkspace.tsx:229-268`), just including the edited `questions` array inside `structured` when present — the server does the re-render (§2c), the client never computes `content` itself. **(Not started.)**
- AI Assist (`AI_ACTIONS`, `ResourceWorkspace.tsx:66-76`) — `more_questions`/`make_easier`/`make_harder`/`simplify_wording` keep working unchanged; for a structured resource the suggestion preview can optionally show a per-question diff instead of a whole-string replace, but that's a UX nicety, not required for V1 (the existing "Apply to editor" whole-replace pattern is a safe, simple default to ship first).
- `client/src/lib/format.ts` — extend the existing MCQ-option/answer-key regex passes with matching passes for `fill_blank`/`descriptive`/`match` markdown conventions (§2d), so on-screen print preview of the *rendered* `content` (still markdown, still needed for print/PDF) displays new types correctly. This is the same kind of visual-only extension `format.ts` already does for MCQ options — not new architecture. **(Not started.)**

---

## 4. Mobile Generator implementation

This is what Phase 6 becomes, once this architecture is approved. **Not started — Stage 3.**

- `mobile/src/api/resources.ts` — extend `QuestionType`/add `Question` union + `structured` field on generate results, mirroring §3 exactly (types should be near-identical to the web ones, per the existing "port types verbatim" convention from Phase 1).
- `mobile/src/config.ts` — extend `QUESTION_TYPES`, add `QUESTION_TYPE_META`, same-commit as backend/web.
- **New screens** (`mobile/src/screens/generator/*`, replacing the two `PlaceholderScreen`s in `GeneratorStack.tsx`):
  - `GeneratorFormScreen` — format/topic/grade/subject/difficulty/questionType/count/instructions form, built from existing primitives (`ChipPicker` for format/difficulty/questionType — it's already the app's closed-vocabulary single-select primitive, used identically for `RESOURCE_TYPES`/`LANGUAGES`/`GRADES` today; `TextField`/`SuggestionChips` for topic/grade/subject, matching `ResourceEditScreen.tsx`'s exact style).
  - `GeneratorResultScreen` — on a structured response (`structured.questions` present), a **native question-card list**: each card shows a type badge, the question text, and type-specific summary (options/answer, blank/answer, pairs, model answer), with per-card **Edit** (opens a type-specific edit sheet — reuses `TextField`/`ChipPicker`, one small form per type, similar scope to `ExamHeaderEditor.tsx`'s per-field form pattern) and **Delete** (confirm via `Alert.alert`, same pattern as `ResourceListScreen.tsx`/`ResourceViewScreen.tsx` delete-with-confirm today), plus **Reorder** controls.
  - **Reorder without a new dependency**: no drag-and-drop library is installed in `mobile/package.json` today. Recommendation for V1: simple **Move Up / Move Down** icon buttons per card (cheap, fully accessible, zero new native dependency) rather than pulling in `react-native-draggable-flatlist` now. A real drag gesture is a reasonable fast-follow, not a V1 blocker.
  - When the response has **no** `structured.questions` (flag off, or a format that doesn't route through the assessment schema), fall back to exactly the current single-markdown-blob flow — Phase 6 always ships a working Generator even before this architecture lands, if sequencing requires it (see §10).
- **Save to Library**: same as web — `createResource` sends the initial server-rendered `content` plus `structured` (including `questions`) as returned by `generate`; any further edits to the question list before/after saving go through `updateResource`/`PATCH` with only the edited `structured.questions`, letting the server re-render `content` (§2c).
- **Library integration on mobile**: `ResourceEditScreen.tsx` gets the identical fork described for `ResourceWorkspace.tsx` in §3 — if the loaded resource's `structured` has `schemaVersion: 2`, show the new per-question editor (same components as `GeneratorResultScreen`, factored into a shared `QuestionListEditor` used by both screens); otherwise render exactly today's flat `TextInput` editor, unchanged.
- **PDF export**: `mobile/src/lib/formatHtml.ts`/`buildResourcePdfHtml.ts` get the same three new-type rendering branches as web `format.ts` (§3) — both are independent ports of the same markdown convention, so both need the extension in lockstep.
- **Tests**: new component tests for the question-card list (add/reorder/delete/edit, per RNTL conventions already established in `ResourceEditScreen.test.tsx`), unit tests for the mobile `Question` type guards/validation, extended `formatHtml.test.ts`/`buildResourcePdfHtml.test.ts` for the new type markup.

---

## 5. Library integration (both platforms)

Single rule, stated once because it governs both `ResourceWorkspace.tsx` and `ResourceEditScreen.tsx` identically:

> **On load**: `schemaVersion === 2 && Array.isArray(structured.questions)` → structured question-list editor. Anything else → today's flat markdown editor, byte-for-byte unchanged.
>
> **On save**: if the structured editor was used, PATCH sends the edited `questions` array inside `structured`; the server re-renders `content` (§2c) so search/PDF/print keep working off `content` exactly as they do today, with zero new code in the search or export paths.

This means Library needs **no new endpoints**, and the existing `ResourceListScreen`/`ResourceViewScreen` (mobile) and their web equivalents need **no changes at all** — they already just display `title`/`grade`/`subject`/a content preview and don't care how `content` was produced.

---

## 6. Migration / backward compatibility for existing resources

- **No backfill, ever** — matches this repo's own stated migration philosophy (every sampled past migration is additive/nullable, no data-rewrite scripts). Every resource saved before this ships keeps `structured` exactly as it is (`null`, or the flat `{format,difficulty,questionType,questionCount,topic,examMeta}` shape with no `schemaVersion` key) and is edited via the legacy flat-textarea path **forever**, unless a teacher explicitly regenerates it through the new Generator (which creates a brand-new resource, not a mutation of the old one).
- `schemaVersion` absence is the only compatibility check needed anywhere (client and server) — no version-migration code, no "upgrade this resource" action.
- AI-assist on old resources: unchanged code path (§2f) — the fragile regex round-trip stays exactly as it is today for anything that predates this feature. It is not being removed, only bypassed for new-style resources.
- Search (`GET /resources?q=`) needs no change — it matches `content`, which is always populated for every resource regardless of `schemaVersion`.
- Any resource sync/export tooling that only reads `content` (PDF export, print, any future integration) is completely unaffected — `content` is a permanent, always-populated, always-server-rendered field for assessments, structured or not.

---

## 7. AI generation response format

- **Gemini's `responseSchema`** (`ASSESSMENT_RESPONSE_SCHEMA`, `resources.js:245-265`) gains the 3 new type shapes as additional required properties on the existing per-question object schema (empty-when-N/A, matching the existing convention).
- **Real risk, flagged explicitly**: `GeminiService.generateContent`'s `MAX_TOKENS` continuation loop is *skipped whenever `responseSchema` is set* — because splicing continued text into a truncated JSON document isn't safe. A richer schema makes a large `questionCount` (up to `MAX_QUESTIONS = 30`) more likely to hit the token ceiling with no automatic recovery. **Status: still unverified against a real Gemini call** (this session mocked Gemini for all new tests, per the existing test convention — no live API key was exercised). Recommend an explicit manual check (generate a real 30-question `mixed`/`match`-heavy set against the live model) before flipping `STRUCTURED_QUESTIONS_ENABLED` on anywhere.
- The server still fully owns turning validated JSON into the final markdown `content` (§2d) — Gemini's output is never shown to a teacher or stored raw.

---

## 8. Validation

- **Server**: per-type validation (§2b) enforced on: (a) Gemini's response before it's ever rendered or returned, (b) any client-submitted `structured.questions` on create/update (shipped — see Implementation Log).
- **Client**: a lightweight pre-Save validator mirroring the server's per-type rules — **not yet built** (Stage 2/3 work; no client editor exists yet to validate).
- **Terminology decision, as shipped**: "SAQ" is a display label for `short_answer`, not a new type. See Implementation Log.

---

## 9. Tests

See the Implementation Log above for exactly what was added in Stage 1. Still open for Stage 2/3:

| Area | File | What's needed |
|---|---|---|
| Web Generator/Workspace | new `GeneratorPage.test.tsx`-equivalent (none exist today) | Structured mode add/reorder/delete/edit, legacy fallback |
| Mobile Generator | `mobile/src/screens/generator/__tests__/*` (new) | RNTL tests mirroring `ResourceEditScreen.test.tsx` conventions |
| Mobile Library fallback | `mobile/src/screens/library/__tests__/ResourceEditScreen.test.tsx` | Structured resource shows new editor; legacy resource shows unchanged flat editor |
| Renderer parity | new small unit tests | Web `format.ts` / mobile `formatHtml.ts` per-type HTML |
| Live-model token-budget check | manual, not automatable in CI | §7's `MAX_TOKENS`/`match`+`descriptive` risk |

---

## 10. Rollout and feature-flag strategy

Two-tier flag, exactly the established pattern (`ASSISTANT_ENABLED`/`CLASSROOM_MANAGEMENT_ENABLED` etc. — client flag hides UI, server flag is the real gate):

- `STRUCTURED_QUESTIONS_ENABLED` (server, `server/.env.example`, default `false`) — **shipped**. Real gate; new question-type values 503 with `STRUCTURED_QUESTIONS_DISABLED` while off (§2g); everything else (existing 3 types, existing markdown-only flow) works identically regardless of this flag's value.
- `VITE_STRUCTURED_QUESTIONS_ENABLED` (web) — **shipped, constant only, not wired to any UI yet**. Mobile's `EXPO_PUBLIC_STRUCTURED_QUESTIONS_ENABLED` — **not shipped** (Stage 3).

Staged build-out:

1. **Backend only** (§1-2, §7-9 server rows) — ✅ **DONE this session**. Flag off by default. Nothing user-visible changed.
2. **Web Generator + Workspace** (§3) — ⬜ not started.
3. **Mobile Generator + Library** (§4-5) — ⬜ not started — the actual Phase 6 work.
4. **Turn flags on** in a real environment — ⬜ not started; blocked on the §7 live-model token-budget check plus Stages 2/3 existing.
5. Flags stay in place indefinitely as a rollback lever once flipped on.

**Sequencing note for the user's original Phase 6 ask, unchanged**: mobile Phase 6 can still ship using the **existing** 4-type API (`mcq/true_false/short_answer/mixed`, one markdown blob) if a nearer-term deadline requires it, and the structured-question upgrade becomes additive on top later with zero rework — an unflagged mobile Generator built today is simply "a resource with no `schemaVersion`," which the new editor (once built) already knows how to leave alone.
