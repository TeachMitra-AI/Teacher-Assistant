# SarasTech skills and rules: usage guide

For the SarasTech team, who use **Claude Code only** (v2.1.310 on the reference machine).
Every path and command below exists in this repository. The current inventory is in
`SKILLS_RULES_STRUCTURE_REVIEW.md` §4.

## 1. What goes where

| You want to… | Put it in | Loads |
| --- | --- | --- |
| State a fact or invariant every task needs | `CLAUDE.md` (keep it under 200 lines) | Every session |
| Govern agent conduct on every task | `.claude/rules/agent-safety.md` (no frontmatter) | Every session |
| Give guidance for one area of the code | `.claude/rules/<area>.md` with `paths:` | The first time Claude reads or edits a matching file |
| Define a multi-step task workflow with a fixed output | `.claude/skills/<name>/SKILL.md` | When invoked with `/<name>`, or by the model if allowed |
| Block or confirm a risky tool call | `.claude/hooks/guard-high-impact.mjs` plus a test | Before every matching tool call |

Rules say *what must be true*. Skills say *how to do a task*. Don't restate a rule inside a
skill: point to it (for example, "Follow `.claude/rules/testing.md`"). That keeps a single
source of truth, as the nmph hub does by separating `rules/` from `skills/`.

## 2. Adding a skill

### 2.1 Decide whether you need one

Add a skill only for a repeatable workflow with clear inputs, steps, and an output. Check the
inventory first. Before creating `backend-` or `frontend-implementation`, note that they
were deliberately left out: `implement-change` plus the path rules `server.md` and
`client.md` already cover them.

### 2.2 Create the folder and file

```
.claude/skills/<name>/SKILL.md          required
.claude/skills/<name>/reference.md      optional: detail loaded only when SKILL.md points to it
.claude/skills/<name>/scripts/<tool>    optional: executed, never loaded as text
```

- `<name>` is lowercase letters, digits, and hyphens, in verb-object form
  (`analyze-change`, `generate-tests`). It must equal the folder name.
- Never reuse a built-in name: `code-review`, `security-review`, `review`, `simplify`,
  `init`, and the others listed in `.claude/scripts/validate-guidance.mjs`. Doing so would
  shadow the built-in. That's why the review skill is `review-change`.
- Keep `SKILL.md` under 500 lines. Today's skills are 55–100 lines.

### 2.3 Format `SKILL.md` (house style, from the nmph reference)

The opening `---` must be on **line 1**. A blank line before it silently drops every field,
as happened to the reference's `code-review`.

```md
---
name: <name>
description: <What it does, in one sentence>. Use when <trigger phrases the model should match>.
argument-hint: "<what to type after /<name>>"
disable-model-invocation: true      # omit to let the model invoke it too (see §3)
---

# <Title in sentence case>

<Input line, for example> Target: $ARGUMENTS

<One or two lines of hard constraints, e.g. "Read-only. Don't edit files.">

## 1. <First step>

…

## 2. <Next step>

…

## Report

### <Fixed output section>
### <Fixed output section>
```

Conventions every SarasTech skill follows:

- **Numbered `## N.` steps**, in the order they run. Each step ends with a clear stop
  condition when one applies ("If any check fails, stop and say which one").
- **Evidence labels:** classify findings as `CONFIRMED` (shown by code, a test, a log, or a
  reproduction you ran), `HYPOTHESIS` (plausible; say what would verify it), or `UNKNOWN`.
- **Fixed report headings** under `## Report` (`### …`), so outputs are comparable.
- **Cite real repository paths in backticks.** The validator checks that each one exists.
- **Point to rules and `CLAUDE.md` sections** instead of copying them.
- **Run the workspace gate** from `CLAUDE.md` §1 when the skill changes code. This
  deliberately replaces the reference's "don't run tests".

Supported frontmatter keys are listed in `SKILL_KEYS` in
`.claude/scripts/validate-guidance.mjs`. Claude Code ignores unknown keys without warning;
the validator warns about them.

### 2.4 Supporting references and scripts

- Link a supporting file from `SKILL.md` with a relative link (`see [reference.md](reference.md)`)
  and say *when* to read it. Otherwise Claude never opens it.
- Reference a script with `${CLAUDE_SKILL_DIR}/scripts/<tool>`, so it resolves from any
  working directory.
- Scripts must be dependency-free or use a workspace's existing dependencies, make no
  network calls unless the skill is about that, and never read `.env` files. Add a
  `node:test` file next to them, as `.claude/hooks/guard-high-impact.test.mjs` does.
- Shared tooling that several skills use belongs in `.claude/scripts/`, not inside one skill.

## 3. Manual versus automatic invocation

| Setting | `/name` by a person | Model may load it | Use for |
| --- | --- | --- | --- |
| `disable-model-invocation: true` | yes | **no** | Anything that writes a handoff, implements scope, reviews, or acts on approval. Typing the command *is* the approval. |
| (omitted) | yes | yes, when the request matches `description` | Investigate-first workflows that edit only when the user asked for a change (`debug-issue`, `generate-tests`) |
| `user-invocable: false` | no | yes | Background knowledge only. Not used in SarasTech. |

`disallowed-tools: Edit Write NotebookEdit` (on `review-change`) removes those tools until
your next message. Bash stays available, so read-only shell use relies on the skill's
instructions.

## 4. Invoking a skill

```
/analyze-change Teacher attendance check-out shows the wrong time; server/src/routes/teacherAttendance.js
/implement-change HANDOFF=3f2c…            # exact ID printed by /analyze-change
/review-change main
/debug-issue test/auth.test.js "refresh rotates" fails
/generate-tests server/src/lib/asyncHandler.js
```

The text after the name becomes `$ARGUMENTS`. If a skill has no `$ARGUMENTS`, Claude Code
appends `ARGUMENTS: <text>` instead.

## 5. Checking that a skill is discoverable and working

1. `node .claude/scripts/validate-guidance.mjs` (from the repo root) must print
   `0 error(s)`. It checks frontmatter, names, built-in collisions, description length,
   cited paths, rule globs, hook script paths, and secret patterns.
2. If you touched the hook: `node --test .claude/hooks/guard-high-impact.test.mjs`.
3. In a Claude Code session, type `/` and check that the skill appears with its
   `argument-hint`. Edits to an existing skill are picked up live. A *new top-level*
   skills directory needs `/reload-skills`.
4. Run it once with a harmless argument (for example `/generate-tests <file>`, asking for a
   plan only) and check that `Target:` shows your text.
5. For an auto-invocable skill, ask a question that matches its description, without the
   slash, and check that it loads.
6. A rule not loading? Read one matching file with the Read tool, then run `/context`, which
   lists loaded memory and rule files. `claude --debug` shows frontmatter parse errors.
7. `/skill-doctor` lists skills that take up context but are never used.

## 6. How skills hand off work

Nothing chains automatically. One skill never runs another, and the three manual skills
can't be started by the model. The person runs each step. The only artifact passed between
skills is the handoff file.

```
            ┌──────────────── /debug-issue (or auto) ──── small fix + regression test + gate
            │                         │ larger or security-sensitive fix
            ▼                         ▼  ("suggest /analyze-change <cause>")
 /analyze-change <request> ──► .claude/work/active-change.md  status: READY | BLOCKED
            │  prints "/implement-change HANDOFF=<id>" only if READY
            ▼
 /implement-change HANDOFF=<id> ── validates ID, status, branch, HEAD, not main
            │  READY → IN_PROGRESS → (gate passes) → CONSUMED
            │  stays IN_PROGRESS if blocked or failed
            ▼
 /review-change [base] ── read-only report; fixes go back through /analyze-change
 /generate-tests <target> ── on its own, or after implement for broader coverage
```

| Question | Answer |
| --- | --- |
| Which skill first? | A change or feature: `/analyze-change`. A defect with unknown cause: `/debug-issue`. A finished diff: `/review-change`. |
| What passes to the next skill? | Only `.claude/work/active-change.md` (git-ignored): frontmatter `handoff_id`, `status`, `repo_branch`, `repo_head`, plus the sections Requirement … Out of scope. Conclusions only, no code or data. |
| How does a skill signal done? | `analyze-change` writes `READY` and prints the exact next command. `implement-change` writes `CONSUMED` plus `consumed_at` and suggests `/review-change`. The others end with their `## Report`. |
| How does the next skill know to stop? | `implement-change` refuses without `HANDOFF=<id>`, or on an ID mismatch, any status other than `READY`, a non-empty Unresolved section, a branch or HEAD that differs from the handoff, or `main`. |
| More than one change at once? | No. There is one handoff slot, and a new `/analyze-change` replaces it. Finish or abandon the current one first. |

## 7. Adding the skill to Git without unrelated files

The working tree usually holds unrelated changes (today: `README.md`,
`client/tsconfig.tsbuildinfo`, `README-RAJEEV.md`). Stage by explicit path, never with
`git add -A` or `git add .`.

```
git switch -c chore/skill-<name>                    # never commit on main (CLAUDE.md §5)
node .claude/scripts/validate-guidance.mjs
git add -- .claude/skills/<name>/                   # plus only the docs you changed for it
git diff --cached --name-only                       # must list only your skill files
git commit -m "chore: add <name> skill"
```

Commit only when you mean to. An agent must ask before committing or pushing (the guard
hook asks before every `git push`). The gitleaks pre-commit hook is optional
(`git config core.hooksPath .githooks`). CI runs gitleaks on every push.
