-- AlterTable
ALTER TABLE "Student" ADD COLUMN "rollNumberKey" TEXT;

-- Backfill with the same normalization as rollNumberKey() in src/lib/classroomStudents.js. Existing duplicates must not
-- fail this migration (`npm start` runs it before boot), so only the earliest active student in each group gets the key;
-- the rest stay NULL and rollNumber itself is untouched.
WITH "normalized" AS (
  SELECT
    "id",
    "classId",
    "createdAt",
    CASE
      WHEN trim("rollNumber") NOT GLOB '*[^0-9]*' THEN
        CASE WHEN ltrim(trim("rollNumber"), '0') = '' THEN '0' ELSE ltrim(trim("rollNumber"), '0') END
      ELSE lower(trim("rollNumber"))
    END AS "key"
  FROM "Student"
  WHERE "active" = 1 AND "rollNumber" IS NOT NULL AND trim("rollNumber") <> ''
),
"ranked" AS (
  SELECT "id", "key", ROW_NUMBER() OVER (PARTITION BY "classId", "key" ORDER BY "createdAt", "id") AS "position"
  FROM "normalized"
)
UPDATE "Student"
SET "rollNumberKey" = (SELECT "key" FROM "ranked" WHERE "ranked"."id" = "Student"."id")
WHERE "id" IN (SELECT "id" FROM "ranked" WHERE "position" = 1);

-- CreateIndex
CREATE UNIQUE INDEX "Student_classId_rollNumberKey_key" ON "Student"("classId", "rollNumberKey");
