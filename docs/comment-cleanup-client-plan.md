# Comment cleanup — Client review & plan

Branch: `chore/comment-cleanup` (uncommitted, nothing pushed). Scope of this doc: `client/src` only.
Server and Mobile get their own pass afterwards, using the same rules.

Status: **findings + proposal only. No client source has been modified.**

## 1. What I looked at

262 `.ts/.tsx/.css` files under `client/src`, ~47,000 lines.

| Measure | Count |
| --- | --- |
| Comment lines (`//`, `/* */`, `*`) | ~6,400 (~14% of all lines) |
| ...of which in `src/assistant/` | ~1,900 |
| ...of which in `src/lib/` / `components/` / `pages/` / `hooks/` | ~1,100 / ~1,400 / ~660 / ~290 |
| ...of which in tests | ~630 |
| Unbroken `//` blocks of 10+ lines | 95 (21 of them 20+ lines) |
| JSDoc blocks longer than 8 lines | 33 |
| JSDoc `@param` / `@returns` tags | 8 (so the codebase is prose-style TSDoc, not tag-style) |
| ASCII banner separators (`// ─── … ───`) | 28 files, 67 lines |
| CSS comments | 0 |
| TODO / FIXME / HACK | 0 |

Heaviest files: `config.ts` (253), `types.ts` (203), `GeneratorPage.tsx` (171), `CoachPage.tsx` (149), `telemetryTransport.ts` (147), `intentGate.ts` (146), `RouterProvider.tsx` (144), `assistant/types.ts` (137), `lib/classroom.ts` (119), `draftStore.ts` (107).

## 2. What is wrong with them

The comments are not bad in content — most carry real reasoning. The problem is *volume and voice*.

1. **Design-doc essays in file headers.** `assistant/*` files open with 20–45 line headers (`api.ts`, `intentGate.ts`, `telemetryTransport.ts`, `RouterProvider.tsx`, `circuitBreaker.ts`) with sections like `─── WHY THE DEADLINE IS A RACE AND NOT AN ABORT (approved decision D11) ───`. That reasoning belongs in `docs/ai-action-router-*.md` (which already exist), with a short pointer in code.
2. **Project-management vocabulary leaking into source.** `M6`, `M8`, `CHANGE-2`, `D7`, `D11`, `G14`, `Phase 1`, `spec §4.5`, "approved decision", "amendment", "guardrail". Roughly 67 `M#`, 32 `CHANGE-#`, 48 `D#`, 74 `§`, 72 `Phase N` hits. These are meaningless to a reader of the file and rot the moment the plan changes.
3. **Changelog / narration in comments.** "Bug fix: …", "has said since M3: …", "HIDDEN FROM THE HOMEPAGE (2026-08-15)", "observed on the Manage page". Belongs in git history / PR, not the file.
4. **Emphatic, AI-flavoured style.** ALL-CAPS emphasis (`DOES THIS LOOK LIKE A COMMAND?`, `CHANGE BOTH IN THE SAME COMMIT`, `SILENTLY`), rhetorical framing ("It is honest rather than elegant, and the alternative was worse"), "is load-bearing, not housekeeping", "is how a router becomes a framework", "exactly", "deliberately" repeated on nearly every constant.
5. **Same rationale stated three times.** e.g. the circuit breaker's "don't trip on passthrough" appears in the header, the `trip` doc, and the outcome type doc; the precision-over-recall argument appears in the header, on `COMMAND_VERBS` and again on `DOMAIN_NOUNS`.
6. **Restating the code.** `/** Does this look like the envelope the executor expects? */` over `isInterpretResponse`; `/** Marker for the deadline branch */` over a Symbol named `DEADLINE`; per-field docs that repeat the field name; docs on `DEADLINE_MS = 6000` explaining what "six seconds" is.
7. **Number/metric restatements that will go stale.** "96.1% precision and 92.5% recall over the 196-turn corpus" lives in a source comment while the test pins it anyway.
8. **Commented-out code.** `WelcomeScreen.tsx` (import + `shortcuts` line) and `config.ts` (the Manage shortcut, with a 6-line explanation). Not deleting these is a *code* decision, see §5.
9. **Stale reference.** 7 comments point at `docs/schedule-a-call-plan.md`, which does not exist.

## 3. What is *good* and must survive

The bar for keeping a comment: a future engineer would make a wrong change without it. Examples in the code that pass:

- `math.ts`: KaTeX/JSON-escape repair rationale, why `$5 and $10` must not pair, why backspace is scanned by string not regex (no-control-regex lint). Non-obvious, needs to stay — but trimmed.
- `config.ts`: `LANGUAGES` / `GRADES` / `SUBJECTS` mirror `server/src/actions/vocab/*` and are pinned by `vocabDrift.test.js` — a real cross-workspace coupling. Keep as 2 lines.
- `intentGate.ts`: NFKC/nukta note on `vocabulary()`; why `do`/`de`/`take` are excluded from verbs; whole-token matching (substring of "de" hits "define").
- `ConfirmDialog.tsx`: why portalled (stacking contexts) and why not native `<dialog>`.
- `format.ts` `<li>` pairing notes, `usePagedList` stale-response and "always refetch after patch" contract, `RouterProvider` sequence guard, `circuitBreaker` "not tripped by passthrough / not reset by new chat".
- `eslint-disable`, `@ts-expect-error` etc. directives (8 files) — untouched, along with their justification text.

## 4. Cleanup rules

**Remove**
- Comments restating the identifier/type/next line.
- Milestone / change-request / decision / guardrail IDs, `Phase N`, `spec §x.y`, "approved", "amendment" — *unless* the ID is the only handle to something a reader must look up, in which case replace with a doc path.
- Changelog narration ("Bug fix:", dates, "observed on…", "since M3").
- Duplicate statements of one rationale (keep it at the single best spot).
- Stale doc pointers (`schedule-a-call-plan.md`).
- Section banners `// ─── … ───` (replace with nothing, or a plain one-line `//` if grouping genuinely helps).

**Shorten** — multi-paragraph headers and JSDoc to 1–3 lines: what the module is for + the one non-obvious constraint. Point to `docs/…` instead of re-arguing a decision.

**Rewrite** — remove ALL-CAPS emphasis and rhetorical phrasing; plain, present-tense, first-clause-is-the-point. Prefer "why" over "what". No "deliberately / exactly / load-bearing / honest rather than elegant".

**Keep as-is** — lint/TS directives, license-ish or legal text, genuine gotchas (see §3), short accurate single-liners, and public-API doc on exported hooks/components where the contract isn't visible from the type (e.g. `usePagedList.patchItem`).

**Format conventions**
- `//` for implementation notes, `/** */` only for exported API where the contract needs explaining. Don't wrap trivially self-describing exports in JSDoc.
- Target sizes: file header ≤ 3 lines (most 1); JSDoc ≤ 3 lines; inline note ≤ 2 lines. Longer only for a truly tricky algorithm (e.g. `math.ts` repair), and even then ≤ ~6.
- Type-field docs stay only when the field name doesn't say it (units, invariants, who sets it).

### Example — `assistant/api.ts` header (30 lines → 3)

Before: 30-line header with two `───` sections, decision D11, spec §2.6.

After:
```ts
// Typed wrappers over api() for the assistant endpoints, plus a response shape check and a 6s deadline.
// The deadline is a race, not an abort: api() takes no AbortSignal and we don't want to duplicate its
// 401 refresh-and-retry. The socket stays open and a late response is dropped (see RouterProvider's seq guard).
// A 200 that doesn't match the expected shape is treated as a passthrough — an older cached client can meet a newer server.
```

And `DEADLINE_MS` 6-line doc → `// Slightly above the server's 5s budget, so this only fires when the network has failed.`

### Example — `intentGate.ts` header (~35 lines → 4)
```ts
// Cheap local check for "does this look like a command?" before we spend a server call on it.
// Tuned for precision over recall: a false positive adds a full classifier round trip to every coach question;
// a miss just means the teacher navigates manually. Rule: imperative verb near a domain noun, no leading
// question word, no "?". Measured numbers live in intentGate.eval.test.ts. Pure module: no network/storage/DOM.
```

## 5. Things that would touch code, not just comments (need your call)

1. **Commented-out code** in `WelcomeScreen.tsx` (2 spots) and `config.ts:122`. It's intentionally parked per `docs/hide-homepage-items.md`. My default: **leave the code lines exactly as they are**, and only shorten the explanation to a one-liner pointing at that doc. Deleting them is a behavior-neutral change but outside "comments only" — say so if you want it.
2. Nothing else. I don't expect any executable line to change. I'll verify with `git diff` filtered for non-comment lines and by running the client gate.

## 6. Execution plan (after approval)

Work in batches, one directory at a time, reviewing each diff:

| Batch | Files | Notes |
| --- | --- | --- |
| 1 | `src/assistant/**` (non-test) | Biggest win; ~1,900 comment lines, most process-ID noise |
| 2 | `src/config.ts`, `src/types.ts`, `src/api.ts`, `src/auth.tsx`, `src/App.tsx` | Type-field docs; keep contracts |
| 3 | `src/lib/**` | Keep math/format/structuredQuestions gotchas |
| 4 | `src/hooks/**`, `src/components/**` | Many small file headers |
| 5 | `src/pages/**`, `src/seo/**`, `src/*.tsx` | GeneratorPage / CoachPage / HomePage |
| 6 | `*.test.*` | Trim headers that narrate milestones; keep the "why this test exists" line |

Expected outcome: comment lines ~6,400 → roughly 2,000–2,500; no `M#/CHANGE-#/D#/§` references remain in source.

**Safety checks per batch and at the end**
1. `git diff -U0` scanned so every changed line is comment-only (script check: strip comments from before/after, compare equal — I'll do this via `tsc`'s `removeComments` emit or an esbuild strip-comments diff on every changed file).
2. Gate from CLAUDE.md §1: `npm run lint` → `npm test` → `npm run build` in `client/`.
3. Restore `client/tsconfig.tsbuildinfo` if the build modifies it (it's a tracked generated file — I won't leave it dirty).
4. No commit, no push.

## 7. Open questions

1. **Commented-out code (§5.1):** leave code, shorten comment (my default), or delete?
2. **Where the removed rationale should go:** I'll rely on the existing `docs/ai-action-router-*.md`. If a removed decision isn't recorded there I'd otherwise lose it — OK for me to add a short "Decisions" note to the relevant existing doc, or should source-only rationale just be dropped when it's already obvious?
3. **Milestone/decision IDs:** OK to remove them entirely from source (docs keep them)? That's my recommendation.
4. **Test files:** include in this pass (batch 6), or leave tests alone?

---

## 8. Client outcome (completed)

| Measure | Before | After |
| --- | --- | --- |
| TS/TSX comment lines (`client/src`) | 6,394 | 2,538 |
| `index.css` comment lines | 977 | 678 |
| Files changed | | 214 TS/TSX + `index.css` |
| Lines (all files) | | +2,355 / −6,511 |

**Verification**
- Every changed TS/TSX file compared against `HEAD` with comments stripped (`ts.transpileModule`, `removeComments`): 0 non-comment differences. `index.css` checked the same way: 0.
- Lint / test / build gate: `npm run lint` 0 errors (1 warning in `useClassroomQueue.ts`, identical at `HEAD`); `npm test` 66 files / 832 tests pass; `npm run build` succeeds (typecheck + vite build + prerender).
- Lint/TS directives untouched (one was accidentally dropped in `ErrorBoundary.tsx` and restored; a before/after count of directives now matches on every file).

**Deliberately not changed**
- Test titles that contain labels (`describe('CHANGE-3 — …')`, `(decision D4)`, `(decision D12)`, `describe('CHANGE-9 …')`) in `pendingAsk.test.ts`, `repeatCache.test.ts`, `RouterProvider.test.ts`: these are executable strings, not comments.
- `client/src/assistant/README.md` and `docs/`: they remain the source of truth for the milestone/decision labels.
- Commented-out code in `WelcomeScreen.tsx` and `config.ts` kept verbatim; only the explanation was shortened.
- `client/tsconfig.tsbuildinfo` restored to `HEAD` after the build.
