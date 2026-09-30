# Comment cleanup — Server review & plan

Branch: `chore/server-comment-cleanup` (uncommitted, nothing pushed). Scope: `server/` only.
Same rules as `docs/comment-cleanup-client-plan.md`; Mobile gets its own pass afterwards.

Status: **findings + proposal only. No server file has been modified.**

The server is CommonJS JavaScript, so there is no Javadoc. The equivalent is JSDoc (`/** */`),
reviewed here under the same rules as `//` comments.

## 1. What I looked at

Every tracked file under `server/` except lockfiles, migrations, and eval cassettes/baselines
(generated JSON): 212 `.js` files plus `schema.prisma`, `.env.example`, and 6 `.md` files.

| Area | Files | Lines | Comment lines | Notes |
| --- | --- | --- | --- | --- |
| `src/` | 93 | 21,807 | **7,881** (36%) | The real target |
| `test/` | 105 | 25,829 | 2,824 (11%) | Mostly short; headers and labels are the issue |
| `evals/` (js) | 10 | 2,437 | 522 (21%) | Scorer/runner headers |
| `tools/` | 3 | 384 | 126 (33%) | Header essays on small scripts |
| `prisma/schema.prisma` | 1 | 836 | 328 (39%) | Per-field/model notes |
| `.env.example` | 1 | 729 | nearly all comments | User-facing config docs |

| Measure (all server `.js`) | Count |
| --- | --- |
| Unbroken `//` blocks of 10+ lines | 185 (45 of them 20+ lines) |
| JSDoc blocks longer than 8 lines | 180 |
| `@param` / `@returns` tags | 482 across 364 JSDoc blocks (mixed tag and prose style) |
| ASCII banners (`// ─── … ───`, `// ---- … ----`) | 169 lines |
| Milestone ids (`M0`…`M10`) | ~205 |
| `Phase N` | ~181 |
| Guardrail ids `G#` / decision ids `D#` | ~97 / ~64 |
| `CHANGE-#` / `ADR` | 36 / 42 |
| ALL-CAPS emphasis words (`NEVER`/`MUST`/`ONLY`) | ~126 |
| "Sibling feature … fail at boot" boilerplate | 8 / 7 |
| History narration ("previously", "no longer", "legacy", "bug fix", "since M3") in `src/` comments | ~53 |
| Dated comments (`2026-08-29` etc.) | 23 |
| Lint/TS directives | 1 |
| TODO / FIXME / HACK | 0 |
| Commented-out code | 0 (4 regex hits are prose) |

Heaviest `src/` files by comment lines: `index.js` (532), `routes/resources.js` (434),
`assistant/contracts.js` (310, 77% of the file), `lib/flags.js` (292), `assistant/slotRecovery.js` (245),
`lib/teacherAttendance.js` (223), `routes/auth.js` (213), `assistant/proposalSchema.js` (208),
`routes/assistant.js` (204), `assistant/resolver.js` (178), `gemini.js` (164),
`learningRepresentation/rendering/cache.js` (155, 66% of the file), `assistant/interpret.js` (154),
`routes/teacherAttendance.js` (147), `assistant/telemetry.js` (141).

Directory concentration: `src/assistant/**` and `src/learningRepresentation/**` are the worst
(design-doc headers, 20–90 lines each). `src/lib/**` (38 files) and `src/routes/**` (16) are next.
`src/actions/**` is mid. Test files are comparatively light.

## 2. What is wrong with them

As on the client, the content is mostly sound — real reasoning is there. The problem is volume and voice.

1. **Design-doc essays in file headers.** `cache.js` opens with ~87 comment lines (sections on
   "only successful renders are cached", "state lives in memory", "deploy cadence and hit rate"),
   `breaker.js` with ~52, `slotRecovery.js` with 45, `telemetry.js` with 39. Each re-argues a
   decision that `docs/ai-action-router-*.md` or the ADR already records.
2. **Project-management vocabulary in source.** `Phase E`, `Milestone M7a`, `amendment CHANGE-8`,
   `decision D20`, `guardrail G21`, `invariant I12`, `approval A3`, `ADR §13`. These mean nothing to a
   reader of the file and go stale when the plan does.
3. **Changelog and narration.** "During M7b two eval runs died on upstream limits, the second returning
   HTTP 429 on 126 consecutive calls"; "There is deliberately no review queue here anymore"; "mapGrade
   was tried and MEASURED WRONG before this module was written"; "Alternative A".
4. **AI-flavoured style.** ALL-CAPS emphasis, rhetorical headings (`THE ONE SENTENCE THAT EXPLAINS THIS
   FILE`, `READ THIS BEFORE CHANGING THAT`), "two honest consequences, neither hidden", "a confident
   badge", "deliberately" on nearly every constant.
5. **Same rationale repeated.** `cache.js` states the reset-on-restart trade-off in the header, again
   under "deploy cadence", and references `budget.js`'s identical text a third time. `index.js` repeats
   the "sibling feature, fail at boot on a malformed module" paragraph for every router (8 times).
6. **Restating the code.** JSDoc on constants that repeat the name (`RECOVERABLE_SLOTS`: "The only
   slots this stage will ever fill"); `@param` lines that copy the parameter name/type; section banners
   over a single function.
7. **Figures that go stale.** "grade 23.9% -> 9.1%, routing recall 89.6% -> 84.0%" in `slotRecovery.js`;
   similar in `evals/` and `assistant/*` headers. Tests/baselines already pin the real numbers.
8. **Stale doc pointers.** `docs/schedule-a-call-plan.md` (6 files) and `docs/attendance-plan-review.md`
   (5 files) do not exist.
9. **Comment-only essays on boot wiring.** `index.js` (532 comment lines in 1,238) is mostly
   import-by-import justification that could be a single line.

## 3. What is good and must survive

The bar for keeping a comment: a future engineer would make a wrong change without it.

- **Security invariants** (CLAUDE.md §4): ownership from the token, 404 for missing-or-not-yours,
  Gemini key only in `gemini.js`, trusted instructions vs delimited untrusted content in `prompts.js`/
  `gemini.js`, role scoping in admin routes, refresh-token rotation/lockout in `auth.js`. Shortened,
  never dropped.
- **Non-obvious gotchas**: `latexGuard.js`/`mathNotation.js` repair rationale (why `$5 and $10` must
  not pair, why normalization is a second pass after `normalizeAssessmentMath`), `vocab/grades.js`
  class-context gating, `shared.js` `MAX_RAW_LENGTH`, NFKC/Devanagari handling, `isEnvTrue` typo policy
  ("typo warns and uses default") in `flags.js`, why `ASSISTANT_ENABLED` is the only reliable kill
  switch (PWA caching).
- **Cross-module couplings**: mirrors that tests pin (`vocab/*` ↔ client `config.ts`), "gemini.js is not
  opened by the breaker; signal is read from `error.metrics`", `PassthroughReason` vocabulary being frozen.
- **Operational caveats that affect readers**: in-memory state resets on restart and is per-process
  (`budget.js`, `cache.js`, `breaker.js`) — stated once per file, in one line, or once in
  `assistant/README.md` with a pointer.
- **Why-the-schema-is-shaped-so** notes: tenant boundary on `School`, `User` identity is email, `pinHash`
  is legacy and unread, `SchoolClass.schoolId` is denormalized and never used for access.
- **Lint directive** (1) — untouched.
- **`.env.example` bounds and defaults** per variable — kept; only the prose around them is trimmed.
- **Test "why this test exists"** one-liners, especially for security/ownership tests.

## 4. Cleanup rules

**Remove**
- Comments restating the identifier/type/next line.
- Milestone / phase / change-request / decision / guardrail / invariant ids (`M#`, `Phase N`, `CHANGE-#`,
  `D#`, `G#`, `I#`, `A#`, `ADR §`), `spec §x.y`, "approved", "amendment" — unless the id is the only handle
  to something a reader must look up; in that case replace it with a doc path.
- Changelog narration, measurement history, dates ("During M7b…", "previously…", "Bug fix:").
- Duplicate statements of one rationale (keep it at the one best spot).
- Stale doc pointers (2 missing docs).
- Section banners (`// ─── … ───`, `// ---- … ----`); keep a plain one-line `//` only where grouping
  genuinely helps in a 600+ line file (`routes/teacherAttendance.js`, `routes/resources.js`, `index.js`).
- The repeated "sibling feature / fail at boot" paragraphs in `index.js`.

**Shorten**
- Multi-paragraph headers and JSDoc → 1–3 lines: what the module is for, plus the one non-obvious
  constraint. Point to `docs/…` instead of re-arguing a decision.
- `@param`/`@returns` kept only where the type/name don't say it (units, nullability meaning, side effects).

**Rewrite**
- No ALL-CAPS emphasis, rhetorical headings, "deliberately / exactly / honest / load-bearing".
- Plain, present-tense, first clause is the point. Prefer *why* over *what*.

**Keep as-is**
- Lint/TS directives, genuine gotchas (§3), short accurate one-liners, public contract docs where the
  contract is not visible from the signature.

**Format conventions**
- `//` for implementation notes; `/** */` only for exported functions whose contract needs explaining.
- Size targets: file header ≤ 3 lines (most 1); JSDoc ≤ 3 lines; inline note ≤ 2 lines. Up to ~6 only for a
  truly tricky algorithm (`latexGuard`, `vocab/grades` parsing, `teacherAttendance` geofence/status).
- Schema/env comments: one line per field or var where the name alone isn't enough.

### Example 1 — `cache.js` header (87 lines → 6)

Before: frozen-architecture bullets, three `───` essays, references to ADR §11/§13, `budget.js`, Phase F,
Railway, CHANGE-6.

After:
```js
// In-memory cache around render(), keyed on (representation, prompt, answer, render version).
// Shared across users: a hit needs a byte-for-byte match on prompt and answer, so nothing user-specific leaks.
// Only successful renders are cached, so a transient failure isn't sticky. Bumping a render version invalidates.
// State is per-process and resets on deploy (same trade-off as assistant/budget.js); purely an optimization.
```

### Example 2 — `slotRecovery.js` header (~45 lines → 5)

After:
```js
// Fills `grade` and `subject` from the utterance when the teacher plainly said them and the model didn't.
// Pure code: nothing here touches the prompt, schema, or model, so routing behaviour is unchanged.
// It only picks which short span is worth asking about; the canonical value still comes from actions/vocab/.
// Whole-utterance mapping gave false positives ("I have 5 students" → Class 3-5) and hits the 120-char
// normalize cap, so we isolate a few tokens first and map only that.
```

### Example 3 — `breaker.js` header (52 lines → 4)

After:
```js
// Opens when Gemini is rate-limiting us so the router steps aside and Coach keeps the shared quota.
// Reads the signal from `error.metrics` rather than changing gemini.js; only the router consults it, never /api/coach.
// Open means "skip the model call and pass through" (reported as `classifier_error`); it is never surfaced as an error.
```

### Example 4 — `index.js` router imports (~60 lines → ~6)

Drop the per-router paragraphs; keep one line above the block:
```js
// Routers are required at boot so a malformed module fails startup, not a request.
```
Keep the one note that matters: `classroomRouter` (student attendance) vs Classroom Mode (AI chat) vs
`teacherAttendanceRouter` are unrelated features — as a single line next to each require.

## 5. Things that would touch code, not just comments (need your call)

1. **Executable strings that carry labels.** ~50 test titles embed ids — e.g. `describe('CHANGE-3 — …')`,
   `test('… (decision D4)')` (`registry.test.js`, `assistant.catalog.test.js`, `assistant.events.test.js`,
   `assistant.hardening.test.js`, `assistant.interpret.test.js`, …). They are code, not comments. My default
   (same as client): **leave them alone**. Renaming them is behavior-neutral but changes test names in CI/reports.
2. **Other string literals with process-ids.** Log events, error messages, and Gemini prompt text may carry
   `M#`/`Phase` wording. Default: **untouched**. I will grep for these and list any I find in the final
   report rather than edit. Prompt text in particular is behavior.
3. **Tools' `--help`/usage text** in `tools/*.js` is a string, not a comment — untouched.
4. No executable line needs to change. If I find one I'll stop and ask.

## 6. Scope of non-JS files

| File | Plan |
| --- | --- |
| `prisma/schema.prisma` | Trim the `///`/`//` notes (328 lines → ~150). Comments don't affect `prisma generate`, but I'll run `npx prisma generate` and confirm the generated client is unaffected. `@@map`, `@default`, `@relation` untouched. |
| `.env.example` | Trim prose, keep every variable, default, and bounds line. Verify variable list is identical before/after with a script. |
| `src/actions/README.md`, `src/assistant/README.md`, `evals/*.md` | **Left alone.** These are the documentation destination for moved rationale. |
| `docs/` | Left alone, except possibly adding a short decision note (see §8 Q2). |

## 7. Execution plan (after approval)

One directory at a time, each diff reviewed.

| Batch | Files | Notes |
| --- | --- | --- |
| 1 | `src/assistant/**` (non-test) | ~1,900 comment lines; biggest id noise |
| 2 | `src/learningRepresentation/**`, `src/actions/**`, `src/attachments/**`, `src/safety/**` | Keep vocab gotchas |
| 3 | `src/lib/**` | Keep latex/math/geofence gotchas |
| 4 | `src/routes/**`, `src/middleware/**` | Keep security/ownership invariants |
| 5 | `src/index.js`, `src/gemini.js`, `src/prompts.js` | Boot wiring and the Gemini boundary |
| 6 | `prisma/schema.prisma`, `.env.example` | Non-JS verification applies |
| 7 | `test/**`, `evals/**`, `tools/**` | Trim headers; keep "why" one-liners |

Expected outcome (comment lines):

| Area | Now | Target |
| --- | --- | --- |
| `src/` | 7,881 | ~3,000 |
| `test/` | 2,824 | ~1,700 |
| `evals/` | 522 | ~250 |
| `tools/` | 126 | ~60 |
| `schema.prisma` | 328 | ~150 |

Goal: no `M#` / `Phase N` / `CHANGE-#` / `D#` / `G#` / `ADR §` references left in comments.

**Safety checks, per batch and at the end**
1. **Comments-only proof.** A script tokenizes each changed `.js` file from `HEAD` and from the working
   tree with `acorn` (already in `node_modules`) and compares the non-comment token streams; any difference
   fails the batch. Directive comments (`eslint-`, `@ts-`, `vitest-environment`) are counted before/after.
   `.env.example` is checked by comparing the `KEY=` / `# KEY=` line sets.
2. **Gate from CLAUDE.md §1:** `npx prisma generate` → `npm run lint` → `npm test` in `server/`; real output reported.
3. `git status` reviewed to ensure only intended files changed (no test artifacts such as `test-results/`).
4. No commit, no push. Final report lists files changed and the before/after comment counts.

## 8. Open questions

1. **Test titles with ids (§5.1):** leave as-is (my default) or rename?
2. **Where removed rationale goes:** I will rely on existing docs (`docs/ai-action-router-*.md`, the
   learning-representation ADR, `src/assistant/README.md`). If a decision being cut is not recorded anywhere,
   should I (a) add a short note to the relevant doc, or (b) drop it if it is obvious from the code? I recommend (a)
   only for genuinely non-obvious decisions, kept brief.
3. **Milestone/decision ids:** OK to remove them entirely from source, with docs as the source of truth? (Recommended.)
4. **Tests/evals/tools:** include in this pass (batch 7) or leave for later? (Recommended: include; they are smaller wins.)
5. **Stale pointers:** for the two missing docs, drop the reference (my default) — or do you want those docs restored?
