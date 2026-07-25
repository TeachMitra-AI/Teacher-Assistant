-- Email + password identity, Google sign-in, and approval-gated signup.
--
-- SQLite cannot ALTER a column's nullability or replace a unique index in
-- place, so `User` is rewritten the same way Prisma itself does it: build the
-- new table, copy the rows across, drop the old one, rename. Foreign keys
-- pointing at User(id) survive because ids are copied unchanged and
-- `PRAGMA legacy_alter_table` (Prisma's default for SQLite migrations) leaves
-- referencing tables alone during the rename.
--
-- Backfill notes for the two column changes that aren't purely additive:
--   * `email` is NOT NULL with no default, so pre-existing rows get a
--     deterministic, non-deliverable placeholder derived from their id
--     (@invalid.local is reserved and can never receive mail). Those rows are
--     seeded demo accounts only — re-run `npm run seed` to replace them with
--     real email+password demo logins.
--   * `status` defaults to 'active' so every pre-existing account keeps
--     working; only NEW signups are written as 'pending'.
--   * `pinHash` becomes nullable. The column and its data are kept rather
--     than dropped, so this migration stays non-destructive, but no code path
--     reads or writes it any more.

-- RedefineTable
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "preferences" TEXT,
    "role" TEXT NOT NULL DEFAULT 'teacher',
    "passwordHash" TEXT,
    "googleSub" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "pinHash" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLogin" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_User" ("id", "schoolId", "name", "email", "displayName", "preferences", "role", "status", "pinHash", "failedLoginCount", "lockedUntil", "lastLogin", "createdAt")
SELECT
    "id",
    "schoolId",
    "name",
    'legacy-' || "id" || '@invalid.local',
    "displayName",
    "preferences",
    "role",
    'active',
    "pinHash",
    "failedLoginCount",
    "lockedUntil",
    "lastLogin",
    "createdAt"
FROM "User";

DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";

-- CreateIndex
CREATE UNIQUE INDEX "User_schoolId_email_key" ON "User"("schoolId", "email");

-- CreateIndex
CREATE INDEX "User_googleSub_idx" ON "User"("googleSub");

PRAGMA foreign_keys=ON;

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
