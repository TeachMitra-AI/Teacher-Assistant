-- CreateTable
CREATE TABLE "TeacherAttendanceActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "performedBy" TEXT,
    "action" TEXT NOT NULL,
    "result" TEXT,
    "lat" REAL,
    "lon" REAL,
    "distanceMeters" REAL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeacherAttendanceActivityLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TeacherAttendanceActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TeacherAttendanceActivityLog_schoolId_createdAt_idx" ON "TeacherAttendanceActivityLog"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "TeacherAttendanceActivityLog_userId_createdAt_idx" ON "TeacherAttendanceActivityLog"("userId", "createdAt");
