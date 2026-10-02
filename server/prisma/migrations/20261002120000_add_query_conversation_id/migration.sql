-- AlterTable
ALTER TABLE "Query" ADD COLUMN "conversationId" TEXT;

-- CreateIndex
CREATE INDEX "Query_userId_conversationId_idx" ON "Query"("userId", "conversationId");
