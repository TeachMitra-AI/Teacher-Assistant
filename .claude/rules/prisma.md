---
paths:
  - "server/prisma/**"
  - "server/src/seed.js"
  - "server/tools/**"
---

# Prisma, migrations, and data tools

- The database is SQLite. Don't start the Postgres migration (`docs/postgres-migration-plan.md`)
  unless the user asks for it.
- Change the schema in `server/prisma/schema.prisma`, then create a migration with
  `npx prisma migrate dev --name <change>` **only after the user agrees**. It rewrites
  the local dev DB. Never edit a migration that is already committed. Add a new one.
- Never run `prisma migrate reset`, `prisma db push`, `--force-reset`, or
  `--accept-data-loss` without explicit approval for that exact command.
- `npm start` runs `prisma migrate deploy`. That is production behaviour. Don't run it
  against a real database from an agent session.
- Don't open `server/prisma/*.db` or the `*.db.backup*` files; they may contain real data.
- Scripts in `server/tools/` and `src/seed.js` modify data. Prefer their `--dry-run` mode
  where one exists, and ask before running them. `seed.js` refuses production on its own.
  Keep that guard.
- A schema change usually needs updated fixtures in `server/test/helpers/fixtures.js` and a
  test that exercises the new column through the API.
