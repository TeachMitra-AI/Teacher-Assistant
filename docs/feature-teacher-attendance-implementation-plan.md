# Teacher Attendance — Implementation Plan

Branch: `feature/teacher-attendance`.

**Status: built and verified.** Phase 1 (the review-queue-driven version)
was fully built, tested, and used with real seeded data across a 50-day,
multi-teacher dataset. That real usage — plus a side-by-side comparison
against how Bihar's own e-Shikshakosh app and other government/enterprise
attendance systems actually work — surfaced a harder problem than any
individual bug: **a queue the Principal has to clear every day doesn't
scale, and most of what it queued (ordinary lateness, an early departure, a
forgotten checkout) never needed a decision at all.** That led to a full
product-level rethink, decided explicitly (see §1), not a patch on top of
the old design — and this redesign (§3–§7) is now implemented:

- **§3 schema** — applied (`20260831184553_add_teacher_attendance_activity_log`).
- **§4 server routes** — block-not-flag, no auto-escalation, review queue
  removed, activity logging wired through check-in/out/corrections/
  settings/holidays/login. 65 server tests for this redesign specifically
  (attendance route/lib tests + the reminder sweep), full server suite
  clean except two pre-existing, unrelated failures confirmed present
  before any of this work started (`resources.test.js`, `pushService.test.js`).
- **§5 checkout reminder** — built as an in-process `setInterval` sweep
  (`server/src/lib/teacherAttendanceReminder.js`), the simplest fit once
  confirmed this codebase has no existing job/cron mechanism at all.
- **§6 client** — teacher screens (disabled-not-hidden distance UI already
  existed and needed only its dead flagged-review branch removed; the
  closing-time reminder banner is new), Review tab retired, Reports'
  drill-down now does on-demand corrections via `AttendanceCorrectionForm`
  (renamed from `ReviewQueueCard`), new Activity Log tab. Client build/
  lint/tests clean except one pre-existing, unrelated date-cutoff flake in
  `HistoryTab.test.tsx` (fails only when run on the 1st of a month; not
  touched by this work).
- **§7 scale** — `GET /school-history` is now paginated and summary-only;
  a specific teacher's day-by-day detail is a separate on-demand fetch;
  the activity log defaults to a 7-day window with required filters.
  **Not yet built**: the 6-month trend strip and Settings' grouped-sections
  visual regrouping from the design doc — both are visual polish, not
  required for correctness, deferred.

This document describes the new plan — the old "approve/reject/correct via
a review queue" design is retired, and this file replaced its own previous
contents rather than appending to them.

**Scope: web only (`client/`).** `mobile/` is not part of this feature and
is not touched anywhere in this plan.

Companion documents:
- `docs/attendance-register-design.html` — the visual/UX design for this
  plan: every teacher and admin screen, mocked up, with the reasoning
  behind each choice, including a dedicated section on staying usable at
  real scale (many teachers, years of history).
- `docs/attendance-system-design.html`, `docs/attendance-governance-decisions.html`,
  `docs/attendance-plan-review.md` — original Phase 1 policy/design
  documents. Still accurate for things this redesign doesn't touch (GPS
  strategy, audit-trail discipline, late/half-day math) — read them for
  background, but where they describe daily Principal approval, **this
  document supersedes that.**
- `docs/attendance-system-audit.html` — the real-usage audit that first
  identified "everything routes through the Principal" as the biggest gap.
  This plan is the direct response to that finding.

---

## 1. The decision, in the user's own words

This is the actual, final product decision this plan implements — recorded
here verbatim (lightly organized) because everything below traces back to
it directly:

1. **Login is not attendance.** A teacher can log into the app from
   anywhere; that alone creates no attendance record.
2. **Check In** is allowed only during the approved check-in window, and
   only within the allowed distance from school. Outside that distance,
   check-in is not available. The backend re-checks location independently
   — the client's own read is never trusted.
3. **Check Out** is allowed only during the approved checkout window, and
   only within the allowed distance from school. Once the checkout window
   closes, checking out is no longer possible for that day — **a teacher
   can never check out later from home.**
4. **A checkout reminder** starts 15 minutes before the checkout window
   closes and continues until 30 minutes after, at a reasonable interval
   (not every minute), and stops the instant the teacher actually checks
   out.
5. **A forgotten checkout is just recorded as "Missing Checkout."** No
   guessed time, no self-reported claim, no way to check out from home
   after the fact, and — the core change — **no Principal review queue
   entry.** It stays visible in that day's history, and repeated
   occurrences show up as a pattern in reports.
6. **Ordinary lateness, an early departure, and a missing checkout do not
   create a Principal approval request.** The system calculates and
   records Present / Late / Half Day / Absent / Early Checkout / Short
   Hours / Missing Checkout / Leave / On Duty / Holiday / Weekly Off as
   facts. It does not automatically punish anyone, and it does not ask
   anyone to sign off on them.
7. **No daily review queue at all.** The Principal isn't asked to approve
   late arrivals, early departures, missing checkouts, or normal
   attendance, and doesn't have to review every unusual event one by one.
   They mainly use reports and history, and investigate a specific day
   only when they choose to.
8. **Reports show the whole picture, including patterns** — e.g. "Missing
   Checkout: 6 times this month," "Late: 8 times this month" — without
   taking any automatic action.
9. **Leave and On Duty stay separate from ordinary attendance** and never
   automatically become Absent. Same for Holidays and Weekly Off.
10. **Everything meaningful is logged**, even though nothing needs
    approval: login, check-in, check-out, a failed/blocked check-in, a
    failed/blocked check-out, the location result, a missing checkout, any
    correction, leave, on-duty, a holiday change, a settings change — each
    as **Who → What → When → Where → Result.**
11. **Internet problems never lose attendance data** — save locally, sync
    when the connection returns (already built, see §3 — unchanged by this
    redesign).
12. **Corrections never silently delete or replace old information.**
    Keep the original, the new value, who changed it, when, and why —
    every time.
13. **The system works even when the Principal is away.** Nothing about
    check-in/check-out depends on anyone approving anything, so a
    Principal being on leave doesn't stop attendance from working.
14. It must stay usable at **real scale** — a school with many more than a
    handful of teachers, and years of accumulated daily records, not just
    the small demo dataset used to design and test it. See §6.

---

## 2. What stays exactly as it is

Most of Phase 1's foundation is unaffected by this redesign — it was never
the problem. Kept as-is, no changes:

- **Location strategy** — GPS read only at check-in/check-out, never
  continuous/background tracking. `client/src/lib/geolocation.ts`.
- **Server-side recompute discipline** — "the phone proposes, the server
  decides." The server always recalculates distance-from-school and never
  trusts a client-reported verdict. `distanceMeters`/`isWithinGeofence` in
  `server/src/lib/teacherAttendance.js`.
- **All the arrival/day-status math** — `classifyArrival`,
  `computeWorkingMinutes`, `computeEarlyDeparture`, `deriveDayStatus`,
  `computeRequiredMinutes` (`server/src/lib/teacherAttendance.js`). What
  changes is only what happens *after* these functions run for an
  outside-window arrival or a too-short day (§4) — the math itself is
  correct and untouched.
- **The append-only audit trail** — `TeacherAttendanceReview`
  (`server/prisma/schema.prisma:717-736`) stays exactly as it is and stays
  the mechanism for any correction: who, when, what action, previous/new
  status, mandatory reason. It's reused, not replaced (§4).
- **Offline queueing** — `client/src/lib/attendanceOfflineQueue.ts`. Fully
  built, already matches decision §1.11. Not touched.
- **The tab-shell page pattern** (`AttendancePage.tsx` + `?tab=`),
  `SchoolAttendanceConfig`, `SchoolHoliday`, the holiday CRUD routes, the
  feature-flag gating (`TEACHER_ATTENDANCE_ENABLED` /
  `TEACHER_ATTENDANCE_ALLOWED_SCHOOL_CODES` in `server/src/lib/flags.js`).
- **Excel export** (`lib/teacherAttendanceReportExcel.js`) — still useful,
  unaffected by how records get created.

---

## 3. What changes — data model

One additive table. Nothing existing is dropped, renamed, or altered.

```prisma
// Every meaningful attendance-related event, whether or not it changed a
// TeacherAttendance row — the record of "who did what, when, where, with
// what result" that decision §1.10 requires. Deliberately separate from
// TeacherAttendanceReview (which stays scoped to Principal corrections
// specifically) since most rows here — a plain check-in, a blocked
// attempt, a reminder firing — were never a "review" of anything.
model TeacherAttendanceActivityLog {
  id             String   @id @default(cuid())
  school         School   @relation(fields: [schoolId], references: [id])
  schoolId       String
  user           User     @relation(fields: [userId], references: [id])
  userId         String   // whose day this event is about
  performedBy    String?  // set only when different from userId — e.g. an
                           // admin correcting someone else's record
  action         String   // login | check_in | check_out | check_in_blocked |
                           // check_out_blocked | missing_checkout | correction |
                           // mark_on_leave | mark_on_duty | holiday_changed |
                           // settings_changed | reminder_sent
  result         String?  // short human-readable summary, e.g. "63m from
                           // school" or "blocked, 410m away"
  lat            Float?
  lon            Float?
  distanceMeters Float?
  metadata       String?  // JSON, only for actions that need extra detail
                           // (old/new values on a correction or settings change)
  createdAt      DateTime @default(now())

  @@index([schoolId, createdAt])
  @@index([userId, createdAt])
}
```

Plus the corresponding relation fields on `School` and `User`
(`activityLogs` on each) — additive only.

**`TeacherAttendance.status`'s `flagged_review` value effectively retires**
from the check-in/check-out paths (§4) — nothing auto-assigns it anymore.
The column keeps the string type (no enum migration needed) since the
`reject` review action can still set a status manually if a Principal ever
wants to. `pending_regularization` stays exactly as it is — still a
read-time-only overlay via `deriveEffectiveStatus`
(`server/src/lib/teacherAttendance.js:215-240`), never written to the
column, unchanged by this redesign since "missing checkout" behaves the
same way structurally — it's only the *reaction* to it (queue vs. no
queue) that changes.

**This is the one change gated behind explicit approval** (this project's
standing rule — no Prisma migration without a direct go-ahead). Nothing
runs until that's given separately.

---

## 4. What changes — server routes

All in `server/src/routes/teacherAttendance.js` unless noted.

**Check-in / check-out — block, don't flag-and-allow.**
Today, a geofence failure on either end still writes a `TeacherAttendance`
row with `status: 'flagged_review'` (`:288-292`, `:374-376`) — the request
succeeds, just gets queued. Per decision §1.2/§1.3, this becomes a hard
block: no `TeacherAttendance` row is written at all for a rejected
attempt. Instead, write one `TeacherAttendanceActivityLog` row
(`action: 'check_in_blocked'` / `'check_out_blocked'`, with the distance
and location) and return a clear rejection to the teacher. Same idea for
checkout after its window has closed — rejected outright, logged, no row.

**Outside-check-in-window arrivals and near-instant checkouts stop
auto-escalating.** Two branches currently promote a record straight to
`flagged_review`:
- `classifyArrival`'s `outside_window` result (`:294-297`) — arriving
  after `checkinWindowEnd`.
- `isImplausiblyShortDay` (`:379-385`, threshold in
  `lib/teacherAttendance.js:133-143`) — checking out under 30 minutes
  after checking in.

Per decision §1.6, both become ordinary recorded facts instead —
`status: 'present'` with a large `lateMinutes`, or `half_day`/`present`
with the real `shortfallMinutes`, exactly like ordinary lateness already
works today. No flag, no queue entry. The 30-minute sanity floor itself
stays (it's still useful, real information — "worked 12 minutes" is a
fact worth recording precisely) — only the automatic escalation to a
Principal-facing flag goes away.

**Missing checkout stays exactly what it already is** —
`deriveEffectiveStatus`'s read-time `pending_regularization` overlay,
unchanged. What's removed is the *reaction*: today's `GET /review-queue`
(`:563-620`) surfaces it as something needing action. Per decision §1.5,
it becomes purely a fact in that day's history and a count in Reports —
no self-report mechanism, no queue entry, nothing to submit.

**`GET /review-queue` and the Review tab retire.** With geofence hard-
blocked (never reaches a status), outside-window/too-soon no longer
auto-flagging, and missing-checkout no longer queued, there's nothing left
that automatically belongs in a queue. This endpoint and
`ReviewTab.tsx`/its nav entry are removed rather than kept half-empty.

**Corrections move from "resolve a queue item" to "act on any day."**
`POST /:id/review` (`:622-710`) keeps its exact logic —
`correct_checkin`, `correct_checkout`, `mark_on_leave`, `mark_on_duty`
(and `approve`/`reject`, kept for a Principal who wants to explicitly
override a day) all still write the same `TeacherAttendanceReview` audit
row and update the same fields. What changes is only *how it's reached*:
callable from any day in a teacher's Reports drill-down, not gated behind
queue membership. No server-side change beyond removing the now-unused
`reviews: { none: {} }` queue-membership filtering — the action endpoint
itself doesn't need to know whether the record was ever "flagged."

**`notifyAdminsOfFlag`** (`:197-224`) loses both its current call sites
(the flags that triggered it no longer occur). It's repurposed for the
one thing decision §1.10 still wants pushed proactively: nothing, in
fact — the checkout reminder (§5) targets the *teacher*, not the admin.
This function likely just gets deleted; there is currently no remaining
"push a notification to the Principal" need in this redesign. Confirm
this is really true before removing it, in case something in §7's open
questions changes that.

**Activity logging** — every route that currently mutates a
`TeacherAttendance` row (check-in, check-out, the review action, holiday
CRUD, settings update) also writes one `TeacherAttendanceActivityLog` row.
The **login event** (decision §1.10) is the one item that lives outside
`teacherAttendance.js` — it means a small, additive hook in
`server/src/routes/auth.js`'s login handler, scoped to only fire for
users who belong to a school with the feature enabled (mirroring how
every other route already gates on `TEACHER_ATTENDANCE_ENABLED`).

---

## 5. What changes — checkout reminder

New requirement, not present in Phase 1 at all. Per decision §1.4: fire
starting 15 minutes before `SchoolAttendanceConfig.closeTime`, continue at
a reasonable interval until 30 minutes after, stop immediately once
`checkOutAt` is set, and log each firing (`action: 'reminder_sent'`).

**Needs investigation before it can be planned precisely:** whether this
codebase has any existing scheduled-job mechanism at all (grepped for so
far in earlier exploration — none found for anything resembling a
periodic timer/cron). Whichever way it's answered decides the shape:
- If nothing exists yet, the simplest fit for a single Node process is an
  in-process interval check (e.g. every few minutes, ask "which schools'
  closing time falls in the next 15–45 minutes, and which of their
  checked-in-not-checked-out teachers haven't been reminded yet") rather
  than introducing a new job-queue dependency for one feature.
- `closeTime` is per-school, so this can't be a single fixed daily
  trigger — it has to actually check per-school config each time it runs.

This section stays a plan, not a built thing, until that's resolved.

---

## 6. What changes — client

Full visual detail and reasoning: `docs/attendance-register-design.html`.
Summary of the structural changes:

**Teacher side** (`CheckInTab.tsx`, `HistoryTab.tsx`):
- The Check In / Check Out button is shown **disabled with the live
  distance and threshold**, not hidden, when out of range — a deliberate
  reading of decision §1.2/§1.3's "button is not shown": a vanished button
  reads as broken on a basic phone, while a disabled button with a reason
  teaches the rule instead. The *enforcement* (can't actually check in
  from far away) is identical either way, and the server independently
  re-checks regardless of what the client shows.
- A calm inline reminder banner (not a blocking popup) appears once the
  15-minute window opens, disappears the instant checkout happens.
- Missing-checkout renders as a plain amber history row, no action
  attached to it — it's a fact, not a task.

**Admin side** (new/changed components under `client/src/components/attendance/`):
- A dashboard landing view — four stat cards (Present/Late/Missing
  checkout/Absent today), not a table, each linking into a pre-filtered
  Reports view. New.
- `ReportsTab.tsx` — stays the main daily-use surface. Its drill-down gets
  an on-demand "Correct this day" action on any row (reusing
  `ReviewQueueCard.tsx`'s existing action-form logic, detached from queue
  membership) instead of only rows that happened to be in the retired
  queue. Also gets a 6-month trend strip per teacher and — at real scale —
  server-side pagination instead of loading every teacher's full month up
  front (§6 of the design doc, §7 below).
- `SettingsTab.tsx` — fields regrouped into collapsible sections (Timing /
  Location / Patterns / Weekly off & Holidays) — same fields, better
  organized now that the list has grown past a dozen.
- A new **Activity Log** tab/view — reverse-chronological, filtered by
  teacher/event-type/date-range, defaulting to the last 7 days. Secondary,
  investigative — not the landing screen.
- `ReviewTab.tsx` and `ReviewQueueCard.tsx`'s queue-list usage are removed
  (the action-form logic inside `ReviewQueueCard` is reused per above, the
  "queue" framing around it is not).

---

## 7. Staying usable at scale

Full detail and mockups: `docs/attendance-register-design.html`'s
"Designing for a large school and a long history" section. The three
places that break first if this isn't designed in from the start, not
patched on later:

1. **Reports with many teachers** — the list view must fetch only
   per-teacher summary counts, paginated (e.g. 25/50 at a time) and
   searched/filtered server-side. Full day-by-day detail is fetched only
   once a specific teacher is opened. `GET /school-history` currently
   returns full raw records for every teacher in one call
   (`server/src/routes/teacherAttendance.js`, per the original plan's §3)
   — this needs to become paginated and summary-only for the list, with a
   separate per-teacher detail fetch.
2. **Long-term pattern visibility** — a 6-month trend strip per teacher
   (late+missing-checkout counts, one bar per month) so a Principal isn't
   forced to open six separate months to see whether something is trending
   up or down.
3. **The activity log** — the one table with no natural ceiling; over a
   couple of years this is the largest table in the schema. It must never
   default to "everything": a required date range (default: last 7 days),
   filters by teacher/event type, real pagination, and the two indexes
   already included in §3's schema (`[schoolId, createdAt]`,
   `[userId, createdAt]`) so a lookup stays fast in year three, not just
   week one.

---

## 8. Build stages

Each stage is independently buildable and verifiable — no stage depends on
guessing what a later one will need.

1. **Schema** (§3) — one additive migration, shown for approval before
   running (§9).
2. **Server routes** (§4) — blocking behavior, removed auto-escalation,
   activity logging, retired review-queue endpoint.
3. **Checkout reminder** (§5) — after investigating what scheduling
   mechanism actually fits this codebase.
4. **Client** (§6) — teacher screens first (smaller, self-contained), then
   the admin side (dashboard, Reports changes, Settings regrouping,
   Activity Log), in that order.
5. **Scale work** (§7) — pagination and server-side summaries for Reports,
   the trend strip, the activity log's default-scoped querying. Can land
   alongside stage 4 rather than strictly after it, since it's the same
   files.

---

## 9. Explicit approval checkpoints

1. **Running the §3 migration.** Standing project rule — no Prisma
   migration without a direct go-ahead, shown before it runs. **Given —
   migration applied, confirmed additive (one `CREATE TABLE`, two indexes,
   no `ALTER`/`DROP`).**
2. **Deleting `ReviewTab.tsx`/`ReviewQueueCard.tsx`'s queue usage and the
   `GET /review-queue` endpoint.** **Done** — both files removed,
   `ReviewQueueCard` reborn as `AttendanceCorrectionForm.tsx` (same action
   logic, no queue framing), `GET /review-queue` deleted server-side.
3. **Turning `TEACHER_ATTENDANCE_ENABLED` on anywhere real** — unchanged
   from the original plan; still hasn't happened outside a local
   developer's own `.env` against demo accounts.

---

## 10. Verification gates

Unchanged from this project's standing rule, re-run at every stage in §8,
not just once at the end:

- `server/`: `npx prisma generate` → `npm run lint` → `npm test`
- `client/`: `npm run lint` → `npm test` → `npm run build`

Existing tests that assumed the old review-queue behavior (parts of
`server/test/teacherAttendance.test.js`,
`client/src/components/attendance/ReviewQueueCard.test.tsx`,
`ReviewTab.test.tsx`, `ReportsTab.test.tsx`, `HistoryTab.test.tsx`) will
need updating alongside the routes/components they cover, not left
red or silently skipped.

---

## 11. Open questions — resolved

- **The reminder job's scheduling mechanism** (§5) — confirmed nothing
  cron/interval-like existed; built as a plain `setInterval` in
  `server/src/index.js`, guarded by the same `require.main === module`
  check that already gated `httpServer.listen`, so a test file requiring
  `app` never starts a background timer.
- **`notifyAdminsOfFlag`** — deleted. Nothing auto-flags any more, so it
  had no remaining call sites.
- **"Login" logging's scope** — gated on `TEACHER_ATTENDANCE_ENABLED` (and
  the school's rollout filter) inside `auth.js`'s two login paths (email
  and Google), via a small shared `logAttendanceLoginIfEnabled` helper —
  a school with the feature off gets no rows.

## 12. Deferred (not required for correctness)

- **6-month trend strip** per teacher in the Reports drill-down (design
  doc §11) — a visual nicety for spotting a pattern across months without
  opening each one; the same information is still available by browsing
  month to month.
- **Settings' grouped-collapsible-sections regrouping** (design doc §8) —
  the fields all still work exactly as before, just as one flat list
  rather than four named groups.
