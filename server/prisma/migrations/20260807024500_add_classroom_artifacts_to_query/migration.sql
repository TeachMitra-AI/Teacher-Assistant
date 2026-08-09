-- Classroom Mode: persist the generated artifacts for a turn so reopening a
-- chat restores them rather than only offering to rebuild (D25, overturning
-- D11 for this one case).
--
-- Nullable and additive, like classroomPlan before it. Never selected in a
-- list query — see the schema comment and routes/queries.js.
ALTER TABLE "Query" ADD COLUMN "classroomArtifacts" TEXT;
