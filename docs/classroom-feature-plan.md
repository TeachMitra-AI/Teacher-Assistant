# Classroom Feature — Plan & Implementation Status

Status: Phases 1–4 implemented (backend foundation, Classes/Students UI,
Attendance UI, Fees UI). Phase 5 (Reports/Analytics UI) NOT yet
implemented — see "Implementation status" immediately below. Everything
after that section (§1 onward) is the original design document, kept as-is
for its architecture rationale; it describes what was *planned*, not always
what shipped — where the two differ, this status section is authoritative.

Branch: `feature/classroom-management` (cut from `main` @ `89856c9`, 2026-08-16).

## Implementation status (read this first)

Last updated: 2026-08-20, after Phase 4 (Fees).

### COMPLETED

**Phase 1 — Backend foundation**
- Prisma models: `SchoolClass`, `Student`, `AttendanceRecord`, `FeeRecord`
  (migration `20260816141736_add_classroom_management`).
- Router `server/src/routes/classroom.js`, mounted at `/api/classroom/*`
  behind its own rate-limit bucket.
- Class CRUD: list, create, get, rename, archive (soft-delete), restore.
- Student CRUD: list, add, edit, deactivate (soft-delete), restore.
- Ownership/tenant isolation: every route scoped to `teacherId: req.user.id`
  via `findOwnedClass`/`findOwnedStudent` helpers; cross-teacher access 404s,
  never 403s (no existence leak).
- Attendance backend: day roster GET, bulk-upsert POST, month summary GET,
  month day-by-day history GET, CSV export GET, plus (added in Phase 3)
  per-student date-level history GET.
- Fee backend foundation: status GET, per-student PATCH (Paid/Pending only),
  CSV export GET — see Phase 4 below for what's still missing (the UI).
- Analytics backend foundation: `GET /api/classroom/analytics/overview` and
  `/analytics/classes/:classId` (cross-class and per-class totals) —
  **backend only**, see Phase 5 below.
- Feature flags: `CLASSROOM_MANAGEMENT_ENABLED` (server kill switch) +
  `CLASSROOM_MANAGEMENT_ALLOWED_SCHOOL_CODES` (rollout filter) in
  `server/src/lib/flags.js`; `VITE_CLASSROOM_MANAGEMENT_ENABLED` client
  cosmetic gate.
- CSV/export foundation: `server/src/lib/csv.js` shared helper, used by both
  the attendance and fee export routes.
- Shared attendance-math helper: `server/src/lib/classroomAttendance.js`
  (`attendancePercentage`, `deriveUnmarked`, day/month aggregation) — the one
  implementation every route (day view, month summary, CSV export, student
  history) calls, so the number can never drift between views.

**Phase 2 — Classes & Students UI**
- `/classroom` route (`client/src/pages/ClassroomPage.tsx`).
- Desktop nav: "Classroom" link in `TopBar.tsx`.
- Mobile nav: "Classroom" entry in `BottomNav.tsx`.
- `ClassroomTabs` sub-navigation: My Classes / Students / Attendance / Fees /
  Reports (the shell for all five tabs exists; only the first three have
  real content — see below).
- My Classes: create, list, rename, archive, restore, "show archived" toggle
  (`components/classroom/ClassList.tsx`).
- Students: add, list, edit, deactivate, restore, "show deactivated" toggle
  (`components/classroom/StudentRoster.tsx`).
- Responsive mobile UI: single-panel-at-a-time layout below 640px (sidebar
  vs. tab content toggles instead of showing both).

**Phase 3 — Attendance**
- Daily attendance marking: pick a class + date, see the active roster, mark
  each student Present or Absent, or leave them Unmarked.
- Present / Absent / Unmarked three-state model — Unmarked is never a stored
  status, it's the absence of an `AttendanceRecord` row for that student/date.
- Date navigation: Previous/Next-day buttons plus a native date picker,
  capped at today (`max` attribute + disabled Next) — no future-dating.
- Attendance persistence: one bulk `POST` per class+date; the UI reloads
  from the server immediately after save (not just trusting local state) —
  confirmed by a full page reload in browser testing.
- Daily summary: live Present/Absent/Unmarked/% tiles that update instantly
  as the teacher taps, before Save is even pressed.
- Monthly summary: month navigation (Previous/Next, capped at the current
  month), Total Students / Days Marked / Present / Absent / Unmarked /
  Average Attendance tiles, plus a per-student breakdown row.
- Attendance percentage: `Present / (Present + Absent) × 100`, Unmarked
  excluded from both sides — computed by the one shared helper everywhere
  (day view, month summary, CSV export, student history); never
  reimplemented per view.
- Student attendance history: new endpoint
  `GET /api/classroom/students/:studentId/attendance/history?month=`, wired
  to an expandable row per student inside Monthly Summary showing a
  date-by-date list of Present/Absent chips.
- Teacher ownership/isolation: every attendance route, including the new
  student-history route, scoped to `teacherId`; 404s on cross-teacher access;
  covered by `classroom-tenant-isolation.test.js`.
- Bulk attendance: one `POST` per class+date carrying a `marks[]` array —
  never one request per student; the server rejects the *whole* batch if any
  student doesn't belong to the caller's class (no partial save).
- Responsive/mobile attendance UI: card-per-student rows (not a dense
  table), full-width stacked Present/Absent buttons and a 3-column summary
  grid under the existing 640px breakpoint. **Implemented and code-reviewed,
  but NOT interactively verified at a real 375px viewport this session** —
  the browser automation's window resize did not take effect in this
  environment, so this is a code-review-level check only, not a screenshot
  of an actual narrow rendering. Flagged here rather than claimed as done.
- CSV download for attendance is **not** wired into this tab's UI yet — the
  backend export route (`GET .../attendance/export?month=`) already exists
  and works (curl-verified), but no button calls it. Tracked under Phase 5
  below ("Downloadable reports"), since the original plan grouped export UI
  with Reports.
- New/changed files: `client/src/components/classroom/AttendancePanel.tsx`,
  `AttendanceDaily.tsx`, `AttendanceMonthly.tsx`; `client/src/lib/classroomApi.ts`
  (+4 endpoint wrappers), `client/src/lib/classroomDate.ts` (new date/month
  helpers); `server/src/routes/classroom.js` (+1 route), `server/src/lib/classroomAttendance.js`
  (+1 helper, `getStudentAttendanceDates`).
- Tests: `server/test/classroom.attendance.test.js` (new student-history
  endpoint coverage), `server/test/classroom-tenant-isolation.test.js` (+1
  isolation case), `client/src/lib/classroomDate.test.ts` (new).
- Test results: server 2118/2119 passing (`npm test`, vitest — the actual
  runner; 1 pre-existing, unrelated flaky failure in `resources.test.js`,
  reproduced on `main`-derived code untouched by this feature). Client
  482/482 passing. Lint, `tsc --noEmit`, and `vite build` all clean.
- Browser verification: real Chrome session, signed in as the seeded
  `teacher@example.com` account. Created a throwaway class + 3 students,
  marked and saved attendance across two dates, confirmed persistence via a
  full page reload, verified independent per-date state, verified monthly
  summary math (including the unmarked-exclusion formula) and the
  student-history drill-down, then deleted all test data via Prisma
  afterward. Along the way, found and fixed an unrelated environment issue —
  a stale `node` process was already squatting on port 3000 from a prior
  session, silently serving old code; killed it and restarted the dev server
  cleanly before verification.

**Phase 4 — Fees**
- Fee status board (`client/src/components/classroom/FeeStatusBoard.tsx`):
  pick a class + month, see every active student with a single Paid/Pending
  toggle. No backend changes were needed — Phase 1's `GET .../fees?period=`,
  `PATCH .../students/:studentId/fees/:period`, and `classroomFees.js` were
  already a complete, tested V1 API; this phase is frontend-only, same shape
  as Phase 3.
- API wrappers added: `getFeeStatus`, `setFeeStatus`
  (`client/src/lib/classroomApi.ts`); DTO types added: `FeeStatus`,
  `StudentFeeStatus`, `ClassFeeStatus`, `FeeRecordDto` (`client/src/types.ts`),
  mirroring `routes/classroom.js`'s fee responses exactly.
- V1 is deliberately Paid/Pending only, per the plan: no amount, due-date, or
  notes UI. `amount`/`paidAt`/`note` remain reserved-unused on `FeeRecord`;
  the PATCH schema's `.strict()` already rejects them if sent, and no client
  code sends them.
- Month navigation: Previous/Next month, reusing the existing
  `addMonths`/`currentMonthString`/`formatMonthLabel` helpers from
  `classroomDate.ts` (no new date helpers needed). Unlike Attendance's date
  nav, there is no "cap at current month" restriction — pre-marking a future
  month's fee status (e.g. marking September paid in August) is intentionally
  allowed.
- Status toggle persists via one `PATCH` per tap, applied optimistically
  (summary tiles and the row both flip instantly) and reverted on failure —
  there is no bulk fee-upsert endpoint (unlike Attendance's bulk day-save),
  so each tap is already exactly one intentional change, not a batchable
  series of taps against a save button.
- Ownership/tenant isolation: inherited unchanged from Phase 1 — every fee
  route already scoped to `teacherId`, 404s on cross-teacher access; no new
  isolation surface was introduced by this phase.
- Test coverage: `server/test/classroom.fees.test.js` gained a case
  verifying a deactivated student drops out of the fee status list while
  their `FeeRecord` history is preserved (soft-delete, not hard-delete) —
  consistent with how Students already handles deactivation elsewhere in
  this feature.
- Test results: server 2120/2121 passing (`npm test`, vitest — the actual
  runner; the same 1 pre-existing, unrelated failure in `resources.test.js`
  noted in Phase 3, still reproducing on code untouched by this feature).
  Client 482/482 passing. Lint (`client`: 0 errors, 1 pre-existing unrelated
  warning in `useClassroomQueue.ts`; `server`: 0 errors/warnings), `tsc
  --noEmit`, and `vite build` all clean.
- CSV download button for fees: still not wired into this tab's UI — the
  backend export route (`GET .../fees/export?period=`) already exists and
  works, but no button calls it. Tracked under Phase 5 below, same as
  Attendance's own CSV button.

### NOT YET IMPLEMENTED

**Phase 5 — Reports & Analytics**
- Backend foundation already exists (`analytics/overview`,
  `analytics/classes/:classId`) — but there is **no Reports tab UI**. The
  Reports tab still shows the Phase 2 "coming soon" placeholder.
- Teacher dashboard/classroom analytics UI: not built.
- Total-students / present-absent stat cards on a dedicated Reports view:
  not built (the data is available from the existing backend route, just not
  rendered anywhere outside the Attendance tab's own Monthly Summary).
- Attendance trends (e.g. week-over-week/month-over-month): not built.
- Monthly/class-wise analytics UI beyond the Attendance tab's own Monthly
  Summary: not built.
- Student-level reports UI: the only student-level view that exists today is
  the ad hoc history drill-down added inside Attendance → Monthly Summary
  (Phase 3) — there is no equivalent under a dedicated Reports tab.
- Downloadable attendance/fee reports: both backend CSV export routes exist
  and work (curl-verified against the running dev server), but **no UI
  download button exists yet** on the Attendance tab, the Fees tab, or a
  Reports tab.
- Any other reporting features from the original plan's Analytics section
  (§12) beyond what's listed above: not built.

### Current branch / development status

- Branch: `feature/classroom-management`.
- Phase 1 + Phase 2 committed (`a8af6a4`) and pushed to
  `origin/feature/classroom-management`.
- Phase 3 (Attendance) committed (`bdebc97`) and pushed.
- Phase 4 (Fees) implemented and tested this session — committed and pushed
  alongside this document update.
- `main` has **not** been modified directly; no PR has been opened.
- Next planned work: **Phase 5 — Reports & Analytics UI** (backend
  already exists; this is a frontend-only phase, same shape as Phases 3–4).

## Naming note (read first)

`origin/classroom-mode` already exists and ships an **unrelated** feature: an AI
chat mode toggle for Coach (`ClassroomModePill`, `ClassroomModeMenu`,
`classroomPlan`/`classroomArtifacts` columns on `Query`, `CLASSROOM_MODE_ENABLED`
flag — see `docs/classroom-mode.md`). It plans/generates lesson artifacts inside
a chat turn; it has no classes, students, attendance, or fees.

This document's "Classroom" is a **class-management workspace** (My Classes /
Students / Attendance / Fees / Reports). To avoid confusion with the existing
"Classroom Mode" naming throughout the codebase (Prisma columns, env flags,
React components, docs), this plan uses **"Classroom Management"** or just
**"Classroom" (workspace)** in prose, and proposes distinct identifiers below
(`ClassroomWorkspacePage`, `SchoolClass` as the model name instead of `Class` —
`class` is also a JS reserved word — `CLASSROOM_MANAGEMENT_ENABLED`, routes
under `/classroom/*` and `/api/classroom/*`). None of these collide with
anything `classroom-mode` already defined. If `classroom-mode` is ever merged
to `main`, only the flag/route naming needs to stay distinct — no functional
overlap exists.

---

## 1. Objective

Classroom is a **teacher-first workspace**: V1 gives each teacher a
self-contained set of tools to manage their own classes, students, day-to-day
attendance, and per-student fee/payment status — plus a summary analytics view
and CSV export of attendance/fee reports — as a new first-class section of the
product. Every one of these is isolated per teacher account exactly like every
other teacher-owned resource in this app (My Library, saved queries): teacher
A must never be able to see teacher B's classes, students, attendance, or fee
data. Cross-teacher visibility (e.g. a school_admin rollup dashboard) is
explicitly **out of scope for V1** — see §8 and §17.

## 2. Current architecture findings

**Stack.** React 19 + TypeScript + Vite (client), Express + Prisma/SQLite
(server), JWT access token + rotating opaque refresh token (server-tracked
`Session` table). SQLite is a deliberate pilot choice — the schema comment and
[[db-engine-constraint]] both say not to migrate to Postgres unasked; every
model below is written to work unmodified under either engine.

**Routing** (`client/src/App.tsx`). A flat `<Routes>` tree, gated post-auth by
`user` from `AuthProvider`. Admin-only routes wrap their `element` in an
inline `isAdmin ? <Page/> : <Navigate to="/" />` check — no nested layout
route, no route-level guard component. New routes follow this exact pattern.

**Roles & tenancy.** Four roles: `teacher | school_admin | resource_person |
super_admin` (`ADMIN_ROLES = [school_admin, resource_person, super_admin]`,
`client/src/config.ts:253`). `School` is the tenant boundary
(`server/prisma/schema.prisma`); every `User` belongs to exactly one school
(`schoolId`, composite-unique with `email`). The JWT carries `{ sub, role,
schoolId, name }` (`server/src/middleware/auth.js:23`) — `schoolId` is trusted
server-side straight off the token, never re-derived per request.

**Two isolation patterns already exist in this codebase, doing different jobs:**
- **Per-teacher ownership** — `Resource` (My Library): every row has a
  `userId`; every route derives ownership from `req.user.id`, never the
  request body; a lookup that doesn't match the caller's `userId` 404s instead
  of 403ing, so existence is never leaked (`findOwned()` in
  `server/src/routes/resources.js:742`). Nothing in this model is
  school-scoped for reads — a teacher only ever sees their own resources
  regardless of school.
- **Per-school scoping** — `admin.js`'s `schoolScope()`-style helpers, used by
  `school_admin`/`resource_person` to see aggregated data *across* their own
  school's teachers, never another school's (pinned by
  `server/test/tenant-isolation.test.js`).

Classroom's requirement ("each teacher only sees their own classes/students")
is the **first pattern** — same shape as `Resource`. The plan below does not
introduce any school_admin cross-teacher visibility in V1; §8 states this as
a hard non-goal and §19 lists it as a possible future extension for a
school-level Dashboard, not part of this feature.

**Data model conventions worth reusing (all present today):**
- `id String @id @default(cuid())` on every model.
- JSON-in-`String` columns for extensible/loosely-typed data (`User.preferences`,
  `Query.context`, `SupportTicket.context`) — avoids a migration for every new
  optional field.
- Soft references (a plain `String` id, no `@relation`/FK) for cross-feature
  links that must never cascade or block deletion — e.g.
  `Resource.sourceQueryId`, `Notification.senderId`,
  `SystemSetting.updatedById`.
- One row per occurrence rather than a summary row that's mutated in place
  (`Event`, `Notification` — fan-out on write). Attendance below follows this:
  one row per student per day, not a monthly aggregate that's updated 30 times.
- DTO-shaping functions (`toDto()`) in every route file — the Prisma row is
  never serialized directly, so an internal-only column can never leak by
  accident.
- Feature flags in `server/src/lib/flags.js`: one `read<Feature>Flags(env)`
  function per feature, always defaulting fully OFF, always with a matching
  `VITE_*` **cosmetic-only** client flag (`client/src/config.ts`) — the server
  flag is the actual, immediately-effective kill switch; the client flag only
  hides UI on an already-cached PWA build. Classroom follows this exactly
  (§14).
- Migrations are timestamp-prefixed, single-purpose
  (`20260816062640_add_notifications`); Classroom's tables ship as one
  migration, `<timestamp>_add_classroom_management`.
- Every route file has a co-located Zod schema (`z.object({...}).strict()`)
  and a matching `server/test/<feature>.test.js` + `server/test/rbac.test.js`/
  `tenant-isolation.test.js` addition.

**Navigation.**
- Mobile: `client/src/components/BottomNav.tsx` — a hardcoded `ITEMS: NavItem[]`
  array, currently `Coach | Library | Generator`, rendered unconditionally for
  every signed-in user (mounted once in `App.tsx:105`, outside the `<Routes>`
  switch, so it appears on every page). No per-role filtering exists here
  today — Classroom's mobile entry doesn't need any since every teacher can
  use it.
- Desktop: `client/src/components/TopBar.tsx` — a hardcoded `<nav
  className="topbar-nav">` with `Coach | Library | Generator`, plus a
  role-gated `Dashboard` (`/admin`) link shown only when `ADMIN_ROLES.includes(user.role)`.
  Active-state styling is a `nav-link active` class matched against
  `location.pathname`. TopBar is shared across every non-Coach page (Coach
  itself replaces the branding slot with its own Sidebar header — see
  `TopBar.tsx:50-60` — but the `topbar-nav` links render identically there
  too).
- The `origin/classroom-mode` branch does NOT touch either of these — its
  entry point is a composer "+" button (`ClassroomModePill`), not navigation.
  No conflict.

**No existing class/student/attendance/fee models.** Confirmed by reading the
full `schema.prisma` (9 models: `School, User, ProfilePicture,
PasswordResetToken, Session, Query, Feedback, Event, Resource, SupportTicket,
SystemSetting, Notification, SupportNote`). Nothing resembling a roster,
attendance register, or payment ledger exists anywhere in `main`.

**Notifications system exists and is reusable.** `lib/notificationService.js`
+ `Notification` model + Socket.IO realtime push
(`server/src/lib/socketServer.js`). A resource-saved notification is created
today from `routes/resources.js:840` as a "fire and forget, never blocks the
response" pattern. Classroom can reuse this untouched for e.g. "Fees pending
reminder" in a later phase — no new transport needed.

## 3. Proposed UX/navigation

**Mobile bottom nav** (`BottomNav.tsx`) gains one entry, inserted between
Library and Generator per the spec:

```
Coach | Library | Classroom | Generator
```

`ITEMS` becomes a 4-entry array; new item uses a `GraduationCap` (or
`Users`/`School`) lucide icon, `to: '/classroom'`,
`isActive: (p) => p.startsWith('/classroom')`. No other BottomNav logic
changes — same `bottom-nav-item`/`active` class contract, same unconditional
render for every signed-in user (a teacher-only concept, but every role in
this app can act as a teacher for their own account, so no role gate is
needed — `school_admin`/`resource_person`/`super_admin` get an empty
Classroom, not a hidden one, consistent with how Coach/Library/Generator
already behave for those roles).

Inside `/classroom`, everything lives under ONE page shell with in-page tabs
— no new bottom-nav items for My Classes/Students/Attendance/Fees/Reports,
per the explicit requirement.

**Desktop top nav** (`TopBar.tsx`) gains one `nav-link`, inserted between
Library and Generator (matching the mobile order) and before the
role-gated Dashboard link:

```
Coach | Library | Classroom | Generator | Dashboard (admin only)
```

Same `nav-link`/`active` class, same `aria-current` pattern as the three
existing links — a 6-line addition mirroring the Library link exactly.

## 4. Mobile UX

`/classroom` renders a single page with:
- A page header (title "Classroom", matches TopBar/other page header styling
  used on Library/Generator).
- A horizontally-scrollable segmented-tab bar (reuse the visual language of
  `AdminTabs.tsx`, which already solves "several sub-sections under one admin
  route" for the Dashboard) with 5 tabs: **My Classes · Students ·
  Attendance · Fees · Reports**.
- Selecting a class (from My Classes) sets a `classId` in the URL
  (`/classroom?class=<id>&tab=students`) so Students/Attendance/Fees are
  always scoped to one class at a time on small screens — avoids cramming a
  class picker + a data table into 375px width.
- Attendance marking uses a **three-state** control per student row (Present /
  Absent / Unmarked — not a binary toggle, since "not yet marked" is a real,
  visually distinct state per §10), with 44px+ tap targets matching existing
  mobile-first components like `Composer.tsx`'s controls. The day summary
  header always shows all three counts (Present, Absent, Unmarked) side by
  side, never collapsing Unmarked into either bucket.
- Attendance History and Fees tabs each expose a "Download CSV" action
  (class + month already selected via the same URL state), matching §13.

## 5. Desktop UX

Same page (`/classroom`), same tab bar, but with more horizontal room:
- A persistent left-hand class list (My Classes) alongside the active tab's
  content, rather than a full-page navigation per class — closer to
  `LibraryPage.tsx`'s list+detail split.
- Attendance and Fees render as data tables instead of stacked cards.
- Reports tab can show 2-3 stat cards + a simple chart area side by side
  (reuse `index.css`'s existing card/stat styling, e.g. whatever `AdminPage`
  dashboard cards already use — no new design system).

No new desktop navigation architecture, per the explicit instruction — the
change to `TopBar.tsx` is a single link.

## 6. Database/schema design

New models, additive-only (no changes to any existing model or column). All
follow the existing `cuid()` id / `createdAt` / soft-reference conventions.

```prisma
// A teacher's own class (e.g. "Class 5-A"). Owned by exactly one teacher —
// mirrors Resource's ownership model, not School's shared-tenant model:
// two teachers at the same school each create and see only their own
// SchoolClass rows, there is no shared "the school's 5-A" entity.
model SchoolClass {
  id         String   @id @default(cuid())
  teacher    User     @relation(fields: [teacherId], references: [id])
  teacherId  String
  // Denormalized alongside teacherId, same convention as Resource.schoolId —
  // never used for row-level access (ownership is always teacherId), only
  // for a possible later school-admin rollup (§17) without a join.
  school     School?  @relation(fields: [schoolId], references: [id])
  schoolId   String?
  name       String   // "Class 5-A"
  grade      String?  // reuses the GRADES vocabulary where useful, free text otherwise
  section    String?  // "A", "B" — split out since Attendance/Reports may filter by it later
  archived   Boolean  @default(false) // soft-delete: a class with attendance history is never hard-deleted
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  students   Student[]

  @@index([teacherId])
  @@index([teacherId, archived])
}

// A student belongs to exactly one class (and transitively one teacher).
// Deliberately minimal today (name only) per the spec, but shaped for
// growth: `details` is an open JSON string (same convention as
// User.preferences/Query.context) for roll number, parent contact, DOB, etc.
// WITHOUT a migration when that's needed — the same reasoning that already
// justifies Resource.structured.
model Student {
  id          String   @id @default(cuid())
  schoolClass SchoolClass @relation(fields: [classId], references: [id])
  classId     String
  // Denormalized for the same reason SchoolClass.teacherId is — every
  // ownership check filters on this directly rather than joining through
  // SchoolClass, exactly like Resource.userId does today.
  teacherId   String
  name        String
  rollNumber  String?  // optional now; first concrete field beyond `details`
  active      Boolean  @default(true) // soft-delete: preserves attendance/fee history
  details     String?  // JSON string — future fields (contact, DOB, guardian) land here first
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  attendance  AttendanceRecord[]
  feeRecords  FeeRecord[]

  @@index([classId])
  @@index([teacherId])
}

// One row per student per calendar day — mirrors Event/Notification's
// "fan-out on write, never mutate a summary" convention. Month-wise views
// and the percentage summary are computed by aggregation queries, not
// stored, so the source of truth never drifts from a stale rollup.
model AttendanceRecord {
  id         String   @id @default(cuid())
  student    Student  @relation(fields: [studentId], references: [id])
  studentId  String
  // Denormalized, same reasoning as Student.teacherId — every list/summary
  // query is teacher-scoped and this avoids a join through Student→SchoolClass.
  teacherId  String
  classId    String
  date       DateTime // stored at UTC midnight for the calendar date; see §10
  status     String   // "present" | "absent" — closed vocabulary, see routes file
  markedAt   DateTime @default(now())

  // One attendance mark per student per day — the DB enforces the invariant
  // the UI relies on ("today's attendance" is unambiguous), and a re-mark is
  // an update, not a duplicate insert.
  @@unique([studentId, date])
  @@index([classId, date])
  @@index([teacherId, date])
}

// One row per student per month — a payment STATUS, not a ledger (per the
// spec's "at minimum Paid/Pending"). Modeled as one-row-per-period (like
// AttendanceRecord) rather than a single mutable field on Student, so
// "review previous months" and future itemized fee tracking (§17) both
// fall out of the schema for free instead of needing a rewrite.
model FeeRecord {
  id         String   @id @default(cuid())
  student    Student  @relation(fields: [studentId], references: [id])
  studentId  String
  teacherId  String
  classId    String
  // "2026-08" — a plain string, not a DateTime, since a fee period is always
  // a whole calendar month with no day/time component; avoids timezone
  // ambiguity a DateTime would introduce for something that's really just a
  // label.
  period     String
  status     String   @default("pending") // "paid" | "pending" — closed vocabulary
  amount     Int?     // paise/cents-as-integer if/when real amounts are tracked; null today
  paidAt     DateTime?
  note       String?
  updatedAt  DateTime @updatedAt

  @@unique([studentId, period])
  @@index([classId, period])
  @@index([teacherId, period])
}
```

`User` and `School` each gain a back-relation (`schoolClasses SchoolClass[]`
on `User`, `classes SchoolClass[]` on `School`) — additive, no column
changes on either.

**Why denormalized `teacherId` everywhere:** every single Classroom query is
"this teacher's data" — denormalizing it onto `Student`/`AttendanceRecord`/
`FeeRecord` means every list/aggregate query is a one-table indexed `WHERE
teacherId = ?`, matching `Resource`'s `where: { userId: req.user.id }`
pattern exactly, and makes the isolation bug class tenant-isolation.test.js
guards against (`server/test/tenant-isolation.test.js`) trivial to write a
Classroom-specific version of (§9, §15).

## 7. API design

New router `server/src/routes/classroom.js`, mounted as
`app.use('/api/classroom', classroomLimiter, classroomRouter)` in `index.js`
(own rate-limit bucket, matching the `resourcesRouter`/`supportRouter`
precedent — Classroom writes are frequent-but-cheap, closer to `/resources`
CRUD than to an AI call, so a generous ceiling like the existing `limiter`,
not a `generateLimiter`-style tight one).

Every route: `authRequired`, then ownership derived from `req.user.id` —
**never** from the request body, matching `resources.js`'s documented
contract verbatim.

```
GET    /api/classroom/classes                    list my classes
POST   /api/classroom/classes                     create a class
GET    /api/classroom/classes/:classId            one class (404 if not mine)
PATCH  /api/classroom/classes/:classId             rename / archive
DELETE /api/classroom/classes/:classId             only if empty, or soft-delete (see §6 archived)

GET    /api/classroom/classes/:classId/students    roster
POST   /api/classroom/classes/:classId/students    add a student
PATCH  /api/classroom/students/:studentId          edit / deactivate
DELETE /api/classroom/students/:studentId          soft-delete (active=false)

GET    /api/classroom/classes/:classId/attendance?date=YYYY-MM-DD
                                                    one day's marks + roster
POST   /api/classroom/classes/:classId/attendance  bulk upsert for one date:
                                                    { date, marks: [{studentId, status}] }
GET    /api/classroom/classes/:classId/attendance/summary?month=YYYY-MM
                                                    total/present/absent/% for the month
GET    /api/classroom/classes/:classId/attendance/history?month=YYYY-MM
                                                    day-by-day rows for review
GET    /api/classroom/classes/:classId/attendance/export?month=YYYY-MM
                                                    V1 — CSV download, see §13

GET    /api/classroom/classes/:classId/fees?period=YYYY-MM
                                                    every student's status for that month
PATCH  /api/classroom/students/:studentId/fees/:period
                                                    set status (paid/pending) for one student/month
GET    /api/classroom/classes/:classId/fees/export?period=YYYY-MM
                                                    V1 — CSV download, see §13

GET    /api/classroom/analytics/overview           cross-class totals: students, today's
                                                    attendance, monthly %, fee paid vs pending
GET    /api/classroom/analytics/classes/:classId    same, scoped to one class
```

Both export routes always require `classId` (path) + `month`/`period`
(query) — there is no "export everything" endpoint in V1, matching the
requirement that export supports class + month filtering, not an unbounded
dump. PDF is deliberately not an endpoint yet — see §13.

`POST .../attendance` is a **bulk upsert** (whole day, whole class in one
call) rather than one row per student per request — marking 40 students
individually would be 40 round trips on a low-end/poor-connectivity device,
which this app already optimizes against elsewhere (batched notification
`createMany`, `generate-set` batching several assessments in one Gemini
call). Implemented as a single `prisma.$transaction` of upserts keyed on the
`@@unique([studentId, date])` constraint.

Every list/mutate endpoint re-derives `classId` ownership via a shared
`findOwnedClass(classId, teacherId)` helper (mirrors `resources.js`'s
`findOwned()`) before touching `Student`/`AttendanceRecord`/`FeeRecord` — a
`studentId` that belongs to another teacher's class 404s exactly like an
unowned `Resource` does today, never a 403 (no existence leak).

## 8. Authorization/data-isolation strategy

- **Ownership key:** `teacherId` (== `req.user.id`), not `schoolId`. Two
  teachers in the same school are as isolated from each other as two
  teachers in different schools — this matches the explicit requirement
  ("only see and manage the classes/students that belong to their own
  account") over a school-shared model.
- **Every** Classroom query includes `teacherId: req.user.id` in its Prisma
  `where` — enforced by always routing reads through the same handful of
  `findOwned*` helpers rather than ad hoc `where` clauses per route (the
  `resources.js` pattern). A code-review checklist item, and a lint-by-test:
  `server/test/classroom-tenant-isolation.test.js` (§9) asserts teacher A
  can never see teacher B's classes/students/attendance/fees even with a
  guessed/enumerated id.
- **404, not 403,** on any cross-teacher access attempt — no existence leak,
  matching `resources.js`.
- **No role-based gating** beyond `authRequired` — every role (`teacher`,
  `school_admin`, `resource_person`, `super_admin`) can use Classroom for
  their own data; there is no admin override that reads across teachers in
  V1. This is simpler than `admin.js`'s role-scoped visibility and is the
  right default: nothing in V1 asks for a school_admin to see a teacher's
  gradebook.
- **School-admin cross-teacher classroom visibility is explicitly NOT built
  in V1** — not a route, not a query option, not a hidden capability behind
  a role check. `admin.js`'s existing `schoolScope()` pattern is a proven
  building block for a *future* school-level Dashboard rollup (§19), but V1
  ships none of it: every `/api/classroom/*` route filters strictly on
  `teacherId: req.user.id` regardless of the caller's role, full stop. This
  is asserted directly by `server/test/classroom-tenant-isolation.test.js`
  (§15), which includes a `school_admin`/`resource_person` case specifically
  to prove no such backdoor exists.
- **Input validation** at the boundary only (Zod `.strict()` schemas per
  route, mirroring `resources.js`), closed string vocabularies for
  `status` fields validated server-side (`present|absent`, `paid|pending`) —
  a client sending anything else gets a 400, never silently stored.

## 9. Frontend component/page structure

```
client/src/pages/ClassroomPage.tsx        top-level route (/classroom), owns
                                           tab state + selected class (URL-synced
                                           via useSearchParams, same pattern
                                           GeneratorPage.tsx already uses)
client/src/components/classroom/
  ClassroomTabs.tsx                       segmented tab bar (My Classes/
                                           Students/Attendance/Fees/Reports)
  ClassList.tsx                           create/select/archive a class
  StudentRoster.tsx                       add/edit/deactivate students for
                                           the selected class
  AttendanceMarker.tsx                    date picker + three-state Present/
                                           Absent/Unmarked control per student
                                           + day summary (all three counts)
  AttendanceHistory.tsx                   month picker + day-by-day review +
                                           "Download CSV" (§13)
  FeeStatusBoard.tsx                      month picker + per-student Paid/
                                           Pending toggle + "Download CSV" (§13)
  ClassroomAnalytics.tsx                  stat cards (reuses whatever
                                           card/stat CSS AdminPage already
                                           defines) — cross-class overview,
                                           links out to a class's own
                                           Attendance/Fees tabs for export
client/src/lib/classroomApi.ts            typed fetch wrappers (mirrors
                                           lib/resources.ts's shape: one
                                           function per endpoint, throwing
                                           ApiError on failure)
client/src/types.ts                       + SchoolClass, Student,
                                           AttendanceRecord, FeeRecord,
                                           AttendanceSummary types
```

`ClassroomPage` follows the same `TopBar`-wrapping pattern every non-Coach
page uses (`preferences` prop threaded through, `showProfileMenu` default).
No new global provider needed — no realtime/cross-tab state, unlike
Notifications.

## 10. Attendance design

- **Marking:** teacher picks a date (defaults to today), sees the class
  roster with a **three-state** Present/Absent/Unmarked control per student
  (unmarked is the real default — no row is silently counted as "present" or
  "absent" just because the teacher hasn't touched it yet; an explicit action
  is required to move a student out of Unmarked). Save calls the bulk upsert
  endpoint once, writing an `AttendanceRecord` only for students the teacher
  actually marked Present or Absent — a student left Unmarked simply has no
  row for that date (§6's schema already models it this way: no
  "unmarked" status value exists in the DB, only the *absence* of a row).
- **Attendance percentage — exact formula (binding, not illustrative):**

  ```
  attendance% = Present / (Present + Absent) * 100
  ```

  Unmarked students are excluded from **both** the numerator and the
  denominator — they are never counted as absent, and they never dilute the
  percentage. Worked example (30 students: 25 present, 3 absent, 2 unmarked):
  `25 / (25 + 3) * 100 = 89.3%`, not `25 / 30`. Every summary/analytics query
  in §12 and every CSV export column in §13 uses this exact formula — there
  is one implementation of it (a shared helper, not reimplemented per route)
  so the number can never drift between the Attendance tab, the Analytics
  tab, and the exported CSV.
- **UI must show three distinct counts, always** — Present, Absent, and
  Unmarked — never a two-way split. This applies to the day-marking summary,
  the month summary (§12), and the exported CSV (§13): "Unmarked" is always
  a visible, labeled number, not folded into Absent or silently dropped.
- **Date storage:** `AttendanceRecord.date` stored as UTC midnight for the
  calendar date the teacher selected (client sends `YYYY-MM-DD`, server
  parses it as `new Date(`${date}T00:00:00.000Z`)`) — avoids the
  off-by-one-day bug a naive `new Date(dateString)` client-timezone parse
  would cause; matches how `period` avoids the same problem for fees (§6) by
  using a plain label instead of a real timestamp where a timestamp isn't
  semantically needed.
- **Re-marking:** upsert on `@@unique([studentId, date])` — correcting a
  mis-marked day is just re-saving that date, no duplicate rows, no special
  "edit" endpoint. Moving a student back to Unmarked deletes their row for
  that date (rather than storing a third status value), keeping "no row" the
  single source of truth for Unmarked everywhere it's computed.
- **Month-wise view:** `GET .../attendance/history?month=` groups
  `AttendanceRecord` rows by date for the selected class+month, and derives
  Unmarked per day as `roster size − (present count + absent count)` for
  that date — never stored, always derived from the live roster so a student
  added mid-month doesn't require backfilling history.
- **Summary stats** (`GET .../attendance/summary?month=`): Present/Absent
  counts via Prisma aggregation (`groupBy` on `status`), Unmarked derived as
  above, percentage via the formula above — nothing here is stored, so
  there is nothing to keep in sync when a student is added/deactivated
  mid-month.
- **Today's attendance** (for the Analytics tab) is the same summary query
  scoped to `date = today` across all of a teacher's classes.
- **Export:** `GET .../attendance/export?month=` (§13) reuses this exact
  summary logic to produce the CSV — same formula, same three-way count,
  computed by the same helper as the on-screen summary.

## 11. Fee/payment-status design

- One `FeeRecord` per student per month, defaulting to absent-until-created
  (a student with no row for a period reads as "pending" in the UI without a
  DB row existing yet — mirrors how `Query.title` being `NULL` falls back to
  `queryText` today: the DB has no row, the API/UI supplies the default).
  `PATCH .../fees/:period` upserts, same as attendance.
- **V1 UI is deliberately simple: Paid/Pending only.** A single two-way
  toggle per student, nothing else exposed on screen — no amount field, no
  due-date picker, no notes field, no partial-payment state. This is a
  direct requirement, not just a nice-to-have: the fee workspace must not be
  overcomplicated in V1.
- `amount`/`paidAt`/`note` **stay in the schema exactly as designed in §6**
  for future expansion, but are write-only-by-nobody in V1 — no route
  accepts them from the client yet (the `PATCH .../fees/:period` body in V1
  is just `{ status: 'paid' | 'pending' }`), and no V1 UI renders them. This
  is what makes "later support proper fee tracking" require zero migration:
  the columns already exist, unused, exactly like `Resource.structured`
  waited for Phase 3's `examMeta` to start using it. Wiring the client to
  actually send/show `amount`/`paidAt`/`note` is future work (§19), not V1.
- Fee status view is per-class, per-month, listing every active student with
  a Paid/Pending toggle — same interaction shape as attendance marking, for
  UI consistency.
- **Export:** `GET .../fees/export?period=` (§13) lists every active
  student's status for that class+month as CSV — status only, matching the
  V1 UI's own scope (no amount/paidAt/note columns in V1, since the app
  never collects them yet).

## 12. Analytics design

`GET /api/classroom/analytics/overview` aggregates across every class the
teacher owns:
- Total students (count of `active` students across the teacher's classes).
- Today's attendance (present/absent/unmarked count for today across all
  classes — all three shown, per §10).
- Monthly attendance % (current month, using the exact §10 formula:
  `present / (present + absent) * 100`, unmarked excluded from both sides).
- Present vs absent vs unmarked (current month totals — three numbers, never
  a two-way split).
- Fee paid vs pending (current month, count of `FeeRecord.status`, defaulting
  unset students to "pending" per §11).

Per-class variant (`analytics/classes/:classId`) is the same shape, scoped.
Both are plain Prisma aggregation queries (`count`, `groupBy`) — no caching
needed at pilot scale (a teacher's own class sizes), matching how
`admin.js`'s existing analytics queries run live rather than cached.

## 13. Report/export design

**CSV export is part of V1** — a teacher must be able to download both their
attendance and fee reports, filtered by class + month, from day one.

**V1 scope:**
- **Attendance CSV** — `GET /api/classroom/classes/:classId/attendance/export?month=YYYY-MM`.
  One row per student, columns: `Student Name, Roll Number, Present, Absent,
  Unmarked, Attendance %` (per-student counts for the month + the §10
  formula applied per student), followed by a final `TOTAL` row using the
  same formula across the whole class. Computed by calling the exact same
  aggregation helper `attendance/summary` uses (§10) — the CSV numbers and
  the on-screen numbers are structurally guaranteed to match, since both
  read from one function.
- **Fee CSV** — `GET /api/classroom/classes/:classId/fees/export?period=YYYY-MM`.
  One row per active student, columns: `Student Name, Roll Number, Status`
  (Paid/Pending), plus a summary line (`Paid: N, Pending: M`) — matches the
  V1 fee UI's own scope (§11): no amount/paidAt/note columns, since V1 never
  collects them.
- **Filtering:** both routes require `classId` (path) and
  `month`/`period` (query) — there is no unscoped "export everything"
  endpoint, matching the requirement that export supports class + month
  filtering rather than an unbounded dump.
- **Mechanism:** `res.attachment('<class>-<month>-attendance.csv')` +
  `res.type('text/csv')` + a small, dependency-free CSV-building helper
  (`server/src/lib/csv.js` — quote/escape fields, join with `\r\n`, no new
  npm package needed). Same ownership check as every other route
  (`findOwnedClass`) before any query runs — an export for a class that
  isn't the caller's 404s exactly like every other Classroom route (§8).
  Mounted under the existing `classroomLimiter` bucket (§7) — export is a
  read, not an AI call, so no dedicated tighter limiter is needed.
- **Client:** a plain `<a>`-style download triggered from
  `AttendanceHistory`/`FeeStatusBoard` (§9) using the already-selected
  class + month from URL state — no new UI pattern, just a button that hits
  the export URL with the current auth token attached (matching how
  `avatar.js`'s authenticated GET is already fetched-and-blobbed elsewhere
  in this client rather than a bare `<a href>`, since these routes require
  `authRequired` and a bare link can't attach a Bearer token).

**Deferred to Phase 2 — PDF only:** a formatted, printable PDF version of
either report (e.g. for physically handing to a school office) is real
future work, but is not CSV's blocker — CSV ships in V1 specifically because
it requires no new dependency and no design decisions beyond "which
columns," while PDF needs a rendering library/layout choice that's worth
making deliberately once there's a concrete request for it, not speculated
on now. When it lands, it reuses the exact same `res.attachment()` +
ownership-check shape, just a different content-type and renderer.

## 14. Validation/error handling

- Every mutating endpoint: Zod `.strict()` schema, 400 on failure with
  `parsed.error.issues[0]?.message`, matching `resources.js` verbatim.
- Ownership check failures → 404 (`Class not found.` / `Student not found.`),
  never 403 — no existence leak, matching `resources.js`.
- Closed vocabularies (`present|absent`, `paid|pending`) via Zod `z.enum`,
  same as `Resource`'s `type` enum.
- String length caps on every free-text field (`name`, `rollNumber`, `note`)
  — same bounded-string discipline as `MAX_TITLE`/`MAX_META` in
  `resources.js`.
- Bulk attendance upsert: partial-failure handling inside the
  `$transaction` — if any student in the batch doesn't belong to the
  teacher's class, the whole transaction rejects (400) rather than silently
  applying a partial save, so the UI never shows a false "saved" for marks
  that didn't actually persist.
- Feature-flag gate (§ next) returns 503 with a generic message when
  disabled, matching every other flagged feature's `readXFlags(env).enabled`
  guard.

**Feature flag.** New `server/src/lib/flags.js` entry,
`readClassroomManagementFlags(env)`:
```js
CLASSROOM_MANAGEMENT_ENABLED            // server kill switch, default false
CLASSROOM_MANAGEMENT_ALLOWED_SCHOOL_CODES  // rollout filter, default [] (= all schools)
```
Client cosmetic gate: `VITE_CLASSROOM_MANAGEMENT_ENABLED` in `config.ts`,
same "hides the nav item on an already-cached PWA build, not a real kill
switch" caveat as every other `VITE_*_ENABLED` constant. `BottomNav`/`TopBar`
render the Classroom link only when this is true; the server flag is what
actually 503s every `/api/classroom/*` route when off — so a stale cached
client that still shows the link gets a clean 503 from the API, not silent
breakage.

## 15. Testing strategy

Mirrors the existing per-feature test layout exactly:
- `server/test/classroom.test.js` — CRUD happy paths for classes/students,
  Zod validation failures, 404-on-not-owned.
- `server/test/classroom.attendance.test.js` — bulk upsert, re-mark
  idempotency, `@@unique` constraint behavior, and a dedicated case pinning
  the §10 percentage formula: the exact 30-student example from the
  requirement (25 present / 3 absent / 2 unmarked → 89.3%, NOT 25/30 =
  83.3%) asserted against both the summary endpoint and the exported CSV, so
  a future edit can never silently fold unmarked into the denominator again.
- `server/test/classroom.fees.test.js` — status upsert, default-pending
  behavior for a student with no `FeeRecord` yet, and a check that
  `PATCH .../fees/:period` rejects any `amount`/`paidAt`/`note` in the body
  (`.strict()` schema, §11) — pins "V1 UI/API surface is Paid/Pending only"
  as a contract, not just a UI choice.
- `server/test/classroom.export.test.js` — new file: attendance CSV and fee
  CSV each tested for correct headers/rows/escaping, correct `class + month`
  filtering (a request missing either param 400s), correct `Content-Type`/
  `Content-Disposition`, and 404 on a `classId` the caller doesn't own
  (proves export can't be used to probe another teacher's data).
- `server/test/classroom-tenant-isolation.test.js` — new file, same shape as
  `tenant-isolation.test.js`: two teachers, assert teacher B can never read/
  write/export teacher A's class/student/attendance/fee data even via a
  guessed id, and — the specific case called out in this round of feedback —
  that a `school_admin`/`resource_person` gets **no** special visibility
  into another teacher's classroom data either (confirms §8: no
  cross-teacher visibility exists in V1, for any role).
- `server/test/rbac.test.js` — add Classroom routes (including both export
  routes) to the existing matrix (every role can use its own; no role can
  use another's).
- Client: component tests for `AttendanceMarker`/`FeeStatusBoard` (bulk-save
  interaction, three-state control for attendance), colocated `*.test.ts(x)`
  per the existing `client/src/lib/*.test.ts` convention (e.g.
  `classroom.test.ts` already exists for the unrelated `classroom-mode`
  feature at `client/src/lib/classroom.ts` — the new Classroom Management
  client lib must use a distinct filename, e.g. `classroomApi.ts`/
  `classroomApi.test.ts`, to avoid a collision if `classroom-mode` is later
  merged).

## 16. Migration considerations

- Single additive migration, `<timestamp>_add_classroom_management` — 4 new
  tables, 2 new back-relations on existing models, zero column changes to
  any existing table. No data backfill needed (nothing existed before).
- Stays on SQLite per [[db-engine-constraint]] — every type used above
  (`String`, `Int`, `Boolean`, `DateTime`) already appears elsewhere in the
  schema, so nothing here is SQLite-specific or would need rework for a
  future Postgres move (the schema header's own stated migration path).
- `npx prisma migrate dev` locally; the existing `dev.db.backup-before-*`
  convention in `server/prisma/` suggests taking a manual backup copy before
  applying, matching how the last two migrations were staged.

## 17. Implementation phases

Status tags below reflect reality as of this document's "Implementation
status" section above — treat that section as authoritative if the two ever
disagree.

1. **✅ DONE — Schema + API (backend only).** Migration, `routes/classroom.js`, Zod
   schemas, `lib/csv.js` helper, `flags.js` entry, `index.js` mount + rate
   limiter, **both CSV export routes**, full test suite from §15 (including
   `classroom.export.test.js` and the percentage-formula pinning test). No
   UI yet — verifiable via Supertest alone, including downloading and
   parsing the CSV bodies.
2. **✅ DONE — Frontend — My Classes + Students.** `ClassroomPage` shell, tabs,
   `ClassList`, `StudentRoster`, nav entries (mobile + desktop), behind the
   flag.
3. **✅ DONE — Frontend — Attendance.** Marking (three-state control), monthly
   summary, and student-history drill-down, all using the §10 formula.
   **Exception:** the "Download CSV" action described here was not wired up
   — the export route works but no UI button calls it yet (see Phase 5).
4. **⬜ NOT STARTED — Frontend — Fees.** `FeeStatusBoard` (Paid/Pending only, per §11) and
   its "Download CSV" action wired to the Phase 1 export route.
5. **⬜ NOT STARTED — Frontend — Analytics.** `ClassroomAnalytics` overview + per-class view.
   Also where the still-missing attendance/fee "Download CSV" UI buttons belong.
6. **⬜ NOT STARTED — Rollout.** Flip `CLASSROOM_MANAGEMENT_ENABLED` for an allow-listed pilot
   school via `CLASSROOM_MANAGEMENT_ALLOWED_SCHOOL_CODES`, then broaden.

CSV export is therefore fully built (API in Phase 1, UI trigger in Phases 3
and 4) before rollout — nothing ships to a real teacher without it.

Each phase is independently mergeable behind the flag, matching how every
other feature in this codebase (`ASSISTANT_ENABLED`, `CLASSROOM_MODE_ENABLED`,
etc.) shipped incrementally dark.

## 18. Risks/trade-offs

- **`teacherId`-only isolation vs. a future school-shared roster.** If a
  school later wants shared class rosters (e.g. a co-taught class, or a
  school_admin needing oversight), the denormalized `teacherId` model doesn't
  support multi-teacher ownership of one `SchoolClass` without a schema
  change (a join table). Accepted trade-off: the spec is explicit that
  isolation is per-teacher-account, and building for a hypothetical shared
  model now would be the premature-abstraction the project's own conventions
  warn against. §6's `schoolId` denormalization on `SchoolClass` is the one
  deliberate hook left for a later rollup without a bigger rewrite.
- **No fee amounts/ledger in V1.** `amount`/`paidAt`/`note` exist in the
  schema but are unused by any V1 route or UI — acceptable since V1 fees are
  deliberately Paid/Pending only (§11), but means neither the on-screen Fees
  tab nor the fee CSV can show real currency totals until a future phase
  wires the columns up.
- **PDF export deferred, CSV is not.** Only the PDF/print-formatted variant
  of the reports is Phase 2 — CSV attendance and fee export are both in V1
  (§13), scoped to class + month exactly as required. This is a narrower cut
  than the original plan's, based directly on this round of feedback.
- **Naming collision risk with `classroom-mode`.** Mitigated by using
  distinct table/flag/file names throughout (§0), but a future person
  skimming git history will see two very differently-scoped features both
  called "classroom" — worth a one-line mention in the eventual PR
  description.
- **SQLite at pilot scale.** Bulk attendance upsert inside a
  `$transaction` on SQLite serializes writes; fine at pilot-scale roster
  sizes (tens of students per class), and consistent with every other write
  path in this app already accepting SQLite's single-writer model
  ([[db-engine-constraint]]).

## 19. Future extensibility

- `Student.details` (JSON) → structured fields (contact number, guardian
  name, DOB, address) without a migration, same pattern `Resource.structured`
  already validates as workable.
- `FeeRecord.amount`/`paidAt`/`note` → wire the V1-unused columns into the
  fee UI/API for real amounts, due dates, and notes once that's requested —
  no schema change needed, just a Zod schema and UI update (§11).
- `SchoolClass.schoolId` → a **future, explicitly out-of-V1** school_admin
  rollup view (read-only, cross-teacher, scoped to their school) reusing
  `admin.js`'s existing `schoolScope()` pattern for the school-level
  Dashboard — additive, no change to the teacher-facing model, and not to be
  built until asked for (§8, §18).
- Report export (§13) → CSV ships in V1; a PDF/print-formatted variant is
  the deferred piece, same `res.attachment()` shape when it's built.
- Notification hooks (e.g. "3 students still pending fees this month") slot
  into the existing `createNotification()` call from a scheduled job or from
  the fee-status PATCH handler, reusing the transport built for Resources/
  Support without any new plumbing.
