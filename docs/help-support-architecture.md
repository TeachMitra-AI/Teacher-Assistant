# Help & Support — Architecture

**Status:** Phase 1 implemented (bug reports + feedback, no attachment upload) · **Owner:** Teacher
Assistant engineering

## 1. What this is

Replaces the lone 👍/👎 after an AI response with a real way for a teacher to report a bug, reach
support, or send feedback without leaving the app — a "Need Help?" entry point in the profile menu,
the Settings page, and next to specific error states (see §5).

Three flows, one entry point:

- **Report a Bug** — category + description, auto-captured context, tracked to resolution (`status`).
- **Contact Support** — a WhatsApp deep link (mirrors `ResponseCard.tsx`'s existing `shareWhatsApp`)
  as the primary channel, with an in-app message as the fallback.
- **Send Feedback** — a lighter flow: a type (feature request / suggestion / praise) and an optional
  message. Not tracked to resolution.

Phase 1 deliberately excludes: attachment/screenshot upload, the AI-conversation opt-in, the admin
inbox, and deeper error-surface integration (upload-failure / AI-timeout). Those are Phase 2 — see §7.

## 2. Data model

One model with a `type` discriminator (`bug | feedback`), not a model per flow and not a fully generic
`Interaction` table — see the design discussion this shipped from for the full reasoning. The short
version: bug reports and feedback share every column and differ only in which ones are required
(a bug needs a category and a description; feedback needs neither strictly), which is a `type`-field
case, not a separate-model case. Contact Support's WhatsApp path creates no row at all; its in-app
fallback is stored as `type: 'feedback', category: 'other'` — there is no third ticket type for it.

```prisma
model SupportTicket {
  id          String   @id @default(cuid())
  type        String   // bug | feedback
  category    String?  // closed vocabulary, different per type — see routes/support.js
  description String   @default("")
  status      String   @default("open") // open | triaged | resolved | wont_fix
  user        User?    @relation(fields: [userId], references: [id])
  userId      String?
  school      School?  @relation(fields: [schoolId], references: [id])
  schoolId    String?
  context     String?  // JSON string — auto-captured, non-sensitive diagnostics
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

`context` is a loose JSON string, the same convention as `User.preferences` and `Query.context` — a
future field (a diagnostics export, Phase 3) never needs a migration to add. SQLite throughout, per
the project's existing constraint to stay on SQLite until Postgres is set up.

## 3. Server

`POST /api/support/tickets` (`server/src/routes/support.js`) is the one Phase 1 endpoint — a sibling
route, same shape as `routes/attachments.js`: its own feature-flag gate, its own rate limiter mounted
in `index.js`, no dependency on either feature's code. Unlike the assistant/attachment routes it makes
no LLM call, so it carries no per-user daily budget — the shared per-IP `SUPPORT_RATE_LIMIT_MAX_REQUESTS`
limiter is what bounds it, the same way `routes/queries.js`'s `POST /feedback` has none either.

```
CLIENT                                          SERVER
"Need Help?" (profile menu / Settings /
 error surfaces)
  │ pick a flow → fill category/description
  │ auto-context captured client-side
  ▼
POST /api/support/tickets ──────────────►   1. authRequired
                                              2. HELP_SUPPORT_ENABLED gate (+ school allow-list)
                                              3. zod validation (category valid for `type`,
                                                 description required for bug, optional for feedback)
                                              4. prisma.supportTicket.create(...)
                                              5. respond { success, id, status }
```

Feature flags (`server/src/lib/flags.js`'s `readHelpSupportFlags`), same shape and same
default-OFF discipline as `readAttachmentFlags`:

| Env var | Default | Meaning |
|---|---|---|
| `HELP_SUPPORT_ENABLED` | `false` | Master kill switch. `false` → 503 for everyone. |
| `HELP_SUPPORT_ALLOWED_SCHOOL_CODES` | empty (= all schools) | Staged rollout filter, not a gate. |
| `SUPPORT_RATE_LIMIT_MAX_REQUESTS` | 20 (prod) / 300 (dev) | Per-IP request cap. |

Client mirror: `VITE_HELP_SUPPORT_ENABLED` (default `false`) hides every entry point — same
"zero new UI, not a button that errors" default as `VITE_ATTACHMENTS_ENABLED`. **Not an incident
control** (PWA + service-worker caching) — the server flag is what takes effect immediately.

## 4. Client

`components/HelpSupport.tsx` is a single globally-mounted provider (`HelpSupportProvider`, mounted in
`App.tsx` next to `ToastProvider`), not a component instantiated at each entry point. TopBar's profile
menu and the Settings card both just call `useHelpSupport().openMenu()`; error surfaces call
`openBugReport({ category })` to jump straight to the bug form with a category pre-selected (not
locked — a teacher can still change it or go back to the menu).

The panel itself is a bottom-sheet-on-mobile / centered-card-on-desktop overlay (`.help-overlay` /
`.help-sheet` in `index.css`) — a new, always-overlay pair of classes rather than reusing
`Sidebar.tsx`'s backdrop classes directly, because the Sidebar is docked in-flow on desktop and only
becomes a fixed overlay under the mobile breakpoint. Same visual language (surface/border/shadow
tokens), same backdrop-dismiss interaction, just working from anywhere in the app on every screen
size. Category pickers reuse the existing `.style-grid` / `.style-option` classes from the Settings
page's response-style picker rather than inventing new ones.

`lib/support.ts` holds the typed API client (`createSupportTicket`) and `captureAutoContext`, which
builds the auto-captured context object described in §6.

## 5. Error integration (Phase 1 scope)

Only the network-error case is wired in Phase 1 — everything else (upload-failure, AI-timeout) is
Phase 2, once the category vocabulary and admin inbox exist to make "selective, not everywhere" a
real distinction rather than a promise.

`CoachPage.tsx`'s two turn-submission paths (`runTurn`, `runTurnWithAttachments`) tag a failed turn
with `errorIsNetwork: true` when the underlying `ApiError` has `status === 0` (see `api.ts`'s
`rawRequest` — a `fetch` throw, not a server response). `MessageBubble.tsx` shows a "Report" button
next to "Try again" only for that case, pre-filling category `connection_issue`.

## 6. Auto-captured context vs. opt-in (privacy)

**Always auto-attached** (`captureAutoContext` in `lib/support.ts`): current route, a client build id
(`VITE_BUILD_ID`), a truncated `navigator.userAgent`, viewport size, theme, and the teacher's default
response language if set. None of this is new exposure — the server already receives User-Agent on
every request, and none of it is free text a teacher wrote.

**Never included in Phase 1, full stop:** the AI prompt/answer, a screenshot, passwords or tokens,
other users'/schools' data, precise geolocation, session replay. The AI-conversation opt-in and
screenshot attachment are Phase 2 additions, and both are designed to require a visible, explicit
action — never folded into the auto-captured object above, even once they exist.

## 7. What's deliberately not in Phase 1

- **Attachment/screenshot upload** — needs its own storage decision (a bounded base64 blob in SQLite,
  downscaled client-side, re-validated server-side with the same magic-byte sniffing as
  `lib/fileValidation.js`) since — unlike a coach attachment — a bug-report screenshot needs to be
  *persisted*, not processed and discarded.
- **AI-conversation opt-in** — the last question + answer, shown in full before sending, never silent.
- **Admin inbox** (`/admin/support`) — `super_admin` only, deliberately *not* extended to
  `school_admin`/`resource_person`: a bug report is a product-team concern, not school-management data.
- **Upload-failure / AI-timeout "Report" actions** — selective, not on teacher-actionable validation
  errors (wrong file type, too large).
- **FAQ/Knowledge Base, ticket tracking, diagnostics export, status page** — Phase 3, additive to the
  schema in §2 without a redesign (a `SupportMessage` child table for threads, the existing `status`
  field surfaced to the teacher, the existing `context` blob extended for diagnostics).
