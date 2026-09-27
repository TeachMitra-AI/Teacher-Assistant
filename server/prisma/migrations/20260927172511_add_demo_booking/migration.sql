-- CreateTable
CREATE TABLE "DemoBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "date" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "cancelToken" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "DemoBooking_cancelToken_key" ON "DemoBooking"("cancelToken");

-- CreateIndex
CREATE INDEX "DemoBooking_date_startTime_status_idx" ON "DemoBooking"("date", "startTime", "status");
