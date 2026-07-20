# Git history secret purge — manual runbook (NOT executed automatically)

**Status: for your review and execution only.** Nothing in this document has
been run. No history has been rewritten, no branch has been force-pushed. Do
not run these commands until you've read them and are ready to do this
yourself (or ask me to run a specific step after reviewing it).

## Why this is needed

Deleting `QUICK-FIX.md` and `archive/test-api.html` (done earlier in this
pass) removes the leaked keys from the current tip of `main`, but **every
commit from `beaf271` (the very first commit) onward still contains at least
one of the three keys** in its historical snapshot. Anyone who has ever
cloned this repo, or clones it in the future, can read those keys out of
history with a plain `git log -p`, even though the files are gone from
`HEAD`. Rewriting history is the only way to actually remove them from the
repository.

**This does not un-leak an already-scraped key.** If this repo has ever been
public, assume bots have already harvested these keys — that's why you're
rotating them in Google AI Studio independent of this cleanup. This runbook
is about hygiene going forward (a clean history, no lingering copies in any
future clone/fork), not incident containment — the containment is the key
rotation you're already doing.

## The three keys involved

This document deliberately does **not** contain the literal key values —
only you should have those, and only in your own local, untracked working
files, never in anything that gets committed. Referred to below by these
placeholder labels, identifiable by the last few characters of each real key
(which you can match against what's in your Google AI Studio console or
your own notes):

| Placeholder       | Real key ends in |
| ------------------ | ---------------- |
| `OLD_GEMINI_KEY_1`  | `...wv1cp8`       |
| `OLD_GEMINI_KEY_2`  | `...JKhSsqYe8`    |
| `OLD_GEMINI_KEY_3`  | `...GEnKsSb7UHI`  |

They appear across all 11 commits in the repo's history (`beaf271` through
`5686c76`), in `config.js`/`test-api.html` at the repo root (pre-`archive/`
rename), `archive/test-api.html`, and `QUICK-FIX.md`.

## Step 0 — Back up first

```bash
# From OUTSIDE the repo you normally work in — make a full mirror backup
# you can restore from if anything goes wrong.
git clone --mirror https://github.com/rajeevkumar-nita/Teacher-Assistant.git teacher-assistant-backup.git
```

Keep this backup until you're confident the rewritten history is correct and
pushed. If something goes wrong, you can push this mirror back over the
remote to fully restore the original history.

## Step 1 — Install git-filter-repo

`git filter-repo` (not the older, unmaintained BFG Repo-Cleaner) is the
currently-recommended tool for this:

```bash
# macOS
brew install git-filter-repo

# Windows / cross-platform (requires Python 3)
pip install git-filter-repo

# Verify
git filter-repo --version
```

## Step 2 — Work on a **fresh clone**, not your existing working copy

`git filter-repo` refuses to run on a repo that still has its original
`origin` remote configured, as a safety measure — you do the rewrite on a
disposable fresh clone, then push that clone's rewritten history back.

```bash
git clone https://github.com/rajeevkumar-nita/Teacher-Assistant.git teacher-assistant-purge
cd teacher-assistant-purge
```

## Step 3 — Create the replacement rules file

`git filter-repo --replace-text` needs the **literal** key strings to match
against — there's no way around that. Create this file yourself, locally,
inside `teacher-assistant-purge/` (the disposable clone from Step 2, which
is never committed to and never pushed as-is — only its *rewritten history*
gets pushed in Step 6). Fill in the three real values yourself using the
placeholder table above to know which is which; do not paste the real values
into this checked-in runbook or any other file that gets committed:

```bash
cat > replacements.txt <<'EOF'
<OLD_GEMINI_KEY_1-real-value>==>***REMOVED-GEMINI-KEY***
<OLD_GEMINI_KEY_2-real-value>==>***REMOVED-GEMINI-KEY***
<OLD_GEMINI_KEY_3-real-value>==>***REMOVED-GEMINI-KEY***
EOF
```

## Step 4 — Run the rewrite

```bash
git filter-repo --replace-text replacements.txt
```

This rewrites every commit's blob content, replacing any occurrence of the
three key strings with `***REMOVED-GEMINI-KEY***`, across the entire branch
and tag history. Commit SHAs downstream of the earliest affected commit will
all change (which, since the leak is in the very first commit, means **every
commit's SHA changes**).

## Step 5 — Verify the keys are actually gone

You don't need the literal values for this check — the general Gemini/Google
API key format is enough (this is the same pattern used in `.gitleaks.toml`
for ongoing secret scanning):

```bash
# Should print nothing.
git log --all -p | grep -E "AIza[0-9A-Za-z_-]{35}"
```

If you want to double-check the three *specific* old keys are gone (belt and
suspenders), run the same command with the real values substituted in
locally — but there's no need to write that command down anywhere, since the
generic pattern above already covers it.

If either command prints anything, stop — do not push. Something wasn't
caught by the replacement rules (e.g., a fourth key variant) and needs a new
rule added to `replacements.txt` before re-running Step 4 on a fresh clone.

## Step 6 — Push the rewritten history (destructive — I will not run this for you)

`git filter-repo` removes the `origin` remote as a safety measure — add it
back first, then force-push:

```bash
git remote add origin https://github.com/rajeevkumar-nita/Teacher-Assistant.git

# Force-push every branch and every tag.
git push origin --force --all
git push origin --force --tags
```

**This overwrites the remote's history.** Anyone with an existing clone
(including your own other local checkouts of this repo) will have diverged
history after this and must re-clone rather than pull.

## Step 7 — After pushing

1. **Re-clone** this repository fresh everywhere you use it (your other
   machines, CI runners' caches if any exist, etc.) — do not `git pull` an
   old clone against the rewritten history.
2. In GitHub's repo settings, check **Settings → Security → Secret scanning**
   — GitHub may have already flagged these keys itself; resolving those
   alerts after rotation is good hygiene.
3. If this repository was ever public, consider whether any **forks** exist
   (check the repo's Forks tab) — a fork retains the old history
   independently and this rewrite does not touch forks. You cannot force a
   fork owner to rewrite their copy; the key rotation is what protects you
   against that copy being useful to anyone.
4. Delete the local `teacher-assistant-purge` working clone and the
   `replacements.txt` file (it's harmless once the keys are rotated, but no
   reason to keep it lying around).
5. Keep the `teacher-assistant-backup.git` mirror from Step 0 for a while
   (a few weeks) in case you need to compare against the pre-rewrite state,
   then delete it too.

## What this does NOT require

- No changes to `.gitignore` (already correct — see the Phase 0 plan).
- No re-running of the Phase 0 code changes — this is purely a history
  operation, independent of everything else in this pass.
- No coordination needed with the pre-commit hook or CI secret scan (added
  earlier in this pass) — those prevent *future* leaks; this cleans up the
  *past* one. Both are needed; neither substitutes for the other.
