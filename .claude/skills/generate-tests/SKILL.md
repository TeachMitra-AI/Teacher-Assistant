---
name: generate-tests
description: Design and write behavioural tests for existing or proposed SarasTech code using each workspace's own framework (Vitest+Supertest server, Vitest+jsdom client, Jest mobile), including security rejection paths. Use when asked to add, extend, or plan tests.
argument-hint: "<file, route, function, or behaviour to test>"
---

# Generate tests

Target: $ARGUMENTS

Understand the behaviour before writing any test. Follow `.claude/rules/testing.md`.

## 1. Model the behaviour

From the code, not the names, identify the starting state, trigger, expected result,
persisted effects, and cleanup. Find the existing test file for the module and the
helpers it uses.

| Workspace | Framework | Location / helpers |
| --- | --- | --- |
| server | Vitest + Supertest | `server/test/*.test.js`; `helpers/testApp.js`, `fixtures.js`, `auth.js`, `geminiMock.js`, `emailMock.js` |
| client | Vitest + jsdom | `*.test.ts(x)` next to the module; pure logic preferred |
| mobile | Jest (default `testMatch`) | mostly `mobile/src/**/__tests__/*.test.ts(x)`; some sit next to the module, as `mobile/src/lib/structuredQuestions.test.ts` does |

## 2. Choose scenarios

Pick the ones that matter for this change: happy path, alternate valid paths, invalid
input, boundaries (empty, max length, limits), repeated calls, ordering, and failure of a
dependency (Gemini error or timeout, Prisma error).

For an API route, also cover the applicable rejection paths:

- 401 with no token, and with an expired or suspended-account token
- 403 for a role that must not call it
- 404 for another user's or another school's record
- 400 for an invalid or over-size body, or unknown keys on `.strict()` schemas
- 429 when a limiter or daily budget applies (only if the existing tests already do this)

For prompt construction, assert what reached `systemInstruction` and what reached
`contents` (model: `server/test/ai-safety.test.js`).

## 3. Write

If the user asked only for a test plan, stop after step 2 and report it. Otherwise, reuse fixtures and mocks. Assert observable outcomes (status, body, DB state through the
API), not private internals. Fake data only. No live Gemini, email, or push calls.

## 4. Run

Run the new or changed test files, then the workspace test command from `CLAUDE.md` §1.
Report the real results. A new test that fails is a finding to report, not something to
weaken.

## Report

### Behaviour Model
### Scenarios
Covered, and deliberately skipped with the reason.
### Tests Added / Updated
### Run Results
### Remaining Gaps
