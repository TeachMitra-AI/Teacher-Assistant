---
name: implement-change
description: Implement exactly the scope of a READY handoff produced by /analyze-change, identified by HANDOFF=<id>, then run the workspace verification gate. Refuses without a matching handoff ID.
argument-hint: "HANDOFF=<handoff_id>"
disable-model-invocation: true
---

# Implement change

Arguments: $ARGUMENTS

## 1. Validate before touching anything

Stop without editing product files if any check fails, and say which one:

- The arguments contain `HANDOFF=<id>`. Never infer approval from conversation history or
  from the file's existence.
- `.claude/work/active-change.md` exists, `handoff_version` is `1`, and `handoff_id`
  equals `<id>`.
- `status` is exactly `READY`. Refuse `BLOCKED`, `IN_PROGRESS`, and `CONSUMED`.
- `Requirement`, `Approach`, and `Required changes` are non-empty, and `Unresolved` holds
  no blocker.
- The current branch equals `repo_branch` and `git rev-parse HEAD` equals `repo_head`.
  On a mismatch, stop. The user can confirm in a new message or rerun `/analyze-change`.
- The current branch is not `main` (`CLAUDE.md` §5).

## 2. Claim it

Set only the frontmatter `status` to `IN_PROGRESS`, then read it back to confirm. This
stops one handoff from being consumed twice.

## 3. Implement only the handoff

- Every behavioural edit must trace to a numbered item under `Required changes`.
  `Must preserve` and `Out of scope` are binding.
- Follow the conventions of the file you edit (`CLAUDE.md` §2) and the path-scoped rules
  in `.claude/rules/`.
- Keep or add the rejection-path tests listed under `Security surface`.
- If the code contradicts the handoff, or you hit a question it doesn't answer, stop.
  Leave the status `IN_PROGRESS` and report what new analysis is needed. Don't improvise.
- Dependency changes, migrations, and other actions in `.claude/rules/agent-safety.md` still
  need the user's confirmation, even inside an approved handoff.

## 4. Verify

Run the gate from `CLAUDE.md` §1 for each workspace you touched, plus any specific tests
the handoff names. Report the real result. If a gate fails, fix the cause within scope.
Never relax a test or a security control. Review `git diff` and remove incidental edits.

## 5. Close

If everything passed, set `status: CONSUMED` and add `consumed_at: <ISO-8601>`, then read
the frontmatter back to confirm. Leave it `IN_PROGRESS` if anything failed. Don't commit
unless the user asks. Don't delete the handoff. The next `/analyze-change` replaces it.

Only if the status is `CONSUMED`, end by suggesting the user run `/review-change` on the
diff. You can't run it yourself: it is manual-only.

Report:

- **Handoff**: the ID and the validation result
- **Files changed**: each file, with the `Required changes` item it maps to
- **Verification**: the commands run and their results
- **Deviations / not verified**: anything you couldn't check (a device run, live Gemini, deploy)
