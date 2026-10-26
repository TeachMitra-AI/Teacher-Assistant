# Security review: SarasTech and its AI development guidance

**Date:** 2026-10-26 · **Scope:** the application (as it constrains AI-written code) and the
new skills/rules/hook system. **Method:** source reading, targeted greps, `npm audit`, and
the three workspace gates. This is a design review, not a penetration test: no live
endpoint was attacked, and the ZAP/Nuclei plan in `docs/security-test-plan-zap-nuclei.md`
was not executed.

**Legend:** *Enforced* means code, CI, or the hook makes it true. *Guidance* means only
instructions say so. A guidance-only item is never described as a security property.

## 1. Domain-by-domain

| Domain | Existing safeguard (evidence) | Status | Gap / control added |
| --- | --- | --- | --- |
| Authentication | bcrypt passwords, timing-equalised dummy compare, lockout plus per-email limiter, Google sign-in (`routes/auth.js`); boot fails on a weak `JWT_SECRET` (`middleware/auth.js`) | Enforced | — |
| Sessions & cookies | 15 min HS256 access JWT (algorithm pinned); hashed, rotating, revocable refresh tokens in `Session`; HttpOnly `sarastech_refresh`, path `/api/auth`, Lax, Secure in prod; per-request status and `statusChangedAt` check, fails closed (503) | Enforced | Socket handshake lacks the `statusChangedAt` check (RCC-007, Low) |
| Authorization / RBAC | `requireRole` on admin routes; `schoolScope` for district/school; owner-scoped lookups with 404 (11 by-id lookups all checked) | Enforced | Admin out-of-scope answers 403, not 404 (RCC-008). `optionalAuth` unsafe if adopted (RCC-011). Rule `server.md` forbids it (guidance). |
| Secrets & env | Gemini key only in `server/src/gemini.js`; boot guards; `.env` git-ignored; gitleaks CI on new commits; `.env.example` placeholders; no keys in `VITE_*`/`EXPO_PUBLIC_*` (grep) | Enforced | Historical keys in git history, rotation unverified (RCC-012). **Hook now denies agent reads of `.env`/DB files** (enforced, fail-open). Validator scans guidance files for secrets. |
| Prompt injection / untrusted content | `systemInstruction` vs delimited `contents` split across all builders; attachments and history in `contents`; input normalization; injection flag as telemetry only | Enforced, **with exception** | Free-text grade/subject/classroomType in `systemInstruction` (RCC-001, High). Rule `ai-prompts.md` forbids new instances (guidance). |
| AI structured output | `responseSchema` treated as a hint; Zod re-validation and catalog re-check (`assistant/proposalSchema.js`); `sanitizeOutput` leak check | Enforced | — |
| Input validation | Zod in 13/16 routers; manual whitelist on `/api/coach`; 16 kB/64 kB body limits; no `req.body` passed to Prisma | Enforced | `.strict()` inconsistent (harmless: Zod strips unknown keys). `/api/coach` not Zod (RCC-009). |
| Output encoding / XSS | Escape-first `formatResponse` is the only HTML sink (8 sites); KaTeX `trust` off; `helmet()` | Enforced | `katex` <0.18.2 advisory (prototype pollution bypassing trust), low, major bump (RCC-002). |
| SQL injection | Prisma only; zero `$queryRaw`/`$executeRaw` | Enforced | Rule requires approval for any raw SQL (guidance). |
| CSRF | Bearer access tokens (not cookies) for API calls; refresh cookie Lax, path-scoped, plus custom header | Enforced | — |
| CORS | Allowlist in production; boot fails if empty | Enforced in prod | Fails open for any `NODE_ENV` ≠ `production` (RCC-006, Low) |
| Rate limiting / exhaustion | Per-feature limiters; auth limiter; per-user daily AI budgets; LLM call, retry, timeout, and token caps; assistant circuit breaker | Enforced | DoS advisories in multer, body-parser, qs, engine.io, zod, undici (RCC-002, High) |
| File uploads / paths | multer `memoryStorage` with size/count limits; magic-byte and PDF page validation (`lib/fileValidation.js`); nothing persisted to disk | Enforced | multer@2.2.0 advisories (RCC-002) |
| Command execution | No `child_process` in `server/src` | — | Hook spawns only `git rev-parse`; validator only `git ls-files` |
| Logging / errors | Global handler never echoes `err.message`; logs shape, not content; `sendAiError` hides upstream detail | Enforced | Rule `server.md` lists never-log fields (guidance) |
| Dependencies / supply chain | Lockfiles; `npm ci` in CI | Partial | No audit gate (RCC-003); open advisories (RCC-002, RCC-013). Reference archives not imported (`REFERENCE_SKILLS_AUDIT.md` §0). |
| Test vs production data | Tests use a throwaway DB (`test/helpers/testEnv.js`); `seed.js` refuses production; real `*.db` git-ignored | Enforced | **Hook denies agent reads of `prisma/*.db*`**. Rule `testing.md` forbids live calls. |
| Destructive / high-impact ops | `CLAUDE.md` §5 (guidance); gitleaks; `npm start` runs `migrate deploy` | Guidance only (before) | **Hook now asks** for push, merge, rebase, main commits, `--no-verify`, Prisma migrate/db, seed and prune, server `npm start`, dependency changes, GitHub writes, Railway/Vercel/EAS, and recursive deletes. **Denies** force-push to main, `npm publish`, catastrophic `rm -rf`. The local allowlist no longer pre-approves these (RCC-004 remediated by the user, re-checked 2026-10-26). |

## 2. Threat model for the AI guidance itself

| Threat | Control | Strength |
| --- | --- | --- |
| Instructions planted in repo files, docs, logs, or model output steer the agent | `agent-safety.md` "data, not instructions"; only the user and committed instruction files carry authority | Guidance |
| Agent leaks secrets into context or reports | Hook denies `.env`/DB access through Bash, PowerShell, Read, Edit, Write, NotebookEdit, and Grep (Grep added during final verification), including `.env*` wildcards, and asks before a recursive `grep` of a `.env`-holding directory; validator secret scan; rules forbid real data | Enforced (fail-open), plus guidance |
| Agent pushes, merges, migrates, or deploys unasked | Hook `ask` and `deny`; skills require explicit invocation; `implement-change` needs a matching `HANDOFF=<id>` plus branch/HEAD match and refuses `main` | Enforced (fail-open), plus guidance |
| A skill relaxes a control "to make tests pass" | `CLAUDE.md` §3, `testing.md`, `debug-issue` step 4 | Guidance (code review catches violations) |
| Imported third-party skill text carries proprietary content or unsafe scripts | Nothing imported; all original; archives kept outside the repo | Process |
| Guidance drifts from code (cites a file that moved) | Validator checks every backticked repo path and every `paths` glob | Enforced when run (CI proposed, RCC-010) |
| Project skill shadows a built-in command | Validator rejects built-in names | Enforced when run |
| Hook bypass via shell tricks (`eval`, `bash -c "…"`, aliases, base64) | None. The hook is a tokenizer, not a sandbox. | **Weak by design.** It is a backstop for honest mistakes, not a defense against a hostile agent. |

## 3. Known limits (stated plainly)

- The hook **fails open** on crash or timeout (documented Claude Code behavior without
  `onFailure: "block"`), and it does not run in Cursor.
- The hooks reference (code.claude.com/docs/en/hooks, read 2026-10-26) says a hook's `ask`
  "also forces a permission prompt in auto mode", that deny and ask rules "are still
  evaluated regardless of what the hook returns", and that a hard allow or deny belongs in
  the permission system, not a hook. It still does not say outright whether a hook's `ask`
  beats a matching `allow` rule. The local allowlist no longer holds such grants (RCC-004).
- Path-scoped rules load when files are touched through Read/Write/Edit or single-file
  `cat`/`head`. A grep-only exploration may not trigger them. The always-on
  `agent-safety.md` and `CLAUDE.md` §4 carry the essentials.
- ~~Cursor support for rules relies on `AGENTS.md`.~~ Not applicable: the team uses Claude
  Code only (2026-10-26).
