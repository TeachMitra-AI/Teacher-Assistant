# Remove Coach follow-up chips (keep "View as visual")

**Branch:** `fix/remove-coach-followup-chips`
**Date:** 2026-08-15
**Status:** Done — implemented and verified

## Problem

Every Coach answer on the homepage renders a row of four follow-up chips:

- ✨ Make it simpler
- 📄 Create a worksheet
- ⏱️ 5-minute activity
- 🌐 Translate to Hindi / Translate to English

They are shown unconditionally under every response. Three problems:

1. **Cost without payoff** — they occupy vertical space and add a step on every
   single answer, whether or not they make sense for the question asked.
2. **Frequently irrelevant** — "Create a worksheet" under an answer about
   handling a disruptive student is noise, not an action.
3. **Duplicated capability** — each of these already exists, better, elsewhere
   in the app (see the inventory below). Re-offering them after every response
   is a worse version of a feature the teacher already has a real home for.

The response area should show the answer, plus at most an action that the
specific question actually earns.

## Decision

Delete the four-chip row from the Coach homepage response. Keep the
✨ **View as visual** chip exactly as it is today, including its current
show/hide behaviour and feature-flag gating.

Explicitly **not** doing: building a model-signalled "should we offer a visual
here" system. `View as visual` keeps its existing behaviour untouched. That
was considered and dropped as over-engineering for this change.

## Scope guard — capabilities that must NOT be affected

The chips duplicate features that live elsewhere. Those other implementations
are the reason the chips are redundant, **not** targets for removal. Verified
by exhaustive grep across `client/src`, `server/src` and `docs`: none of them
import `FOLLOW_UP_ACTIONS`, `FollowUpChips`, or `lib/followUp.ts`.

| Capability | Real home | Backed by |
|---|---|---|
| Worksheet creation | `pages/GeneratorPage.tsx` — the Quiz & Worksheet Generator | `generateAssessment` in `lib/resources.ts` |
| Make it simpler | `pages/ResourceWorkspace.tsx` `AI_ACTIONS` | `runAiAction` / `AiActionId` in `lib/resources.ts` |
| Worksheet / activity generation | Classroom Mode — `components/ClassroomSet.tsx` | `lib/classroom.ts`, `CLASSROOM_MODE_ENABLED` |

`ResourceWorkspace`'s "Make it simpler" shares only the label string with the
chip — separate array, separate type, separate server action. Deleting the
chip path cannot reach it.

## Change inventory

Every reference in the repo. All are Coach-homepage-only.

| File | Change |
|---|---|
| `client/src/config.ts` | Remove `FollowUpAction` type + `FOLLOW_UP_ACTIONS` array (L129–145) |
| `client/src/components/FollowUpChips.tsx` | Delete file — only imported by `MessageBubble` |
| `client/src/lib/followUp.ts` | Delete file — `buildSuffixedQuery` had one caller |
| `client/src/components/MessageBubble.tsx` | Drop import, `FollowUpAction` type, `onFollowUp` prop, render at L124–126 |
| `client/src/components/MessageList.tsx` | Drop `FollowUpAction` type + `onFollowUp` prop passthrough |
| `client/src/pages/CoachPage.tsx` | Drop imports + `handleFollowUp` (L410–418) and its `<MessageList>` prop |
| `client/src/index.css` | Remove `.follow-up-chips` / `.follow-up-chip` rules (L1476–1487) |
| ~~`docs/AI_ACTION_ROUTER_README.md`, `docs/ai-action-router-phase1-spec.md`~~ | **Reversed during implementation — left unchanged.** Both mentions sit under an "explicitly untouched" heading recording what was out of scope for the AI Action Router at that time. They are a historical record of a past project's boundary, not a live file inventory; editing them would falsify the record. |

### Deliberately left alone

- **`setLanguage(...)` in `handleFollowUp`** — the translate chip called into
  the page's language state (the override from #40). The chip's call goes; the
  language state itself is used across the page and stays.
- **`assistant/intentGate.test.ts` L96 fixtures** — assert that chip phrasings
  ("Make it simpler", etc.) never become routable. That guard is still
  worthwhile with the chips gone, and is independent of them.
- **`LearningRepresentationPanel`** — renders next to the chips in
  `MessageBubble` but is entirely independent. Untouched.

### CSS note

`.lr-panel` (L1493) carries its own `margin-top`, `padding-top` and
`border-top`. Removing `.follow-up-chips` therefore leaves "View as visual"
with its own divider and correct spacing — no compensating CSS needed.

## Risk

Low. No server contract is involved — `FOLLOW_UP_ACTIONS` is a client-side
constant and the chips resubmitted an ordinary turn through the existing
`submitTurn` path. No test file exists for `followUp.ts` or `FollowUpChips`.
Any missed dependency is a compile error, not a silent runtime break, because
the removed symbols are all typed and imported explicitly.

## Test plan

1. `npm run build` in `client/` — `tsc -b` catches any missed reference.
2. `npm test` in `client/` — full vitest suite. Baseline before the change:
   **24 files, 421 tests passing.**
3. `npm run lint` in `client/` — catches unused imports left behind.

## Results

### Files changed

```
D  client/src/components/FollowUpChips.tsx
D  client/src/lib/followUp.ts
M  client/src/components/MessageBubble.tsx
M  client/src/components/MessageList.tsx
M  client/src/config.ts
M  client/src/index.css
M  client/src/pages/CoachPage.tsx
A  docs/remove-coach-followup-chips.md
```

`pages/GeneratorPage.tsx`, `pages/ResourceWorkspace.tsx`, `lib/resources.ts`,
`lib/classroom.ts` and `components/LearningRepresentationPanel.tsx` are absent
from this list — the scope guard held.

Two extra removals the plan did not anticipate, both forced by the deletion:

- `MessageBubble`'s `onFollowUp` prop and `MessageList`'s passthrough of it.
  `hasAttachments` was checked and is still used (the attachment tray at L35),
  so it stays.
- `CoachPage`'s `<MessageList onFollowUp={…}>` wiring at the render site.

### Verification

| Check | Result |
|---|---|
| `npm run build` (`tsc -b && vite build`) | **Pass** — no dangling references; built in 2.22s |
| `npm test` (vitest) | **Pass** — 24 files, 421 tests, identical to the pre-change baseline |
| `npm run lint` (eslint) | **0 errors.** 1 pre-existing warning in `hooks/useClassroomQueue.ts` L223 (`react-hooks/exhaustive-deps`) — an untouched file, unrelated to this change |
| Residual-reference grep | **Clean** — zero hits for `FollowUpChips`, `follow-up-chip`, `FOLLOW_UP_ACTIONS`, `FollowUpAction`, `buildSuffixedQuery`, `onFollowUp`, `lib/followUp` across `client/src` and `server/src` |

The build passing is the meaningful signal here: every removed symbol was
explicitly typed and imported, so a missed dependency anywhere in the client
would have been a compile error rather than a silent runtime break.

### Not verified

The visual result was not checked in a running browser. The CSS reasoning
(that `.lr-panel` supplies its own divider and spacing, so "View as visual"
renders correctly as the only element in that slot) is sound but unconfirmed
against a live render — worth an eyeball on first run.

