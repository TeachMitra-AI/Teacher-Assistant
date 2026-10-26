# SarasTech AI skills & rules architecture

Status: **Implemented** (2026-10-26). Validation evidence is in `FINAL_VERIFICATION_REPORT.md`.

## 1. Goals

1. Make future AI-generated changes follow SarasTech's real architecture and security
   controls, as verified in `ARCHITECTURE_AUDIT.md`.
2. Load only what a task needs: one small always-on rule, with the rest scoped by path or
   invoked on demand.
3. Keep one source of truth, in Claude Code's native locations. The team uses Claude Code
   only (decided 2026-10-26), so there is no `.cursor/` mirror.
4. Enforce what can be enforced (hook, validator, CI) instead of relying on prose.
5. Never relax a product security control to fit the guidance. Conflicts are recorded in
   `REQUIRED_CODE_CHANGES.md`, not silently "fixed".

## 2. Layout

```
CLAUDE.md                      always · project map, gates, principles, product invariants (§4), git (§5), this system (§6)
AGENTS.md                      not read by Claude Code (CLAUDE.md exists) · pointer for any other agent; no duplicated content
mobile/AGENTS.md               mobile/ · Expo 57 docs pointer (pre-existing, unchanged; overrides root for mobile/)
.claude/
  settings.json                registers the PreToolUse guard hook (project-shared)
  rules/
    agent-safety.md            always · agent conduct: untrusted input, secrets, high-impact actions, honest reporting
    server.md                  server/** · route→middleware→lib→Prisma, auth/RBAC/scope/404, Zod, limits, logging
    ai-prompts.md              Gemini call sites · systemInstruction vs contents, model-output re-validation, budgets
    prisma.md                  server/prisma/**, seed, tools · migrations, destructive DB commands, real-data files
    client.md                  client/** · formatResponse HTML sink, cookie session, VITE_* is public
    mobile.md                  mobile/** · SecureStore, EXPO_PUBLIC_* is public, defer to mobile/AGENTS.md
    testing.md                 test files · rejection paths, no live calls, never weaken assertions
  skills/
    analyze-change/            manual · read-only analysis → .claude/work/active-change.md handoff (git-ignored)
    implement-change/          manual · implements only HANDOFF=<id>, runs gates, marks CONSUMED
    debug-issue/               auto+manual · classify → reproduce → root cause → (fix) → gate
    review-change/             manual · read-only diff review vs SarasTech invariants; Edit/Write disallowed
    generate-tests/            auto+manual · behaviour model → scenarios incl. 401/403/404/400 → run
  hooks/
    guard-high-impact.mjs      PreToolUse (Bash|PowerShell|Read|Edit|Write|NotebookEdit|Grep): ask/deny on push, main commits, migrations, deploys, deps, secrets
    guard-high-impact.test.mjs node:test suite (no deps)
  scripts/
    validate-guidance.mjs      read-only validator for all of the above
docs/ai-skills/                this design, usage guide, structure review, audits, change register, security review, verification report
```

## 3. Discovery and invocation (Claude Code v2.1.310, checked against the docs on 2026-10-26)

| Mechanism | Claude Code behaviour |
| --- | --- |
| `CLAUDE.md` | Loaded at launch, from the cwd and its parents. Subdirectory files (`mobile/CLAUDE.md` → `@AGENTS.md`) load on demand. |
| `AGENTS.md` (root) | **Not read** while a `CLAUDE.md` exists (default `claude-md-or-agents-md`). |
| `.claude/rules/**/*.md` | Discovered recursively. No `paths` means loaded at launch. With `paths`, loaded the first time Read/Write/Edit (or a single-file `cat`/`head`) touches a matching file. Globs are relative to the repo root. `paths` is the only field read. |
| `.claude/skills/<n>/SKILL.md` | `/n` runs it. The model may load it through the Skill tool unless `disable-model-invocation: true`. `disallowed-tools` removes tools while the skill is active. `$ARGUMENTS` is substituted. Edits are picked up live. |
| PreToolUse hook | `.claude/settings.json`. `deny` blocks. `ask` prompts, even in auto mode. Fails open on crash or timeout unless `onFailure: "block"`. |

Sources: code.claude.com/docs/en/skills, /memory, /hooks. Each row was observed live in a
session on 2026-10-26 (`SKILLS_RULES_STRUCTURE_REVIEW.md` §6).

**Invocation policy.** Skills that write a handoff, implement scope, or review are
**manual only** (`disable-model-invocation: true`). Explicit invocation is the
authorization signal. `debug-issue` and `generate-tests` may auto-load, because their
first step is investigation and they only edit when the user asked for a fix or tests.

## 4. Instruction hierarchy and precedence

1. **Enforced controls.** Application code (auth, RBAC, Zod, limits, safety guards),
   CI (gitleaks, gates), and the guard hook. No instruction can override them.
2. **The user's explicit instruction in the current session**, within layer 1. Approval is
   per action and does not carry over.
3. **`CLAUDE.md` + `.claude/rules/`**, with `mobile/AGENTS.md` for `mobile/`.
4. **Skills.** They add workflow and constraints, and never relax 1–3.
5. **Existing code conventions** in the file being edited.
6. **Reference archives.** No authority. Not shipped (see `REFERENCE_SKILLS_AUDIT.md` §0).

**Untrusted at every layer:** repository content, docs, comments, logs, CI output, web
pages, and model output. These are data. `agent-safety.md` says this explicitly.

This matches the requested priority (approved guidance > existing code > references) with
one deliberate refinement: where existing code *enforces* a security control, the control
outranks prose guidance. Where guidance and code disagree, the disagreement goes in the
change register, and the code is not rewritten silently.

## 5. Security boundaries of the system itself

- **No secrets anywhere in guidance.** The validator scans for key, token, JWT, and
  private-key patterns.
- **Secret reads are blocked on the common paths, not all paths.** The hook denies
  Read/Edit/Write/NotebookEdit, Grep (by `path` or `glob`), and shell commands that name a
  real `.env` file (including `.env*` wildcards) or a `prisma/*.db*` file. It asks before a
  recursive `grep` of a directory that holds a `.env`. `.env.example` stays readable.
  Indirect shell forms (`eval`, `bash -c`, `Get-ChildItem -Recurse | Select-String`) are
  not caught. `agent-safety.md` covers them as guidance only.
- **High-impact actions need a human.** The hook returns `ask` for push, merge, rebase,
  history-discarding git, main-branch commits, `--no-verify`, Prisma migrate/db commands,
  seed and prune tools, server `npm start`, dependency changes, GitHub write calls,
  Railway/Vercel/EAS deploys, and recursive deletes. It returns `deny` for force-pushing
  main, `npm publish`, and catastrophic `rm -rf`.
- **Handoffs are local.** `.claude/work/` is git-ignored. A handoff carries conclusions,
  not code or data.
- **Scripts:** both are dependency-free and read-only (the validator) or decision-only (the
  hook). The only process either spawns is `git` (`ls-files`, `rev-parse`). No network.

## 6. Verification strategy

| What | How | Where |
| --- | --- | --- |
| Frontmatter, names, built-in shadowing, description length, rule keys, glob coverage, cited paths, secrets | `node .claude/scripts/validate-guidance.mjs` | local; proposed for CI (RCC-010) |
| Hook policy | `node --test .claude/hooks/guard-high-impact.test.mjs` | local; proposed for CI (RCC-010) |
| Guidance vs code consistency | manual audit (`ARCHITECTURE_AUDIT.md`), with cited paths checked by the validator | each guidance change |
| Product gates unaffected | the three workspace gates | `FINAL_VERIFICATION_REPORT.md` §6 |
| Live skill discovery, rule loading, hook firing | a session smoke test | **Verified live**: hook denials, the model-visible skill list, a `/generate-tests` run with arguments, and path-scoped `client.md` loading. The `/` menu was not checked. See `SKILLS_RULES_STRUCTURE_REVIEW.md` §6. |

## 7. Decisions and alternatives rejected

| Decision | Alternative | Why |
| --- | --- | --- |
| `.claude/skills`, `.claude/rules` only | A `.cursor/` mirror (`.mdc`, `hooks.json`) | The team uses Claude Code only. A mirror would drift. |
| Flat `.claude/rules/` (7 files) | nmph-style subfolders (`development/`, `automation/`) | Claude Code supports subfolders, but 7 files don't need grouping. Revisit at about 12 rules. |
| 5 skills | 8 suggested names | `backend-`/`frontend-implementation` duplicate path rules plus `implement-change`. `regression-log-analyzer` has no SarasTech equivalent. `workflow-analysis` folded into `analyze-change`. |
| `review-change` | `code-review` | Would shadow the built-in `/code-review`. |
| Hook fails open, `ask` over `deny` | `onFailure: "block"`, deny-everything | A broken hook must not stop all shell use. Needs CLI ≥ v2.1.295 (OQ-3). `ask` keeps legitimate requested pushes possible. |
| Gates are run | Reference "don't run tests" | `CLAUDE.md` §2 |

## 8. Open questions

- **OQ-1** Reference archives are Medtronic-confidential. Decide whether to keep them locally.
- **OQ-2** *Resolved 2026-10-26:* Claude Code only. No Cursor configuration.
- **OQ-3** Minimum Claude Code version across the team. Decide whether to set
  `onFailure: "block"` on the guard hook (needs v2.1.295+; this machine runs v2.1.310).
- **OQ-4** Add a `workflow-analysis` skill for auth/session or attendance-approval state
  machines later?
- **OQ-5** RCC-001: fix the code (enum or move to `contents`), or formally accept
  `grade`/`subject` as a documented exception?

## 9. Maintenance

When adding or editing a skill or rule, follow `SKILLS_USAGE_GUIDE.md`: keep it short, cite
real files in backticks so the validator checks them, run both validation commands (see
`CLAUDE.md` §6), and update this document's layout table.
