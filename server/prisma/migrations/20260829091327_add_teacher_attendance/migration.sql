-- CreateTable
CREATE TABLE "SchoolAttendanceConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "openTime" TEXT NOT NULL,
    "closeTime" TEXT NOT NULL,
    "checkinWindowStart" TEXT NOT NULL,
    "checkinWindowEnd" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "TeacherAttendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "checkInAt" DATETIME,
    "checkInLat" REAL,
    "checkInLon" REAL,
    "checkInAccuracyMeters" REAL,
    "checkInDistanceMeters" REAL,
    "checkInDeviceId" TEXT,
    "checkOutAt" DATETIME,
    "checkOutLat" REAL,
    "checkOutLon" REAL,
    "checkOutAccuracyMeters" REAL,
    "checkOutDistanceMeters" REAL,
    "checkOutDeviceId" TEXT,
    "status" TEXT NOT NULL,
    "lateMinutes" INTEGER,
    "earlyDepartureMinutes" INTEGER,
    "workingMinutes" INTEGER,
    "shortfallMinutes" INTEGER,
    "leaveOrDutyCategory" TEXT,
    "leaveOrDutyReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeacherAttendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeacherAttendance_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeacherAttendanceReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attendanceId" TEXT NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeacherAttendanceReview_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "TeacherAttendance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeacherAttendanceReview_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SchoolHoliday" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SchoolHoliday_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolAttendanceConfig_schoolId_key" ON "SchoolAttendanceConfig"("schoolId");

-- CreateIndex
CREATE INDEX "TeacherAttendance_schoolId_date_idx" ON "TeacherAttendance"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherAttendance_userId_date_key" ON "TeacherAttendance"("userId", "date");

-- CreateIndex
CREATE INDEX "TeacherAttendanceReview_attendanceId_idx" ON "TeacherAttendanceReview"("attendanceId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolHoliday_schoolId_date_key" ON "SchoolHoliday"("schoolId", "date");
