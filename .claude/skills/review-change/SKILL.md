---
name: review-change
description: Read-only, evidence-based review of the current SarasTech branch or diff against SarasTech's security invariants and conventions, separating introduced issues from pre-existing ones. Complements the built-in /code-review and /security-review.
argument-hint: "[base ref, default: main]"
disable-model-invocation: true
disallowed-tools: Edit Write NotebookEdit
---

# Review change

Base: `$ARGUMENTS` (use `main` if empty).

Read-only. Don't edit files, commit, or post comments. Run `git` and the read-only gates
only. This skill adds SarasTech-specific checks. Claude Code's built-in `/code-review`
(general bugs) and `/security-review` can be run alongside it.

## 1. Scope

```
git diff --stat <base>...HEAD
git diff <base>...HEAD
git log --oneline <base>...HEAD
git status --porcelain
```

Include uncommitted changes when the user is reviewing work in progress. Read each changed
file in full, not just the hunk, plus the callers it affects. Lines the diff didn't touch
are **pre-existing**. List them separately, and never as defects of this change.

## 2. SarasTech checks (apply those relevant to the diff)

- **Auth / RBAC / scope.** New routes use `authRequired`, and `requireRole` where needed.
  Admin data is scoped with `schoolScope`. `optionalAuth` isn't used.
- **Ownership.** Owner-scoped lookups. Missing and not-yours both return 404.
- **Validation.** A Zod schema per body, with only `parsed.data` reaching Prisma. Bounded
  string, array, and body sizes.
- **Abuse.** A rate limiter is mounted for new expensive paths, and AI routes keep the
  per-user budgets and call caps.
- **AI.** No untrusted free text added to `systemInstruction`. Model output re-validated
  server-side, and `sanitizeOutput` kept (`.claude/rules/ai-prompts.md`).
- **XSS.** No `dangerouslySetInnerHTML` without `formatResponse`. KaTeX `trust` stays off.
- **Secrets / privacy.** No keys or real data in code, tests, or `VITE_*`/`EXPO_PUBLIC_*`.
  No teacher content in logs.
- **Data.** Migrations are new files, not edits to committed ones. No raw SQL.
- **Tests.** Rejection paths covered (401/403/404/400). No weakened assertions or skipped
  tests.
- **Correctness.** Edge cases, async ordering, error paths, and changed callers.

A finding needs a triggering scenario and a consequence. Drop anything speculative that
has neither. Don't restate lint output.

## 3. Verify (optional, read-only)

If the user wants it, run the gate from `CLAUDE.md` §1 for the touched workspaces and
report the real result. Otherwise say the gates weren't run.

## 4. Report

```
## Review: <branch> vs <base>
Files: N · Findings: x must-fix, y should-fix, z nit · Pre-existing: p

| # | Severity | File:line | Finding | Scenario → impact | Suggested fix |
```

Severity: **Must fix** (security-control regression, data loss, crash, wrong result),
**Should fix** (material risk, missing rejection-path test), **Nit**. Pre-existing items
go last. Then list what was not checked, and end with: *AI-assisted review; a human
reviewer must still approve before merge.*

Don't apply fixes. If the user wants them, offer `/analyze-change` with the finding IDs.
