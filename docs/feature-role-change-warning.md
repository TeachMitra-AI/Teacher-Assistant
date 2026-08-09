# Branch: `feature/role-change-warning`

**Status:** Implemented, not yet committed · **Owner:** Teacher Assistant engineering

Three things were built on this branch:

1. A confirmation step before any role change
2. Classroom Mode remembering what it already saved
3. A live waiting element on the Coach page

They are unrelated to each other. They just happened to be done together.

---

## 1. Role change now asks first

**The problem.** On the Manage page, picking a new role from the dropdown applied it straight away.
One wrong click could make someone a Super Admin. One wrong click could also take the role away.

**What we did.**

A confirmation box now appears before anything happens. It names the person and says what will
change. Nothing is sent to the server until Confirm is pressed. Cancel does nothing at all — the
dropdown snaps back to the real role.

Every role change is confirmed, not only Super Admin ones, because removing someone's access is just
as disruptive as giving it. Changes involving Super Admin get a red Confirm button; ordinary ones get
the normal orange.

We also fixed three things the box alone could not fix, because anyone can call the API directly and
skip the screen entirely:

- **You cannot change your own role.** Before, a Super Admin could demote themselves and instantly
  lose the ability to undo it.
- **The last Super Admin cannot be demoted.** Before, this left nobody able to hand the role back to
  anyone.
- **Every role change is now recorded**, with who did it, to whom, and from which role to which. This
  was already happening for approving and rejecting teachers, but not for role changes.

**Files:** `components/ConfirmDialog.tsx` (new, reusable), `lib/roleChange.ts` (new, the wording),
`pages/ManagePage.tsx`, `server/src/routes/admin.js`.

**No database change was needed.**

---

## 2. Classroom Mode remembers what was saved

**The problem.** Saving a quiz or homework from a Classroom Mode card showed "Saved" — but only until
the page was reloaded. Reopen the chat from history and the button said "Save" again. Pressing it
made a second copy in the Library, because nothing checked for duplicates.

**What we did.**

A saved card now stays "Saved" after a reload. The app asks the Library what this chat already saved,
once per set of cards, and marks them accordingly. Saving also records which chat it came from, which
is what makes the check possible.

If the teacher deletes the item from their Library, the button correctly goes back to "Save" instead
of claiming a copy exists.

**Worth knowing:** anything saved *before* this change has no link back to its chat, so those cards
will still show "Save". Only new saves are recognised.

**Files:** `components/ClassroomSet.tsx`, `components/ClassroomArtifactCard.tsx`, `lib/classroom.ts`,
`lib/resources.ts`, `server/src/routes/resources.js`.

---

## 3. Live waiting element on the Coach page

**The problem.** After sending a question, the teacher saw one line — "Preparing practical advice for
you…" — that never changed, no matter how long it took. Answers here can take a long time. A frozen
line looks like the app has hung, so teachers send the question again, which costs a second AI call
out of a limited quota.

**What we did.**

That line is replaced by three shimmering grey bars where the answer will appear, a counter showing
how long it has been waiting, and wording that changes as the wait grows:

- Under 10 seconds — "Preparing practical advice for you…" (the same as before, so quick answers look
  unchanged)
- After 10 seconds — "Still working — a good answer takes a moment."
- After 25 seconds — "This is taking longer than usual."

The old spinner was removed, because the shimmer already shows that something is happening.

**Two deliberate decisions:**

- **No progress bar or percentage.** The app genuinely cannot know how far along the answer is — it
  sends one request and waits for the whole reply. Any percentage would be made up. The grey bars only
  promise that something is coming, which is true.
- **No Cancel button.** It was considered and dropped. Cancelling would not have saved any AI quota
  anyway: the server finishes the call regardless of whether the teacher is still watching.

**Files:** `components/RunStatus.tsx` (new), `lib/runStatus.ts` (new), `components/MessageBubble.tsx`,
`pages/CoachPage.tsx`, `types.ts`, `index.css`.

---

## Testing

All automated tests pass: **1911 on the server, 421 on the client.** Type checking and linting are
clean.

The role change work was also checked in a real browser — 18 checks confirming, among other things,
that Cancel sends nothing to the server and that Confirm sends exactly one request.

The other two were left for manual testing, because generating classroom materials or a coach answer
calls the AI and uses quota.

### What to check by hand

- **Role change:** try granting and removing Super Admin; try cancelling; try changing your own role
  (should be refused with a message).
- **Classroom Mode:** save a card, reload the page, reopen the chat — it should still say "Saved".
- **Waiting element:** send a question and watch the shimmer; check it in dark mode too; check the
  chat does not jump when the answer appears.
