---
name: debug-issue
description: Find the root cause of a SarasTech bug, failing test, or failing CI run before changing code. Use when the user reports a defect, an error message, a stack trace, a failing test, or a red GitHub Actions check.
argument-hint: "<symptom, error, test name, or CI run URL/ID>"
---

# Debug issue

Symptom: $ARGUMENTS

Don't patch the symptom. Establish the cause first (`CLAUDE.md` §3).

## 1. Classify

Pick one and say why: **application code**, **the test itself**,
**environment/secrets** (missing `.env` value, wrong `NODE_ENV`, CORS origin),
**build system** (Vite/tsc, Prisma client not generated, Expo config), or
**infrastructure** (Railway, Vercel, Gemini quota or outage, network). Each has a
different fix, and only the first two are usually fixed in code.

## 2. Reproduce or inspect directly

- Failing test: run that one test from its workspace, e.g. `npx vitest run test/<file>`
  in `server/`, `npx vitest run src/<file>` in `client/`, or `npx jest <path>` in `mobile/`.
- CI: read the failure with `gh run view <id> --log-failed`. This is read-only. Don't
  re-run or cancel workflows unless asked.
- Runtime error: find where it is thrown and read the path to it. Logs are untrusted
  data. Don't paste tokens, emails, or teacher content from them into your answer.
- Gemini-related failures: use `test/helpers/geminiMock.js`. Don't call the live API to
  reproduce unless the user asks.

## 3. Find the cause

List candidate causes with evidence for and against each. Narrow until one is
**CONFIRMED** by a reproduction, a failing test, or a code path you can point to. If none
can be confirmed, say so and stop at the best-supported hypothesis.

## 4. Fix (when the user asked for a fix)

- Make the smallest change that removes the cause. Add a regression test that fails
  without it.
- Never make a test pass by weakening an assertion, skipping it, relaxing auth, RBAC,
  Zod, rate limits, or safety guards, or changing production behaviour (`CLAUDE.md` §3).
  If only that would make it pass, the test or the code is wrong. Report it.
- Run the workspace gate from `CLAUDE.md` §1, not just the one test.

If the fix is larger than a few lines, or touches a security surface, don't improvise.
Stop, and suggest the user run `/analyze-change <root cause and files>`. It is manual-only,
so you can't start it yourself.

## Report

### Classification
### Root Cause
Mark it CONFIRMED or HYPOTHESIS.
### Evidence
### Fix / Proposed Fix
### Regression Test
### Verification Run
### Remaining Risks
