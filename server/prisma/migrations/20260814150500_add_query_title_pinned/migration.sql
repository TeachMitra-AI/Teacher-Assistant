-- Add `title` (nullable) and `pinned` (defaulted false) to Query, backing the
-- Sidebar three-dot menu's Rename/Pin actions. A table rebuild rather than a
-- plain ALTER TABLE ... ADD COLUMN: SQLite can append a column that way, but
-- `pinned` is NOT NULL WITH a DEFAULT, which this project's schema differ
-- generates as a full redefinition rather than an in-place add. Data-preserving
-- either way — every existing row is copied through unchanged, and lands with
-- title = NULL, pinned = false (see schema.prisma's comments on both fields
-- for why each of those defaults is correct for pre-existing rows).
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Query" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "schoolId" TEXT,
    "queryText" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "context" TEXT,
    "responseText" TEXT NOT NULL,
    "responseTimeMs" INTEGER,
    "finishReason" TEXT,
    "classroomPlan" TEXT,
    "classroomArtifacts" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Query_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Query_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Query" ("classroomArtifacts", "classroomPlan", "context", "createdAt", "finishReason", "id", "language", "queryText", "responseText", "responseTimeMs", "schoolId", "userId") SELECT "classroomArtifacts", "classroomPlan", "context", "createdAt", "finishReason", "id", "language", "queryText", "responseText", "responseTimeMs", "schoolId", "userId" FROM "Query";
DROP TABLE "Query";
ALTER TABLE "new_Query" RENAME TO "Query";
CREATE INDEX "Query_userId_idx" ON "Query"("userId");
CREATE INDEX "Query_schoolId_idx" ON "Query"("schoolId");
CREATE INDEX "Query_createdAt_idx" ON "Query"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

