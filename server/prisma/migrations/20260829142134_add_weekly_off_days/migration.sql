-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SchoolAttendanceConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "openTime" TEXT NOT NULL,
    "closeTime" TEXT NOT NULL,
    "checkinWindowStart" TEXT NOT NULL,
    "checkinWindowEnd" TEXT NOT NULL,
    "weeklyOffDays" TEXT NOT NULL DEFAULT '0',
    "lateGraceMinutes" INTEGER NOT NULL DEFAULT 10,
    "halfDayThresholdPercent" INTEGER NOT NULL DEFAULT 50,
    "fullDayGraceMinutes" INTEGER NOT NULL DEFAULT 15,
    "earlyDepartureGraceMinutes" INTEGER NOT NULL DEFAULT 15,
    "geofenceLat" REAL NOT NULL,
    "geofenceLon" REAL NOT NULL,
    "geofenceRadiusMeters" INTEGER NOT NULL DEFAULT 180,
    "repeatPatternThreshold" INTEGER NOT NULL DEFAULT 3,
    "repeatPatternWindowDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SchoolAttendanceConfig_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SchoolAttendanceConfig" ("checkinWindowEnd", "checkinWindowStart", "closeTime", "createdAt", "earlyDepartureGraceMinutes", "fullDayGraceMinutes", "geofenceLat", "geofenceLon", "geofenceRadiusMeters", "halfDayThresholdPercent", "id", "lateGraceMinutes", "openTime", "repeatPatternThreshold", "repeatPatternWindowDays", "schoolId", "updatedAt") SELECT "checkinWindowEnd", "checkinWindowStart", "closeTime", "createdAt", "earlyDepartureGraceMinutes", "fullDayGraceMinutes", "geofenceLat", "geofenceLon", "geofenceRadiusMeters", "halfDayThresholdPercent", "id", "lateGraceMinutes", "openTime", "repeatPatternThreshold", "repeatPatternWindowDays", "schoolId", "updatedAt" FROM "SchoolAttendanceConfig";
DROP TABLE "SchoolAttendanceConfig";
ALTER TABLE "new_SchoolAttendanceConfig" RENAME TO "SchoolAttendanceConfig";
CREATE UNIQUE INDEX "SchoolAttendanceConfig_schoolId_key" ON "SchoolAttendanceConfig"("schoolId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
