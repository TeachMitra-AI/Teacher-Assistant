# Teacher Assistant — working instructions

## 1. Project map & commands

Three independent npm workspaces. **There is no root `package.json`** — never run `npm`
from the repo root. `cd` into the workspace first. (Root `src/` and `test/` are empty
leftovers; all real code is below.)

| Workspace | Stack | Verification gate (same as CI) |
| --- | --- | --- |
| `server/` | Node 18+ (CI: 20), Express 4, Prisma → SQLite | `npx prisma generate` → `npm run lint` → `npm test` |
| `client/` | React 18, TypeScript, Vite 5 | `npm run lint` → `npm test` → `npm run build` |
| `mobile/` | Expo 57, React Native 0.86 | `npm run lint` → `npm run typecheck` → `npm test` |

`npm run build` in `client/` is the typecheck (`tsc -b` + `vite build`) — there is no
separate `typecheck` script there. Server tests are Vitest + Supertest and point
`DATABASE_URL` at their own throwaway DB via `server/test/helpers/testEnv.js`; they never
touch a real database.

For architecture, env vars, API surface, and feature detail, read `README.md` and `docs/`
rather than restating them. When working anywhere under `mobile/`, read and follow
`mobile/AGENTS.md` before making changes. Its instructions take precedence over this file
where they differ.

## 2. Working principles

### Think before coding
Read the existing implementation before changing it. Follow the actual call path —
route → middleware → lib/service → Prisma — instead of inferring it. The repository can
answer most questions; don't guess when it can. State your assumptions explicitly, and
name ambiguities and tradeoffs **before** writing code, not after. If two readings of the
task lead to materially different work, ask.

### Simplicity first
Ship the smallest correct change. No new abstraction, helper, wrapper, or dependency
unless the task actually requires it. No speculative flexibility, no config knobs nobody
asked for, no error handling for impossible states. The test: would a senior engineer
call this overcomplicated for what was asked?

### Surgical changes
Every change should have a clear connection to the task or be necessary to safely
implement or verify it. Don't refactor working code, reformat untouched lines, rename
things in passing, or delete pre-existing dead code unless that is the task. Preserve
behavior outside the task's scope. Match the conventions already in the file you're
editing — this repo mixes CommonJS (`server/`) and ESM/TSX (`client/`, `mobile/`);
follow the local style rather than importing a new one.

### Goal-driven execution
Before implementing, restate the task as concrete success criteria — what must be true
when this is done. Afterwards, run the matching gate from §1 and report the real output.
Never call a task complete without verification when verification is possible; if it
isn't possible (needs a device, a live API key, a deployed environment), say so plainly
and state what remains unverified.

## 3. Debugging

- Reproduce or directly inspect the failure before proposing a fix. No speculative fixes.
- Find the root cause. Prefer fixing the cause over masking the symptom.
- Classify the failure first: application code, the test itself, environment/secrets,
  the build system, or infrastructure. They have different fixes.
- After the fix, run the most relevant validation from §1 — not just the one test.

**Never weaken authentication, RBAC, Zod validation, rate limiting, safety guards, or
production behavior to make a test pass.** If a test only passes with a security control
relaxed, the test or the code is wrong — fix that instead.

## 4. Security invariants

These are verified properties of the current codebase. Don't regress them.

- The Gemini API key is **server-side only** — used solely in `server/src/gemini.js`,
  loaded from git-ignored `server/.env`. It must never reach the client or mobile app.
- Trusted instructions go in Gemini's `systemInstruction`; teacher input and resource
  content are passed as **delimited untrusted user content**. Never concatenate user
  content into the system instruction.
- Admin routes stay behind `requireRole(...)`; analytics and user lists remain scoped by
  role (own school / district / all).
- Resources and history are owner-scoped: missing and not-yours both return **404**, so
  existence isn't leaked. Keep it that way.
- Request bodies are validated with Zod, mostly `.strict()`. New endpoints get a schema.
- Auth is bcrypt-hashed PINs + short-lived JWT access tokens + rotating, revocable
  refresh tokens, with lockout after repeated failures.
- Never commit secrets. gitleaks is a hard CI gate on new commits
  (`.github/workflows/ci.yml`), with an optional local hook via
  `git config core.hooksPath .githooks`.
- The database is **SQLite via Prisma**. A Postgres migration is planned
  (`docs/postgres-migration-plan.md`) but not sanctioned — don't start it unasked.

## 5. Git safety

- Do **not** commit, push, open a PR, or rewrite history unless explicitly asked.
- When asked to commit: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`),
  feature branch → PR into `main`. Don't commit directly to `main`.
- Leave unrelated working-tree changes alone — never stage or revert what you didn't touch.
- Before finishing, list the files you changed and summarize what changed and why.
