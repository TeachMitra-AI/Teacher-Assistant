-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "region" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT NOT NULL,
    "classLevel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Subject_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Chapter_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Topic_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExamPaper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "classLevel" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "examType" TEXT NOT NULL DEFAULT 'annual',
    "setLabel" TEXT NOT NULL DEFAULT '',
    "totalMarks" INTEGER,
    "language" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExamPaper_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExamPaper_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "examPaperId" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "pageCount" INTEGER,
    "extractionState" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceDocument_examPaperId_fkey" FOREIGN KEY ("examPaperId") REFERENCES "ExamPaper" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "examPaperId" TEXT NOT NULL,
    "chapterId" TEXT,
    "boardId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "classLevel" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "questionNumber" TEXT NOT NULL,
    "parentQuestionId" TEXT,
    "requiresGroupSelection" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'en',
    "translationOfId" TEXT,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "options" TEXT,
    "marks" INTEGER NOT NULL,
    "difficulty" TEXT,
    "correctAnswer" TEXT,
    "hasOfficialAnswer" BOOLEAN NOT NULL DEFAULT false,
    "pageNumber" INTEGER,
    "hasDiagram" BOOLEAN NOT NULL DEFAULT false,
    "hasTable" BOOLEAN NOT NULL DEFAULT false,
    "rawExtraction" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'extracted',
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "extractionConfidence" REAL,
    "embedding" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Question_examPaperId_fkey" FOREIGN KEY ("examPaperId") REFERENCES "ExamPaper" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Question_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Question_parentQuestionId_fkey" FOREIGN KEY ("parentQuestionId") REFERENCES "Question" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Question_translationOfId_fkey" FOREIGN KEY ("translationOfId") REFERENCES "Question" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionTopic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ai',
    CONSTRAINT "QuestionTopic_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuestionTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionCluster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "label" TEXT,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "confirmedById" TEXT,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionCluster_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionClusterMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clusterId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "similarity" REAL,
    CONSTRAINT "QuestionClusterMember_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "QuestionCluster" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuestionClusterMember_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Board_code_key" ON "Board"("code");

-- CreateIndex
CREATE INDEX "Subject_boardId_classLevel_idx" ON "Subject"("boardId", "classLevel");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_boardId_classLevel_name_key" ON "Subject"("boardId", "classLevel", "name");

-- CreateIndex
CREATE INDEX "Chapter_subjectId_idx" ON "Chapter"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_subjectId_name_key" ON "Chapter"("subjectId", "name");

-- CreateIndex
CREATE INDEX "Topic_chapterId_idx" ON "Topic"("chapterId");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_chapterId_name_key" ON "Topic"("chapterId", "name");

-- CreateIndex
CREATE INDEX "ExamPaper_boardId_subjectId_classLevel_year_idx" ON "ExamPaper"("boardId", "subjectId", "classLevel", "year");

-- CreateIndex
CREATE INDEX "ExamPaper_status_idx" ON "ExamPaper"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaper_boardId_subjectId_year_examType_setLabel_key" ON "ExamPaper"("boardId", "subjectId", "year", "examType", "setLabel");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_examPaperId_key" ON "SourceDocument"("examPaperId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_checksum_key" ON "SourceDocument"("checksum");

-- CreateIndex
CREATE INDEX "SourceDocument_examPaperId_idx" ON "SourceDocument"("examPaperId");

-- CreateIndex
CREATE INDEX "Question_boardId_subjectId_classLevel_year_idx" ON "Question"("boardId", "subjectId", "classLevel", "year");

-- CreateIndex
CREATE INDEX "Question_chapterId_idx" ON "Question"("chapterId");

-- CreateIndex
CREATE INDEX "Question_examPaperId_idx" ON "Question"("examPaperId");

-- CreateIndex
CREATE INDEX "Question_reviewStatus_idx" ON "Question"("reviewStatus");

-- CreateIndex
CREATE INDEX "QuestionTopic_topicId_idx" ON "QuestionTopic"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionTopic_questionId_topicId_key" ON "QuestionTopic"("questionId", "topicId");

-- CreateIndex
CREATE INDEX "QuestionCluster_chapterId_idx" ON "QuestionCluster"("chapterId");

-- CreateIndex
CREATE INDEX "QuestionCluster_status_idx" ON "QuestionCluster"("status");

-- CreateIndex
CREATE INDEX "QuestionClusterMember_questionId_idx" ON "QuestionClusterMember"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionClusterMember_clusterId_questionId_key" ON "QuestionClusterMember"("clusterId", "questionId");
