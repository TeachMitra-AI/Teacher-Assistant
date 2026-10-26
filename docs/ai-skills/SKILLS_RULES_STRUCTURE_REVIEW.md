# Skills and rules structure review

**Date:** 2026-10-26 · **Claude Code:** v2.1.310 · **Branch:** `feature/homepage-faq-categories`
@ `68c31d4` (guidance files untracked) · **Scope:** organization, format, invocation, and
handoffs of the Claude Code skills and rules only. Application code, bugs, and security
are out of scope. They are covered by `FINAL_VERIFICATION_REPORT.md`, and nothing here
re-audits them.

## 1. Verdict

**PASS WITH ISSUES.** The structure is correct for Claude Code and follows the nmph hub's
skill conventions. The handoff workflow is consistent end to end. Discovery, invocation,
argument substitution, and path-scoped rule loading were observed live. The remaining
issues are minor and documented (§7). None blocks use.

## 2. Actual structure (inspected, not assumed)

```
CLAUDE.md                         shared project instructions; §6 indexes the system (tracked, modified)
AGENTS.md                         pointer for non-Claude agents; NOT read by Claude Code (untracked)
mobile/CLAUDE.md → @AGENTS.md     mobile instructions (tracked, unchanged)
.claude/
  settings.json                   registers the PreToolUse hook (matcher Bash|PowerShell|Read|Edit|Write|NotebookEdit|Grep)
  settings.local.json             personal, git-ignored, not part of the system
  rules/                          7 files, flat
    agent-safety.md               no frontmatter → always loaded
    server.md ai-prompts.md prisma.md client.md mobile.md testing.md   `paths:`-scoped
  skills/                         5 skills, one folder each, SKILL.md only
    analyze-change/ implement-change/ debug-issue/ review-change/ generate-tests/
  hooks/guard-high-impact.mjs (+ .test.mjs)
  scripts/validate-guidance.mjs
  worktrees/fix-api-base-suffix/  stale, excluded by .git/info/exclude; unrelated (not touched)
docs/ai-skills/                   design, usage guide, this review, audits, change register
~/.claude/skills/synced/…         user-level Anthropic skills; no name collisions
```

Requested names that **do not exist**: `code-review` (the review skill is `review-change`,
because `/code-review` is a built-in and is listed in this session), `backend-implementation`,
and `frontend-implementation` (deliberately omitted, §5). `.claude/work/` does not exist
yet. `/analyze-change` creates it, and it is git-ignored (`.gitignore:24`).

## 3. Comparison with the reference structure

| nmph hub convention | SarasTech | Decision |
| --- | --- | --- |
| `skills/<name>/SKILL.md`, one folder per skill | `.claude/skills/<name>/SKILL.md` | **Followed** (native Claude Code location) |
| Frontmatter `name` = folder, `description`, `disable-model-invocation` | Same, plus native `argument-hint` and `disallowed-tools` | **Followed and extended**. The validator enforces name = folder. |
| One-sentence "what it does" descriptions | "What it does. Use when …" | **Adapted**: trigger phrases help auto-invocation |
| H1, then numbered `## N.` steps, then fixed `###` output sections | Same in all five skills (`debug-issue` and `generate-tests` were aligned earlier the same day) | **Followed** |
| CONFIRMED / HYPOTHESIS / UNKNOWN | `analyze-change` §1, `debug-issue` §3 | **Followed** |
| Handoff `active-change.md`: UUID, branch, HEAD, `READY`/`BLOCKED` → `IN_PROGRESS` → `CONSUMED`, `HANDOFF=<id>` | Identical lifecycle in `.claude/work/` | **Followed**. Sections adapted: CodeBeamer and Architecture Context replaced by **Security surface**. |
| Common rules separate from skills (`rules/` vs `skills/`) | `.claude/rules/` vs `.claude/skills/` | **Followed** |
| Rules grouped in subfolders (`development/`, `automation/`, numeric prefixes) | Flat, 7 files | **Intentionally not followed yet.** Claude Code supports subfolders (recursive discovery). Revisit at about 12 rules. |
| `.mdc` rules with `description`/`globs`/`alwaysApply` | `.md` with `paths:` (the only field Claude Code reads) | **Adapted** to Claude Code. No `.mdc` files created. |
| Per-skill `reference.md`, `examples.md`, `scripts/`, templates | None. Shared tooling in `.claude/scripts/` and `.claude/hooks/` | **Not needed yet**: every SKILL.md is ≤100 lines. The nmph analyze/implement skills also keep the handoff template inline. The guide (§2.4) covers how to add them. |
| "Do not run tests" | Skills run the `CLAUDE.md` §1 gate | **Intentionally changed** (`CLAUDE.md` §2) |
| Medtronic headers, CodeBeamer, SonarQube, Figma, Jenkins, Android/Angular content, `.cursor/` hooks | Absent | **Omitted** (proprietary or not applicable) |
| Defects in the reference: blank line before `---` (`code-review`), `name` mismatch (`arxan-to-datatheorem-v2`) | Validator rejects both | **Guarded against** |

## 4. Skills inventory

| Skill | Purpose | Invoked | Inputs → outputs | Steps | Supporting files | Validation status |
| --- | --- | --- | --- | --- | --- | --- |
| `analyze-change` | Read-only analysis before a change, producing a bounded handoff | **Manual only** (`disable-model-invocation: true`) | Request, files, symbols → `.claude/work/active-change.md` (READY/BLOCKED) plus `/implement-change HANDOFF=<id>` when READY | 1 supplied context · 2 security surface · 3 tests · 4 recommendation · 5 write and read back the handoff | Inline handoff template | Static ✔. Contract check 19/19 ✔. Live run not done (it needs you to type it). |
| `implement-change` | Implement exactly a READY handoff, then run the gate | **Manual only** | `HANDOFF=<id>` → code changes, `CONSUMED` handoff, report, suggests `/review-change` | 1 validate · 2 claim IN_PROGRESS · 3 implement scope · 4 verify gate · 5 close | Reads the handoff | Static ✔. Contract ✔. Hidden from the model (live ✔). |
| `debug-issue` | Find the root cause before fixing | **Manual + automatic** | Symptom/test/CI ID → classification, root cause, fix or proposal, regression test | 1 classify · 2 reproduce · 3 cause · 4 fix (if asked) · Report | `server/test/helpers/geminiMock.js`, `gh run view` | Static ✔. Visible to the model (live ✔). |
| `review-change` | Read-only diff review against SarasTech invariants | **Manual only**, `disallowed-tools: Edit Write NotebookEdit` | Base ref (default `main`) → findings table, pre-existing items, human sign-off line | 1 scope · 2 checks · 3 optional gate · 4 report | None | Static ✔. Hidden from the model (live ✔). |
| `generate-tests` | Behavioural tests in each workspace's framework, including rejection paths | **Manual + automatic** | Target → behaviour model, scenarios, tests, run results (plan only when asked) | 1 model · 2 scenarios · 3 write · 4 run · Report | `server/test/helpers/*` | **Live ✔**: invoked with arguments, `$ARGUMENTS` substituted, stopped at plan |

## 5. Gap analysis: are more skills needed?

No genuine gap. `backend-`/`frontend-implementation` would duplicate `implement-change`
plus the path rules. `workflow-analysis` (OQ-4) can be added if the auth/session or
attendance-approval state machines need it. No skill was added to increase the count.

## 6. Validation: static versus live

| Check | Kind | Result |
| --- | --- | --- |
| Frontmatter, names, built-in collisions, rule keys, globs, cited paths, secrets | Static (`node .claude/scripts/validate-guidance.mjs`) | 0 errors, 0 warnings (after this review's edits) |
| Hook policy | Static (`node --test .claude/hooks/guard-high-impact.test.mjs`) | 9/9 pass |
| Handoff contract: the frontmatter and sections implement-change validates exist in analyze-change's template, statuses, exact next command, same path | Static (scratch script, not committed) | 19/19 OK |
| Model-visible skills | **Live** (session skill list) | Only `debug-issue` and `generate-tests` are listed. The three manual skills are hidden, as configured. |
| Invocation with arguments | **Live** (`generate-tests` via the Skill tool) | Loaded from `.claude/skills/generate-tests`. `Target:` showed the arguments. The plan-only branch was followed. |
| Always-on rule | **Live** | `agent-safety.md` was in the session's initial instructions |
| Path-scoped rule | **Live** | Reading `client/src/lib/format.ts` injected `client.md`. `server.md` was not shown on a Read of `server/src/lib/asyncHandler.js`, probably because an earlier single-file `head` in this session had already loaded it (unconfirmed). |
| Hook registration | **Live** | Bash and Grep probes denied in session |
| `/` menu and autocomplete hints; typing a manual skill | Not done | They need a person at the terminal (guide §5 step 3) |
| Automated orchestration between skills | n/a | **None exists.** Each step is started by a person. Documented as such. |

## 7. Changes made in this review, and remaining issues

**Changed:**
- **Removed Cursor-era wording from active guidance:** `CLAUDE.md` §6, `AGENTS.md` (now
  states Claude Code doesn't read it), and the validator's messages.
- **Clarified handoffs:** `implement-change` §5 reads back the status, keeps the handoff,
  and suggests `/review-change`. `debug-issue` now *suggests* `/analyze-change` rather than
  implying the model can start it.
- **Updated `SKILLS_RULES_ARCHITECTURE.md`** for the Claude-Code-only decision (OQ-2
  resolved): a Claude Code table and the flat-rules decision.
- **Added notes to `FINAL_VERIFICATION_REPORT.md` and `SECURITY_REVIEW.md`** recording that decision.
- **New docs:** `SKILLS_USAGE_GUIDE.md` and this review.

**Remaining (minor):**

| # | Issue | Recommendation |
| --- | --- | --- |
| S-1 | `review-change` read-only is partial: Bash remains available, and `disallowed-tools` clears at your next message | Accept. It is stated in the guide. |
| S-2 | One handoff slot, so only one analyzed change can be in flight | Accept (same as the reference). Documented. |
| S-3 | The validator doesn't check the handoff contract or `docs/ai-skills/` | Optional: fold the scratch check into `validate-guidance.mjs` if the template changes often |
| S-4 | Root `AGENTS.md` is unused by Claude Code | Keep as a harmless pointer, or delete. Your call. |
| S-5 | Rules are flat | Group into subfolders at about 12 rules |
| S-6 | No CI job runs the validator (RCC-010) | Unchanged. Tracked in the change register. |
| S-7 | The `/` menu and the three manual skills weren't exercised by a person | Run guide §5 steps 3–4 once |

No application source, test, dependency, or database file was changed. Nothing was staged
or committed.
