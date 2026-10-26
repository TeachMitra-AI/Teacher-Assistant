# Final verification report: SarasTech AI skills and rules

**Date:** 2026-10-26 · **Branch:** `feature/homepage-faq-categories` @ `68c31d4` (all guidance
files are untracked, uncommitted work) · **Auditor:** Claude Code (Opus 5.5), local session.

> **Update (later on 2026-10-26):** the team confirmed it uses Claude Code only. OQ-2 is
> resolved, and L-3 (Cursor parity) no longer applies. The structure and invocation review
> that followed is in `SKILLS_RULES_STRUCTURE_REVIEW.md`.

## 1. Verdict

**PASS WITH ISSUES.**

The skills, rules, hook, and validator exist, match the real SarasTech code, and work in a
live Claude Code session. All three workspace gates pass. Ten defects were found in the
guidance system itself. Five were in the guard hook, and the most serious let the Grep tool
read real `.env` files. All ten were fixed and re-verified (§5). The issues that remain are
application-code items awaiting your decision (`REQUIRED_CODE_CHANGES.md`, chiefly
**RCC-001**, **RCC-002**, **RCC-012**), weaker support in Cursor, and limits inherent to a
fail-open hook (§7).

**Reference style: followed for skills, deliberately adapted for rules and hooks.** The
skills keep the nmph hub's structure almost one-to-one. The Cursor-only formats (`.mdc`
rules, `hooks.json` with sh/ps1 pairs) were replaced with their Claude Code equivalents.
That is correct for Claude Code, but it means path-scoped rules do not load automatically
in Cursor (§3.4, OQ-2).

## 2. Method: static inspection versus execution

| Kind | What was done |
| --- | --- |
| Static | Read every guidance file in full (§8). Read every SKILL.md and rule in both reference archives, plus their hooks and commands. Read the source behind each code claim in the rules (§4). Inspected git status and diffs. |
| Execution | Ran the validator, the hook test suite, a bypass probe of the hook's `decide()`, live hook probes in this session, and all three workspace gates (§6). |
| Vendor docs | Read code.claude.com/docs/en/hooks and cursor.com/docs/context/skills on 2026-10-26, to check the hook `args` form, how `ask` interacts with permission rules, and Cursor's skill directories and frontmatter. |
| Not done | `npm audit` (needs network access). The client `npm run build` step (it would rewrite your modified `client/tsconfig.tsbuildinfo`). Checking the `/` menu. Any Cursor session. Any reference-archive script (none were executed). |

The reference archives were extracted into an isolated scratch directory outside the
repository and treated as untrusted data. Nothing from them was copied into the repository.

## 3. Comparison with the reference projects

### 3.1 Preserved: style and conventions

| Convention | Reference example | SarasTech example |
| --- | --- | --- |
| One folder per skill, `SKILL.md`, `name` = folder | `nmph/skills/analyze-change/SKILL.md` | `.claude/skills/analyze-change/SKILL.md`. The validator enforces name = folder. |
| Frontmatter `name` / `description` / `disable-model-invocation` | `nmph implement-change`: `disable-model-invocation: true` | Same three keys, plus Claude Code's `argument-hint` and `disallowed-tools`. |
| H1 title, then `## N. Step` numbered sections | `# Analyze Change` / `## 1. Start With Supplied Context` | `# Analyze change` / `## 1. Start from what was supplied` |
| Evidence classes | CONFIRMED / HYPOTHESIS / UNKNOWN | Identical (`analyze-change` §1, `debug-issue` §3). |
| Handoff contract | `.cursor/work/active-change.md`: UUID, branch, HEAD, READY/BLOCKED, IN_PROGRESS → CONSUMED, `/implement-change HANDOFF=<id>` | Same lifecycle and fields in `.claude/work/active-change.md` (git-ignored). |
| Fixed output sections | `Return:` followed by `### Root Cause`, `### Evidence`, … | `### …` report headings. `debug-issue` and `generate-tests` were aligned to this during verification (GD-10). |
| Rule body | H1 plus short imperative bullets (`nmph rules/development/testing.mdc`) | Same shape (`.claude/rules/testing.md`). |
| Few always-on rules, the rest scoped by path | Activa: 5 `alwaysApply`, 18 `globs` | 1 always-on rule (`agent-safety.md`, plus `CLAUDE.md`). Six are `paths`-scoped. |
| Introduced vs pre-existing review findings, human sign-off line | `activa/commands/review.md` "Pre-existing vs Introduced Issues" and "Disclaimer" | `review-change` §1 and §4 |
| Hook blocks protected-branch commits and merges | `activa/hooks/block-protected-branch.sh`, `block-mr-merge.*` | `guard-high-impact.mjs`: main/master commit → ask, force-push main → deny, merge → ask |

### 3.2 Reused workflows

`analyze-change` → `implement-change`, `debug-issue`, `generate-tests`, and the review flow
(as `review-change`). Each keeps the reference's order of steps and its "stop rather than
improvise" exits.

### 3.3 Adapted for SarasTech

| Pattern | Adaptation | Why |
| --- | --- | --- |
| "Do not run tests unless explicitly requested" (every nmph development skill and rule) | Skills run the workspace gate | `CLAUDE.md` §2 requires verification. This is the main intentional behaviour change. |
| `debug-issue` and `generate-tests` manual-only | Model-invocable | Investigation comes first, and they edit only when the user asked for a fix or tests. `generate-tests` now stops at a plan when only a plan was asked for (GD-9). |
| `code-review` name | `review-change` | `/code-review` is a Claude Code built-in, and the validator rejects built-in names. |
| CodeBeamer input, `.cursor/docs/architecture.md` routing | Replaced by a **Security surface** checklist tied to SarasTech controls | SarasTech has no CodeBeamer or architecture index. Path-scoped rules do the routing. |
| `.mdc` with `description`/`globs`/`alwaysApply` | `.md` with `paths` in `.claude/rules/` | Claude Code reads only `paths`, and the validator rejects other keys. **Cost:** the nmph "agent-requested" mode (description only) has no equivalent, and Cursor does not read `.claude/rules/` (§3.4). |
| `hooks.json` + duplicated `.sh`/`.ps1` scripts that parse JSON with `grep -o` | One dependency-free Node PreToolUse hook with real JSON parsing and unit tests | Cross-platform. The reference's regex parsing misses escaped quotes. |

### 3.4 Not adopted, and why

| Item | Reason |
| --- | --- |
| Medtronic copyright/confidential headers (all 23 Activa rules and 6 hooks, confirmed) | Proprietary. Nothing was copied (OQ-1). |
| Android/Kotlin/Angular/Gherkin/Appium rules, `backend-`/`frontend-implementation` | Wrong stack. Path rules plus `implement-change` cover the need. |
| `regression-log-analyzer`, `codebeamer`, `sonarqube`, `figma`, `arxan-*`, `test-procedure-assistant` | Internal Medtronic services. `rosetta_client.py` defaults to plain `http://`. Shared-password env-var setup. Not part of SarasTech's toolchain. |
| Mandatory four-subagent review fan-out | Cost without benefit at SarasTech's size. |
| `.cursor/` mirror of rules | Two copies would drift. **Unresolved:** if the team uses Cursor, rules arrive only through the `AGENTS.md` pointer (OQ-2). |

Defects confirmed in the references themselves: `nmph/skills/code-review/SKILL.md` starts
with a blank line before `---`, and `arxan-to-datatheorem-v2` declares
`name: arxan-to-datatheorem`. Neither carried over.

## 4. SarasTech-specific correctness

Each claim the guidance makes about the code was checked against the source. **All hold**,
except the three marked *corrected*.

| Claim (file) | Evidence |
| --- | --- |
| Gates per workspace (`CLAUDE.md` §1, rules) | `server`, `client`, and `mobile` `package.json` scripts and `.github/workflows/ci.yml` jobs match. All gates ran green (§6). |
| `authRequired` re-reads status and fails closed with 503. HS256 pinned. | `server/src/middleware/auth.js:21, 67-79` |
| `optionalAuth` unused | Grep finds no router using it (RCC-011) |
| `requireRole` / `schoolScope` | `schoolScope` in `routes/admin.js`, `adminSupport.js`, `lib/notification*.js` |
| Owner scoping with `findOwned`, 404 | `routes/resources.js:774, 893, 905` |
| `asyncHandler` on async handlers | Every router: the count of async handlers ≤ the count of `asyncHandler(` calls |
| The global error handler never echoes `err.message` | `index.js:956-980`: it logs `message` server-side and answers a generic 500 |
| 16 kB / 64 kB body limits | `index.js:356-363` |
| Limiters mounted before routers | *Corrected* (`server.md`): most are. `/api/coach` takes its limiter inline (`index.js:569`), `lib/limiters.js` builds the generate limiter, and `routes/auth.js` has its own. |
| No raw SQL. No `child_process` in `server/src`. | Both greps: 0 hits |
| `createBudgetCounter`, `parseIntEnv`, `flags.js`, `sendAiError` | All exist and are used as described |
| Model output re-validated ("responseSchema … only a hint") | `assistant/proposalSchema.js:7, 222` |
| Free-text grade/subject in `systemInstruction` (RCC-001) | `prompts.js:166-180`, `routes/resources.js:159-161, 323-324`, `lib/lessonPlanPrompt.js:71-72` |
| `seed.js` refuses production. Tools have `--dry-run`. | `seed.js:26`. `tools/pruneAssistantEvents.js`, `tools/clearTeacherAttendance.js`. |
| Hook-guarded npm scripts exist | `start` (runs `prisma migrate deploy`), `migrate`, `seed`, `eval`, `eval:replay`, `assistant:prune-events`, `attendance:clear-test-data` |
| Test helpers | `server/test/helpers/`: `testApp`, `fixtures`, `auth`, `geminiMock`, `emailMock`, `testEnv` |
| `formatResponse` is the only HTML sink | 8 `dangerouslySetInnerHTML` sites, all wrapping `formatResponse`. No KaTeX `trust` override in `lib/math.ts`. |
| HttpOnly `sarastech_refresh` cookie, `X-Session-Transport` | `middleware/auth.js:125`, `client/src/api.ts:23` |
| Mobile SecureStore | `mobile/src/api/session.ts:12-28` |
| Mobile test location | *Corrected* (`generate-tests`): Jest uses its default `testMatch`, and `mobile/src/lib/structuredQuestions.test.ts` sits outside `__tests__`. |
| No secrets in `VITE_*`/`EXPO_PUBLIC_*` | 26 variable names found. All are flags, URLs, OAuth client IDs (public by design), a GA ID, or a WhatsApp number. |
| `.claude/work/` git-ignored. `settings.local.json` ignored. | `git check-ignore -v`: `.gitignore:24`, `~/.config/git/ignore:1` |
| Local allowlist risk (RCC-004) | *Corrected*: the user has since remediated it (§5, GD-8) |

No rule was found telling an agent to rely on a control that does not exist. Where code
doesn't yet meet a rule (RCC-001, RCC-011), the rule says so and points to the register.

## 5. Defects found in the guidance system, all fixed

| ID | Severity | Defect (evidence) | Fix | Verified by |
| --- | --- | --- | --- | --- |
| GD-1 | **Medium** | The Grep tool was not covered by the hook, so `Grep(path: "server/.env")` or `glob: ".env"` returned secrets. The probe returned `none`. The docs claimed "secrets are unreadable through agent tools". | `Grep` added to the matcher in `.claude/settings.json`. `decide()` checks Grep's `path` and `glob`. | Unit tests. A **live** Grep probe (glob `.env*` over `docs/`, which holds no `.env`) was denied in this session. |
| GD-2 | **Medium** | `grep -rn GEMINI server` (a natural honest command) prints `server/.env`, because GNU grep ignores `.gitignore`. Probe: `none`. | Hook asks before a recursive grep of `.`, `..`, `*`, `server`, `client`, or `mobile`. `agent-safety.md` now says to use the Grep tool or `git grep`. | Unit tests. Probe: `ask`. `grep -rn … server/src` still `none`. |
| GD-3 | Low–Med | A `.env*` wildcard (`cat server/.env*`) bypassed `isSecretPath`. Probe: `none`. | `ENV_FILE` matches `*`/`?` after `.env` and a `*` prefix. `.env.example` is still allowed. | Unit tests (deny), and `ls server/.env*` stays `none` (metadata only) |
| GD-4 | Low | `npm --prefix server install x` skipped the dependency `ask`. | `npmDecision` skips leading options and the `--prefix` value. | Unit test |
| GD-5 | Low | `npx --yes prisma migrate reset` and `npx -y prisma db push` skipped the database `ask`. | Find `prisma` after leading `npx` flags. | Unit test, probe |
| GD-6 | Low | `SKILLS_RULES_ARCHITECTURE.md` (3 places) and `ARCHITECTURE_AUDIT.md` cited a `VALIDATION_REPORT.md` that was never written. | They now point to this report. | grep |
| GD-7 | Low | Over-claims: "Secrets are unreadable through agent tools". Live hook firing listed as "not verifiable". | Reworded to what is enforced and what isn't. Live results recorded. | Review |
| GD-8 | Low | RCC-004 and `ARCHITECTURE_AUDIT.md` §7 described an allowlist (320 rules, 12 wildcards, 4 JWTs) that no longer exists: there are now 285 rules, the only wildcard is `cd *`, and there are 0 JWTs. | Re-check notes added. RCC-004 set to Verified. | Node summary of `settings.local.json`, values redacted |
| GD-9 | Low | `generate-tests`: incomplete mobile test location, and step 3 wrote tests even when only a plan was asked for (it is model-invocable). `server.md`: "limiters are mounted in index.js" was incomplete. | Corrected the text. | Review against code |
| GD-10 | Low (style) | Report formats were inconsistent across skills (`**A** · **B**` vs bullets) and differed from the reference's `###` sections. | `debug-issue` and `generate-tests` reports now use `###` headings. | Validator |

After the fixes: validator 0 errors / 0 warnings, and hook tests 9/9 pass (now with 12 more
assertions).

## 6. Test and validation evidence

All commands were run in this session on 2026-10-26 with Node v24.18.0.

| Check | Command | Result |
| --- | --- | --- |
| Guidance validator (before and after fixes) | `node .claude/scripts/validate-guidance.mjs` | `0 error(s), 0 warning(s).` exit 0 |
| Hook unit tests (before and after fixes) | `node --test .claude/hooks/guard-high-impact.test.mjs` | `tests 9 · pass 9 · fail 0` |
| Hook bypass probe | scratch script calling `decide()` | Before: all 7 bypasses `none`. After: deny/ask as intended, with no false positive on `server/src` greps, `*.js` globs, or `.env.example`. |
| **Live hook (Bash)** | `echo "probe: server/.env"` | Denied by "SarasTech guard". The registration and `args` exec form work. |
| **Live hook (Grep)** | Grep `glob: .env*`, path `docs/` | Denied after GD-1. The settings change took effect in-session. |
| **Live invocation settings** | Session skill list | Only `debug-issue` and `generate-tests` are visible to the model. `disable-model-invocation: true` hides the other three, as designed. |
| Server gate | `npx prisma generate` → `npm run lint` → `npm test` | generate 0, lint 0, **100 files / 2494 tests passed** |
| Client gate | `npm run lint` → `npm test` | lint 0 errors (1 pre-existing `react-hooks/exhaustive-deps` warning in `useClassroomQueue.ts:171`), **78 files / 1123 tests passed**. `npm run build` **not run** (see §2). |
| Mobile gate | `npm run lint` → `npm run typecheck` → `npm test` | all exit 0. **70 suites / 602 tests passed** |

Note: `expo lint` loads `mobile/.env` on its own and printed only variable names. No values
reached this session.

The gates show the product is unaffected (no application code changed) and that the gate
commands the guidance prescribes are correct. They do not test the guidance's prose.

## 7. Remaining issues and limitations

| # | Severity | Issue | Disposition |
| --- | --- | --- | --- |
| L-1 | High (code) | RCC-001: free-text fields in `systemInstruction` | Awaiting decision OQ-5 |
| L-2 | High (code) | RCC-002: vulnerable server dependencies. RCC-012: historical keys. | Awaiting approval. Rotation must be confirmed by a human. |
| L-3 | Medium | **Cursor parity.** Cursor does not read `.claude/rules/`, does not document `disallowed-tools`, `argument-hint`, or `$ARGUMENTS` substitution, and does not run the Claude Code hook. In Cursor, rules arrive only through the `AGENTS.md` pointer, and `review-change` is read-only by instruction only. | OQ-2. If Cursor is used, consider generated `.cursor/rules/*.mdc` stubs that point to the `.md` rules, plus a `hooks.json` that calls the same Node hook. Not done here, because it is a design decision. |
| L-4 | Medium | The hook fails open and is a tokenizer, not a sandbox. `eval`, `bash -c "…"`, and `Get-ChildItem -Recurse \| Select-String` are not caught. | Documented. `onFailure: "block"` needs CLI ≥ v2.1.295 (OQ-3). |
| L-5 | Low | False positive: any command that merely names `server/.env` (for example `echo`) is denied. | Acceptable, conservative. |
| L-6 | Low | The guidance files are **untracked**. `agent-safety.md` gives authority to "committed" instruction files, gitleaks CI has not scanned them yet, and teammates don't have them. | They take effect for others only once you commit them. Validator secret scan: clean. |
| L-7 | Low | No CI job runs the validator or hook tests (RCC-010). | Proposed |
| L-8 | Info | `.claude/worktrees/fix-api-base-suffix/` (from Aug 23) is a stale worktree directory, excluded through `.git/info/exclude`. | Not touched |

## 8. Files inspected and their roles

| File | Role |
| --- | --- |
| `CLAUDE.md` (modified, tracked) | Project map, gates, principles, product invariants, git safety, §6 guidance index |
| `AGENTS.md` (new) | Pointer for Cursor/Codex to `CLAUDE.md` and `.claude/` |
| `mobile/AGENTS.md` (pre-existing) | Expo 57 docs pointer, precedence for `mobile/` |
| `.claude/rules/agent-safety.md` | Always-on agent-conduct rule |
| `.claude/rules/{server,ai-prompts,prisma,client,mobile,testing}.md` | Path-scoped rules |
| `.claude/skills/{analyze-change,implement-change,debug-issue,review-change,generate-tests}/SKILL.md` | Workflows |
| `.claude/settings.json` | Registers the PreToolUse hook |
| `.claude/hooks/guard-high-impact.mjs` and `.test.mjs` | Backstop policy and its tests |
| `.claude/scripts/validate-guidance.mjs` | Read-only validator. It spawns only `git ls-files`. No network. |
| `.claude/settings.local.json` (git-ignored) | User allowlist, reviewed with values redacted |
| `.gitignore` (modified) | Adds `.claude/work/` |
| `docs/ai-skills/*.md` | Design, audits, security review, change register, this report |
| `~/.claude/skills/synced/*` | User-level Anthropic skills. No name collisions. |
| Both reference archives (scratch directory) | Style baseline. Untrusted. Nothing executed. |

## 9. Unresolved questions for you

1. **OQ-2:** does the team use Cursor? If so, L-3 needs a decision.
2. **OQ-5:** fix RCC-001 in code, or accept it as a documented exception?
3. **OQ-1:** keep the Medtronic-confidential reference archives on this machine?
4. **`README.md` diff:** the working tree removes the link to
   `docs/READ_ALOUD_MANUAL_TESTING.md`, a file that exists and is committed (`e9ca510`).
   This verification did not make that change, and the earlier register does not record
   it. It was left untouched. Please confirm it is intended.
5. **OQ-3:** minimum Claude Code version, which decides whether `onFailure: "block"` can be used.

## 10. Changes made during this verification

| File | Change |
| --- | --- |
| `.claude/hooks/guard-high-impact.mjs` | GD-1 to GD-5 |
| `.claude/hooks/guard-high-impact.test.mjs` | Regression assertions for GD-1 to GD-5 |
| `.claude/settings.json` | `Grep` added to the matcher (GD-1) |
| `.claude/rules/agent-safety.md` | Search guidance (GD-2) |
| `.claude/rules/server.md` | Limiter wording (GD-9) |
| `.claude/skills/generate-tests/SKILL.md` | Mobile location, plan-only stop, report headings (GD-9, GD-10) |
| `.claude/skills/debug-issue/SKILL.md` | Report headings (GD-10) |
| `docs/ai-skills/SKILLS_RULES_ARCHITECTURE.md` | GD-6, GD-7, Cursor caveat |
| `docs/ai-skills/ARCHITECTURE_AUDIT.md` | GD-6, GD-8 |
| `docs/ai-skills/SECURITY_REVIEW.md` | Hook coverage, RCC-004, vendor-doc findings |
| `docs/ai-skills/REQUIRED_CODE_CHANGES.md` | Re-check section. RCC-004 and RCC-005 → Verified. |
| `docs/ai-skills/FINAL_VERIFICATION_REPORT.md` | New (this file) |

No application source, test, configuration, dependency, or database file was changed.
Nothing was staged, committed, pushed, merged, or deployed.
