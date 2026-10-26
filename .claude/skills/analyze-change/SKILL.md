---
name: analyze-change
description: Analyze an existing SarasTech implementation before a code change and write a bounded, verifiable implementation handoff to .claude/work/active-change.md. Read-only for product code. Run before /implement-change.
argument-hint: "<feature or defect description, files, symbols>"
disable-model-invocation: true
---

# Analyze change

Request: $ARGUMENTS

Do not modify product, test, or config files. The only file you may create or replace is
`.claude/work/active-change.md` (git-ignored). It is the handoff for `/implement-change`.

## 1. Start from what was supplied

Read the files and symbols the user named, then only the callers and callees needed to
explain current behaviour. Follow the real path: route → middleware → lib/service →
Prisma, or page/component → `client/src/api.ts` → server route. Before opening another
file, name the question it answers. Stop once you can recommend the smallest safe change.

Classify each material finding:

- **CONFIRMED**: shown by code, tests, logs, or a reproduction you ran.
- **HYPOTHESIS**: plausible, not yet verified. Say what would verify it.
- **UNKNOWN**: not enough evidence.

## 2. Security surface

Mark each item touched or not touched, with the file that shows it:

- authentication / session / refresh-token handling
- role checks (`requireRole`) and school/district scope (`schoolScope`)
- owner scoping and the 404-for-not-yours rule
- request validation (Zod) and body-size or rate limits
- Gemini prompt construction (`systemInstruction` vs `contents`) or model-output handling
- HTML rendering (`formatResponse` / `dangerouslySetInnerHTML`)
- secrets, env vars, `VITE_*` / `EXPO_PUBLIC_*`
- Prisma schema or migrations, uploads, email or push sends

For each item touched, state the control that must be preserved and the rejection-path
test that proves it (see `.claude/rules/testing.md`).

## 3. Tests

Find the closest existing tests (`server/test/`, `client/src/**/*.test.ts(x)`,
`mobile/src/**/__tests__/`). List what must be added or updated. Don't run them here.

## 4. Recommendation

Propose the smallest change that fixes the cause, extending an existing mechanism before
adding a new one. Put adjacent problems under **Out of scope** rather than fixing them.
If the change would alter application behaviour that `docs/ai-skills/REQUIRED_CODE_CHANGES.md`
already tracks, cite that change ID.

## 5. Write the handoff

Get a fresh ID with `node -e "console.log(require('crypto').randomUUID())"`, the branch with
`git rev-parse --abbrev-ref HEAD`, and HEAD with `git rev-parse HEAD`. Use `unknown` if a
command fails. Never reuse an ID.

Set `status: READY` only when nothing in **Unresolved** blocks a safe implementation.
Otherwise set `status: BLOCKED`. Write exactly this structure, with conclusions only and no
raw search output or code dumps:

```md
---
handoff_version: 1
handoff_id: <uuid>
status: READY | BLOCKED
created_at: <ISO-8601>
repo_branch: <branch>
repo_head: <sha>
---
# Implementation handoff
## Requirement
## Root cause / evidence
- CONFIRMED: …
- HYPOTHESIS: … (verification gap: …)
## Approach
## Files / symbols
## Required changes
1. …
## Security surface
- <item>: <control to preserve> — test: <rejection-path test>
## Must preserve
## Tests / verification
- <workspace gate from CLAUDE.md §1 plus specific tests>
## Risks / assumptions
## Unresolved
- None | <blocker>
## Out of scope
```

Read the file back and confirm the ID and status. Report the ID. Only if the status is
`READY`, end with the exact line `/implement-change HANDOFF=<handoff_id>`. `READY` is not
approval. The user grants approval by running that command.
