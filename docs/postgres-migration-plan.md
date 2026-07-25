# SQLite → PostgreSQL migration plan (reference only — not executed)

**Status: documentation only.** Nothing in this document has been run. The
project's Prisma datasource is unchanged: `provider = "sqlite"`,
`DATABASE_URL="file:./dev.db"`, in `server/prisma/schema.prisma`. This is a
plan for a future phase you'll initiate yourself once PostgreSQL is
installed/available — likely once the pilot needs concurrent-write
throughput SQLite can't provide, or a second app instance.

## Why this will eventually be needed

SQLite is a single-writer, single-file database. It's the right choice for a
pilot with one server process and moderate traffic, which is exactly the
current state of this project. It stops being the right choice once:
- More than one API instance needs to run at the same time (SQLite's file
  locking doesn't support that safely).
- Write concurrency grows (many teachers submitting at once, e.g. during a
  training day) to the point where SQLite's single-writer model becomes a
  bottleneck.
- You need managed backups, point-in-time recovery, or replication that a
  single local file can't provide.

None of that is true yet for this pilot — this document exists so the move
is easy and low-risk *when* it becomes true.

## Current state (verified)

- `server/prisma/schema.prisma`: `datasource db { provider = "sqlite", url = env("DATABASE_URL") }`.
- `server/.env.example`: `DATABASE_URL="file:./dev.db"`.
- Four migrations exist (`20260718152644_init`, `20260719031857_add_teacher_preferences`,
  `20260720060253_add_sessions`, `20260721153908_add_resources`), each plain
  Prisma-generated DDL — but written in **SQLite dialect** and not directly
  replayable against Postgres.
- The schema now has eight models: `School`, `User`, `Session`, `Query`,
  `Feedback`, `Event`, `Resource` (the "My Library" / Lesson Plan Workspace
  store, added in `…_add_resources`), and `PasswordResetToken` (added in
  `…_add_email_password_auth` alongside the move from name+PIN to
  email+password identity).
- `server/prisma/dev.db` is git-ignored and was never committed — no
  data-in-git risk during a future migration.
- One caveat specific to `…_add_email_password_auth`: it is a **table-rewrite**
  migration (SQLite cannot alter column nullability or swap a unique index in
  place), so it drops and recreates `User`. Postgres can express the same change
  with plain `ALTER TABLE`, which is why step 3 below regenerates DDL from
  `schema.prisma` rather than replaying the SQLite migration history.
- Every primary key is a `cuid()` string, not a SQLite autoincrement integer
  — rows can move to Postgres with their existing IDs completely unchanged,
  no foreign-key remapping needed. This is the single biggest simplifier for
  this particular migration.
- `server/src/lib/db.js` is a single `new PrismaClient()` singleton — works
  unchanged against Postgres, but will need a `connection_limit` set on
  `DATABASE_URL` once more than one app instance runs against the same
  database.

## Migration plan

1. **Provision Postgres** for dev/staging first — any managed provider works
   (Neon, Supabase, RDS, Cloud SQL); Prisma is provider-agnostic beyond the
   `datasource` block.
2. **Branch the schema.** On a separate branch, change
   `provider = "postgresql"` and point `DATABASE_URL` at the new instance.
   Do this on a branch, not `main`, so local SQLite development keeps
   working for everyone until the cutover is actually ready.
3. **Regenerate migrations from scratch against Postgres.** Do not try to
   replay the existing SQLite `.sql` files — they're the wrong dialect.
   Archive `server/prisma/migrations/` for the historical record, then run:
   ```bash
   npx prisma migrate dev --name init_postgres
   ```
   against an empty Postgres database, so Prisma generates fresh,
   Postgres-native DDL from the current `schema.prisma`.
4. **Migrate the data**, respecting FK order:
   `School → User → Session → PasswordResetToken → Resource → Query → Feedback → Event`
   (`Resource` references `User` (required) and `School` (optional), so it
   copies after both. `Event` **is** written by the app now — the coach route
   in `server/src/index.js` records AI-safety flags and notable reliability
   incidents — so it is no longer an always-empty table and should be copied
   like any other.) A small one-off Node script
   using two Prisma clients (one pointed at SQLite, one at Postgres) is the
   simplest approach given the small table count and cuid-based IDs — no ID
   remapping required, just read-then-write per table in FK order.
5. **Validate**:
   - Row counts match per table between source and destination.
   - Spot-check `Query.context` and `User.preferences` JSON-string columns
     deserialize identically after the copy.
   - Confirm `School.code` and `User(schoolId, name)` unique constraints
     hold on the imported data (they should, since they held in the source).
   - Confirm `Session.tokenHash` uniqueness holds.
6. **Update configuration**: `DATABASE_URL` becomes a real per-environment
   secret (ideally via a secrets manager rather than a `.env` file in
   anything beyond local dev — a separate recommendation from the
   enterprise-readiness audit, out of scope for this migration itself).
   Document a `connection_limit` query parameter on the connection string
   once more than one app instance exists.
7. **Decide on local-dev parity.** Two reasonable options when this phase
   starts:
   - Keep SQLite for local dev, Postgres for staging/prod — lower friction,
     small risk of a dialect difference (e.g. case-sensitivity, some SQL
     function) going unnoticed until it hits staging.
   - Standardize on Postgres everywhere via Docker Compose for full parity
     — recommended if the team is willing to add that one-time setup step.

   This project's testing foundation (`server/test/`) currently runs against
   a throwaway SQLite file regardless of what the "real" dev/prod datasource
   is — once Postgres is adopted, moving CI's integration tests to a real
   ephemeral Postgres service container (e.g. GitHub Actions'
   `services: postgres:` block) is the natural follow-up, for full fidelity
   between what's tested and what's deployed.
8. **Cutover**: a maintenance-window `DATABASE_URL` swap in production, run
   `prisma migrate deploy` against the production Postgres instance, deploy
   the app pointing at it, and smoke-test all four role flows (teacher,
   school_admin, resource_person, super_admin) end-to-end before declaring
   the migration complete.

## Rollback

Until the production cutover in Step 8 actually happens, rollback is trivial
— the branch from Step 2 simply isn't merged, and `main` keeps running on
SQLite untouched. After cutover, rollback means reverting `DATABASE_URL` back
to the SQLite file and redeploying the pre-cutover build — which only
recovers data written before the cutover, so this migration should not be
treated as reversible once real production traffic has hit the Postgres
instance. Keep the SQLite `dev.db` from immediately before cutover archived
for a reasonable retention period as a cold rollback point.
