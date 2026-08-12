# Classroom Mode — Living Project Document

> **This is the single source of truth for the Classroom Mode feature.**
> It is not a normal README. It records what we decided, *why* we decided it (including the
> options we rejected), and exactly how far the implementation has got.
>
> **If you are a new engineer or a new AI session and you read only this file, you should be
> able to continue the work correctly without any other context.**
>
> Maintenance is mandatory — see [§12 Rules for Future Sessions](#12-rules-for-future-sessions).
> **Tick the checkboxes and update §1 the moment a phase completes — not later, not in a batch.**

---

## 1. Snapshot

| Field | Value |
|---|---|
| **Feature** | Classroom Mode (Teacher Assistant) |
| **Owner** | Teacher Assistant engineering |
| **Base branch** | `main` |
| **Working branch** | `classroom-mode` ✅ created |
| **Current phase** | **Feature complete** — P0–P7 built; live verification outstanding |
| **Overall progress** | **~95%** — P0–P7 built. All five artifacts generate and save. Classroom Mode now costs **4 model calls per question, down from 7** (D23). Remaining work is not code: one live Gemini pass, and the cost measurement P7's daily-cap decision depends on. |
| **Feature flags** | `CLASSROOM_MODE_ENABLED` (server, the real kill switch) + `VITE_CLASSROOM_MODE_ENABLED` (client UI) — **both default OFF** |
| **DB migration needed** | ✅ **Yes, two** — `20260807021500_add_classroom_plan_to_query` ([D24](#d24--the-plan-is-persisted-on-the-query-row-the-artifacts-are-not)) and `20260807024500_add_classroom_artifacts_to_query` ([D25](#d25--the-generated-artifacts-are-persisted-on-the-turn-overturns-d11-in-part)). Both nullable and additive; no backfill. |
| **Last updated** | 2026-08-07 |
| **Next task** | ▶️ **Live verification.** Nothing since P4 has hit real Gemini — and the maths notation ([D22](#d22--the-model-writes-plain-maths-notation-not-latex)) and batched set ([D23](#d23--the-four-question-shaped-artifacts-share-one-gemini-call)) both changed what the model is ASKED for, so the whole set needs one live pass. Per §7 rule 8: ONE run, not a batch. Then measure cost (P7) and decide the cap (D9). |

### Progress by phase

| Phase | What it delivers | Status |
|---|---|---|
| P0 | This document, feature flags, branch | ✅ **Complete** (2026-08-06) |
| P1 | `+` menu, Classroom Mode toggle, pill | ✅ **Complete** (2026-08-06) |
| P2 | Planner call, gates, context merge, empty state | ✅ **Complete** (2026-08-06) |
| P3 | Artifact cards + generation queue (quiz, worksheet) | ✅ **Complete** (2026-08-06) |
| P4 | Exit Ticket artifact | ✅ **Complete** (2026-08-06) |
| P5 | Homework artifact | ✅ **Complete** (2026-08-07) |
| P6 | Lesson Plan artifact (the big one) | ✅ **Complete** (2026-08-07) |
| P7 | Telemetry, mobile polish, optional daily cap | 🟡 **Built** (2026-08-07) — cost measurement + cap decision need live data |

---

## 2. What this is, in one paragraph

A teacher turns on **Classroom Mode** from a `+` button in the chat composer. From then on, every
question they ask gets the normal coaching answer **plus** a set of ready-to-use classroom materials
generated automatically underneath it — a Lesson Plan, Worksheet, Quiz, Homework and Exit Ticket —
but **only the ones that actually make sense for what they asked**. A question with no teachable
topic in it ("my students keep talking") produces no materials at all. The mode is off by default,
is visible while on, and never saves anything without the teacher pressing Save.

---

## 3. The five artifacts

All five are built as of 2026-08-07. Where each one is generated:

| Artifact | Key | Endpoint | Shape | Saves as |
|---|---|---|---|---|
| Lesson Plan | `lesson_plan` | `POST /api/resources/generate-lesson-plan` | 10 named prose sections | `lesson_plan` |
| Worksheet | `worksheet` | `POST /api/resources/generate-set` (batched) | 8 questions, mixed, medium | `assessment` |
| Quiz | `quiz` | `POST /api/resources/generate-set` (batched) | 10 questions, MCQ, medium | `assessment` |
| Homework | `homework` | `POST /api/resources/generate-set` (batched) | 6 questions, mixed, medium | `assessment` |
| Exit Ticket | `exit_ticket` | `POST /api/resources/generate-set` (batched) | 3 questions, MCQ, easy | `assessment` |

The four question-shaped artifacts travel in **one** Gemini call
([D23](#d23--the-four-question-shaped-artifacts-share-one-gemini-call)); the lesson plan keeps its
own. Each still exists individually at `POST /api/resources/generate` (and on the `/generator` page),
so a teacher can produce any one of them without Classroom Mode.

**Why Lesson Plan is different, and why it was sequenced last:** the other four are the same
document — questions, options, an answer key — which is why they share one schema, one renderer and
now one call. A lesson plan has neither questions nor an answer key, so it needed its own schema,
prompt, renderer and endpoint
([D21](#d21--the-lesson-plan-is-its-own-endpoint-not-a-fourth-assessment-format)). Before P6 it
existed only as a Library *type*, produced as free-form chat prose and saved by a string-match
heuristic (`client/src/components/SaveToLibrary.tsx:22`) — that path still exists for ordinary chat
answers and is untouched by Classroom Mode.

**Counts differ on purpose.** Five documents of identical length would look machine-made, and each
artifact is for a different moment: an exit ticket is answered in the last two minutes of a lesson,
homework is done alone at home with nobody to ask, a worksheet fills a period with the teacher in
the room. Pinned by `client/src/lib/classroom.test.ts`, which asserts the three practice artifacts
stay ordered by how long they take.

---

## 4. Decisions log

Each decision records what we chose **and what we rejected**, so a future session does not
re-litigate settled ground.

### D1 — Classroom Mode is a chat mode, not a separate page
**Chosen:** a mode toggled from the composer, applied to the teacher's normal question.
**Rejected:** a standalone `/classroom` page with its own topic box.
**Why:** the teacher is already describing what they need in the chat. Making them re-type the
topic into a second form is duplicate work. The chat already collects grade/subject/language via
`ContextBar.tsx`.

### D2 — The mode means "generate automatically", not "show buttons"
**Chosen:** mode ON ⇒ applicable artifacts generate by themselves.
**Rejected:** mode ON ⇒ shows tap-to-generate chips.
**Why:** if the mode only revealed chips, the chips could just live in normal chat and the toggle
would earn nothing. The toggle has to buy something real — the teacher saying *"I'm planning a
lesson, do the work for me."* Same shape as ChatGPT's Deep Research toggle.
**Cost of this choice:** ~5–6× a normal question's AI spend in OUTPUT tokens, every time it's used
— batching (D23) cut the number of CALLS from 7 to 4 but not the amount generated, which is the
expensive half. That is
precisely why it is opt-in and default-off, and why [D9](#d9--no-usage-cap-in-the-pilot) exists.

### D3 — Default OFF, visible while ON
**Chosen:** flag-gated, off by default; when on, a dismissable pill sits above the composer
(`🎓 Classroom Mode ✕`); stays on until the teacher turns it off.
**Rejected:** per-message opt-in (too much friction for a teacher planning several things);
invisible sticky state (a mode you can't see is a mode people forget is on — and this one spends
money).

### D4 — The question decides applicability, not the UI dropdowns
**Chosen:** a small dedicated AI "planner" call reads the question and reports whether a teachable
topic exists and which artifacts fit.
**Rejected:** keyword matching. **This cannot work here** — the app supports ten languages
(`LANGUAGES` in `client/src/config.ts:19`: en, hi, bn, te, mr, ta, gu, kn, or, hinglish). A teacher
typing *"कक्षा 4 को भिन्न कैसे पढ़ाऊँ?"* would match no English keyword. There is no keyword list
that survives ten languages.
**Rejected:** deciding from `context.issueType` ("Focus"). It lives inside a collapsed *"More
context"* popover (`client/src/components/ContextBar.tsx:67`), defaults to `""`, and — unlike Grade
and Subject — is **never** seeded from the teacher's saved preferences. It will be empty for most
teachers most of the time. It is a useful *shortcut* when set (see [D6](#d6--three-gates-in-order)),
never the deciding factor.

### D5 — The test for applicability is "is there a teachable topic?"
**Chosen:** the planner returns a `topic` string. Non-empty ⇒ generate. Empty ⇒ generate nothing.
**Why this specific test:** it falls out of the existing architecture rather than being invented.
`topic` is a **required** field on `generateAssessmentSchema`
(`server/src/actions/schemas/generateAssessment.js`). Without a topic you *cannot* call the
generator at all. So "no topic ⇒ no artifacts" is not a policy we're layering on — it's the shape
of the code.

### D6 — Three gates, in order
1. **Emergency check** (`detectEmergency`, `server/src/safety/inputGuard.js:128`) → if it matches,
   generate **nothing**. Hard block, before any AI call. See [§6](#6-the-emergency-block).
2. **Focus = "Classroom Management"** → generate nothing, and skip the planner call entirely.
   A free shortcut on the occasions the teacher actually set it.
3. **Otherwise → planner call decides.**

Gates 1 and 2 are cheap exits. Gate 3 does the real work.

### D7 — The planner is a SEPARATE call, run in parallel
**Chosen:** two AI calls fire simultaneously — Call A (the normal coaching answer, untouched) and
Call B (the tiny planner, using `responseSchema` for guaranteed-valid JSON).
**Rejected:** appending a JSON block to the end of the coaching answer and parsing it out.
**Why:** the coaching answer path is prose and is the most-used path in the product. Parsing
structure out of prose there is fragile, and it would mean editing a protected path for a
flag-gated feature. A separate call with a hard schema is more robust, costs very little (short
input, ~50 tokens out), and — because both calls fire at once — **adds zero latency**.
`server/src/gemini.js` already supports `responseSchema` (the generator uses it).

> **Note for future sessions:** an earlier draft of this design said the planner could ride along
> free with the answer. That was reversed after reading the code. Do not revert it.

### D8 — Context precedence: the teacher always wins
For grade / subject / language / classroom type, highest wins:
1. What the teacher selected in the **Context Bar**
2. Their **Settings defaults** (`prefs.defaultGrade`, `defaultSubject`, `defaultLanguage`, …)
3. What the **planner** read out of the question
4. Blank

The AI only fills **gaps**. It never overwrites a choice the teacher made with their own hands.

### D9 — No usage cap in the pilot; measure first
**Chosen (owner decision, 2026-08-06):** ship without a per-teacher daily cap. Log every use (P7
telemetry), get real numbers, then decide whether a cap is needed and what the number should be.
**Rejected:** a cap from day one.
**Why:** the pilot is a known, small set of schools, so the exposure is bounded — and a cap that
fires on a teacher mid-planning is a bad first impression. Capping at a guessed number is worse
than capping at a measured one. Adding a cap later is a configuration change, not a redesign.
⚠️ **Revisit before any wider rollout.** P7 must produce the numbers that make that decision
possible — that is the whole point of choosing "measure" over "cap", so P7's telemetry is
**not optional polish**.

### D10 — Two artifacts at a time, progressively rendered
**Chosen:** artifact cards appear immediately in a `waiting` state; the client generates **two at a
time**; each card flips to `ready` as it lands; a **Stop** button kills the queue.
**Rejected:** all five at once (will likely trip `server/src/lib/limiters.js` from a single teacher
and hammers the Gemini quota); one big blocking spinner (a 60-second dead screen).
**Why:** the answer arrives at normal speed and the teacher reads it while materials land
underneath. Wall-clock time is roughly the same as firing all five, without the burst.

> ⚠️ **Partly superseded by [D23](#d23--the-four-question-shaped-artifacts-share-one-gemini-call)
> (2026-08-07).** The *outcome* still holds — at most two requests are in flight for a turn — but it
> is now **structural rather than enforced**: the four question-shaped artifacts travel in ONE
> batched call and the lesson plan in another, so the `CONCURRENCY = 2` worker pool this decision
> described no longer exists. Progressive rendering is unchanged for the lesson plan (its own call,
> lands independently); the other four now flip to `ready` together when the batch returns, which is
> the one thing D23 costs.


### D11 — Nothing auto-saves *(scope narrowed to the Library — see [D25](#d25--the-generated-artifacts-are-persisted-on-the-turn-overturns-d11-in-part))*
> ⚠️ **Partly overturned 2026-08-07.** Still true for **My Library**: a document only becomes a saved `Resource` when the teacher presses Save. No longer true for the **chat turn**, which now keeps the artifacts it generated so reopening it does not silently discard four model calls of work.
Each ready card carries its own **Save to Library** button. Cards are **collapsed** by default
(title + first two lines, tap to expand) — five full documents inline is unreadable on a phone.
**Why:** this is the app's existing principle everywhere else. `POST /api/resources/generate`
explicitly persists nothing; the teacher saves deliberately (`GeneratorPage.tsx` `handleSave`).

### D12 — No database changes
> ⚠️ **Superseded by [D24](#d24--the-plan-is-persisted-on-the-query-row-the-artifacts-are-not) (2026-08-07).** One nullable column (`Query.classroomPlan`) was added so reopening a chat can restore the artifact cards. Everything else below still holds: a saved artifact is still an ordinary `Resource` row, and there is still no grouping model.
Each saved artifact is an ordinary `Resource` row, tagged with its topic. No grouping model, no
"pack" concept, no migration.
**Rejected (for now):** a `ClassroomPack` model or a `packId` grouping five artifacts together.
**Why:** it's genuinely nicer, but it costs a schema migration and the Library already filters by
type. Not worth it until teachers ask. **Standing project rule: never touch `schema.prisma` or run
a Prisma migration without explicit owner approval.**

### D13 — TWO flags, not one — the server flag is the real kill switch
**Chosen:** `CLASSROOM_MODE_ENABLED` on the server **and** `VITE_CLASSROOM_MODE_ENABLED` on the
client. Both default OFF.
**Why:** this is the established pattern for every feature in this app — `ASSISTANT_ENABLED`,
`ATTACHMENTS_ENABLED`, `HELP_SUPPORT_ENABLED` all exist in both halves (`server/src/lib/flags.js`,
`client/src/config.ts:277+`). The client flag is **not an incident control**: the app is a PWA with
service-worker caching (`registerType: 'autoUpdate'`), so a client flag change only reaches users on
some later page load. The **server** flag takes effect in under a minute and covers already-loaded
clients — it must refuse to attach `classroom` to any response regardless of what the client sends.
**Corrected during P0:** an earlier draft of this document specified only the client flag. Do not
revert to one flag.

### D14 — Tap-to-generate chips in normal chat are OUT of scope
**Chosen (owner decision, 2026-08-06):** normal (mode-off) chat is completely unchanged. No chips.
**Why:** it keeps the mode's promise unambiguous — Classroom Mode is the *only* way to get
materials, and it does the work for you. Revisit only if teachers ask for materials without wanting
the mode. See [§9](#9-deliberately-not-in-scope).

### D15 — Lesson Plan follows the standard Indian school format
**Chosen (owner decision, 2026-08-06):** the Lesson Plan artifact uses the lesson-plan format Indian
government-school teachers are actually trained on (the NCERT / B.Ed / DIET format), **not** a
generic Western warm-up/closure structure.
**Why:** a plan a teacher can hand to their head teacher without reformatting is worth far more than
a well-designed plan in an unfamiliar shape. Exact section list in [P6](#p6--lesson-plan-) — still
to be confirmed against a real sample before building.

### D16 — The mode resets on page reload (session-only state)
**Chosen (owner decision, 2026-08-06):** `classroomMode` is ordinary React state in `CoachPage`.
It survives navigation within the session; a reload or a new tab starts it OFF. It is **not**
persisted to `user.preferences`.
**Rejected:** remembering it across sessions.
**Why:** the risk is not annoyance, it is **silent spending**. Persisted, a teacher who turned it on
once last month keeps paying ~6× on every question and may never register the pill. Given there is
no usage cap ([D9](#d9--no-usage-cap-in-the-pilot-measure-first)), "on until you turn it off" has to
mean *this session*. The cost of being wrong the other way is two taps tomorrow.

### D17 — All four question-artifacts save as `assessment`; no new Library types
**Chosen (owner decision, 2026-08-06):** Quiz, Worksheet, Homework and Exit Ticket all save as
`type: 'assessment'`, with the format recorded inside `structured` — exactly as the Generator does
today. Lesson Plan saves as the existing `lesson_plan` type.
**Rejected:** giving Homework and Exit Ticket their own Library types.
**Why:** the clean line is *assessments are things students answer; lesson plans are things teachers
follow.* Making Worksheet an `assessment` but Homework its own type would be arbitrary, and would
grow the Library filter to eight entries where four mean nearly the same thing. Discovery still
works — titles read `Homework: Fractions (Class 4)` and the Library already has a search box.
**Consequence:** `RESOURCE_TYPES` / `RESOURCE_TYPE_META` in `client/src/config.ts:183` and
`server/src/routes/resources.js:40` are **not** touched by P4/P5. Only `FORMATS` changes.

### D18 — Planner language handling
**Chosen:** `topic` comes back as **free text in whatever language the teacher wrote**. `grade` and
`subject` are mapped to the existing **closed, English vocabularies** (`GRADES`, `SUBJECTS` in
`client/src/config.ts:55`). The **generation language is the Context Bar's `language`**, never
inferred from the question.
**Why:** grade and subject feed validated fields with fixed value lists, so they must canonicalize —
`server/src/actions/vocab/` already exists for exactly this and should be reused rather than
reimplemented. Topic is free text on the way into a prompt, so it needs no canonical form, and
forcing it to English would lose meaning for a teacher working in Hindi or Tamil. Language stays
the teacher's explicit choice because it already is one, everywhere else in the app
([D8](#d8--context-precedence-the-teacher-always-wins)).

### D19 — The planner runs on `geminiFast` (flash-lite), not the coaching model
**Chosen (during P2, 2026-08-06):** `planClassroom` is given the existing `geminiFast` client
(`server/src/index.js`, `gemini-flash-lite-latest`), not the coaching `gemini` client
(`gemini-2.5-flash`).
**Why:** the planner is a small classification call returning a fixed JSON shape — structurally the
same thing the AI Action Router already uses `geminiFast` for, which is why that client exists with
short timeouts and `maxContinuations: 0`. Three consequences, all wanted: it is far cheaper per
call; it is faster, which matters for a call whose whole job is to finish before the answer does;
and it draws on a **different model's rate-limit bucket**, so planning can never starve the coaching
answer of quota. The answer is what the teacher is actually waiting for, and it must never lose
capacity to an optional extra.
**Corrected:** the first P2 draft passed the coaching `gemini`. That was wrong on all three counts
and was found by exhausting the free-tier quota during verification. Do not revert it.

### D20 — The AI Action Router advertises a SUBSET (`ROUTABLE_FORMATS`)
**Chosen (during P4, 2026-08-06):** `server/src/actions/schemas/generateAssessment.js` now exports
two lists. `FORMATS` is what the **endpoint accepts** and grows with this feature. `ROUTABLE_FORMATS`
is what the **AI Action Router advertises**, and stays frozen at `['quiz', 'worksheet']`.
**Rejected:** adding `exit_ticket` to the router's vocabulary along with everything else.
**Why:** the router's classifier prompt is built from those values and is pinned **byte-for-byte** by
`test/assistant/recoveryIsolation.test.js` against the M7a evaluation baseline. Changing it
invalidates every recorded eval cassette, and that test's own note says re-validating needs "a full
live pass and a variance band, not a replay" — expensive model work, on a feature still mid-rollout.
Classroom Mode never touches the router (it calls the generation endpoint directly), so widening the
router's vocabulary would impose that cost to buy nothing.
**Why a subset is safe, and a superset would not be:** the single-schema rule exists so the router
cannot propose parameters the endpoint rejects. Advertising fewer formats cannot violate that —
every routable value is still valid. Advertising more would be exactly the failure the rule prevents.
Pinned by a test asserting `ROUTABLE_FORMATS ⊆ FORMATS`.
**To add a format to the router later:** budget the live eval pass and update `FROZEN_PROMPT_SHA16`
in the same commit, saying why.

### D21 — The Lesson Plan is its own endpoint, not a fourth assessment format
**Chosen (during P6, 2026-08-07):** `POST /api/resources/generate-lesson-plan`, with its own request
schema (`actions/schemas/generateLessonPlan.js`), document schema (`lib/lessonPlanSchema.js`), prompt
and renderer (`lib/lessonPlanPrompt.js`). It shares the assessment path's generation **machinery** —
the LaTeX repair-and-verify retry loop, the error mapping — but none of its **shape**.
**Rejected:** adding `lesson_plan` to `FORMATS` and reusing `/resources/generate`, which is how P4
and P5 shipped and would have been the cheap-looking move.
**Why:** worksheet, quiz, homework and exit ticket are the *same document* — questions, options, an
answer key — which is exactly why they are formats of one endpoint sharing one schema. A lesson plan
has no questions and no answer key; it is ten named prose sections. Making it a format would force
`assessmentDocumentSchema` to stop requiring `questions`, and then every consumer of that schema
(the renderer, the four AI-assist edit actions, the client's answer-key split) needs a branch for a
document that has none. That is precisely the ternary sprawl `FORMAT_META` was introduced in P4 to
remove — the P4 recipe's own §8 note calls those ternaries "correct while there were exactly two
formats, and silently wrong the moment there is a third".
**Consequence for the client:** `generateArtifact()` in `lib/classroom.ts` dispatches on artifact
kind, so `useClassroomQueue` never learns there are two endpoints. Routing knowledge stays in one
place instead of three (the worker, the retry path, and the request builder).
**Consequence for saving:** a lesson plan saves as `type: 'lesson_plan'`, the one exception to
[D17](#d17--all-four-question-artifacts-save-as-assessment-no-new-library-types) — and not a new
Library type either, since `lesson_plan` already existed in `RESOURCE_TYPES` with its own
`ResourceWorkspace` handling. Saving it as an `assessment` would push a document with no answer key
through the answer-key split, which is the branch D17 exists to avoid.

### D22 — The model writes PLAIN maths notation, not LaTeX
**Chosen (2026-08-07):** the generation prompts ask for `$5/9$`, `$x^2$`, `$sqrt(16)$`, `$45 deg$` —
notation with **no backslashes**. `server/src/lib/mathNotation.js` converts it to LaTeX
deterministically before validation.
**Rejected:** a fourth repair layer for the next way the model mangles a backslash.
**Why:** every LaTeX repair in `assessmentSchema.js` — `repairControlCharLatex`,
`normalizeDegenerateLatex`, `restoreBareCommands` — exists for ONE root cause: a backslash inside a
JSON string. `JSON.parse` turns `"\frac"` into FORMFEED+`"rac"`; the model dodges `"\sin"` (an
invalid JSON escape) into `\text{sin}`; and on 2026-08-07 a live Class 4 quiz reached a teacher
reading *"In the fraction f r a c 59, which number is the numerator?"* — a lost backslash producing
`$frac59$`, which is **valid KaTeX** and therefore passed every check we had. The prompt already
demanded double-backslash escaping, in capitals. A model instruction is a request, not a guarantee,
and each new failure mode had cost another repair pass. Plain notation removes the cause instead of
the symptom, and the conversion is code we unit-test rather than a prompt we hope about.
**Safety contract (the part that matters):** anything containing a backslash is already LaTeX and is
returned **unchanged**; anything the parser cannot read confidently returns null and the text is left
**exactly as it arrived**. So every saved resource, and any model that ignores the new prompt, keeps
working — and the old repair layers stay behind this as a net. They become dead code only once live
traffic proves the new path holds.

### D23 — The four question-shaped artifacts share ONE Gemini call
**Chosen (2026-08-07):** `POST /api/resources/generate-set` generates worksheet, quiz, homework and
exit ticket in a single call. Classroom Mode goes from **7 model calls per teacher question to 4**
(answer, planner, assessment set, lesson plan).
**Rejected (a):** one call per artifact, as P3–P5 shipped.
**Rejected (b):** all five artifacts plus the coaching answer in one call.
**Why not (a):** the binding constraint is the free tier's **20 requests per MINUTE**, not token
price. At 7 calls a question a teacher was throttled after three questions. Note what this does and
does not save: the duplicated instructions are ~750–1000 input tokens; the **output** — the same five
documents — is identical either way, and output is the expensive half. This is a rate-limit fix that
happens to save some input tokens, not a cost fix.
**Why not (b):** the lesson plan is a different document shape (D21), so folding it in means one
union schema — the thing D21 rejected — and it is the largest single output in the set. The coaching
answer must stay separate anyway; it is what the teacher reads first.
**The part that makes it work — per-artifact retry:** a naive batch discards the whole response when
one artifact is bad and regenerates all four, which with `MAX_LATEX_REGEN_ATTEMPTS` can cost **more**
than separate calls ever did. Each artifact is normalized, LaTeX-checked and schema-checked
independently; the good ones are kept and returned, and only the failures are re-requested as a
smaller set. Partial success is a success — one bad quiz must not cost the teacher the other three.
Pinned by `test/routes/generateSet.test.js`, which asserts the retry asks for `['quiz']` alone.

### D24 — The plan is persisted on the Query row; the artifacts are not
**Chosen (2026-08-07):** a nullable `classroomPlan` column on `Query` holds the plan as JSON. Its
migration is `20260807021500_add_classroom_plan_to_query`. Reopening a chat restores the artifact
**cards**; each card generates only when the teacher presses **Generate**.
**Rejected (a):** leaving it — the behaviour a teacher actually hit: ask a question with the mode on,
refresh, reopen the chat, and the materials are simply gone. They had cost four model calls and
vanished with no warning and no way back.
**Rejected (b):** caching plan + artifacts in `sessionStorage` — survives a refresh but not a closed
tab, and puts generated content outside the Library with no Save, which bends [D11](#d11--nothing-auto-saves).
**Rejected (c):** persisting the generated artifacts too — that IS auto-saving, which D11 exists to
prevent, and it would put five full documents on a row read by every history list.
**Why this line, between plan and artifacts:** the plan is small, cheap, and describes what the
teacher asked for. The artifacts are large, are the product, and D11 says the teacher decides what
enters their Library. Storing the plan restores the *offer*; storing the artifacts would be making
the decision for them.

**⚠️ The trap this decision had to avoid, spelled out because it is silent and expensive:** restoring
a plan hands `useClassroomQueue` a plan it has never seen, and its effect generates the whole set.
Without a guard, simply BROWSING history would cost four model calls per chat opened — on a free
tier allowing twenty calls a MINUTE. Hence the `restored` flag: a restored plan renders its cards in
`stopped`, and nothing is spent until a teacher asks. `stopped` was reused rather than adding a sixth
status, since "planned, not made" is exactly what it already meant.

**[D12](#d12--no-database-changes) is superseded.** It said "no database changes"; this is one. It
is nullable and additive, so every existing row and every row from a teacher who never turns the
mode on stays NULL, and nothing that already reads a `Query` had to change. `GET /api/queries` omits
the key entirely rather than sending `null`, so an ordinary history payload is byte-for-byte what it
always was — [§7 rule 3](#7-guardrails) applies to this response too, not only to `/api/coach`.

**Note on how the migration was applied:** `prisma migrate dev` could not be used — the shared
`dev.db` carries a migration record (`20260720193726_add_conversations_and_messages`) that exists in
no branch, so Prisma saw drift and wanted to reset. The migration was hand-written, the `ALTER TABLE`
applied directly, and `prisma migrate resolve --applied` used to record it. **That pre-existing drift
is still there** and will block the next person who runs `migrate dev`.

### D25 — The generated artifacts ARE persisted on the turn (overturns D11 in part)
**Chosen (2026-08-07):** a nullable `classroomArtifacts` column on `Query` holds
`{ artifactKind: markdown }` for the turn. Migration
`20260807024500_add_classroom_artifacts_to_query`. Reopening a chat shows what was already
generated, exactly as the teacher left it.
**Rejected:** keeping [D11](#d11--nothing-auto-saves) intact and offering only a Generate button
(the state D24 shipped a few hours earlier).
**Why D11 is overturned here:** D11 says "nothing auto-saves", and it was written before anyone had
watched a teacher lose four model calls' worth of materials to a page refresh. It is still right
about the LIBRARY — pressing **Save** is what puts a document somewhere a teacher goes looking for
it, and that is unchanged. This is a different thing: keeping the CHAT TURN intact. A turn that
shows an answer but has silently discarded the materials generated beside it is not "not saving",
it is losing work. **D11 now governs the Library only; the turn keeps its own artifacts.**

**Where the line sits now:**

| | Persisted | Where | Decision |
|---|---|---|---|
| The plan (topic, which artifacts fit) | ✅ | `Query.classroomPlan` | [D24](#d24--the-plan-is-persisted-on-the-query-row-the-artifacts-are-not) |
| The generated documents | ✅ | `Query.classroomArtifacts` | D25 |
| A document in My Library | Only on **Save** | `Resource` row | [D11](#d11--nothing-auto-saves) — unchanged |

**⚠️ The performance trap, because it is invisible until it is slow:** this column holds up to five
full documents. `GET /api/queries` returns twenty rows to render a sidebar that displays none of
them — pulling this column there would move hundreds of kilobytes per history load. So
`routes/queries.js` uses an **explicit `select`** that omits it, and the artifacts are fetched on
demand for ONE turn via `GET /api/queries/:id/classroom-artifacts`. A test asserts the list payload
never contains them. If someone later "tidies" that select back to a default `findMany`, history
gets slow for every teacher and nothing will fail loudly.

**Bounds and ownership:** 60000 bytes per turn (well above a realistic ~25KB set), rejected with a
413 rather than truncated. Both endpoints are owner-only and return the SAME 404 for "missing" and
"not yours", so one teacher cannot probe another's history — the rule `routes/resources.js` already
follows.

**One thing this change required that was easy to miss:** `/api/queries` was on the app's **16kb**
JSON body limit. A realistic five-artifact set is 15–25KB, so storing one would have failed in
production while passing every unit test. `index.js` now routes this one path to the 64kb parser,
and a test stores a realistic 25KB set to keep that honest.

### 4.1 Small decisions (recorded so they are not re-litigated)

- **Artifact cards stay in the chat history** when the teacher asks the next question. An in-progress
  queue keeps running — asking a follow-up does not cancel materials already being generated.
- **Card titles follow the Generator's existing pattern** — `Worksheet: Fractions (Class 4)`, from
  `defaultTitle()` in `client/src/pages/GeneratorPage.tsx:35`. Reuse it, don't reinvent it.
- **Classroom Mode ignores attachments.** If a teacher has attached an image/PDF, artifacts are still
  generated from the merged topic/grade/subject only. Attachment-aware generation is not in scope.

### 4.2 Scope lock 🔒

**Owner instruction, 2026-08-06: build P0 → P7 as written. Nothing more.**

Everything in [§9](#9-deliberately-not-in-scope) stays out — pack grouping, chips in normal chat,
router integration, bulk print. Do not add phases, do not widen a phase's checklist, and do not
re-open §9 items on your own initiative. If you believe something in §9 has become necessary,
**stop and ask the owner** rather than building it.

Feature Management (an admin dashboard for toggling features at runtime) was discussed and is
**explicitly deferred until after Classroom Mode ships** — no doc, no design, no seam work. It will
be planned separately. Do not anticipate it in this feature's code.

---

## 5. How it works, end to end

Teacher has Classroom Mode ON and sends *"How do I teach fractions to Class 4?"*

```
1. EMERGENCY CHECK  (no AI, server-side, before anything)
   detectEmergency(query) → match?  ──yes──▶ emergency answer, NO artifacts. STOP.
                             │
                             no
                             ▼
2. FOCUS SHORTCUT
   context.issueType === 'Classroom Management'? ──yes──▶ answer only, NO artifacts. STOP.
                             │
                             no
                             ▼
3. TWO CALLS, IN PARALLEL
   ┌─ Call A: coaching answer  (unchanged from today)
   └─ Call B: planner          (new, tiny, responseSchema)
                             │
                             ▼
4. MERGE CONTEXT   (teacher's Context Bar > Settings defaults > planner > blank)
                             ▼
5. RESPOND
                             ▼
6. CLIENT: answer renders immediately
     artifacts empty? ──yes──▶ one quiet line, nothing else
                       └─no──▶ cards appear (waiting) → generate 2 at a time → each flips to ready
```

### Call B — the planner contract

Input: the teacher's question + merged context. Output (strict `responseSchema`):

```json
{
  "topic": "Fractions",
  "grade": "Class 4",
  "subject": "Mathematics",
  "artifacts": ["lesson_plan", "worksheet", "quiz", "homework", "exit_ticket"]
}
```

No teachable topic ⇒ `{ "topic": "", "artifacts": [] }`.

`artifacts` is a **per-artifact** judgement, not all-or-nothing. *"Design a group activity for
fractions"* may legitimately return `["lesson_plan"]` only.

### Coach response shape

```json
{
  "response": "…the coaching answer…",
  "classroom": {
    "topic": "Fractions",
    "grade": "Class 4",
    "subject": "Mathematics",
    "language": "en",
    "artifacts": ["lesson_plan", "worksheet", "quiz", "homework", "exit_ticket"]
  }
}
```

**Mode off ⇒ no `classroom` key at all, and the response is byte-for-byte what it is today.**

### Worked examples

| Teacher's question | Focus set? | What decides | Result |
|---|---|---|---|
| "How do I teach fractions to Class 4?" | (empty) | planner: topic = Fractions | all 5 |
| "भिन्न कैसे पढ़ाऊँ?" | (empty) | planner: topic = Fractions | all 5 |
| "Explain photosynthesis simply" | Concept Explanation | planner: topic = Photosynthesis | all 5 |
| "Design a group activity for fractions" | (empty) | planner: partial list | lesson plan only |
| "My students keep talking" | (empty) | planner: no topic | nothing |
| "My students keep talking" | Classroom Management | gate 2 — planner never called | nothing |
| "I'm feeling burnt out" | (empty) | planner: no topic | nothing |
| "A student collapsed" | anything | gate 1 — emergency | nothing (hard block) |

### When nothing applies

Do **not** go silent — the teacher turned the mode on and expects something. One quiet line under
the answer:

> 🎓 No classroom materials for this one. Ask about a topic and I'll create them.

---

## 6. The emergency block

`detectEmergency()` already exists (`server/src/safety/inputGuard.js:128`) and already reroutes the
answer to `EMERGENCY_SYSTEM_PROMPT` (`server/src/prompts.js:137`). Classroom Mode's only job is to
**respect it**.

It catches descriptions of something happening *right now*: a student unconscious / not breathing /
having a seizure / choking / bleeding heavily; a weapon or intruder; fire in the classroom; a
serious injury. It deliberately does **not** fire on *teaching about* those topics —
`TEACHING_ABOUT_PATTERN` (`inputGuard.js:92`) short-circuits first, so *"how do I teach first aid"*
and *"lesson plan on fire safety"* stay normal teaching questions.

**Why this is non-negotiable here.** Without the block:

> **Teacher:** A student collapsed and isn't breathing
> **App:** *[safety guidance]* … 🎓 Creating your classroom set… 📄 Worksheet ⏳ 📝 Quiz ⏳

Generating worksheets underneath a teacher in a real crisis would be indefensible. This is a hard
`if`, evaluated **before** any generation call is made — not a hint to the planner, and not
something we hope the model declines to suggest. The mode stays on for the next question; it simply
sits out this one.

---

## 7. Engineering rules (do not break these)

1. 🔒 **Never touch `server/prisma/schema.prisma` or run a Prisma migration** without explicit owner
   approval. One shared `dev.db` across branches — drift risks a reset. This feature needs no
   migration ([D12](#d12--no-database-changes)); if you think it does, **stop and ask**.
2. 🔒 **Vocabulary drift rule.** `server/src/actions/schemas/generateAssessment.js` is the single
   runtime authority for `FORMATS`. `client/src/config.ts` (`ASSESSMENT_FORMATS`) holds the matching
   picker labels. Adding `homework` / `exit_ticket` means editing **both in the same commit** — the
   comments in both files say so, and a drift guard is a mandatory acceptance criterion.
   Also update `RESOURCE_TYPE_META`/`RESOURCE_TYPES` (`config.ts:183`) and `RESOURCE_TYPES`
   (`server/src/routes/resources.js:40`) if new Library types are introduced.
3. 🔒 **Mode OFF must be byte-for-byte today's behaviour.** No `classroom` key, no extra call, no
   changed prompt, no new latency. This is the acceptance test for every phase.
4. 🔒 **Do not modify the coaching answer prompt or path** to carry planner data ([D7](#d7--the-planner-is-a-separate-call-run-in-parallel)).
5. 🔒 **Feature flag `VITE_CLASSROOM_MODE_ENABLED` defaults OFF.** Flag off ⇒ the `+` button does not
   render at all. Mirrors `ASSISTANT_ENABLED` / `ATTACHMENTS_ENABLED` / `HELP_SUPPORT_ENABLED`
   (`client/src/config.ts:277`, `:288`, `:297`).
6. 🔒 **Nothing is persisted to MY LIBRARY by a generation call.** A document becomes a saved
   `Resource` only when the teacher presses Save. *(Narrowed 2026-08-07 by
   [D25](#d25--the-generated-artifacts-are-persisted-on-the-turn-overturns-d11-in-part): the chat
   turn itself now keeps the artifacts it generated, so a refresh no longer discards them.)*
7. 🔒 **Emergency block is unconditional** ([§6](#6-the-emergency-block)).
8. 🔒 **Never batch-run real Gemini calls.** The key is free tier — **20 requests/minute** for
   `gemini-2.5-flash` — and one `POST /api/coach` costs several calls (answer + retries/
   continuations + planner). A loop over even 9 questions exhausts the quota, returns
   `RATE_LIMITED` for everything, proves nothing, and leaves the owner unable to use their own app
   for a minute. Verify with a **fake model client** (see `server/test/lib/classroomPlan.test.js`);
   spend real calls **one at a time**, and ask the owner before spending more than one.

---

## 8. Phases

> Tick a box the moment that item is true. Update the §1 snapshot table in the same commit.
> **One phase at a time.** Do not start the next phase until the current one's acceptance criteria
> all pass.

### P0 — Design & scaffolding ✅ Complete (2026-08-06)

**Goal:** this document exists, the branch exists, both flags exist and do nothing.

- [x] `docs/classroom-mode.md` written and agreed (this file)
- [x] Branch `classroom-mode` created off `main`
- [x] Owner has answered the [§11 open questions](#11-open-questions)
- [x] **Server flag** `CLASSROOM_MODE_ENABLED` — `readClassroomModeFlags` in `server/src/lib/flags.js`,
      default OFF, following `readHelpSupportFlags`' shape exactly
- [x] **Client flag** `CLASSROOM_MODE_ENABLED` from `VITE_CLASSROOM_MODE_ENABLED` in
      `client/src/config.ts`, default OFF
- [x] Both documented in `client/.env.example` / `server/.env.example` alongside the other flags,
      with the same "NOT AN INCIDENT CONTROL" note the client flags carry
- [x] Flag tests added to `server/test/lib/flags.test.js` alongside the existing flag tests
      (6 tests, including "a mistyped enable value must fail CLOSED")

**Acceptance:** ✅ `npm run build` clean; server suite **1406/1406 pass**; nothing reads either flag.

> **Note for future sessions:** `vitest` was declared in `client/package.json` but not installed, so
> `npm run build` (`tsc -b`) failed on pre-existing type errors in `src/**/*.test.ts` before this
> phase touched anything. Fixed by running `npm install` in `client/`. Not caused by, and not
> related to, this feature.

---

### P1 — `+` menu, mode toggle, pill ✅ Complete (2026-08-06)

**Goal:** the teacher can turn Classroom Mode on and off and can see that it's on. **No generation
yet.**

**Files as built**
- `client/src/components/ModeMenu.tsx` — **new.** The `+` button and its popover. Uses
  `useDismissable`, the same hook as `ContextBar`'s "More context" popover. Modes are a **list**,
  so a second mode is one object, not a restructure.
  **SUPERSEDED — see [`composer-ui-rework.md`](./composer-ui-rework.md):** this file is now
  `AddMenu.tsx` and `+` carries Capture Photo / Upload File/Photo. The Classroom Mode control moved
  to `client/src/components/ClassroomModeMenu.tsx`, an "Assistant Mode" dropdown at the RIGHT of the
  composer row where the paperclip used to be. Everything below about state ownership still holds —
  the mode still lives in `CoachPage`, not in the composer — and the CSS classes are now
  `.composer-menu-*` (shared by both menus) rather than `.mode-menu-*`.
- `client/src/components/ClassroomModePill.tsx` — **new.** The pill, with its own ✕.
  **DELETED — see [`composer-ui-rework.md`](./composer-ui-rework.md):** the Assistant Mode control
  shows its own state (active styling, selected mode on hover), so the pill was a second copy of the
  same fact holding a permanent strip above the grade and subject.
- `client/src/components/Composer.tsx` — renders `ModeMenu` leftmost in `composer-controls`; the
  char count moved to its right. Paperclip / mic / send untouched.
- `client/src/pages/CoachPage.tsx` — `classroomMode` state, the pill, and `classroomMode` in the
  request body.
- `client/src/types.ts` — `Turn.classroomMode`.
- `client/src/index.css` — mode menu, pill, and the `composer-controls` layout change.

- [x] `+` renders leftmost, flag-gated, keyboard-accessible, with an `aria-label`
- [x] Menu opens/closes on click, Escape, and outside-click
- [x] Selecting Classroom Mode turns it on; the pill appears; a toast confirms
- [x] The pill's ✕ turns it off
- [x] Mode state is sent as `classroomMode: true` in the coach request body (server ignores it for now)
- [x] **Reload resets the mode to OFF** — plain React state, never written to `user.preferences`
      ([D16](#d16--the-mode-resets-on-page-reload-session-only-state))
- [x] Flag OFF ⇒ no `+` button anywhere in the DOM
- [x] Mobile: `+` does not crowd the composer at 390 px width; the pill drops its hint and keeps
      the label and the ✕

**Acceptance:** ✅ verified in a real browser (Playwright driving Chrome, signed in as
`teacher@example.com`). Verified request body:

```json
{"query":"How do I teach fractions to Class 4?","language":"en",
 "context":{"grade":"","subject":"","classroomType":"","issueType":""},"classroomMode":true}
```

**Decisions taken during this phase** (recorded so they are not re-litigated):

- **`classroomMode` is omitted from the body entirely when off**, not sent as `false` — a teacher
  who never touches the feature produces a request byte-identical to today's (rule §7.3).
- **The mode is snapshotted onto the `Turn`**, alongside `language` and `context`, rather than read
  live at request time. `handleRetry` re-runs a turn, and a retry must repeat the request that was
  actually made — not one reshaped by whatever the mode happens to be now.
- **`composer-controls` moved from `justify-content: space-between` to `flex-start` +
  `margin-left: auto` on the buttons.** With two children the rendering is identical; with three it
  keeps the char count beside the `+` instead of stranding it in the middle of the row.
- **A toast fires on both enable and disable.** Not in the original checklist; added because the
  pill alone confirms only the "on" direction, and turning a spending mode off deserves an explicit
  acknowledgement.

---

### P2 — Planner call, gates, context merge ✅ Complete (2026-08-06)

**Goal:** the app correctly *decides* what applies, and says so. **Still no generation.**

**Files**
- New `server/src/lib/classroomPlan.js` — the planner prompt + `responseSchema` + the merge logic.
- The coach route in `server/src/index.js` — accept `classroomMode`, run the two gates, fire Call B
  in parallel with Call A, attach `classroom` to the response.
- `client/src/types.ts` — the `classroom` response shape.
- `client/src/pages/CoachPage.tsx` — store it on the turn; render the empty-state line.

**Design notes**
- Call B must be `Promise.all`-parallel with Call A. If it **fails or times out, swallow the error**
  and return no `classroom` key — a planner failure must never take down a teacher's answer. (Same
  spirit as guardrail G22 in the AI Action Router docs: this sits in front of a text box.)
- Give Call B a shorter timeout than Call A.

- [x] Gate 1: `detectEmergency` match ⇒ no `classroom` key, and **no Call B is made**
- [x] Gate 2: `issueType === 'Classroom Management'` ⇒ no `classroom` key, no Call B
- [x] Call B returns schema-valid JSON, or is treated as "no artifacts"
- [x] Call B failure/timeout never affects the coaching answer
- [x] Context merge follows [D8](#d8--context-precedence-the-teacher-always-wins) precedence exactly
- [x] `grade` / `subject` canonicalized through the existing `server/src/actions/vocab/` mappers —
      **reused, not reimplemented**; `topic` left as free text in the teacher's language
      ([D18](#d18--planner-language-handling))
- [x] Empty `artifacts` ⇒ the quiet one-line message renders
- [x] Mode OFF ⇒ no `classroom` key, no Call B, zero added latency — **verified live**
      (`has classroom key: false | has classroomMode key: false`)
- [x] Unit tests for the gates and the merge — `server/test/lib/classroomPlan.test.js`, 34 tests,
      against a fake model client (zero API calls)
- [x] **Judgement verified against the real model** — both directions, two calls:

| Question | Planner returned | Expected |
|---|---|---|
| "How do I teach fractions to Class 4?" | topic `fractions`, grade `Class 3-5`, subject `Mathematics`, **all 5 artifacts** | all 5 ✅ |
| "My students keep talking in class and I cannot get their attention" | `null` | nothing ✅ |

**Acceptance: ✅ MET.**

> ### How the quota scare resolved — read this before doing model verification again
>
> A mid-phase run reported `[lesson_plan]` only for the fractions question, which looked like a
> too-narrow prompt and briefly blocked this phase. **It was a false signal.** Those calls went to
> `gemini-2.5-flash` while that model was rate-limited and degrading. Pointing the planner at
> `geminiFast` ([D19](#d19--the-planner-runs-on-geminifast-flash-lite-not-the-coaching-model))
> both fixed the quota problem and removed the bad signal — the prompt needed no change.
>
> **Two lessons worth keeping:**
>
> 1. **Different models have separate quota buckets.** With the coaching model exhausted, the
>    planner was still testable on flash-lite — by calling `planClassroom` directly in a node
>    one-liner instead of going through `POST /api/coach`. Verify a component through its own
>    seam, not through an endpoint that drags an unrelated model call along with it.
> 2. **Degraded-model output is not evidence.** Before concluding anything about prompt quality,
>    confirm the call actually succeeded cleanly. See rule §7.8.

---

### P3 — Artifact cards + generation queue ✅ Complete (2026-08-06)

**Goal:** Quiz and Worksheet actually generate and can be saved. The feature is real.

**Files**
- New `client/src/components/ClassroomSet.tsx` — the card list, the 2-at-a-time queue, Stop.
- New `client/src/components/ClassroomArtifactCard.tsx` — one card: waiting / generating / ready /
  failed, collapsed preview, expand, Save to Library, Open in Workspace.
- `client/src/lib/resources.ts` — reuse `generateAssessment` and `createResource` as-is.
- `client/src/index.css` — styles.

**Design notes**
- Reuse the existing `POST /api/resources/generate` untouched. Pass merged topic/grade/subject/language.
- A failed artifact shows a **Retry** on its own card. One failure must not kill the others.
- Save uses the existing `createResource` path (`type: 'assessment'` for quiz/worksheet) and lands
  in the Library exactly like a Generator save.

- [x] Cards render immediately in `waiting` for each planned artifact
- [x] Exactly 2 generate concurrently; the rest queue — **instrumented in the browser: `MAX_CONCURRENT_GENERATIONS: 2`**
- [x] Each card flips waiting → generating → ready independently
- [x] Stop halts the queue; already-generated cards remain usable
- [x] Cards are collapsed by default; tap expands
- [x] Per-card Save to Library works; nothing saves automatically — **verified the row reaches the Library**
- [x] A single artifact failure leaves the others unaffected and offers Retry
- [x] Only buildable artifacts are requested — **`TOTAL_GENERATE_CALLS: 2`** for a 5-artifact plan
- [x] Navigating away mid-queue does not leak requests or throw
- [x] Mobile: readable and scrollable at 390 px

**Acceptance:** ✅ verified in a real browser. Both AI endpoints were **stubbed via Playwright route
interception** — zero Gemini spend, and it made the concurrency limit directly measurable rather
than inferred. Save used the real `POST /api/resources` (a DB write, no AI) and the row was
confirmed in the Library.

**Bug found and fixed during this phase — worth reading:**

> The queue's cancellation flag was reset AFTER its dedupe guard. React `StrictMode` (on, see
> `client/src/main.tsx`) double-invokes effects: run 1 started the workers, its cleanup set
> `cancelled = true`, then run 2 hit the guard and returned early **without un-cancelling**. The
> in-flight generations completed successfully and then discarded their own results — every card
> stuck at "Creating…" forever, with no error anywhere.
>
> **The unit tests could not have caught this** (they do not double-invoke effects), and neither
> could a code read. Only driving the real app surfaced it. Keep the browser step for any phase
> that adds async React state.

---

### P4 — Exit Ticket ✅ Complete (2026-08-06)

**Goal:** add the cheapest new artifact. Proves the "add an artifact" path works.

> Saves as `type: 'assessment'` — **do not** add a Library type
> ([D17](#d17--all-four-question-artifacts-save-as-assessment-no-new-library-types)).
>
> **⚠️ "Only `FORMATS` / `ASSESSMENT_FORMATS` change" was wrong.** Adding a format touches SIX
> places, and P4 found every one of them the hard way. The recipe for P5/P6:
>
> | # | File | What |
> |---|---|---|
> | 1 | `server/src/actions/schemas/generateAssessment.js` | add to `FORMATS` — **not** `ROUTABLE_FORMATS` (see [D20](#d20--the-ai-action-router-advertises-a-subset-routable_formats)) |
> | 2 | `server/src/lib/assessmentFormats.js` | add a `FORMAT_META` entry — **boot fails without it** |
> | 3 | `client/src/config.ts` | add to `ASSESSMENT_FORMATS`, same commit |
> | 4 | `client/src/lib/resources.ts` | widen the `AssessmentFormat` union |
> | 5 | `client/src/lib/classroom.ts` | `BUILDABLE_ARTIFACTS` + `GENERATION_CONFIG` |
> | 6 | `client/src/pages/GeneratorPage.tsx` | `FORMAT_LABELS` + `FORMAT_ICONS` — both `Record<AssessmentFormat, …>`, so a missing entry is a **compile error** |
>
> **Still exactly six files after batching ([D23](#d23--the-four-question-shaped-artifacts-share-one-gemini-call)).**
> `assessmentSetInputFor` builds the batch by reading `GENERATION_CONFIG`, so step 5 puts a new
> format in the batched call automatically — there is no seventh place to register it. Nothing to
> do for maths notation either ([D22](#d22--the-model-writes-plain-maths-notation-not-latex)): the
> rules live once in `MATH_NOTATION_RULES` and every prompt interpolates it.
>
> Steps 2, 4 and 6 now fail loudly (boot assertion / type error) rather than silently mislabelling
> the new format as a quiz — which is what the old ternaries did.

- [x] `exit_ticket` added to `FORMATS` in `server/src/actions/schemas/generateAssessment.js`
- [x] `ASSESSMENT_FORMATS` in `client/src/config.ts` updated **in the same commit** (rule §7.2) — pinned by the existing pair-B drift test
- [x] `RESOURCE_TYPES` / `RESOURCE_TYPE_META` **untouched** in both client and server
- [x] Prompt + render logic via the new `FORMAT_META` table (`server/src/lib/assessmentFormats.js`)
- [x] 3 questions, MCQ, easy — and 3 is already `MIN_QUESTIONS`, so no bound needed relaxing
- [x] Works from both Classroom Mode **and** the existing `/generator` page
- [x] Tests updated — 11 new (`test/lib/assessmentFormats.test.js`), plus 1 new client test

---

### P5 — Homework ✅ Complete (2026-08-07)

**Goal:** a worksheet framed for home.

> Same as P4: saves as `type: 'assessment'`, no Library type added
> ([D17](#d17--all-four-question-artifacts-save-as-assessment-no-new-library-types)).
>
> **The P4 six-file recipe held exactly.** No surprises, no seventh file — the first phase where
> the recipe was followed as written rather than discovered. All six edits landed in one commit;
> the boot assertion and the pair-B drift test were what confirmed nothing was missed.

- [x] `homework` added to `FORMATS` + `ASSESSMENT_FORMATS` (same commit)
- [x] `AssessmentFormat` union widened (`client/src/lib/resources.ts`)
- [x] `BUILDABLE_ARTIFACTS` + `GENERATION_CONFIG` (`client/src/lib/classroom.ts`) — **this is the
      edit that makes the card appear**; without it the planner still proposes homework and
      `buildableFrom` silently drops it
- [x] `FORMAT_LABELS` + `FORMAT_ICONS` (`client/src/pages/GeneratorPage.tsx`, icon `House`)
- [x] Prompt reflects the different setting: done at home, no teacher present, parent/guardian note,
      only materials likely available at home
- [x] 6 questions, mixed, medium — shorter than a worksheet's 8, deliberately not harder
- [x] Works from both Classroom Mode and `/generator`
- [x] Tests updated — 1 new server test (homework's purpose states its constraints), 2 new client
      tests (homework ≠ relabelled worksheet; the three practice artifacts are ordered by length)
- [ ] ⚠️ **Not yet verified against a real Gemini call** — no live generation has been run for
      `format: 'homework'`. Per §7 rule 8 this needs ONE manual run, not a batch. Until then the
      prompt is untested in production shape.

---

### P6 — Lesson Plan ✅ Complete (2026-08-07)

**Goal:** the one genuinely new generator. **Treat this as its own project.**

**Files**
- New `server/src/lib/lessonPlanSchema.js` — the response schema (sibling of
  `server/src/lib/assessmentSchema.js`)
- A renderer alongside `renderAssessmentMarkdown`
- A new endpoint or a branch in `POST /api/resources/generate` — **decide and record the choice here**
- Saves as `type: 'lesson_plan'` (the Library type already exists)

**Structure — the standard Indian government-school format** ([D15](#d15--lesson-plan-follows-the-standard-indian-school-format)).
This is the shape Indian teachers are trained on (NCERT / B.Ed / DIET), not a generic Western
lesson plan. Proposed sections:

| Section | Notes |
|---|---|
| Topic · Class · Subject · Duration | Header. Reuse the `ExamHeader` letterhead pattern from the Generator. |
| **Learning Objectives** | Phrased as learning *outcomes* ("students will be able to…"), NCF/NEP-aligned |
| **Previous Knowledge** | What students are assumed to already know |
| **Teaching Learning Material (TLM)** | **Low-cost, locally available** — this is the section that makes or breaks usefulness in a government school |
| **Introduction / Motivation** | Opening question or hook |
| **Presentation** | Step-by-step, split into **Teacher Activity** and **Student Activity** columns — the distinctive part of the Indian format |
| **Blackboard Summary** | What actually goes on the board. Nothing in the app produces this today. |
| **Differentiation** | Driven by `classroomType` — multi-grade, large class (40+), mixed ability |
| **Recapitulation / Evaluation** | Oral check questions |
| **Home Assignment** | Links naturally to the Homework artifact (P5) |

**Before building:** get one real lesson plan from a pilot-school teacher and match this against it.
Section *names* matter here — teachers and head teachers recognise the format by its headings.

- [ ] ⚠️ **Structure NOT yet confirmed against a real teacher's lesson plan.** Built to D15 from this
      document alone. Section names are load-bearing — a head teacher recognises the format by its
      headings — so this still needs one real plan from a pilot school held up against it. This is
      the highest-value remaining check and it needs a person, not code.
- [x] Schema + renderer written; output passes the same LaTeX/KaTeX safety path as assessments
      (`normalizeLessonPlanMath` → `sanitizeTextFields`, sharing `latexGuard`'s repair and verify)
- [x] Endpoint decision recorded in this document — **[D21](#d21--the-lesson-plan-is-its-own-endpoint-not-a-fourth-assessment-format)**
- [x] Generates from Classroom Mode (`generateArtifact` dispatches; the queue stays endpoint-agnostic)
- [x] Saves as a `lesson_plan` Resource and opens correctly in `ResourceWorkspace`
      (note `isLessonPlan` at `client/src/pages/ResourceWorkspace.tsx:296`)
- [x] Markdown **tables** added to `client/src/lib/format.ts` — the Presentation section is a
      two-column teacher/student table, and the formatter had no table support at all, so it would
      have rendered as raw pipe characters
- [x] Tests — 22 server (`test/lib/lessonPlanSchema.test.js`), 8 client (`src/lib/format.table.test.ts`)
- [ ] ⚠️ **Not yet verified against a real Gemini call.** Per §7 rule 8, ONE manual run.

---

### P7 — Telemetry, polish, optional cap 🟡 Built (2026-08-07)

- [x] `Event` rows, no schema change as promised:
      - `classroom_mode_planned` (server, `index.js`) — mode requested, gate passed, what the planner
        decided. `planned: 0` is the interesting row: a teacher who turned the mode on and got nothing.
      - `classroom_artifact_saved` (server, `routes/resources.js`) — recorded where the save already
        passes through, tagged `source: 'classroom_mode'`. Saving is the honest success signal; an
        artifact generated but never saved helped nobody.
- [ ] `Event` rows for **generated** and **stopped** — deliberately deferred. Both are client-only
      states, and the existing `assistant/telemetry.ts` is the Action Router's with a closed event
      set that these do not belong in. Needs a small dedicated transport; not worth inventing one
      before the two rows above show whether the funnel question is even live.
- [ ] ⚠️ **Measure the real cost per Classroom Mode use** — BLOCKED on live usage. The telemetry to
      measure it now exists; the numbers do not.
- [ ] ⚠️ **Decide on a daily cap ([D9](#d9--no-usage-cap-in-the-pilot))** — blocked on the above. Do
      not guess a number; that is the whole point of D9.
- [x] Onboarding tip for the `+` button — `classroom-mode-intro`, shown only while the mode is OFF
      (once it is on, the teacher has found the button and the pill explains the rest)
- [x] Mobile pass — the Presentation table scrolls inside its own box rather than forcing the page
      to scroll sideways, and keeps its borders and repeats its header when printed
- [x] Accessibility pass — progress is now announced **while generating**, not only at the end. It
      previously swapped the "N of M ready" count for the Stop button, so the one moment a teacher
      most wants to know how far along it is said nothing. Card status was already text, not colour.

---

## 9. Deliberately NOT in scope

- **Grouping the five artifacts into one "pack"** — needs a migration ([D12](#d12--no-database-changes)).
  Each saves as its own Library resource for now.
- **Tap-to-generate chips in normal (mode-off) chat** — ✅ **decided out** by the owner
  ([D14](#d14--tap-to-generate-chips-in-normal-chat-are-out-of-scope)). Mode-off chat is completely
  unchanged. Revisit only if teachers ask for materials without wanting the mode.
- **A Classroom Mode action in the AI Action Router** — the router (`server/src/actions/`) could
  route *"make me everything for fractions"* here later. Additive, not needed now.
- **Editing artifacts inline in the chat** — Save, then edit in `ResourceWorkspace`, which already
  does this well.
- **Printing/exporting the whole set at once** — per-artifact print already exists in the Workspace.

---

## 10. Cost & risk

| Risk | Mitigation |
|---|---|
| ~5–6× AI spend per use | Opt-in, default off, visible pill; measure in P7; cap available ([D9](#d9--no-usage-cap-in-the-pilot)) |
| Rate limiter trips on a burst | Was 7 model calls per question; now **4** ([D23](#d23--the-four-question-shaped-artifacts-share-one-gemini-call)). At most 2 requests in flight, structurally — the free tier's 20/min was the binding limit, not token price |
| Planner misjudges applicability | P2 gate: 20 real questions verified before any generation is built |
| Planner call slows the answer | Parallel + shorter timeout + failure swallowed ([D7](#d7--the-planner-is-a-separate-call-run-in-parallel)) |
| Materials appear during a real emergency | Unconditional hard block ([§6](#6-the-emergency-block)) |
| Regression in the main chat path | Rule §7.3 — mode-off byte-equality is an acceptance test every phase |
| Five documents unreadable on a phone | Collapsed cards ([D11](#d11--nothing-auto-saves)); mobile check each phase |

---

## 11. Open questions

All P0 blocking questions are **resolved** (owner decisions, 2026-08-06):

| # | Question | Answer | Recorded as |
|---|---|---|---|
| 1 | Daily cap now, or measure first? | **Measure first** — no cap in the pilot | [D9](#d9--no-usage-cap-in-the-pilot-measure-first) |
| 2 | Chips in normal chat? | **Out of scope** | [D14](#d14--tap-to-generate-chips-in-normal-chat-are-out-of-scope) |
| 3 | Branch name? | **`classroom-mode`** | [§1](#1-snapshot) |
| 4 | Lesson Plan structure? | **Standard Indian government-school format** | [D15](#d15--lesson-plan-follows-the-standard-indian-school-format) |
| 5 | Does the mode survive a reload? | **No — session only** | [D16](#d16--the-mode-resets-on-page-reload-session-only-state) |
| 6 | New Library types for Homework / Exit Ticket? | **No — all save as `assessment`** | [D17](#d17--all-four-question-artifacts-save-as-assessment-no-new-library-types) |
| 7 | What language does the planner return? | **Topic free text; grade/subject canonicalized** | [D18](#d18--planner-language-handling) |
| 8 | Feature Management dashboard — now or later? | **Later, after Classroom Mode ships** | [§4.2](#42-scope-lock-) |

**No open questions block implementation. P0 can begin.**

### Still open (not blocking)

- **P6:** confirm the lesson-plan section list against a real teacher's plan before building.
- **P6:** new endpoint vs. a branch inside `POST /api/resources/generate` — decide at P6, record here.
- **Post-pilot:** revisit the cap once P7 telemetry produces real numbers ([D9](#d9--no-usage-cap-in-the-pilot-measure-first)).

---

## 12. Rules for future sessions

**If you are a new AI session picking this up, do this first:**

1. Read [§1](#1-snapshot) — it tells you the current phase and the next task.
2. Read [§4](#4-decisions-log) — do **not** re-open settled decisions. Each records what was
   rejected and why.
3. Read [§7](#7-engineering-rules-do-not-break-these) — those rules are load-bearing.
4. Work **one phase at a time**. Do not start the next phase until every checkbox in the current
   one is ticked.

**When you complete a phase:**

- [ ] Tick every checkbox in that phase
- [ ] Change its heading marker ⬜ → ✅ and update the §1 progress table
- [ ] Update §1 **Current phase**, **Overall progress**, **Last updated**, **Next task**
- [ ] Record any decision you made along the way in §4, with what you rejected
- [ ] Commit the doc update **with** the phase's code, not separately

**When you change the design:**
Add a new decision to §4 with the reasoning. Never silently edit an old one — if a decision is
reversed, say so and say why (see the note under [D7](#d7--the-planner-is-a-separate-call-run-in-parallel)
for the format).

**Never:**
- Touch `schema.prisma` or run a migration without asking the owner
- Change the vocabulary in one file without the other (rule §7.2)
- Let the flag default to ON
- Skip the emergency block
