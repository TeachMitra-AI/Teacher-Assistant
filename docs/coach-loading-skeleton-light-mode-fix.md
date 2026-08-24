# Chat Composer & Loading Fixes

**Status:** Loading animation and Enter-to-send are done. Stop button is
investigated but not built (2026-08-22 to 2026-08-23).

## The problem

When you send a message in the chat (Coach page), three shimmering gray bars
show up under your message while the AI is thinking (the "RunStatus"
loading animation). In dark mode you could see them fine. In light mode
they were almost invisible.

## Why it happened

Those bars were colored using a shade of gray that the app also reuses in
many other places (menus, hover backgrounds, etc.). In light mode, that
particular gray was almost the exact same color as the page background —
so the bars blended into the background and disappeared. In dark mode, that
same gray happened to look clearly different from the dark background, so
it worked there by coincidence, not by design.

## The fix

Gave the loading bars their own dedicated color, instead of sharing one
with a dozen unrelated things — so it could be tuned on its own without
touching (or accidentally breaking) anything else in the app.

- **Light mode:** now a visibly darker gray, clearly different from the
  white background.
- **Dark mode:** left exactly as it was — it already worked, so nothing
  needed to change there.

## What we tested

- Ran the full frontend test suite — all pass (this was a colors-only
  change, no logic touched).
- Switched the app to light mode, sent a real message, and watched the
  three bars clearly while waiting for the reply.
- Switched back to dark mode and confirmed it still looks the same as
  before.

---

# Enter Key Now Sends the Message

**Status:** Done (2026-08-23).

## The problem

Pressing Enter in the chat box just added a new blank line instead of
sending your message. You had to press Ctrl+Enter (or click the Send
button) to actually send — not what most people expect from a chat app.

## The fix

Changed it to match the normal chat-app convention (ChatGPT, Slack, etc.):

- **Enter** — sends the message.
- **Shift+Enter** — adds a new line, for when you want a multi-line message.
- Also added a small safety check: if you mash Enter while a reply is
  still loading, it won't fire off extra/duplicate messages.

## What we tested

- Ran the full frontend test suite — all pass.
- Typed a two-line message using Shift+Enter and confirmed both lines
  stayed in the box (didn't send early).
- Pressed plain Enter and confirmed it sent the message.

---

# Stop Button — Investigated, Not Built Yet

**Status:** Looked into it, decided to hold off (2026-08-23).

## What was asked

Add a "Stop" button so a teacher can cancel a prompt after sending it,
instead of being stuck waiting for the AI's reply with no way out.

## What we found

There are two different levels of "stop," and they're not equally easy:

1. **Stop waiting** — hide the loading animation immediately when you
   click Stop. Simple. But the server may keep working in the background
   even though you're not watching anymore.
2. **Stop the actual work** — also tell the server to abandon the AI call,
   so it doesn't keep running (and doesn't use up AI quota) after you've
   stopped it.

Digging into the server code for option 2 turned up a real complication:
the part of the app that calls the AI has an automatic retry system (if a
call times out, it tries again). It turns out a **user pressing Stop looks
identical, internally, to a timeout** — so wiring up cancellation the
straightforward way would make the server **retry the call instead of
abandoning it**, the opposite of what we want. Fixing that properly means
carefully editing that retry system itself, which is sensitive, carefully
tuned code with its own dedicated set of tests — real surgery, not a quick
addition.

## Decision

Held off on building this for now, so as not to risk that sensitive retry
code without a good reason to rush it. Can be picked up later as its own
careful, focused piece of work — either the simple "stop waiting" version,
or the fuller version with the retry-system fix included.
