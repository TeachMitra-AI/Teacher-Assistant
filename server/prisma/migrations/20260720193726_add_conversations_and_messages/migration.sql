-- Reconstructed to match the live dev.db exactly (see schema.prisma's
-- Conversation/Message doc comment): this migration was applied to dev.db
-- at some point but its file was never committed. Recreated verbatim from
-- `sqlite_master` so migration history and the database agree; no schema
-- change is actually being made by this file today.
-- CreateTable
CREATE TABLE IF NOT EXISTS "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "classLevel" TEXT,
    "subject" TEXT,
    "topic" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "language" TEXT,
    "classLevel" TEXT,
    "subject" TEXT,
    "topic" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Conversation_userId_idx" ON "Conversation"("userId");

-- CreateIndex
CREATE INDEX "Conversation_schoolId_idx" ON "Conversation"("schoolId");

-- CreateIndex
CREATE INDEX "Conversation_createdAt_idx" ON "Conversation"("createdAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Message_conversationId_role_createdAt_idx" ON "Message"("conversationId", "role", "createdAt");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");
