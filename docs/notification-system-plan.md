# Notification System — Implementation Plan

Branch: `feature/notifications` (cut from `main` at `11e9456`).

## 0. What already exists (architecture inventory)

Read before designing anything below — the notification system is built entirely
out of these existing pieces, not new infrastructure.

- **Auth**: `server/src/middleware/auth.js` — short-lived JWT access token
  (`authRequired`, `optionalAuth`, `requireRole(...roles)`), opaque rotating
  refresh token in the `Session` table. Client sends `Authorization: Bearer
  <token>`, no cookies anywhere.
- **Roles**: `teacher | school_admin | resource_person | super_admin`
  (`server/src/lib/roles.js` APP_ROLES, duplicated intentionally into
  `client/src/types.ts` `Role` and `client/src/config.ts` `ROLE_LABELS` /
  `ADMIN_ROLES` — this codebase's documented "CHANGE-11" convention).
  `ADMIN_ROLES = [school_admin, resource_person, super_admin]`.
- **Scoping**: `server/src/routes/admin.js`'s `schoolScope(user)` —
  `super_admin` → all schools (`null`), `resource_person` → every school in
  their own district, `school_admin` → their own school only. This is the
  exact scoping model the notification "who can send to whom" rules reuse.
- **DB**: Prisma + SQLite (`server/prisma/schema.prisma`). Convention:
  `cuid()` ids, `@default(now())`/`@updatedAt` timestamps, JSON-as-String
  columns for loosely-typed data (`Query.context`, `User.preferences`),
  soft (non-FK) references where cascading is undesired
  (`Resource.sourceQueryId`, `SystemSetting.updatedById`).
- **Routes**: one router file per feature, mounted in `server/src/index.js`,
  each route wrapped in `asyncHandler` (`lib/asyncHandler.js`), validated with
  `zod`, gated by `authRequired` + `requireRole(...)`. New feature modules are
  `require()`d unconditionally at the top of `index.js` (fail at boot, not at
  request time) and mounted after existing routers, never editing an existing
  router's file just to bolt on a sibling feature.
- **Feature flags**: `server/src/lib/flags.js` — one `read<Feature>Flags(env)`
  function per feature, every flag **defaults OFF**, invalid values fall back
  to the default with a `console.warn`, never crash. Mirrored client-side in
  `client/src/config.ts` as a `VITE_*` constant that is a **UI-only courtesy
  gate** — the server flag is always the real, immediately-effective kill
  switch, because the client is a PWA with `registerType: 'autoUpdate'` and a
  cached client can lag the server by hours.
- **Realtime**: **none exists today.** No Socket.IO, no SSE, no WebSocket
  anywhere in `server/` or `client/` (confirmed by search). This is new
  infrastructure, not a duplicate of anything — see §5.
- **Toasts**: `client/src/components/Toast.tsx` — a `ToastProvider` mounted
  once in `App.tsx`, exposing `useToast().show(message, type)`.
- **Panel precedent**: `client/src/components/HelpSupport.tsx` — a
  globally-mounted provider (`HelpSupportProvider`) owning its own overlay
  state, opened from `ProfileMenu`/`TopBar` via `useHelpSupport().openMenu()`.
  Its CSS (`.help-overlay` / `.help-sheet`, `index.css` ~L3306) is a
  bottom-sheet-on-mobile, centered-modal-on-desktop overlay. The notification
  panel is a **dropdown anchored to the bell** on desktop (like
  `.profile-dropdown`, `index.css` ~L261) and a **bottom sheet** on mobile —
  reusing both existing visual languages rather than inventing a third.
- **Header/nav**: `client/src/components/TopBar.tsx` renders on every
  authenticated page (desktop and mobile); `BottomNav.tsx` is an *additional*
  mobile-only primary-nav bar, not a replacement for TopBar. So the bell lives
  once, in `TopBar`, and needs no separate mobile placement.
- **Design tokens**: `client/src/index.css` `:root` — `--orange: #ff6b35`,
  `--orange-soft`, `--surface`, `--border`, `--radius`, `--shadow`, full
  `[data-theme='dark']` overrides. Icons are `lucide-react` throughout.
- **Tests**: server — Supertest integration tests per route file under
  `server/test/`, using `helpers/testApp` (built `app` + `prisma` against a
  throwaway SQLite DB), `helpers/fixtures` (`createFixtures` builds a
  two-school, four-role fixture set), `helpers/auth` (`loginAs`). Client —
  only `lib`/hook-level `*.test.ts` unit tests exist today (no component
  tests), so notification client tests follow that same scope (pure logic,
  not rendering).

## 1. Notification UI/UX

- **Bell icon**: `lucide-react` `Bell`, placed in `TopBar.tsx`'s
  `topbar-controls`, between the theme toggle and `extraControl`/`ProfileMenu`
  — visible on every authenticated page, desktop and mobile alike (TopBar is
  never hidden).
- **Unread badge**: a small orange dot (no count) while unread ≤ 0 is false
  and count is unknown-but-nonzero is never a state we have — we always know
  the count, so show a numeral badge, capped at "9+" past 9, using the
  existing `--orange` token. Pure CSS `::after`/absolutely-positioned `<span>`
  on the bell button, matching `.user-avatar`'s existing badge-adjacent
  sizing conventions.
- **Popover/dropdown**: click opens `NotificationPanel`.
  - **Desktop (≥640px)**: anchored dropdown below the bell, same shape as
    `.profile-dropdown` (surface/border/shadow/radius tokens, `role="menu"`-
    adjacent semantics but `role="dialog"` since it's richer than a menu).
  - **Mobile (<640px)**: bottom sheet, same shape as `.help-sheet`
    (`translateY(100%)` → `0` transition, safe-area padding).
  - Dismissed the same way every other panel in this app is:
    `useDismissable` (click-outside + Escape) — already used by
    `ProfileMenu`.
- **List**: newest-first, each row shows an icon (per `type`), title,
  message (truncated to ~2 lines), relative time (reuse
  `client/src/lib/historyTime.ts`'s relative-time formatting — same function
  the Sidebar's history list already uses), and an unread indicator (left
  accent bar / dot). Unread rows have a subtle `--orange-soft` background.
  Loading state reuses the existing shimmer skeleton classes (`.sk-line`).
  Empty state: a centered icon + "You're all caught up" message, matching
  other empty states in the app (e.g. Library's).
- **Read/unread**: clicking a notification row marks it read (optimistic UI,
  server call `PATCH /api/notifications/:id/read` in the background) and
  navigates to `notification.link` if present (see §8).
- **Mark all as read**: a small text button in the panel header, calls
  `PATCH /api/notifications/read-all`, optimistically clears every unread
  indicator and zeroes the badge.
- **Pagination**: first page (20) loads on open; a "Load more" button at the
  bottom fetches the next page. No infinite-scroll complexity for v1.
- **Mobile behavior**: identical data/actions; only the container chrome
  changes (bottom sheet vs. dropdown), exactly like Help & Support's existing
  responsive split.
- **Theme**: every new class gets both a `:root` (light) definition and a
  `[data-theme='dark']` override, following every existing component's
  pattern in `index.css` — no new tokens needed, reuses `--surface`,
  `--border`, `--text`, `--text-muted`, `--orange`, `--orange-soft`.
- **Accessibility**: bell button has `aria-haspopup="dialog"`
  `aria-expanded` and an `aria-label` that includes the unread count (e.g.
  "Notifications, 3 unread"); the panel has `role="dialog"` `aria-label`;
  the live region for a just-arrived realtime notification uses
  `aria-live="polite"` (a visually-hidden announcer, not the visible toast
  itself, to avoid double-announcing).

## 2. Who can send notifications

Reuses `admin.js`'s existing `schoolScope()` model rather than inventing a
second permission system:

| Role | Can send to | Notes |
|---|---|---|
| `super_admin` | Everyone (platform-wide), a specific school, a specific role, or a specific list of user ids | Only role that can target `scope: 'all'` |
| `school_admin` | Their own school only (any role within it, or specific users within it) | Enforced via `schoolScope()` — a `scope: 'all'` request is silently DOWNGRADED to their own school rather than rejected (see §7); another school's id reaches zero recipients |
| `resource_person` | Every school in their own district (mirrors their existing analytics/user-management scope) | Same `schoolScope()` call `admin.js` already uses |
| `teacher` | **Nobody.** No send endpoint is reachable by a teacher at all (403, not just a hidden button). | Classroom-specific notifications (e.g. "message my class") are an explicitly **future** capability — see §6/§11 — not built now, since there is no classroom/roster model in this schema to scope it against yet. |
| System/AI | Any single user (itself, not a broadcaster) | Server-internal calls only — never reachable via an HTTP route; see §6. |

The compose UI (§ "Super Admin notification sending UI" in §6/Step 6) is
shown to every `ADMIN_ROLES` member, but the *scope picker* it offers is
computed from the caller's own role: a `school_admin` never sees an "All
schools" option in the first place, and even if they forged the request body
the backend independently re-derives and clamps the scope — **the frontend
hiding options is a courtesy, not the boundary** (§7).

## 3. Notification database model

New Prisma model, migration `add_notifications`:

```prisma
// A single notification, one row PER RECIPIENT (fan-out on write, not a
// broadcast + read-receipt join table) — mirrors how Event already does one
// row per user per occurrence. Simpler to query ("my unread count" is one
// indexed WHERE), and pilot-scale (a school's teacher count) never makes the
// fan-out write expensive; createMany() is used for multi-recipient sends
// (see lib/notificationService.js) so a broadcast is one INSERT, not N.
model Notification {
  id          String    @id @default(cuid())
  recipient   User      @relation(fields: [recipientId], references: [id])
  recipientId String
  // Closed vocabulary — see lib/notificationTypes.js (server) /
  // config.ts NOTIFICATION_TYPES (client), same CHANGE-11 duplication
  // convention as every other closed vocabulary in this app.
  type        String
  title       String
  message     String
  // Relative path the client navigates to on click (e.g.
  // "/library/<id>", "/admin/support/<id>"), or null for a notification
  // with nothing to open (e.g. a plain announcement). Never an absolute
  // URL — built the same way every other in-app link already is.
  link        String?
  read        Boolean   @default(false)
  readAt      DateTime?
  createdAt   DateTime  @default(now())
  // Soft reference to the sending admin, or null for a system/AI-generated
  // notification. NOT a FK — mirrors SystemSetting.updatedById exactly: the
  // durable record is this row itself, an admin's account is never blocked
  // from deletion by rows they sent, and every reader that cares about "who
  // sent this" already has senderName/senderRole as plain columns below.
  senderId    String?
  senderName  String?
  senderRole  String?
  // Optional extra context as a JSON string, same convention as
  // Query.context / SupportTicket.context — e.g. { resourceId, resourceType,
  // ticketId } for a system-generated notification a future UI might want
  // to key off of beyond just `link`.
  metadata    String?

  @@index([recipientId, read])
  @@index([recipientId, createdAt])
  @@index([type])
}
```

`User` gains the inverse relation: `notifications Notification[]`.

Denormalizing `senderName`/`senderRole` (rather than a `sender User?`
relation) is deliberate: a broadcast to 300 teachers must not require 300
`include: { sender: true }` joins just to render "Sent by Priya (School
Admin)" in the list — the two strings are captured once, at send time.

## 4. API architecture

New router `server/src/routes/notifications.js`, mounted in `index.js` as
`app.use('/api', notificationsRouter)`, gated the same way `support.js` is
(a `requireNotificationsEnabled()` gate middleware reading
`readNotificationsFlags(process.env)`, defaulting every route to `503
{code: 'NOTIFICATIONS_DISABLED'}` when off).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/notifications` | `authRequired` | Paginated list for the caller (`?page=&limit=`, capped like every other list endpoint at `MAX_PAGE_SIZE=100`, default 20) |
| GET | `/api/notifications/unread-count` | `authRequired` | `{ count }` — cheap, indexed `count()`; polled as a realtime fallback (see §5) and called once on app load |
| PATCH | `/api/notifications/:id/read` | `authRequired` | Marks one of *the caller's own* notifications read (404 if it isn't theirs — never leak existence of another user's row) |
| PATCH | `/api/notifications/read-all` | `authRequired` | Marks every unread notification of the caller's read in one `updateMany` |
| POST | `/api/notifications` | `authRequired` + `requireRole('school_admin','resource_person','super_admin')` | Send/broadcast — body validated by zod (`title`, `message`, `type`, `link?`, `target: { scope: 'all'\|'school'\|'role'\|'users', schoolIds?, roles?, userIds? }`); backend re-derives the caller's allowed scope via `schoolScope()` and clamps/rejects rather than trusting the body (§7) |

All list/mutate routes only ever touch rows where `recipientId ===
req.user.id`; there is no "read someone else's notifications" endpoint at
any role, including `super_admin` — a notification is inbox-private the same
way `SupportNote` is submitter-private.

## 5. Real-time architecture

No Socket.IO (or any realtime layer) exists in this codebase today — see
§0 — so "prefer the existing infrastructure" has nothing to prefer over.
**This plan adds Socket.IO as the one new runtime dependency this feature
needs**, rather than avoiding it in favor of polling, because:

1. The verification bar explicitly asked for is *"appears instantly without
   refresh"* — short-interval polling cannot honestly claim that, and would
   also add sustained load to the API for every online user.
2. This codebase already accepts **in-memory, per-process, resets-on-restart**
   state for comparable concerns (`assistant/budget.js`'s daily counters,
   `assistant/breaker.js`, `learningRepresentation/rendering/cache.js`) — an
   in-memory `Map<userId, Set<socketId>>` of connected sockets is the same
   accepted tradeoff, not a new class of risk, and the app's current single
   Railway instance (see `index.js`'s `trust proxy` comment) means there is no
   multi-instance fan-out problem to solve with Redis pub/sub yet.
3. It is one dependency (`socket.io` + `socket.io-client`), added once, and
   reused by nothing else — it does not duplicate anything, it *is* the thing
   §0 found missing.

```
Backend (POST /api/notifications, or a system hook)
   ↓
notificationService.js — writes Notification row(s) via prisma
   ↓
socketServer.js — emitToUser(recipientId, 'notification:new', dto)
   ↓ (only if that user has a live socket — best-effort, never blocks the write)
Connected user's browser (client/src/lib/socket.ts)
   ↓
NotificationProvider — prepends to list, increments unread badge,
   fires a toast via the existing ToastProvider
```

**Server-side** (`server/src/lib/socketServer.js`):
- `require('http').createServer(app)` replaces the bare `app.listen(...)` in
  `index.js`; `io = new Server(httpServer, { cors: <same isOriginAllowed
  check already used by the cors() middleware> })`.
- `io.use((socket, next) => ...)` handshake middleware: reads
  `socket.handshake.auth.token`, verifies it with the **same** `decode()`
  helper `middleware/auth.js` already uses for HTTP (exported alongside the
  existing exports — no new JWT logic), rejects the connection on failure.
  No cookies, matching the rest of the app's Bearer-token-only model.
- On connect, the socket joins room `user:<userId>`; `emitToUser(userId,
  event, payload)` is just `io.to('user:' + userId).emit(event, payload)`.
- Gated by the same `NOTIFICATIONS_ENABLED` flag as the REST routes — off by
  default, `io` is still constructed (so a later flag flip needs no restart
  logic beyond what already exists) but the handshake middleware rejects
  every connection while disabled.

**Client-side** (`client/src/lib/socket.ts` + `NotificationProvider` in a new
`client/src/components/Notifications.tsx`, mounted in `App.tsx` next to
`ToastProvider`):
- Connects lazily once `useAuth().user` is set (never for signed-out
  visitors), passing the current access token as `auth.token`; disconnects on
  logout, exactly mirroring how `api.ts` already treats the access token as
  the single source of truth for "am I signed in."
- Listens for `notification:new` → prepend + increment badge + toast.
- **Reconnection/missed-events fallback**: on socket `connect` (including
  reconnects) the client always re-fetches `GET
  /api/notifications/unread-count`, so a notification created while the
  browser was offline/backgrounded is never silently lost — sockets are the
  fast path, the count endpoint is the correctness backstop. This is the
  full extent of "polling" in this design: one cheap call per (re)connect,
  not an interval timer.

## 6. Browser push — FUTURE PHASE

Not implemented now. The architecture stays extensible for it:

```
Backend
  ├── Socket.IO → online users (this phase)
  └── Web Push / FCM → background/closed browser (future phase)
```

`notificationService.js`'s `createNotification()` is already the single
choke point every send path (API, system hooks) goes through — a future
phase adds a Web Push dispatch call alongside the existing
`emitToUser()` call at that same choke point, with no change to the DB model,
the REST API, or any UI beyond a permission-request prompt and a stored
subscription table. Nothing in this phase needs to anticipate that further
than "don't scatter notification-creation logic across route handlers."

## 7. Permission/security model

- Every mutating and every list endpoint requires `authRequired`; the send
  endpoint additionally requires `requireRole('school_admin',
  'resource_person', 'super_admin')` — a `teacher` gets a 403 from Express
  middleware before any handler code runs, not a hidden button.
- **Scope is re-derived server-side, never trusted from the request body.**
  `POST /api/notifications` computes the caller's own `schoolScope()` (the
  exact function `admin.js` already exports the logic for — extracted to a
  shared helper, see §Step 3/reuse) and:
  - `scope: 'all'` in the body means "everyone I can reach," not literally
    everyone: for `super_admin` it IS platform-wide; for anyone else it is
    silently DOWNGRADED to their own `schoolScope()` result before recipients
    are resolved (never rejected — a school_admin's "send to all" naturally
    means "everyone I can see," and the compose UI never has to know its own
    school/district id list to ask for that). This is a deliberate, more
    ergonomic choice than an outright 403, made and reconciled with this plan
    during implementation.
  - `scope: 'school'` with `schoolIds` is intersected with the caller's own
    `schoolScope()` result; any id outside it is dropped (school_admin
    passing a foreign school id sends to *zero* recipients from that id, not
    an error that leaks whether the school exists — same "degrade gracefully
    on bad filter input" convention `adminSupport.js` already uses).
  - `scope: 'users'` with `userIds` is filtered to users whose `schoolId` is
    in the caller's scope, same reasoning.
- Read/mark-read endpoints only ever operate on
  `WHERE recipientId = req.user.id` — enforced in the Prisma query itself,
  not just checked after fetching, so there is no window where one user's
  notification is even loaded into a handler acting on another user's
  behalf.
- The Socket.IO handshake re-verifies the JWT independently (§5) — a socket
  is not trusted just because an HTTP request with the same token succeeded
  earlier; each connection authenticates itself.
- Every route lives behind `NOTIFICATIONS_ENABLED` (server-side, real kill
  switch) independent of the client's `VITE_NOTIFICATIONS_ENABLED` (UI-only
  courtesy gate) — identical two-layer contract to every existing feature
  flag in this app (§0).

## 8. Notification click/navigation behavior

`notification.link` is a relative in-app path, built by the *sender* of that
notification at creation time (never derived client-side from `type`, so a
future notification type never needs a client release to be clickable):

- Resource generated (system) → `/library/<resourceId>`
- Support ticket update (system, future) → n/a for a teacher today (no
  teacher-facing ticket page exists — sent with `link: null`, shown but not
  clickable)
- Announcement (admin-sent) → whatever the admin optionally set (e.g.
  `/admin` for their own dashboard link, or left blank for a pure
  announcement with no destination)

Clicking a row with a `link` navigates via `react-router`'s `useNavigate()`
(client-side, no full reload) and closes the panel; a row with no `link`
still marks itself read but does nothing else — no dead click, no error.

## 9. Testing strategy

**Server (Vitest + Supertest, mirroring `adminSupport.test.js`'s shape
exactly)** — new `server/test/notifications.test.js` and
`server/test/notifications.realtime.test.js`:
- Access control: unauthenticated → 401; `teacher` → 403 on `POST
  /api/notifications`; `school_admin`/`resource_person`/`super_admin` → 200.
- Scope enforcement: a `school_admin` sending with `scope: 'all'` is
  downgraded to their own school (never reaches another school's users);
  sending with a foreign `schoolId` reaches zero recipients; a `super_admin`
  sending `scope: 'all'` reaches every fixture user across every school.
- CRUD correctness: list is newest-first and paginated; `unread-count`
  matches actual unread rows; `PATCH :id/read` only affects the caller's own
  row (a second user's id → 404); `read-all` zeroes the count in one call.
- Feature flag off → every route 503s, no DB row is ever created.
- Realtime: a lightweight `socket.io-client` test harness connects with a
  valid/invalid token (handshake accept/reject), and asserts
  `notification:new` fires exactly once per created recipient with no
  duplicates on a re-send/retry path.
- System hook: generating a resource via the existing
  `POST /api/resources/generate` flow creates exactly one `lesson_generated`
  /`assessment_ready` notification for its owner, with a `link` that
  round-trips to the created resource's id.

**Client (Vitest, matching the existing `lib`/hook-only test scope — no
component-render tests exist in this codebase today, so none are added
here)**:
- `client/src/lib/notifications.ts` — the API-calling functions (list,
  unread-count, mark-read, mark-all, send) against a mocked `api()`, same
  shape as `lib/support.test.ts`.
- A pure reducer/state-transition test for however `NotificationProvider`'s
  list-merge-on-`notification:new` logic is factored out (prepend + dedupe by
  id + unread-count increment), since that's the one piece of real logic
  worth unit-testing in isolation from React.

**Manual/browser verification** (this plan's Step 7 — see the final report):
every item in the task's STEP 7 checklist, run against the local dev client
+ server with `NOTIFICATIONS_ENABLED=true` and
`VITE_NOTIFICATIONS_ENABLED=true`, in both two logged-in browser
sessions (to observe cross-session realtime delivery) and both themes.

---

## Plan review notes (Step 5 self-check)

- Reuses `schoolScope()`'s exact logic rather than a parallel permission
  system — no duplicated authorization model.
- Reuses `asyncHandler`, `zod`, the `read<Feature>Flags` pattern, the
  `ToastProvider`/`HelpSupportProvider` provider shape, `.profile-dropdown`
  and `.help-sheet` CSS, `historyTime.ts`, and the existing Supertest
  fixture/helper set — no parallel infrastructure for anything that already
  has an established pattern in this codebase.
- The **only** new dependency is `socket.io`/`socket.io-client`, and §5
  states explicitly why introducing it is in scope for this feature (it is
  the one piece of "realtime" infrastructure the task requires that
  genuinely does not exist yet) rather than something to avoid duplicating.
- Browser push is explicitly deferred per the task's own instruction.
- Teacher broadcast is explicitly excluded per the task's own instruction;
  classroom-scoped notifications are named as future work rather than
  half-built now, since there is no classroom/roster model in the current
  schema to scope them against.
