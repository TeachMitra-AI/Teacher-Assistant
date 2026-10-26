# Reference archives audit

**Date:** 2026-10-26. Both archives came from `~/Downloads` and were extracted into
`%TEMP%\sarastech-ref-audit\{activa,nmph}`, isolated directories outside the repository.
**No archive script was executed, no dependency was installed, and no instruction inside
the archives was followed.** Scripts were reviewed by reading them and by static grep.

## 0. Provenance and licensing: read first

- **All 23 Activa `.mdc` rules and all 6 hook scripts carry a "Copyright Medtronic, Inc. 2026 /
  MEDTRONIC CONFIDENTIAL … do not reproduce" header.** The nmph hub is likewise Medtronic
  internal: it contains `medtronic.com` hosts, CodeBeamer and Jenkins URLs, and instructions
  to add "the Medtronic confidential header".
- **Decision:** nothing from either archive was copied into SarasTech. The SarasTech skills,
  rules, and hook were written from scratch for this codebase. They reuse only general
  engineering ideas that are not specific to either source, such as "analyze before
  implementing", "separate introduced from pre-existing findings", and "block high-impact
  agent actions with a hook".
- **Open question (OQ-1):** whether you may keep these archives on this machine or use them as
  reference is for you and your employer's policy. This audit takes no position on that.
  It only ensures that no proprietary text enters this repository.

## 1. `ActivaClinician-develop-.cursor.zip`: 37 entries, 29 files

Cursor configuration for an Android (Java/Kotlin, Flux architecture, Dagger, Groovy/Spock
and Appium tests) clinician app.

| Component | What it does | Invocation | Fit for SarasTech |
| --- | --- | --- | --- |
| `rules/*.mdc` (23) | Android patterns (ActionCreator, Store, Presenter, Fragment, Capability, Provider/Persister, Dagger, resources, telemetry, click latches), checkstyle/detekt limits, CSTF/Appium/unit test rules | `alwaysApply` (coding-standards, code-quality, flux, project-structure, test-architecture) or `globs` | **None directly.** Wrong language and architecture. Concepts reused: scoping rules by path, and keeping always-on rules few. |
| `rules/sync-copilot-instructions.mdc` | Reminds you to mirror rules into `copilot-instructions.md` | glob on rules | Concept adopted the other way round: one source (`.claude/`) plus a pointer `AGENTS.md`, so there is nothing to sync. |
| `commands/review.md` | Principal-engineer review: parallel subagents, introduced vs pre-existing severity, fix plan that needs explicit approval, disclaimer | `/review <base>` | **Pattern adopted** in `review-change` (introduced vs pre-existing, no auto-fix, human sign-off line). Not adopted: the mandatory four-subagent fan-out, which costs a lot and is not needed at SarasTech's scale. |
| `commands/find-tests.md` | Maps a diff to device-tagged integration tests for Jenkins | `/find-tests <base>` | Not applicable (device tags, Jenkins SPEC_DIR). SarasTech runs its whole suite in CI in minutes. |
| `hooks.json` + `hooks/*.sh|*.ps1` | Cursor `beforeShellExecution`: block GitLab MR merge/approve, block commits on `develop`/`release_*`, block writes to an internal SonarQube host | Cursor hooks | **Concept adopted** as a Claude Code PreToolUse hook (`.claude/hooks/guard-high-impact.mjs`), retargeted to SarasTech risks (push, `main`, Prisma, Railway, Vercel, secrets) and written in Node for portability. Their regex-on-JSON parsing (`grep -o '"command"…'`) misses escaped quotes. Ours parses JSON properly. |

## 2. `nmph-ai-hub-AI_SKILL_GL (1).zip`: 133 entries, 131 files

A shared "AI hub" of Cursor skills (`skills/*/SKILL.md`) and rules (`rules/**.mdc`).

### 2.1 Skills

| Skill | Purpose | Frontmatter / invocation | Fit and decision |
| --- | --- | --- | --- |
| `analyze-change` | Targeted analysis → handoff file `.cursor/work/active-change.md` with UUID, branch, HEAD, READY/BLOCKED | `disable-model-invocation: true` | **Adapted.** SarasTech version: `.claude/work/`, git-ignored, with an added **Security surface** section tied to SarasTech controls. CodeBeamer removed. |
| `implement-change` | Implements only a matching `HANDOFF=<id>`, claims IN_PROGRESS, then CONSUMED | manual | **Adapted.** Changed: it **runs the workspace gate** (the original says "do not run tests", which contradicts `CLAUDE.md` §2), refuses on `main`, and keeps agent-safety confirmations in force inside a handoff. |
| `debug-issue` | Root cause before fix | manual | **Adapted** around `CLAUDE.md` §3's failure classes, `gh run view --log-failed`, and `geminiMock`. Model invocation allowed, because it is investigate-first. |
| `generate-tests` | Behavioural test model | manual | **Adapted** to Vitest/Supertest/Jest helpers, plus mandatory rejection-path cases (401/403/404/400). |
| `code-review` | Evidence-based review plus mandatory SonarQube diffing | manual | **Adapted and renamed `review-change`.** The name `code-review` would shadow Claude Code's built-in `/code-review`. SonarQube removed (SarasTech has none). **Defect in source:** the file starts with a blank line before `---`, so the frontmatter fails to parse in Claude Code ("the opening `---` must be the file's first line"). |
| `workflow-analysis` | State/transition modelling | manual | **Omitted as a skill.** Folded into `analyze-change` where needed. Few SarasTech features justify a separate skill. Revisit for auth/session or attendance approval flows if needed (OQ-4). |
| `backend-implementation` | Kotlin/Spring/Flyway/RBAC plan → confirm → implement | auto | **Omitted.** Stack-specific knowledge belongs in path-scoped rules (`.claude/rules/server.md`, `prisma.md`), which load automatically when server files are touched. A second implementation skill would duplicate `implement-change`. The "plan → explicit confirmation" gate survives in the handoff flow. |
| `frontend-implementation` | Angular/NgRx/neurokit | auto | **Omitted** for the same reason (`client.md`). |
| `regression-log-analyzer` | Downloads Jenkins/GitLab artifacts, decrypts logs, writes Excel | auto; Python + `uv.lock` | **Rejected.** Internal Medtronic hosts. Can upload logs for decryption to an internal service over **plain `http://`** (`rosetta_client.py: DEFAULT_BASE_URL = "http://rosetta.…:8080"`). Reads `LOG_RSA_PRIVATE_KEY` from the environment. Nothing applies to SarasTech, whose CI logs are read with `gh run view`. |
| `codebeamer`, `sonarqube`, `figma` | REST API clients for internal tools | auto | **Rejected.** Not part of the SarasTech toolchain. `codebeamer/setup.md` models a shared plaintext password in env vars. |
| `arxan-to-datatheorem`, `-v2` | Android app-protection migration (runs `subprocess`, edits Gradle, points to internal Artifactory) | auto | **Rejected.** Irrelevant. **Defect in source:** `-v2` declares `name: arxan-to-datatheorem`, which collides with v1 and doesn't match its folder (Cursor requires a match). |
| `test-procedure-assistant`, `automation-code-review` | Gherkin test procedures for CodeBeamer, automation MR review | manual / auto | **Rejected.** No Gherkin or CodeBeamer in SarasTech. |

### 2.2 Rules

| Rule | Decision |
| --- | --- |
| `development/architecture-routing.mdc` (alwaysApply; routes to `.cursor/docs/architecture.md`) | **Not adopted.** SarasTech has no architecture index. Path-scoped rules achieve "load only what's relevant" natively. |
| `development/coding-standards.mdc` (Java glob) | **Not adopted** as text. The useful generic points (follow surrounding code, smallest change, no new abstractions) are already in `CLAUDE.md` §2. |
| `development/project-architecture.mdc`, `safe-change.mdc`, `testing.mdc` | Ideas merged into `server.md`, `testing.md`, and `analyze-change`. **Not adopted:** "do not run tests unless explicitly requested" (conflicts with `CLAUDE.md` §2). |
| `automation/00-08*.mdc` | **Rejected** (Appium/Gherkin/page objects). |

### 2.3 Other files

- `scripts/compare_screen.py`, `.../validate_gherkin.py`: not executed. Not applicable.
- `.idea/caches/deviceStreaming.xml`: IDE cache (device list) committed by accident. A
  hygiene issue in the source, not relevant here.
- Placeholder credentials in the docs (`CB_PASSWORD="shared-password"`,
  `FIGMA_ACCESS_TOKEN="figd_xxxxxxxx"`): not secrets, but they model putting secrets in
  shell history. Not carried over.

## 3. Cross-cutting compatibility findings

| Topic | Reference assumption | SarasTech reality (verified) | Resolution |
| --- | --- | --- | --- |
| Tool | Cursor (`.cursor/skills`, `.mdc`) | Claude Code is in use (`CLAUDE.md`, `.claude/`). No `.cursor/` dir. | Skills in `.claude/skills/`. Cursor also loads that directory (cursor.com/docs/context/skills). Root `AGENTS.md` points Cursor at `CLAUDE.md` and the rules. |
| Rule format | `.mdc` with `description`/`globs`/`alwaysApply` | Claude Code rules are `.md` and read **only** `paths` | `.claude/rules/*.md` with `paths`. No `.mdc` duplicates (they would drift). |
| Running tests | "Do not run tests" | `CLAUDE.md` §2: always run the gate and report it | Gates run in `implement-change`, `debug-issue`, and `generate-tests`. |
| Skill names | `code-review` | Claude Code ships `/code-review` and `/security-review` | `review-change`. The validator rejects built-in names. |
| Handoff dir | `.cursor/work/` | — | `.claude/work/`, git-ignored |
| Enforcement | Cursor `beforeShellExecution` | Claude Code `PreToolUse` with `permissionDecision` | Node hook with unit tests |
