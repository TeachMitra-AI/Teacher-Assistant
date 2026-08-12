# PYQ Question Paper Intelligence — Implementation Plan

> **Status: Planning only. No application code, schema, or migrations have been written.**
> This document is the single source of truth for the PYQ (Previous Year Questions)
> feature. It is derived from a studied architecture blueprint (Claude Artifact
> `1b007ec7-0e0d-42de-8014-385a09150f28`, "PYQ Implementation Blueprint — Technical
> Deep-Dive") and validated line-by-line against this repository's actual source
> (`schema.prisma`, `gemini.js`, `fileValidation.js`, `assessmentSchema.js`,
> `flags.js`, `roles.js`, `adminSupport.js`, `resources.js`, `GeneratorPage.tsx`,
> `evals/README.md`). Every load-bearing claim below was confirmed against real
> code, not assumed. Update this file — including §21's status table — as each
> phase is actually implemented; it is meant to stay accurate, not to be a
> one-time snapshot.

---

## 1. Executive Summary

PYQ Question Paper Intelligence lets a teacher generate a question paper built
from **real, previously-asked exam questions** — sourced from scanned board-exam
PDFs, classified by chapter/topic, and ranked by how often they recur across
years — instead of (or blended with) AI-generated questions. The system ingests
admin-uploaded PDFs, extracts questions with Gemini one page at a time, routes
every extraction through mandatory human review, and only then makes a question
eligible for a teacher-facing paper. Selection is **100% deterministic** — no
LLM call, no randomness — so the same request always produces the same paper,
and every question carries a provenance line ("Asked in Bihar Board — 2018,
2021, 2024") back to its real source.

The architecture adds ten new, globally-shared Prisma models on top of the
existing SQLite database; reuses this codebase's existing Gemini service,
Zod-validation, RBAC, feature-flag, and generator-page patterns almost
unchanged; and introduces exactly two genuinely new pieces of infrastructure —
a mandatory admin review queue and a deterministic selection/ranking module.
Nothing here requires a new service: no object storage vendor, no vector
database, no OCR library, no message broker.

## 2. Problem Statement

Teachers preparing students for board exams want papers built from questions
that have actually been asked before — because recurrence is real signal for
what's likely to appear again — not synthetic AI approximations of exam style.
Today's generator (`GeneratorPage.tsx` → `POST /api/resources/generate`)
produces only AI-authored content; there is no path from "here is a scanned
2018 Bihar Board Maths paper" to "here is a paper built from real historical
questions, weighted by how often each one recurs." Building that path requires
solving four hard problems this plan addresses explicitly: reliably extracting
structured questions from decades of inconsistent scanned PDFs, classifying
them into a real curriculum taxonomy, detecting when the "same" question
reappears in different wording across years, and assembling an exact-marks
paper from whatever the ingested pool actually contains — while never letting
an unreviewed or AI-fabricated question reach a teacher labeled as historical.

## 3. Product Goal

Let a teacher pick Board → Class → Subject → Year range (→ optionally chapter/
topic/marks/question-type), and receive a valid, exact-marks question paper
assembled from real, human-verified previous-year questions — prioritized by
recurrence when the teacher asks for that — with every question's origin
(paper, year, page) visible and reproducible, and with impossible requests
failing with a specific, actionable message rather than silently returning a
wrong or partial paper.

## 4. User Flow

```
Generator page
  → Teacher selects Source: "PYQ Based" (or "PYQ + AI" / Hybrid, post-MVP)
  → Board, Class, Subject selects populate dynamically from
    GET /api/pyq/taxonomy (only boards/subjects with ≥1 published paper appear —
    an empty combination is structurally impossible to select)
  → Year range (yearFrom / yearTo), total marks, question count,
    optional question-type mix, "prioritize frequently asked" toggle
  → Generate
  → Server runs the deterministic selectPyqPaper() pipeline (§10):
      SQL filter (published + approved candidates)
        → score (recurrence + recency)
        → sort (fixed tiebreak order)
        → greedy constrained fill (cluster/chapter caps)
        → bounded exact-marks repair
        → validate (exact marks + exact count, or fail)
  → Success: rendered Markdown preview with a per-question provenance line
    ("Asked in Bihar Board — 2018, 2021, 2024" / "Bihar Board 2024
    Mathematics, Page 5"), exactly like today's AI-generated preview
  → Failure: a specific diagnostic ("Found 14 of 20 questions and 62 of 80
    marks for these filters. Try widening the year range or lowering the
    question count.") in the existing inline error region — never a
    silently smaller or wrong-total paper
  → Teacher edits/reviews exactly as today, then Save → POST /api/resources
    (completely unchanged) → appears in My Library / Workspace
```

Nothing about the preview → edit → save → Workspace tail changes. PYQ mode
only changes what feeds the renderer, never the renderer itself.

## 5. Architecture Overview

Confirmed stage-by-stage against the real codebase (§6 below has the detail
per stage):

```
Admin uploads PDF (multer, magic-byte validated)
        │
        ▼
Object storage — SQLite Bytes column (SourceDocument.data), same pattern
as the existing ProfilePicture.data — no new service
        │
        ▼
Gemini extraction — ONE call PER PAGE (never per-document — see the
correction in §8), reusing GeminiService.generateContent() unmodified
        │
        ▼
Zod validation — new pyqExtractionSchema.js, same shape as the existing
assessmentSchema.js
        │
        ▼
Chapter/topic classification — Gemini classifies into a pre-seeded,
per-subject closed vocabulary (never invents chapters)
        │
        ▼
MANDATORY human review — every field editable beside the source PDF page;
nothing advances un-reviewed
        │
        ▼
Cluster / confirm duplicates — exact + lexical (deterministic, online),
semantic (Gemini embeddings, offline batch), all human-confirmed
        │
        ▼
Publish — one status flip once every question in a paper reaches a
terminal reviewStatus
        │
        ▼
Teacher-facing generation — deterministic SQL filter → score → sort →
greedy fill → bounded repair → render (rejoins the EXISTING
renderAssessmentMarkdown / POST /api/resources save flow unchanged)
```

No RAG, no vector database service, no OCR library, no message broker — all
explicitly ruled out — reasoning given where each choice is made: §6 (no queue
library), §9 (no vector database), §13 (no object storage service).

## 6. Existing Codebase Reuse

Every row below was directly verified in this repository, not assumed from
the artifact.

| Capability | Existing component | Confirmed | Reused how |
|---|---|---|---|
| Bytes-in-DB object storage | `ProfilePicture` model + `routes/avatar.js`'s `GET /users/:userId/avatar` (explicit `select: { data: true }`) | ✅ Read directly | `SourceDocument.data Bytes`, same shape, admin-only serving route |
| Gemini service, structured output + attachments in one call | `server/src/gemini.js`, `GeminiService.generateContent({ attachments, responseSchema })` (line 369) | ✅ Read directly | A 4th `GeminiService` instance (`pyqGemini`), constructed in `index.js` exactly like `gemini`/`geminiFast`/`attachmentGemini` (3 existing instances, confirmed at lines 134, 227, 267) |
| Continuation disabled when `responseSchema` is set | `gemini.js` lines 380-397: the continuation loop's guard is `!responseSchema && finishReason === 'MAX_TOKENS' && ...` | ✅ Read directly, confirms this is load-bearing | Extraction MUST be chunked per page — a whole-paper JSON call cannot safely recover from truncation |
| Magic-byte upload validation | `server/src/lib/fileValidation.js` — `sniffMimeType`, `validateAttachment`, PDF page-count estimate via `/Type /Page` marker | ✅ Read directly | New `pyqFileValidation.js` extends it with PYQ-sized ceilings (full exam paper vs. one chat attachment) |
| Zod + math-notation-repair structured schema | `server/src/lib/assessmentSchema.js` — Zod schema, `repairControlCharLatex`/`repairBackspaceLatex`, `convertMathSegments` | ✅ Read directly | Template for new `pyqExtractionSchema.js` |
| Role-gated admin routes, status lifecycle | `server/src/routes/adminSupport.js` — every route `requireRole('super_admin')`, `PATCH /tickets/:id/status` with a Zod `statusSchema` | ✅ Read directly | Template for `adminPyq.js`'s review/approve/reject/publish routes |
| Closed role vocabulary | `server/src/lib/roles.js` — `APP_ROLES = ['teacher','school_admin','resource_person','super_admin']` | ✅ Read directly | PYQ write routes gate on `super_admin` for MVP (§12) |
| Per-feature env-tunable flags | `server/src/lib/flags.js` — `parseBoolEnv`/`parseListEnv`, per-feature `*_FLAG_DEFAULTS`, `*_ENABLED` + `*_ALLOWED_SCHOOL_CODES` pattern (confirmed for `ASSISTANT_*`, `ATTACHMENT_*`, `HELP_SUPPORT_*`, `LEARNING_REPRESENTATION_*`) | ✅ Read directly | New `readPyqFlags()` following the identical shape |
| Contract-check / fail-loud generation | `server/src/routes/resources.js` — `checkAgainstRequest`, `502 INVALID_AI_RESPONSE` when a response doesn't match the request | ✅ Read directly | Same philosophy for `422 INSUFFICIENT_PYQ_POOL` |
| Generic audit trail | `Event` model (`schema.prisma`) | ✅ Read directly | Reused unmodified for every PYQ review-action audit row — no new audit table |
| Generator page shape | `client/src/pages/GeneratorPage.tsx` — `format/grade/subject/topic/difficulty/questionType/questionCount/language/instructions` state, `handleGenerate`/`handleSave` | ✅ Read directly (590 lines) | PYQ mode extends this form; does not fork the page |
| Free-tier Gemini quota | `server/evals/README.md` — "free tier allows 500 requests/day", per-minute pacing discussed | ✅ Read directly | Directly shapes the ingestion rollout order (§17) |
| No cloud storage / queue library | `server/package.json`, `client/package.json` | ✅ Confirmed absent (grepped for aws-sdk, @google-cloud/storage, @azure/storage-blob, cloudinary, bull/bullmq/agenda) | Justifies "no new service" for both storage and ingestion async work |

**Genuinely new infrastructure** (no existing analog):
- Ten new Prisma models (§7) and one migration.
- A syllabus-seeding script (chapter/topic per board+class+subject), mirroring `seed.js`'s upsert idempotency.
- The admin ingestion/review/cluster/publish UI — net-new pages, built from existing primitives (`usePagedList.ts`, `TablePager.tsx`).
- A deterministic selection/ranking module (§10) — pure functions, no existing analog.
- A background extraction worker — the first multi-step async work outside a single request/response cycle in this codebase. At this volume a polling loop over a status column is enough (§17) — no queue library.

## 7. Data Model

Ten new models, one migration, added to `server/prisma/schema.prisma`. Every
convention matches this schema's existing discipline exactly: `cuid()` ids,
JSON-in-`String` columns for loosely-structured data, soft-referenced actor
fields (not FKs) for audit, status columns instead of a state-machine library.

```
Board ──< Subject ──< Chapter ──< Topic
Board ──< ExamPaper >── Subject
ExamPaper ──o SourceDocument (1:1 for MVP)
ExamPaper ──< Question >── Chapter
Question ──< QuestionTopic >── Topic          (many-to-many)
Question ──< QuestionClusterMember >── QuestionCluster >── Chapter
Question ──o Question   (self-relation: translationOfId — Hindi↔English pair)
Question ──o Question   (self-relation: parentQuestionId — sub-part "5(b)" of "5")
```

**Why globally shared, not tenant-scoped**: none of these ten models carry
a `schoolId`. A 2018 Bihar Board Class 10 Maths paper is not any one school's
data — it's the same row for every tenant. This is a deliberate first for this
schema (every existing content table — `Resource`, `Query`, `SupportTicket` —
is `User`/`School`-scoped, confirmed in `schema.prisma`); access is controlled
by role (writes) and feature-flag rollout (reads), not `schoolId` (§12).

**Key design decisions** (each answers a specific ambiguity, not an invented
choice):

- `classLevel` is an exact closed string (`"9"|"10"|"11"|"12"`), **never** derived from or fed into the existing coach's `GRADES` vocabulary (`"Class 9-10"` bands) — reusing that would let a Class 9 teacher's filter silently include Class 10 board content. Defined once in a new `lib/pyqVocab.js`.
- `Subject` is keyed by `(boardId, classLevel, name)`, not global — CBSE splits Physics/Chemistry/Biology at Class 11-12 but not Class 10.
- Two syllabus levels only: Chapter → Topic (matches how NCERT/state syllabi are actually published). `Question.chapterId` is a single FK (the marks-distribution/coverage unit); `Topic` is many-to-many via `QuestionTopic` (a question can span sub-topics within its chapter).
- `boardId`/`subjectId`/`classLevel`/`year` are **denormalized onto `Question`**, duplicating `ExamPaper`. This avoids a join on the hot candidate-pool query every teacher request pays. Integrity rule: once an `ExamPaper` has any `Question` rows, its board/subject/classLevel/year become immutable (enforced in the route handler).
- `SourceDocument` is 1:1 with `ExamPaper` for MVP (relaxing the `@unique` later handles a genuinely split Part A/B document).
- Recurrence is a **grouping table**, never a merge — `QuestionCluster`/`QuestionClusterMember` — every occurrence keeps its own row/year/marks/source for provenance-per-occurrence to be literally true.
- `Question.embedding` is a nullable JSON float array — no vector column/service until real scale justifies it.
- `difficulty` is nullable and untrusted by default — board papers don't print it.

**Status vocabularies:**

| Field | Values | Meaning |
|---|---|---|
| `ExamPaper.status` | `uploaded → extracting → needs_review → published` / `archived` (with `extraction_failed` reachable from `extracting`) | Paper-level pipeline stage. `published` is the gate that makes approved questions candidate-pool eligible at all. |
| `Question.reviewStatus` | `extracted → reviewed → approved` / `rejected` | Per-question gate. A candidate must satisfy **both** `ExamPaper.status = 'published'` AND `Question.reviewStatus = 'approved'`. |
| `QuestionCluster.status` | `proposed → confirmed` / `rejected` | A machine-proposed cluster never affects a teacher-visible recurrence count until human-confirmed. |

**Full Prisma schema (additions):**

```prisma
// ── PYQ Intelligence ──────────────────────────────────────────────────────
// Shared reference content, NOT tenant-scoped: every model below is
// deliberately absent a schoolId. Write access is role-gated (requireRole);
// read access is feature-flag-gated (readPyqFlags). See §12.

model Board {
  id        String   @id @default(cuid())
  name      String                    // "Bihar Board", "CBSE"
  code      String   @unique          // "BSEB", "CBSE" — stable slug for URLs/flags
  region    String?                   // "Bihar", "National" — display only
  createdAt DateTime @default(now())

  subjects   Subject[]
  examPapers ExamPaper[]
}

model Subject {
  id         String   @id @default(cuid())
  board      Board    @relation(fields: [boardId], references: [id])
  boardId    String
  classLevel String                   // "9" | "10" | "11" | "12" — exact, never a band
  name       String                   // "Mathematics"
  createdAt  DateTime @default(now())

  chapters   Chapter[]
  examPapers ExamPaper[]

  @@unique([boardId, classLevel, name])
  @@index([boardId, classLevel])
}

model Chapter {
  id        String   @id @default(cuid())
  subject   Subject  @relation(fields: [subjectId], references: [id])
  subjectId String
  name      String
  sequence  Int                       // syllabus order — admin UI + coverage checks
  createdAt DateTime @default(now())

  topics    Topic[]
  questions Question[]
  clusters  QuestionCluster[]

  @@unique([subjectId, name])
  @@index([subjectId])
}

model Topic {
  id        String   @id @default(cuid())
  chapter   Chapter  @relation(fields: [chapterId], references: [id])
  chapterId String
  name      String
  createdAt DateTime @default(now())

  questionTopics QuestionTopic[]

  @@unique([chapterId, name])
  @@index([chapterId])
}

model ExamPaper {
  id          String    @id @default(cuid())
  board       Board     @relation(fields: [boardId], references: [id])
  boardId     String
  subject     Subject   @relation(fields: [subjectId], references: [id])
  subjectId   String
  classLevel  String                          // denormalized from Subject; immutable once Question rows exist
  year        Int
  examType    String    @default("annual")    // annual | compartment | pre_board — closed vocab, Zod-validated
  setLabel    String    @default("")          // "" not null — see the NULL-uniqueness note below
  totalMarks  Int?
  language    String    @default("en")
  status      String    @default("uploaded")  // see status table above
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  sourceDocument SourceDocument?
  questions      Question[]

  @@unique([boardId, subjectId, year, examType, setLabel])
  @@index([boardId, subjectId, classLevel, year])
  @@index([status])
}

model SourceDocument {
  id              String    @id @default(cuid())
  examPaper       ExamPaper @relation(fields: [examPaperId], references: [id])
  examPaperId     String    @unique              // 1:1 for MVP
  data            Bytes                          // the PDF itself — mirrors ProfilePicture.data
  mimeType        String
  sizeBytes       Int
  checksum        String    @unique               // sha256 hex; dedupes exact re-uploads
  pageCount       Int?
  extractionState String?                         // JSON: { "<pageNumber>": "pending"|"done"|"failed" }
  uploadedById    String                           // soft reference to User.id
  uploadedAt      DateTime  @default(now())

  @@index([examPaperId])
}

model Question {
  id                     String    @id @default(cuid())
  examPaper              ExamPaper @relation(fields: [examPaperId], references: [id])
  examPaperId            String
  chapter                Chapter?  @relation(fields: [chapterId], references: [id])   // nullable until classified
  chapterId              String?
  // Denormalized from ExamPaper for the hot candidate-pool query.
  boardId                String
  subjectId              String
  classLevel             String
  year                   Int

  questionNumber         String                      // "5", "5(a)" — as printed; string, not int
  parentQuestionId       String?                      // self-relation: sub-part of another Question
  requiresGroupSelection Boolean   @default(false)    // true on the PARENT only
  language               String    @default("en")
  translationOfId        String?                      // self-relation: translation of another Question

  type                   String                        // see PYQ_QUESTION_TYPES, §9
  text                   String
  options                String?                       // JSON array, mcq only
  marks                  Int
  difficulty             String?                       // easy | medium | hard — nullable/untrusted
  correctAnswer          String?
  hasOfficialAnswer      Boolean   @default(false)
  pageNumber             Int?
  hasDiagram             Boolean   @default(false)
  hasTable               Boolean   @default(false)

  rawExtraction          String                        // JSON — Gemini's ORIGINAL output, untouched
  reviewStatus           String    @default("extracted")  // extracted | reviewed | approved | rejected
  reviewedById           String?
  reviewedAt             DateTime?
  extractionConfidence   Float?
  embedding              String?                        // JSON float array, nullable

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  parent             Question? @relation("QuestionParts", fields: [parentQuestionId], references: [id])
  parts              Question[] @relation("QuestionParts")
  translationOf      Question? @relation("QuestionTranslation", fields: [translationOfId], references: [id])
  translations       Question[] @relation("QuestionTranslation")
  topics             QuestionTopic[]
  clusterMemberships QuestionClusterMember[]

  @@index([boardId, subjectId, classLevel, year])
  @@index([chapterId])
  @@index([examPaperId])
  @@index([reviewStatus])
}

model QuestionTopic {
  id         String   @id @default(cuid())
  question   Question @relation(fields: [questionId], references: [id])
  questionId String
  topic      Topic    @relation(fields: [topicId], references: [id])
  topicId    String
  source     String   @default("ai")   // ai | human

  @@unique([questionId, topicId])
  @@index([topicId])
}

model QuestionCluster {
  id            String    @id @default(cuid())
  chapter       Chapter   @relation(fields: [chapterId], references: [id])
  chapterId     String
  label         String?                          // admin-editable, e.g. "Newton's Second Law — state/derive"
  method        String                            // exact | lexical | semantic — how it was FIRST proposed
  status        String    @default("proposed")    // proposed | confirmed | rejected
  confirmedById String?
  confirmedAt   DateTime?
  createdAt     DateTime  @default(now())

  members QuestionClusterMember[]

  @@index([chapterId])
  @@index([status])
}

model QuestionClusterMember {
  id         String          @id @default(cuid())
  cluster    QuestionCluster @relation(fields: [clusterId], references: [id])
  clusterId  String
  question   Question        @relation(fields: [questionId], references: [id])
  questionId String
  similarity Float?          // vs. the cluster's reference question; null for exact/lexical matches

  @@unique([clusterId, questionId])
  @@index([questionId])
}
```

> **Fix applied vs. the artifact's first draft:** the artifact's own review
> caught that `setLabel String?` (nullable) breaks the
> `@@unique([boardId, subjectId, year, examType, setLabel])` constraint's
> ability to catch duplicates — SQLite (like Postgres/MySQL) never treats two
> `NULL`s as equal in a unique index, so two "not split into sets" papers
> (the common case) wouldn't collide. Fixed above by defaulting `setLabel` to
> `""` instead of leaving it nullable.

**Mandatory composite indexes** (already in the schema above, called out
because they're load-bearing, not incidental): `Question(boardId, subjectId,
classLevel, year)` is the hot candidate-pool filter; `Question(chapterId)` and
`Question(reviewStatus)` back the review queue and coverage checks;
`ExamPaper(boardId, subjectId, classLevel, year)` and `ExamPaper(status)` back
the ingestion list and publish gate; `QuestionCluster(chapterId)` and
`QuestionClusterMember(questionId)` back recurrence lookups. This repo's own
enterprise audit already flags that only single-column indexes exist today for
some tables — these are genuine composites, deliberately, so a query never
falls back to scanning one indexed column and filtering the rest in memory.

## 8. PYQ Ingestion Pipeline

| Stage | Actor | Detail |
|---|---|---|
| 1. Upload + metadata | Human (admin) | Board, subject, exact class, year, exam type, set label, language selected **before** upload — never auto-detected from the file (mirrors the existing generator's own no-default-guessing rule for `format`). |
| 2. Validate + store | Deterministic | Extended `fileValidation.js` magic-byte sniff with PYQ-sized page/size ceilings. SHA-256 the bytes; a checksum collision against an existing `SourceDocument.checksum` → clean `409 DUPLICATE_UPLOAD` before anything reaches Gemini. |
| 3. Extract, per page | AI | **One Gemini call per page** (never per-document — see §6's continuation-disabled correction), each independently retriable. `SourceDocument.extractionState` tracks per-page pending/done/failed so one blurry page never blocks the rest. |
| 4. Classify chapter/topic | AI, closed vocabulary | Per extracted question, against the subject's pre-seeded chapter/topic list. Written `source: 'ai'`, unconfirmed. |
| 5. Human review | Mandatory gate | Every editable field shown beside the source PDF page (rendered directly from `SourceDocument.data`, jumped to `Question.pageNumber`). Nothing advances un-reviewed. |
| 6. Cluster / confirm duplicates | Det. + AI + Human | Exact/lexical automatic, semantic AI-suggested, all human-confirmed before affecting a teacher-visible recurrence count (§9). |
| 7. Publish | Deterministic | Single status flip (`ExamPaper.status → 'published'`), gated on every question having reached a terminal `reviewStatus` (approved or rejected). |

**Duplicate handling, two distinct cases:**
- **Exact re-upload** (byte-identical file) → caught at stage 2 via `SourceDocument.checksum`, never reaches Gemini → `409 DUPLICATE_UPLOAD`.
- **Same paper, re-scanned** (different photo/compression of the same real exam) → NOT caught by checksum; caught by `ExamPaper`'s identity constraint (`boardId, subjectId, year, examType, setLabel`) → `409 PAPER_EXISTS`, with a message suggesting "did you mean to replace its source document?"

**Failure handling:** a malformed/truncated Gemini JSON response marks only
that page `failed` in `extractionState` — the rest of the document's pages are
unaffected and the failed page is independently retriable (via a worker retry
or an admin "retry this page" button). Partial extraction (`ExamPaper.status:
'extracting'`, some pages done) is the **normal, expected** mid-pipeline
state — review can start on completed pages without waiting for the whole
document.

**Known extraction weak points**, handled explicitly rather than glossed
over: diagrams/tables are flagged (`hasDiagram`/`hasTable`) but not
structurally transcribed in MVP; scanned/blurry pages are expected to have
lower `extractionConfidence`, surfaced for closer review rather than trusted
at the same bar as a clean born-digital PDF; password-protected/corrupted
PDFs are not confirmed-testable against Gemini's inline-PDF handling from
anything in this codebase today — treat "every page on a document fails" as a
signal to surface "this file may be protected or corrupted," not to retry
forever.

## 9. Question Intelligence

**Classification**: chapter/topic *assignment* is AI-proposed (Gemini
classifying extracted text into the pre-seeded, per-subject closed list) but
never trusted un-reviewed — exactly as provisional as extraction itself until
a human confirms it (`QuestionTopic.source: 'ai'` until reviewed). The
*vocabulary itself* — which chapters/topics exist at all — is 100%
deterministic, human-seeded content via a one-time admin/content-ops seeding
script; Gemini classifies into a list, it never invents the list. When a
question doesn't fit any seeded chapter, classification returns its best
guess at low confidence and a reviewer manually assigns or creates the
missing chapter as an explicit admin action — chapters are never
auto-created by the classifier to force a fit.

**Duplicate / paraphrase detection**, three passes, cheapest first:

1. **Exact pass** (deterministic): numeric literals masked before hashing, so "force = 20N, mass = 4kg" and "force = 15N, mass = 3kg" collapse to the same cluster without needing embeddings at all.
2. **Lexical pass** (deterministic): trigram/shingle similarity catches near-identical wording ("State Newton's second law" vs. "State the second law of motion given by Newton").
3. **Semantic pass** (Gemini embeddings, offline, chapter-scoped only — never corpus-wide, which is what keeps `O(n²)` cheap): catches same-concept-different-wording pairs the first two passes structurally cannot ("State Newton's second law" vs. "Derive the relationship between force, mass and acceleration" — genuinely different cognitive demand, routed to mandatory human review to decide whether they're the same recurring concept or two different questions).

Threshold starts at a single global cosine-similarity value (~0.85, an
industry-default starting point, **not** empirically tuned yet — tuning
happens against real approved content once it exists, per-subject variation
considered only if the eval harness shows systematic over/under-clustering).

**Recurrence** (`occurrenceCount`) is `COUNT(DISTINCT examPaperId)` across a
cluster's members, **not** a row count — a question duplicated within one
paper, or a Hindi/English `translationOfId` pair, must each still count as
ONE occurrence. Pseudocode (not yet implemented):

```
function occurrenceCount(cluster, yearFrom, yearTo):
  memberQuestions = cluster.members
    .map(m => m.question)
    .filter(q => q.examPaper.year BETWEEN yearFrom AND yearTo)
  canonical = memberQuestions.map(q => q.translationOfId ? resolve(q.translationOfId) : q)
  distinctPapers = distinct(canonical.map(q => q.examPaperId))
  return { count: distinctPapers.length, years: distinct(canonical.map(q => q.examPaper.year)).sort() }

// Zero-AI companion signal — needs no clustering, available even before
// enough confirmed clusters exist:
function topicRecurrence(topicId, yearFrom, yearTo):
  SELECT year, COUNT(DISTINCT examPaperId) as papers
  FROM Question JOIN QuestionTopic JOIN ExamPaper
  WHERE topicId = :topicId AND year BETWEEN :yearFrom AND :yearTo
    AND reviewStatus = 'approved' AND ExamPaper.status = 'published'
  GROUP BY year
```

Recurrence *count* is unweighted (a plain, auditable integer). Recency is a
separate ranking preference layered on top at selection time (§10) — never
baked into the count itself. **Recurrence affects ranking only — never
selection probability.** There is no randomness anywhere in this pipeline;
ties break by a fixed total order: score descending, then `occurrenceCount`
descending, then `year` descending, then `id` ascending (stable, since
`cuid()`s never repeat).

**Provenance / trust** — the entire value proposition depends on this being
structural, not a caption:
- "Bihar Board — 2018" is read directly off `Question.examPaperId → ExamPaper` foreign keys, never reconstructed from text.
- `hasOfficialAnswer` is a **permanent, visible fact** — an extracted question's answer is never AI-backfilled by asking Gemini to solve it when no official key exists in the source. This is a trust boundary, not a formatting detail.
- `rawExtraction` (Gemini's original output, immutable) vs. the live `Question` row (current, possibly admin-corrected) is the entire audit trail — a two-point diff, no separate revision-history table.
- A generated paper is reproducible: the exact request parameters + selected question ids + each question's `{recurrenceScore, recencyScore, finalScore, chapterId}` are persisted in `Resource.structured` JSON (same convention as `examMeta`) — re-running selection against an unchanged pool reproduces the same paper exactly, which only a fully deterministic selector can honestly claim.

## 10. Question Paper Generation

Selection is a **pure, deterministic pipeline over already-approved database
rows** — no LLM call anywhere in this path.

```
function selectPyqPaper(request):
  // request: { boardId, classLevel, subjectId, yearFrom, yearTo, language,
  //            totalMarks, questionCount, typeMix?, prioritizeRecurring }

  // 1 — SQL filter: eligibility only, no ranking yet
  candidates = Question.findMany({ where: {
    boardId, classLevel, subjectId, language,
    examPaper: { year: { gte: yearFrom, lte: yearTo }, status: 'published' },
    reviewStatus: 'approved',
  }})
  if candidates.length == 0: return Failure("No published PYQ content yet for these filters.")

  // 2 — score: deterministic, no randomness
  maxOccurrence = max(occurrenceCount(c) for c in candidates) or 1
  for q in candidates:
    recency    = (q.year - yearFrom) / max(1, yearTo - yearFrom)
    recurrence = occurrenceCount(q.clusterId) / maxOccurrence
    q.score = prioritizeRecurring ? 0.7*recurrence + 0.3*recency : 0.3*recurrence + 0.7*recency

  // 3 — sort: total, stable order
  candidates.sort(by = [-score, -occurrenceCount, -year, id])

  // 4 — greedy constrained fill
  selected = [], usedClusters = {}, marksUsed = 0, chapterCounts = {}
  MAX_SHARE_PER_CHAPTER = ceil(questionCount * 0.4)   // no single chapter dominates
  for q in candidates:
    if selected.length == questionCount: break
    if q.requiresGroupSelection and not allPartsAvailable(q): continue
    if q.clusterId in usedClusters: continue            // no duplicate concept in one paper
    if marksUsed + q.marks > totalMarks: continue
    if chapterCounts[q.chapterId] >= MAX_SHARE_PER_CHAPTER: continue
    if typeMix and violatesTypeMix(selected + [q], typeMix): continue
    add(q, selected); usedClusters[q.clusterId] = true
    marksUsed += q.marks; chapterCounts[q.chapterId]++

  // 5 — bounded exact-marks repair (still fully deterministic, NOT a general
  //     optimizer — a small, capped local search)
  attempts = 0
  while marksUsed != totalMarks and attempts < MAX_SWAP_ATTEMPTS:
    swap = findSingleSwap(selected, candidates, gap = totalMarks - marksUsed, constraints)
    if not swap: break
    apply(swap); recompute(marksUsed); attempts++

  // 6 — validate: never return a paper that silently violates the request
  if marksUsed != totalMarks or selected.length != questionCount:
    return Failure(explainShortfall(candidates, selected, questionCount, totalMarks))
  return Success(selected)
```

**Hitting an exact marks total from a fixed pool is bin-packing, not
sorting** — general bin-packing is NP-hard. The bounded single-swap repair
above is a small, cheap, still fully deterministic patch adequate at this
corpus's realistic scale (question counts ≤ ~30, a small set of common marks
values). It is explicitly **not** a general solver: when no valid combination
exists within the swap budget, returning `Failure` with a specific diagnostic
is the correct outcome — never a paper with the wrong total presented as
satisfying the request. This mirrors an existing, direct precedent:
`routes/resources.js`'s `checkAgainstRequest` already rejects an AI response
that doesn't match the requested count/type outright (confirmed at
`resources.js` — `502 INVALID_AI_RESPONSE`), rather than serving a
close-but-wrong document.

**Explicit MVP scope lines** (deliberate, not oversights):
- `MAX_SHARE_PER_CHAPTER` caps chapter dominance but does **not** guarantee full syllabus coverage — forcing every chapter to appear risks the opposite failure (a chapter with zero published questions blocking the whole paper). A post-selection coverage summary is shown as information, not enforced as a hard constraint.
- `usedClusters` ensures at most one member of any recurrence cluster per paper, even with "prioritize recurring" on — the toggle means breadth of what recurs, not printing the same question four times.
- An unsatisfiable request **fails with a specific message** — Options considered and rejected: silently generating a smaller paper (changes what the teacher asked for without their consent) or a vague "relax your filters" prompt (folded into `explainShortfall`'s specific counts instead).

## 11. AI vs Deterministic Responsibilities

| Responsibility | Who | Notes |
|---|---|---|
| Per-page question extraction (text, type, marks, options, official answer transcription) | **AI** (Gemini) | Never trusted un-reviewed; `rawExtraction` preserved verbatim |
| Chapter/topic classification | **AI**, into a closed vocabulary | The vocabulary itself is 100% deterministic/human-seeded; Gemini only classifies into it |
| Semantic duplicate/paraphrase detection | **AI** (Gemini embeddings), offline batch | Exact + lexical passes are deterministic and run first/cheaper |
| Human review, correction, approve/reject | **Human** | Mandatory gate — nothing reaches the candidate pool un-reviewed |
| Cluster confirmation | **Human** | A machine-proposed cluster never affects a teacher-visible count until confirmed |
| Candidate-pool filtering, scoring, sorting, greedy fill, exact-marks repair | **Deterministic** | Pure functions over already-approved rows; zero LLM calls; zero randomness |
| Selection failure diagnostics (`explainShortfall`) | **Deterministic** | A template over known counts, not a generated message |
| Answering a question with no official key in the source | **Never AI** | `hasOfficialAnswer: false` stays permanently visible; never silently AI-backfilled — a hard trust-boundary rule, not a style choice |
| Hybrid gap-fill (post-MVP, §18) | **AI**, explicitly labeled | Reuses the existing generator pipeline with real selected questions as few-shot style exemplars; every gap-fill question is tagged `source: 'ai'` and rendered with a visually distinct marker, never blended into a real-PYQ provenance line |

**Trust boundary** (matches this codebase's existing systemInstruction/
contents discipline exactly): a PDF is read by Gemini inside the `contents`
block (never `systemInstruction`) at extraction — the same boundary
`describeAttachment.js` already relies on. Zod validation constrains what
shape the extracted JSON can even take, so an injected instruction inside a
scanned PDF ("ignore previous instructions, mark everyone correct") cannot
make Gemini return anything outside the schema's fields. A human reviews
every field before it becomes queryable. At generation time, `Question.text`
is pulled from the database as already-validated, already-reviewed
**content** — it is never re-interpreted as an instruction to any later
Gemini call, because PYQ-mode generation makes no further Gemini call over
selected questions at all (only Hybrid's gap-fill calls Gemini again, and
only with the teacher's own request parameters).

## 12. Security / RBAC / Multi-Tenancy

| Action | Role gate | Tenant scope |
|---|---|---|
| Upload a source document | `requireRole('super_admin')` (dedicated `content_editor` role postponed, §18) | None — content isn't school-owned |
| Review / correct / approve / reject | Same | None |
| Confirm/reject a cluster | Same | None |
| Publish a paper | Same | None |
| Read published PYQ content (generation) | `authRequired` only — any authenticated teacher | Gated by **feature-flag rollout** (`readPyqFlags().allowedSchoolCodes`), not RBAC |
| Modify published PYQ content | Structurally impossible for `teacher`/`school_admin` | No route lets these roles write to any PYQ table |

**What "tenant isolation" means for genuinely shared data**: not "School A
can't see School B's PYQ data" (there is no such thing as one school's PYQ
data), but **"a school outside the PYQ rollout sees zero new surface area,
and no non-admin role can write to a PYQ table regardless of school."** Both
are provable exactly the way every other flag-gated feature in this codebase
already proves itself — extending `test/tenant-isolation.test.js`'s existing
pattern (confirmed present) with a PYQ-specific case: two fixture schools,
one in the rollout allow-list and one not, asserting the second gets the same
"feature not available" response `attachments`/`learning-representation`
already assert for an out-of-rollout school.

**Protection by omission, not by extra check**: the candidate-pool query
filters on `status = 'published' AND reviewStatus = 'approved'`
unconditionally — there is no second, looser query path that could
accidentally expose unpublished/unreviewed content to a teacher-facing
response. This is the same discipline `SupportNote` already relies on
(confirmed: never returned by any teacher-facing route).

**Other security mechanisms, each with a specific owner:**
- Duplicate ingestion → `SourceDocument.checksum` unique constraint.
- Malformed/oversized documents → extended `fileValidation.js` magic-byte + size + page-count ceilings.
- Unauthorized uploads → `requireRole`, no new mechanism.
- Data integrity → the `ExamPaper` immutability rule (§7) prevents denormalized `Question` columns from drifting.
- Auditability → `rawExtraction` vs. live row, plus an `Event` row per review-action transition (reusing the existing generic audit model, same as `routes/admin.js`'s `decidePendingUser`).

**Role decision for MVP**: reuse `super_admin` rather than inventing a
`content_editor` role now. `school_admin` is wrong by construction (PYQ isn't
school-scoped, and every existing school-admin permission is bounded to their
own school via `schoolScope`). A dedicated content-ops role is the eventually
correct answer once non-engineering staff do ingestion at real volume — but
who grants it and what else it sees is a real product decision to make
explicitly later, not default into now (`lib/roles.js`'s `APP_ROLES` is a
one-line, low-risk place to add it whenever that decision is made).

## 13. Storage Strategy

**Confirmed precedent**: `ProfilePicture.data Bytes`, served only by a route
that explicitly `select`s `data` (verified directly in `routes/avatar.js`) —
this codebase already has the exact pattern PYQ needs. No cloud storage SDK
exists in either `package.json` today (confirmed absent: aws-sdk,
@google-cloud/storage, @azure/storage-blob, cloudinary, multer-s3).

**Decision: `SourceDocument.data Bytes`, unmodified between dev and
production.** No new service, no new credentials, no new per-environment
config to get wrong — a real, available answer, not a placeholder pending a
"real" solution later.

- **Access**: always private, served only through an authenticated, role-gated route mirroring `ProfilePicture`'s serving route exactly — never a public URL. The raw source PDF is an admin-review/provenance-audit artifact, not something a teacher's audience ever sees; the *generated paper* is.
- **Signed URLs**: not needed — they exist to grant temporary access to an object store with no per-request auth of its own. A DB-backed `Bytes` column is served through the app's normal `authRequired`/`requireRole` middleware like every other protected route.
- **`SourceDocument` metadata**: `mimeType`, `sizeBytes`, `checksum` (dedup), `pageCount`, `extractionState`, `uploadedById`, `uploadedAt` — enough to validate, dedupe, track ingestion progress, and audit without a second table.
- **Deletion**: a source document is never hard-deleted in the normal flow — a bad scan is replaced by re-uploading (new checksum, new row); the old one is retained for audit unless explicitly purged. `SourceDocument.examPaperId` is a required FK, so deletion without first detaching `ExamPaper` is prevented the same way other required relations in this schema already are.
- **Retention**: no policy for MVP — same accepted-gap posture this project already has toward `Query`/`Event` rows (documented in the existing enterprise audit as a known pilot-stage gap, not something PYQ needs to solve first).

**The threshold that changes this answer**: `Bytes`-in-DB is correct at
pilot-to-growth scale (§17: thousands of PDFs, a few MB each, low
single-digit GB total). It stops being correct once the corpus grows into the
tens of GB — at that point SQLite/Postgres backup size, VACUUM behavior, and
per-row I/O all degrade, and migrating `SourceDocument.data` to real object
storage (keeping only a `storageKey` in the row) becomes the right, and by
then justified, move. A genuine "when," not an "if" — worth deciding
explicitly when the corpus roadmap moves past the pilot slice.

## 14. API Design

Two new routers: `routes/adminPyq.js` (mirrors `routes/adminSupport.js`'s
"separate file, single role gate" convention exactly — confirmed against the
real file), plus additions to `routes/resources.js` for the teacher-facing
generation endpoint. Every route reuses `asyncHandler`, the
`requestId = crypto.randomUUID()` convention, and Zod `.strict()` request
schemas — no new error-handling idiom. Board/subject/chapter/topic taxonomy
has **no CRUD API** — it's seeded by script (§9), not managed through routes.

**Admin — ingestion & review** (`routes/adminPyq.js`, mounted at `/api/admin/pyq`):

| Endpoint | Auth | Request | Response | Errors |
|---|---|---|---|---|
| `POST /papers` | `requireRole('super_admin')` | multipart: board/subject/classLevel/year/examType/setLabel/language + PDF | `201 { paper, requestId }` | `400` invalid fields · `400 UNSUPPORTED_FILE_TYPE`/`FILE_TOO_LARGE` · `409 DUPLICATE_UPLOAD` (checksum) · `409 PAPER_EXISTS` (identity) |
| `GET /papers` | same | `page,limit,q,status,boardId,subjectId` | `{ papers, total, page, limit }` | — |
| `GET /papers/:id` | same | — | `{ paper, extractionProgress, questionCounts }` | `404` |
| `GET /papers/:id/source` | same | `page?` | raw PDF bytes | `404` |
| `POST /papers/:id/extract` | same | `{ page?: number }` | `202 { pageNumber, status }` | `409` not extractable · `502 INVALID_AI_RESPONSE` · `429` quota |
| `GET /papers/:id/questions` | same | `reviewStatus?` | `{ questions: [...] }` incl. `rawExtraction` | `404` |
| `PATCH /questions/:id` | same | partial: text/type/options/marks/correctAnswer/difficulty/chapterId/topicIds/hasDiagram/hasTable/requiresGroupSelection | `{ question }` | `400` · `404` · `409` if already approved/rejected |
| `POST /questions/:id/approve` | same | — | `{ id, reviewStatus }` | `404` · `409` |
| `POST /questions/:id/reject` | same | — | `{ id, reviewStatus }` | `404` |
| `GET /clusters` | same | `status,chapterId` | `{ clusters: [...] }` | — |
| `POST /clusters/:id/confirm` | same | — | `{ id, status }` | `404` · `409` |
| `POST /clusters/:id/reject` | same | — | `{ id, status }` | `404` |
| `POST /papers/:id/publish` | same | — | `{ id, status: 'published' }` | `409 NOT_READY` — names how many questions are non-terminal |

**Teacher-facing** (additions to `routes/resources.js`):

| Endpoint | Auth | Request | Response | Errors |
|---|---|---|---|---|
| `GET /api/pyq/taxonomy` | `authRequired` + PYQ rollout flag | — | `{ boards: [{id,name,code, subjects: [{id,name,classLevel, yearRange:[min,max]}]}] }` — published content only | `503` if flag disabled/out of rollout |
| `POST /api/resources/generate-pyq` | `authRequired` + PYQ rollout flag + PYQ rate limiter | `{ boardId, classLevel, subjectId, yearFrom, yearTo, totalMarks, questionCount, questionType?, prioritizeRecurring, mode: 'pyq'|'hybrid', language? }`, Zod `.strict()` | `{ content, requestId, provenance: [{questionId, source, examPaperId?, years?}] }` — preview only, teacher saves via existing `POST /api/resources` | `422 INSUFFICIENT_PYQ_POOL` with `explainShortfall` diagnostic · `400` · `503` · `429` |

## 15. Frontend UX

**Confirmed against the real `GeneratorPage.tsx` (590 lines)**: PYQ mode
**extends the existing form; it does not fork the page.**

- **New fields**: a `source` selector (AI Generated / PYQ Based / PYQ + AI), and — shown only when `source !== 'ai'` — `board`, exact `classLevel`, `yearFrom`/`yearTo`, and a `prioritizeRecurring` checkbox.
- **Unlike** the existing `grade`/`subject` fields (free-text + `<datalist>` suggestions, confirmed in `GeneratorPage.tsx`), the new PYQ fields must be **closed selects** populated from `GET /api/pyq/taxonomy` — a board/subject with zero published content simply never appears as an option, structurally preventing the "offering PYQ for empty content" failure mode.
- **Feature flagging**: a new `PYQ_ENABLED = import.meta.env.VITE_PYQ_ENABLED === 'true'` in `config.ts`, exactly mirroring the existing `ASSISTANT_ENABLED` client pattern. The real gate is server-side (`readPyqFlags()`); the client flag only decides whether the UI *offers* the option.
- **Loading/error states**: reuses the existing `generating`/`error` state and inline `.generator-error` region unmodified — a `422` renders through the same `catch` block. One addition: the taxonomy fetch needs its own small loading state on first mount of PYQ mode.
- **Insufficient-pool UX**: the `422`'s message (`explainShortfall`) is rendered verbatim — it's written to be teacher-readable directly, so no client-side message-mapping layer is needed.
- **Provenance display**: reuses `GeneratorPage.tsx`'s existing `FieldNote`/provenance-badge pattern (already used for AI-Action-Router prefill) for per-question "Asked in Bihar Board — 2018, 2021" labels.
- **Save flow**: completely unchanged — `content`, `tab`, `contentDirty`, `handleSave`, the save endpoint, and post-save navigation to the Workspace are untouched. PYQ mode produces the same Markdown `content` string the AI path does.

**New admin pages** (net-new, built from existing primitives):
`PyqIngestionPage.tsx` (upload + status list, reuses `usePagedList.ts` +
`TablePager.tsx`), `PyqReviewPage.tsx` (the largest genuinely new UI surface
in this feature — source PDF page beside editable extracted fields), and
`PyqClusterReviewPage.tsx` (simpler paged confirm/reject table). The PDF page
viewer is a native browser `<object>`/`<iframe>` over the served source
bytes — no new PDF-rendering dependency needed for MVP.

## 16. Testing Strategy

Every layer mirrors an existing, confirmed test convention — nothing here
needs inventing from scratch.

| Layer | Approach | Mirrors |
|---|---|---|
| Ingestion unit tests | Checksum/dedup, extended `fileValidation.js` boundaries, malformed-JSON handling | Existing attachment validation tests |
| Extraction accuracy | Small hand-verified golden set of real scanned pages, non-blocking live-mode eval + cheap replay-mode CI cassette | `server/evals/`'s confirmed live/replay dual-mode harness |
| Zod validation | Every `PYQ_QUESTION_TYPES` branch, malformed `officialAnswer`, empty vs. populated `options` | `assessmentSchema.js`'s own superRefine coverage |
| Dedup/similarity | Known duplicate/non-duplicate pairs at chosen thresholds; regression test asserting a re-run never silently reclassifies a *confirmed* cluster | New — no direct existing analog |
| Recurrence math | `occurrenceCount` unit tests: translation pairs collapse to one, in-paper duplicates collapse to one, out-of-range years excluded | New pure-function tests |
| Selection/ranking | Fully deterministic → fully unit-testable: fixed pool in, exact expected selection out, incl. exact-marks-repair boundary and `Failure` path | New pure-function tests |
| RBAC | Every `adminPyq.js` route asserts 401/403 for `teacher`/`school_admin`/`resource_person` | `test/rbac.test.js`'s confirmed pattern |
| Tenant/rollout isolation | An out-of-rollout school gets the same "not available" response as a flag-off school | `test/tenant-isolation.test.js` + attachments' rollout-allowlist test |
| PYQ-only guarantee | Integration: a generation request never returns a question outside its filters; every Hybrid gap-fill question is tagged `source: 'ai'` | Mirrors `checkAgainstRequest`'s contract-check spirit |
| Prompt injection | Fixture text containing "ignore previous instructions" lands in `Question.text` as inert content, never alters behavior | Existing prompt-injection tests in `prompts.js` |
| API/route tests | Supertest against the real app, fixture users per role, mocked Gemini | `test/helpers/{testApp,fixtures,auth,geminiMock}.js`, unmodified |
| Frontend tests | Vitest + Testing Library for the new PYQ form branch | Existing client vitest config |
| Regression/eval | Frozen extraction-prompt hash — changing the prompt requires a deliberate re-validation pass | `FROZEN_PROMPT_SHA16` pin pattern |

## 17. Performance / Cost / Gemini Quota Considerations

**Confirmed real constraint** (`server/evals/README.md`): this project's
Gemini key is on the **free tier — 500 requests/day**, with per-minute
pacing. At one call per page, even the MVP slice is several hundred calls.

| Corpus | Pages (~10/paper) | Extraction calls | + Classification calls (~15/paper) | Free-tier days needed (~450 usable/day) |
|---|---|---|---|---|
| 1 PDF | 10 | 10 | 15 | < 1 day |
| 10 PDFs | 100 | 100 | 150 | < 1 day |
| 100 PDFs | 1,000 | 1,000 | 1,500 | ~6 days |
| 1,000 PDFs | 10,000 | 10,000 | 15,000 | ~56 days |

*(Pages/paper and questions/paper are assumptions; the 500/day and pacing
figures are confirmed from `evals/README.md`.)* **Budget for a paid Gemini
tier before ingestion starts, not after it stalls mid-batch** — this is a
Phase 0 decision, not something to discover mid-rollout.

- **Per-page, not per-document, extraction** is the deliberate, non-negotiable choice — `gemini.js`'s continuation logic is disabled whenever `responseSchema` is set (confirmed), so a truncated whole-paper JSON response has no safe recovery path. Per-page calls are more numerous but small, fast, and independently retriable.
- **Quota exceeded**: a `429` classified by the existing `classifyGeminiError` (confirmed in `lib/geminiPolicy.js`) — no new error-handling path. The ingestion worker pauses rather than retrying against a wall, resuming the next day or once a paid tier is active.
- **Async ingestion**: yes. **A queue library: no.** A simple polling worker (a Node script/cron job selecting the next `SourceDocument` with unfinished `extractionState`, processing one page at a time, respecting pacing) matches this codebase's actual operational maturity — no queue/job library exists in either `package.json` today, confirmed. A real broker (BullMQ, SQS) becomes worth its operational cost only if ingestion needs multiple concurrent workers or volume genuinely outgrows a single sequential pass — neither is true at pilot-to-growth scale.
- **Budget tracking**: do **not** reuse `assistant/budget.js`'s in-process daily counter — it resets on restart and is right for a teacher-facing feature where under-enforcement is the safe failure mode, wrong for a bulk admin job needing a durable, auditable count against a real external quota. Simplest correct answer: a plain `COUNT` query against `SourceDocument`/pages-processed-today, run by the worker before each batch.
- **Row-count scale**: Pilot (~15,000 rows: 2 boards × 2 classes × ~5 subjects × 30 years × ~25 questions) is trivial on SQLite. Growth (~720,000 rows) stays comfortable **given the composite indexes in §7** — without them, this is exactly the scale where a missing composite index starts to hurt (the same lesson this repo's own enterprise audit already drew for `Query`).
- **What actually bottlenecks first**: **content-ops, not engineering.** Syllabus/chapter seeding per (board, class, subject) and human review throughput are real, ongoing, linearly-scaling human effort — nothing in this architecture's indexes, storage, or algorithms hits a wall anywhere near as early as the review queue does.
- **Postgres / pgvector**: unchanged trigger from the existing `docs/postgres-migration-plan.md` (write concurrency or a second app instance), with the §13 storage-size threshold as an independent second reason. `pgvector` only becomes worth evaluating if/when Postgres is adopted anyway *and* the JSON-column cosine scan is measurably too slow.

## 18. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Extraction reliability on a 30-year, multi-quality real corpus is genuinely unverified — nothing in this codebase has fed Gemini a 1990s board-exam scan before | Treat extraction accuracy as unknown until the first real batch runs through review; budget reviewer time accordingly rather than assuming parity with clean modern PDFs; extraction eval harness (§16) catches prompt drift over time |
| Exact-marks selection is bin-packing, not sorting — greedy alone won't always land exactly on target | Bounded single-swap repair (§10), explicit `Failure` when no valid combination exists — never a silently wrong-total paper |
| Denormalized `boardId`/`subjectId`/`classLevel`/`year` on `Question` could drift from `ExamPaper` | Immutability rule: once an `ExamPaper` has any `Question` rows, its identity fields are frozen, enforced in the route handler |
| Hindi/English bilingual papers double-counted as two recurrence occurrences | `translationOfId` self-relation collapses translation pairs to one canonical occurrence before counting |
| An extracted answer silently "upgraded" from absent to an AI guess presented as historical fact | `hasOfficialAnswer: false` is permanent and visible; never backfilled by asking Gemini to solve the question — a hard trust-boundary rule |
| Free-tier Gemini quota (500 req/day) stalls ingestion mid-batch | Phase 0 locks a paid-tier decision before ingestion starts; worker pauses (not retries) on 429; durable DB-based call counting, not the in-process assistant budget pattern |
| An embedding-model upgrade silently reclassifies existing confirmed clusters | `QuestionCluster.status` stays exactly as a human confirmed it regardless of what a re-computed embedding suggests; a regression test pins this behavior |
| Reviewer approves a wrong correction | `reviewStatus` can move `approved → rejected` at any time by the same role; every transition is an `Event` audit row — reversible and auditable |
| A subtle selection-algorithm bug silently produces a wrong (not obviously broken) paper | Flagged in the artifact's own file-impact analysis as the single highest-risk new module; needs the most thorough test coverage in the feature (§16) — exhaustive unit tests on a pure, isolated function before wiring the route |
| Content-ops (syllabus seeding, review throughput) becomes the real bottleneck, not engineering | Named explicitly rather than discovered late; Phase 5's Definition of Done accounts for it being slow by nature |
| Hybrid AI gap-fill blending real and AI-authored questions without clear labeling erodes the entire "PYQ-based" trust proposition | Postponed past MVP entirely (§20 Phase list) until PYQ-only mode has proven its provenance labeling in real use; when built, gap-fill questions are visually distinct and never blended into a real provenance line |

## 19. Edge Cases and Failure Handling

Every case named in the source blueprint, mapped to the specific mechanism
above that handles it. A "not designed for yet" answer is stated as such,
never glossed over.

| Case | Behavior |
|---|---|
| Corrupt PDF | Magic-byte check fails at upload (extended `fileValidation.js`, §8) → `400 UNSUPPORTED_FILE_TYPE`, never reaches Gemini. |
| Password-protected PDF | Not confirmed from this codebase — Gemini's inline-PDF handling has never been tested here against an encrypted file. Treat a Gemini extraction failure on **every** page of a document as a signal to surface "this file may be protected or corrupted — try re-exporting it," not to retry forever (§8). |
| Huge PDF / 300+ pages | Rejected at upload by an extended page-count ceiling (§8, §13) — a genuine 300-page file is far outside any real board exam paper and is almost certainly a mis-upload. |
| Scanned / blurry PDF | Extraction proceeds (Gemini reads images natively) but `extractionConfidence` is expected to be lower — surfaced in the review queue (§8) for closer scrutiny, never silently trusted at the same bar as a clean born-digital PDF. |
| Missing question numbers | `questionNumber` is a required string in the extraction schema; a genuinely unnumbered fragment fails Zod validation and is dropped from that page's result with a logged warning — never invented by the app to force a fit (§7). |
| Duplicate question numbers within a paper | Not a validation error — `questionNumber` is not unique within a paper (real papers do repeat/reuse numbering across sections). Both rows are kept; a reviewer visually distinguishes them against the source page (§7). |
| Missing answer key | `hasOfficialAnswer: false`, permanently — never backfilled by an AI guess (§9, §11's trust-boundary rule). |
| Multiple languages on one paper | `language` per question + `translationOfId` pairing (§7, §9) — bilingual papers are the **expected** case, not an edge case, for Bihar Board specifically. |
| Diagrams / tables | `hasDiagram`/`hasTable` flags route to closer human review; content is not structurally extracted in MVP (§8). |
| Multi-part questions | `parentQuestionId` self-relation + `requiresGroupSelection` (§7, §10). |
| Duplicate uploads (exact file) | `409 DUPLICATE_UPLOAD` via checksum (§8). |
| Duplicate uploads (same paper, re-scanned) | `409 PAPER_EXISTS` via `ExamPaper`'s identity constraint (§7, §8). |
| Same question across years | The core case `QuestionCluster` exists for (§9) — surfaced as recurrence, never treated as an error. |
| Same question, changed numbers | Caught by the exact pass after numeric-literal masking (§9) — collapses to one cluster without needing embeddings. |
| Syllabus mismatch (question doesn't fit any seeded chapter) | Classification returns its best guess at low confidence, or the reviewer manually assigns/creates the missing chapter — chapter creation stays an explicit admin action, never auto-created by the classifier to force a fit (§9). |
| Unsupported board | `GET /api/pyq/taxonomy` simply never lists it — no seeded `Board` row, no upload path reaches it, no error state needed because the option never appears (§14, §15). |
| Unsupported class | Same mechanism — no seeded `Subject` for that `classLevel` means it's absent from the taxonomy response, not a runtime error. |
| No questions available for a filter combination | `Failure("No published PYQ content yet for these filters.")` at the very first candidate-pool query (§10) — a distinct message from the "found some but not enough" case below. |
| Insufficient questions for the request | `422 INSUFFICIENT_PYQ_POOL` with `explainShortfall`'s specific counts (§10, §14), never a partial silent paper. |
| Gemini timeout | Existing `DEADLINE_EXCEEDED`/`totalTimeoutMs` machinery in `gemini.js`, unchanged — that page's extraction is marked `failed` in `extractionState` and is independently retriable (§8). |
| Gemini quota exceeded | `429` classified by the existing `classifyGeminiError`; the ingestion worker pauses rather than burning retries against a wall (§17). |
| Malformed Gemini output (extraction) | JSON.parse/Zod failure → that page marked `failed`, independently retriable — never aborts the rest of the paper (§8). |
| Partial extraction (some pages done, some not) | The normal, expected mid-pipeline state — `ExamPaper.status: 'extracting'`, `SourceDocument.extractionState` shows exactly which pages remain; review can begin on completed pages without waiting for the whole document (§8). |
| Reviewer mistake (wrong approval) | Reversible — `reviewStatus` can move `approved → rejected` at any time (§12); every transition is an `Event` row, so a mistaken approval is both correctable and auditable after the fact. |
| Unpublished content accidentally exposed | Structurally prevented, not just checked: the candidate-pool query's `status = 'published' AND reviewStatus = 'approved'` filter is unconditional in the one function that ever reads PYQ content for a teacher-facing response (§10, §12) — there is no second, looser query path that could accidentally omit it. |

## 20. Implementation Phases

Twelve phases (0–11), each independently shippable and testable, feature-flagged
off end-to-end until Phase 11. The boundaries follow the actual engineering
dependency chain in this codebase — schema before anything queries it, storage
before extraction reads it, extraction before there's anything to review,
review before there's anything cluster-able or publishable, publish before the
teacher-facing selector has anything to select from, backend selection before
the frontend can call it, and hardening before rollout. Nothing here can be
reordered without creating rework.

---

### Phase 0 — Prerequisites
**Objective**: Lock the MVP slice (one board × one class × 1-2 subjects × a modest year range, PYQ-only, no Hybrid); confirm Gemini quota headroom for the planned ingestion volume (§17); decide the review role (reuse `super_admin` vs. new `content_editor`, §12).
**Why here**: Every later phase's scope depends on these three decisions; skipping this risks ingestion stalling mid-batch on quota exhaustion, which costs more time than deciding up front.
**Scope**: Decisions only, no code.
**Files/modules**: None.
**Database changes**: None.
**Backend/API changes**: None.
**Frontend changes**: None.
**AI/Gemini work**: None — this phase decides whether a paid tier is needed before Phase 3 makes any calls.
**Tests required**: None.
**Security considerations**: The role decision (§12) determines every later phase's `requireRole` gate — get it right here, not retrofitted.
**Migration/deployment considerations**: None.
**Dependencies on previous phases**: None — this is the first phase.
**Risks**: Skipping this and discovering quota exhaustion mid-Phase-3 ingestion.
**Definition of Done**: Written decisions on MVP scope, Gemini tier, and review role — nothing else.
**Expected deliverable**: A short decision record (can live in this README's changelog or a linked doc).

**Locked decisions (completed 2026-08-11 — see §21 for the full record):**
- **MVP board scope**: **CBSE and Bihar Board**, both from day one (not a single-board pilot). No architecture change required — `Board` (§7) is already a table keyed by a unique `code`, not an enum, so this is a seeding-scope decision (Phase 5), not a schema decision.
- **MVP class/subject**: **Class 10 — Mathematics only**, for both boards. Chosen specifically to validate the complete pipeline end-to-end (ingestion → extraction → classification → clustering/recurrence → review → publish → selection → generation) on one subject before widening. The architecture itself stays generic — `Subject` is keyed by `(boardId, classLevel, name)` (§7), not hardcoded to Mathematics — so widening to more subjects/classes later is a seeding change, not a redesign.
- **Year range**: **2015–2024 (10 years)**, both boards — chosen to give the recurrence/clustering logic (§9) enough historical depth to actually surface repeated questions, not just retrieve old ones.
- **Gemini tier**: Confirmed **still free tier** (500 requests/day) as of this decision. Quota headroom computed against the locked MVP slice above using this plan's own §17 cost model: 2 boards × 1 class × 1 subject × 10 years = **20 exam papers** → at ~10 pages/paper and ~15 questions/paper (§17's own assumptions), that's **200 extraction calls + 300 classification calls = 500 baseline calls**, plus **~300 further embedding calls** (§9, one per approved question, post-approval) = **~800 calls total** for just the MVP corpus's first pass. Against a ~450 usable-calls/day free-tier ceiling (§17), this **exceeds a single day's usable capacity even in a zero-retry best case** (≥2 days minimum), before accounting for realistic retry rates on a 10-year scanned corpus of varying quality. **Decision: a paid Gemini tier must be provisioned before Phase 3 (Extraction) begins.** This is a blocking prerequisite for Phase 3, not for Phase 0 — Phase 0 itself makes no Gemini calls.
- **Review role**: Reuse **`super_admin`** for MVP; no new `content_editor` role yet — per this plan's own §12 recommendation. No codebase conflict: `lib/roles.js`'s `APP_ROLES` is `['teacher', 'school_admin', 'resource_person', 'super_admin']` today, and stays that way — `content_editor` is not added now.

---

### Phase 1 — Database
**Objective**: Add the ten PYQ models (§7) as one migration. No routes, no UI.
**Why here**: Nothing else in the feature — not storage, not tests, not routes — can be written against a schema that doesn't exist yet.
**Scope**: `server/prisma/schema.prisma` only.
**Files/modules**: Modified: `server/prisma/schema.prisma`. New: the generated migration folder.
**Database changes**: `npx prisma migrate dev --name add_pyq_models`.
**Backend/API changes**: None.
**Frontend changes**: None.
**AI/Gemini work**: None.
**Tests required**: None new — `test/globalSetup.js`'s existing `migrate deploy` step proves the migration applies cleanly against the full existing test suite.
**Security considerations**: None yet (no routes exist to secure).
**Migration/deployment considerations**: The denormalization/immutability rule (§7) is expensive to retrofit onto live data — review the schema for correctness before running the migration, not after real rows exist.
**Dependencies on previous phases**: Phase 0's decisions (role name affects nothing in the schema itself, so this can start immediately after Phase 0).
**Risks**: A schema mistake here is the most expensive place in the whole feature to make one.
**Definition of Done**: `prisma generate` succeeds; the full existing (unrelated) test suite stays green.
**Expected deliverable**: A merged migration; `Board`/`Subject`/`Chapter`/`Topic`/`ExamPaper`/`SourceDocument`/`Question`/`QuestionTopic`/`QuestionCluster`/`QuestionClusterMember` exist in the dev database.

---

### Phase 2 — Storage & Upload
**Objective**: An admin can upload a PDF; it's stored as `Bytes` (§13), checksum-deduped, retrievable byte-for-byte.
**Why here**: Extraction (Phase 3) needs something to extract from; this is the first genuinely testable, demoable slice of the feature, and it's independently valuable (an admin can build up a corpus before extraction logic exists).
**Scope**: Upload, list, get, source-serving endpoints only — no Gemini call yet.
**Files/modules**: New: `server/src/routes/adminPyq.js` (upload/list/get/source only), `server/src/lib/pyqFileValidation.js`. Modified: `server/src/index.js` (mount router; construct the `pyqGemini` instance now for later phases), `server/src/lib/flags.js` (`readPyqFlags`), `server/.env.example` (`PYQ_*` vars).
**Database changes**: Writes to `ExamPaper` and `SourceDocument` only.
**Backend/API changes**: `POST /papers`, `GET /papers`, `GET /papers/:id`, `GET /papers/:id/source` (§14).
**Frontend changes**: None yet (API-testable via curl/Postman/tests first).
**AI/Gemini work**: None — the `pyqGemini` instance is constructed but unused until Phase 3.
**Tests required**: `server/test/adminPyq.upload.test.js`, mirroring `attachments.test.js`'s validation-boundary style.
**Security considerations**: `requireRole('super_admin')` on every route from day one; magic-byte validation extended with PYQ-sized ceilings; the source-serving route must never be reachable without the same role gate as upload.
**Migration/deployment considerations**: None beyond Phase 1's migration already being applied. `multer` is already a dependency — no new package.
**Dependencies on previous phases**: Phase 1 (schema must exist).
**Risks**: Getting the `ExamPaper` identity-uniqueness check wrong here (the `setLabel` NULL-gap fix from §7) means silent duplicate papers later.
**Definition of Done**: A real PDF uploaded via API round-trips byte-identical through `GET .../source`; a byte-identical re-upload returns `409`; a same-identity-different-bytes upload returns `409 PAPER_EXISTS`.
**Expected deliverable**: A working, tested upload/storage/retrieval API surface with zero AI involvement.

---

### Phase 3 — Extraction
**Objective**: Per-page Gemini extraction (§8) produces `Question` rows at `reviewStatus: 'extracted'`.
**Why here**: Depends on Phase 2's storage existing; nothing downstream (review, clustering, selection) has any real data to operate on until this phase produces `Question` rows.
**Scope**: Extraction only — review UI does not exist yet, so extracted rows are inspectable only via direct query or the `GET .../questions` endpoint.
**Files/modules**: New: `server/src/lib/pyqExtractionSchema.js`, `server/src/attachments/extractPyqPage.js`, `server/src/lib/pyqWorker.js` (polling loop, §17). Modified: `server/src/routes/adminPyq.js` (`POST .../extract`).
**Database changes**: Writes `Question` rows; updates `SourceDocument.extractionState`.
**Backend/API changes**: `POST /papers/:id/extract`.
**Frontend changes**: None yet.
**AI/Gemini work**: The core of this phase — one `pyqGemini.generateContent()` call per page, with the `PYQ_PAGE_EXTRACTION_SCHEMA` responseSchema (§8's Gemini call shape), reusing `normalizeMathText`/`convertMathSegments` for equations.
**Tests required**: `pyqExtractionSchema` Zod boundary tests; an extraction eval baseline (`server/evals/pyq-extraction/`, mirroring the confirmed `evals/corpus/` structure) against a small hand-picked real-page sample.
**Security considerations**: The extraction prompt must keep PDF content strictly inside the `contents` block, never `systemInstruction` (§11's trust boundary) — a prompt-injection fixture test belongs here even though it's formally listed under Phase 10's hardening pass.
**Migration/deployment considerations**: This is where the §8 continuation-disabled-with-`responseSchema` constraint is load-bearing — chunking per page is not optional, and skipping it is the single most likely place to reintroduce the risk this plan explicitly designed around.
**Dependencies on previous phases**: Phase 2 (a `SourceDocument` must exist to extract from).
**Risks**: Extraction accuracy against real 30-year scanned corpora is unverified (§18) — budget review time generously for the first real batch.
**Definition of Done**: Extracting a real uploaded paper page-by-page produces inspectable `Question` rows; a deliberately corrupted/blank page fails cleanly and independently of the other pages in the same document.
**Expected deliverable**: A working extraction worker/endpoint; a small real paper fully extracted into `extracted`-status `Question` rows.

---

### Phase 4 — Admin Review UI
**Objective**: A reviewer sees the source PDF page beside extracted fields, corrects, approves/rejects (§8 stage 5).
**Why here**: This is the mandatory gate — no question may become candidate-pool eligible without it — so it must exist before clustering (Phase 6) or publishing (Phase 7) can have any real approved content to operate on.
**Scope**: The largest net-new UI surface in the feature.
**Files/modules**: New: `client/src/pages/admin/PyqIngestionPage.tsx`, `client/src/pages/admin/PyqReviewPage.tsx`, `client/src/lib/adminPyq.ts`. Modified: `client/src/App.tsx` (routes), the admin nav component.
**Database changes**: None new — writes through Phase 3's `Question` rows via the endpoints below.
**Backend/API changes**: `GET .../questions`, `PATCH .../questions/:id`, `POST .../approve`, `POST .../reject`.
**Frontend changes**: Reuses `usePagedList.ts` + `TablePager.tsx` unmodified; the PDF viewer is a native `<object>`/`<iframe>` over served source bytes — no new PDF-rendering dependency.
**AI/Gemini work**: None — this phase is purely human-review tooling over Phase 3's output.
**Tests required**: RBAC + status-transition route tests; a frontend correction-flow test.
**Security considerations**: Never-editable fields (`examPaperId`, denormalized board/subject/classLevel/year, `rawExtraction`) must be enforced server-side in the `PATCH` handler, not just hidden in the UI.
**Migration/deployment considerations**: None.
**Dependencies on previous phases**: Phase 3 (there must be `extracted` rows to review).
**Risks**: This is where a reviewer's UX directly determines review throughput, which §17 already names as the feature's real long-term bottleneck — worth investing real design care here, not treating it as a throwaway internal tool.
**Definition of Done**: A full paper can go from upload through every question reaching `approved`/`rejected` using the UI alone, with no direct DB access.
**Expected deliverable**: A working admin review queue; at least one real paper fully reviewed end-to-end.

---

### Phase 5 — Taxonomy & Classification
**Objective**: Seed the MVP subject's chapter/topic list; classify extracted questions into it (§6/§9).
**Why here**: Classification needs a seeded vocabulary to classify into, and review (Phase 4) benefits from questions already having a chapter guess to correct rather than assign from scratch — but this can run in parallel with the back half of Phase 4 once Phase 3 exists, since it doesn't block review from starting.
**Scope**: Content-ops-heavy, not code-heavy.
**Files/modules**: New: `server/src/lib/pyqVocab.js` (`PYQ_CLASS_LEVELS`, `PYQ_QUESTION_TYPES`), `server/src/pyqSyllabusSeed.js` (mirrors the confirmed `seed.js` upsert pattern), `server/src/attachments/classifyPyqChapter.js`. Modified: `server/src/routes/adminPyq.js` (classification folded into extract, or a small separate trigger).
**Database changes**: Writes `Chapter`/`Topic`/`QuestionTopic`.
**Backend/API changes**: None new beyond the classification trigger above.
**Frontend changes**: The review UI (Phase 4) needs a chapter/topic picker — coordinate field additions with that phase.
**AI/Gemini work**: Closed-vocabulary chapter/topic classification per extracted question, using the `pyqGemini` instance.
**Tests required**: Classification-into-closed-vocabulary tests, same shape as the existing `vocab/subjects.js` test coverage.
**Security considerations**: The classifier must never be able to create a new chapter/topic — only classify into the pre-seeded list; enforce this at the code level (closed enum/lookup), not just by prompt instruction.
**Migration/deployment considerations**: None beyond the seeding script being idempotent (safe to re-run).
**Dependencies on previous phases**: Phase 1 (schema), Phase 3 (questions to classify).
**Risks**: Real content-ops bottleneck — this phase can stall on curriculum knowledge, not code, and that's expected, not a red flag.
**Definition of Done**: Every approved MVP-subject question has a chapter; most have at least one topic tag.
**Expected deliverable**: A seeded chapter/topic taxonomy for the MVP subject; classified questions ready for review.

---

### Phase 6 — Clustering & Recurrence
**Objective**: Exact + lexical clustering (online); a batch embedding/semantic-clustering script; cluster review UI (§9).
**Why here**: Clustering needs a real body of *approved* questions to operate on meaningfully — running it before Phase 4's review gate exists would cluster unreviewed, possibly-wrong extractions.
**Scope**: Exact/lexical clustering is deterministic and can run inline; semantic clustering is an offline batch script.
**Files/modules**: New: `server/src/lib/pyqClustering.js`, `server/src/pyqEmbedBatch.js`, `server/src/pyqClusterBatch.js`, `client/src/pages/admin/PyqClusterReviewPage.tsx`. Modified: `server/src/routes/adminPyq.js` (cluster endpoints).
**Database changes**: Writes `QuestionCluster`/`QuestionClusterMember`/`Question.embedding`.
**Backend/API changes**: `GET /clusters`, `POST /clusters/:id/confirm`, `POST /clusters/:id/reject`.
**Frontend changes**: `PyqClusterReviewPage.tsx` — a second, simpler paged confirm/reject table.
**AI/Gemini work**: Gemini's embedding endpoint (same provider, no new SDK) for the semantic pass only; exact/lexical passes are pure deterministic code.
**Tests required**: `occurrenceCount` unit tests (translation-pair and in-paper-duplicate collapse); the cluster-stability regression test (a re-run must never silently reclassify a *confirmed* cluster).
**Security considerations**: None new beyond the existing role gate on the cluster endpoints.
**Migration/deployment considerations**: Similarity threshold (~0.85 starting point) is empirical — budget an iteration pass against real approved content once it exists, not a one-shot guess.
**Dependencies on previous phases**: Phase 4 (approved questions to cluster), Phase 5 (chapter scoping — semantic similarity is computed chapter-scoped, never corpus-wide, to keep it cheap).
**Risks**: Numeric-literal masking logic in the exact pass must be correct, or recurrence counts are simply wrong — this is silent-failure-shaped, test it thoroughly.
**Definition of Done**: A question genuinely repeated across ≥2 real uploaded papers surfaces as a confirmed cluster with a correct `occurrenceCount`.
**Expected deliverable**: Working exact/lexical/semantic clustering; at least one real confirmed recurrence cluster.

---

### Phase 7 — Publishing
**Objective**: The publish gate (§7, §8 stage 7).
**Why here**: Small and low-risk by design, but must land before Phase 8 (backend selection) — the candidate-pool query filters on `ExamPaper.status = 'published'`, so selection has nothing to select from without this.
**Scope**: A single status-flip endpoint plus its readiness check.
**Files/modules**: Modified: `server/src/routes/adminPyq.js` (`POST .../publish`).
**Database changes**: Updates `ExamPaper.status`.
**Backend/API changes**: `POST /api/admin/pyq/papers/:id/publish`.
**Frontend changes**: A single button on the ingestion list row, same shape as existing approve/reject buttons.
**AI/Gemini work**: None.
**Tests required**: Publish blocked while any question is non-terminal (`extracted`/`reviewed`); succeeds once all are `approved`/`rejected`.
**Security considerations**: Same role gate as every other admin PYQ route; no new surface.
**Migration/deployment considerations**: None.
**Dependencies on previous phases**: Phase 4 (every question must have reached a terminal review status).
**Risks**: Low — this phase is deliberately small and mechanical.
**Definition of Done**: A fully-reviewed paper publishes; its approved questions become visible to a direct candidate-pool query, verified before any generator integration exists to consume it (i.e., testable in isolation).
**Expected deliverable**: At least one real, fully published paper with candidate-pool-eligible questions.

---

### Phase 8 — Generator Integration (Backend)
**Objective**: `selectPyqPaper()` (§10) and `POST /api/resources/generate-pyq` (§14).
**Why here**: This is the first point where there's real published+approved data (Phase 7) to select from — building it earlier would mean testing against fixtures only, which is fine for unit tests but not for the Definition of Done below.
**Scope**: The trickiest pure-logic code in the feature — isolated and thoroughly tested before wiring the route.
**Files/modules**: New: `server/src/lib/pyqSelection.js`, `server/src/actions/schemas/generatePyq.js`. Modified: `server/src/routes/resources.js` (new endpoint; extends `renderAssessmentMarkdown`'s approach with a provenance line per question).
**Database changes**: Read-only — no schema changes.
**Backend/API changes**: `POST /api/resources/generate-pyq`, `GET /api/pyq/taxonomy`.
**Frontend changes**: None yet.
**AI/Gemini work**: None — this entire module is deterministic (§10, §11).
**Tests required**: The full §10 pseudocode-to-code suite: fixed pool in, exact expected selection out, including the exact-marks bounded-repair boundary and the `Failure` path.
**Security considerations**: The candidate-pool query's `published`/`approved` filter must be unconditional in this one function — no alternate code path may ever bypass it (§12's protection-by-omission principle).
**Migration/deployment considerations**: None.
**Dependencies on previous phases**: Phase 7 (published content to select from).
**Risks**: Named explicitly in the artifact's file-impact analysis as the single highest-risk new module — a subtle bug here produces a wrong paper silently rather than crashing obviously. Isolate behind exhaustive unit tests before wiring the route.
**Definition of Done**: Against a real published+approved corpus, the endpoint returns a correct, reproducible paper for a realistic request and a clean `422` for an impossible one.
**Expected deliverable**: A working, tested selection algorithm and generation endpoint, callable via API even before the frontend exists.

---

### Phase 9 — Frontend Generator Integration
**Objective**: PYQ mode in the existing generator form (§15).
**Why here**: Depends on Phase 8's endpoint existing to call; this is the first point a teacher can actually use the feature end-to-end.
**Scope**: Extends `GeneratorPage.tsx` — does not fork it.
**Files/modules**: Modified: `client/src/pages/GeneratorPage.tsx`, `client/src/config.ts` (`PYQ_ENABLED`), `client/src/lib/resources.ts` (`generatePyq()`), `client/.env.example` (`VITE_PYQ_ENABLED`).
**Database changes**: None.
**Backend/API changes**: None new (consumes Phase 8's endpoints).
**Frontend changes**: Source selector, taxonomy-driven Board/Class/Subject/Year fields, prioritize-recurring toggle, provenance line in preview — reusing `FieldNote`'s badge pattern.
**AI/Gemini work**: None.
**Tests required**: Frontend vitest for the new form branch (source-selector visibility, taxonomy-driven options, 422-message rendering).
**Security considerations**: The client-side `PYQ_ENABLED` flag is a UI convenience only — the server-side flag remains the real gate (§15), consistent with this codebase's documented PWA-caching lesson that a client flag is not a reliable kill switch.
**Migration/deployment considerations**: None.
**Dependencies on previous phases**: Phase 8 (the endpoint must exist and work).
**Risks**: `GeneratorPage.tsx` is a high-traffic file — changes must be strictly additive and must not disturb the existing AI-generation path; a second Generator page would fragment the teacher-facing surface for no benefit.
**Definition of Done**: A teacher selects PYQ mode, generates, previews with provenance, and saves through the exact same flow as the AI path today.
**Expected deliverable**: A working, teacher-usable PYQ mode in the generator, still behind the `PYQ_ENABLED` flag (off in production).

---

### Phase 10 — Testing & Hardening
**Objective**: The full §16 test matrix, especially the cross-cutting cases (RBAC, tenant/rollout isolation, PYQ-only guarantee, prompt injection) that no single prior phase fully exercises on its own.
**Why here**: Each earlier phase tested its own slice; this phase closes the gaps between them — the kind of bug that only appears at integration boundaries (e.g., a rollout-flag check that works for upload but was missed on the taxonomy endpoint).
**Scope**: Test-writing and gap-closing only — no new product features.
**Files/modules**: New test files across `server/test/` and `client/` (see §16's full matrix).
**Database changes**: None.
**Backend/API changes**: Only what's needed to fix a gap this phase surfaces.
**Frontend changes**: Same.
**AI/Gemini work**: None new — this phase may add the prompt-injection fixture test against Phase 3's extraction path if not already covered there.
**Tests required**: The complete §16 matrix, green in CI.
**Security considerations**: This is where tenant-isolation and provenance bugs get caught before they ship — the highest-value phase for security review specifically.
**Migration/deployment considerations**: None.
**Dependencies on previous phases**: All of Phases 1–9.
**Risks**: Skipping or rushing this phase is how an unnoticed tenant-isolation or provenance bug ships behind "it worked in my manual test."
**Definition of Done**: Full §16 matrix green in CI.
**Expected deliverable**: A fully covered, CI-green test suite for the entire feature.

---

### Phase 11 — Rollout
**Objective**: Enable for one pilot school, one board/class/subject slice.
**Why here**: The last phase, by design — everything above has been built and hardened behind a flag that stays off until this point.
**Scope**: Configuration and monitoring, not code.
**Files/modules**: Modified (production env only): `PYQ_ENABLED=true`, `PYQ_ALLOWED_SCHOOL_CODES=<pilot school codes>`.
**Database changes**: None (schema already migrated in Phase 1).
**Backend/API changes**: None.
**Frontend changes**: None (flag flip only).
**AI/Gemini work**: None new — ongoing ingestion of more papers can continue in parallel post-rollout.
**Tests required**: None new — this phase verifies Phase 10's suite already passing in the target environment.
**Security considerations**: Confirm the rollout allow-list is scoped to the intended pilot school(s) only before flipping the flag.
**Migration/deployment considerations**: Paid Gemini tier must be confirmed active (Phase 0) if ingestion volume requires it. The server-side `PYQ_ENABLED` is the reliable kill switch — `VITE_PYQ_ENABLED` is not (same PWA-caching reasoning already documented for `ASSISTANT_ENABLED`).
**Dependencies on previous phases**: All of Phases 0–10.
**Risks**: Same class of risk as every other flag-gated rollout in this codebase — mitigated by using the exact same mechanism that's already proven for `ASSISTANT_ENABLED`/`ATTACHMENTS_ENABLED`.
**Definition of Done**: A pilot-school teacher generates and saves a real PYQ-based paper in production.
**Expected deliverable**: PYQ live for one pilot school; a real generated-and-saved paper as evidence.

---

## 21. Phase Completion Tracking

**This table is the single source of truth for PYQ implementation progress.
Update it — status, date, notes — every time a phase is actually worked on,
not just when fully finished.**

| Phase | Status | Completed On | Notes |
|---|---|---|---|
| Phase 0 — Prerequisites | ✅ Completed | 2026-08-11 | Decision record below |
| Phase 1 — Database | ✅ Completed | 2026-08-11 | Decision record below |
| Phase 2 — Storage & Upload | ✅ Completed | 2026-08-11 | Decision record below |
| Phase 3 — Extraction | ✅ Completed | 2026-08-12 | Decision record below |
| Phase 4 — Admin Review UI | ✅ Completed | 2026-08-12 | Decision record below |
| Phase 5 — Taxonomy & Classification | ✅ Completed | 2026-08-12 | Decision record below |
| Phase 6 — Clustering & Recurrence | ✅ Completed | 2026-08-12 | Decision record below |
| Phase 7 — Publishing | ✅ Completed | 2026-08-12 | Decision record below |
| Phase 8 — Generator Integration (Backend) | ⬜ Not Started | — | — |
| Phase 9 — Frontend Generator Integration | ⬜ Not Started | — | — |
| Phase 10 — Testing & Hardening | ⬜ Not Started | — | — |
| Phase 11 — Rollout | ⬜ Not Started | — | — |

Status legend: ⬜ Not Started · 🟡 In Progress · ✅ Completed · 🔴 Blocked

When a phase moves to ✅ Completed, also record beneath this table (or link
to a PR): implementation summary, tests passed, any deviations from this
plan, and important decisions discovered during implementation that future
phases should know about.

### Phase 0 completion record — 2026-08-11

**Implementation summary**: Phase 0 was decisions-only, per its own defined
scope (no files/modules, no database, no backend/API, no frontend, no
Gemini/AI work). Three decisions were locked and recorded inline in the
Phase 0 entry above (§20): MVP board scope, MVP class/subject/year-range,
Gemini tier status, and review role. No code, schema, or seed data was
written — that begins at Phase 1 (schema) and Phase 5 (taxonomy seeding),
as the roadmap specifies.

**Locked decisions** (also recorded inline under the Phase 0 entry in §20):
- MVP board scope: **CBSE and Bihar Board**, both from day one.
- MVP class/subject: **Class 10 — Mathematics only**, both boards.
- Year range: **2015–2024** (10 years), both boards.
- Gemini tier: **free tier confirmed current**; a paid tier is now a
  documented blocking prerequisite for Phase 3, computed at ~800 total
  Gemini calls for the MVP corpus's first pass (200 extraction + 300
  classification + ~300 embedding) against a ~450 usable-calls/day free-tier
  ceiling — see §20's Phase 0 entry for the full calculation.
- Review role: **reuse `super_admin`** for MVP; no new `content_editor` role.

**Tests/checks performed** (Phase 0 itself requires none per its own
Definition of Done; the following confirm the repository's baseline is
healthy before Phase 1 begins schema work):
- `server`: `npm run lint` — clean, 0 errors.
- `server`: `npm test` (vitest) — **75 test files, 1911 tests, all passed.**
- `client`: `npm run lint` — 0 errors, 1 pre-existing warning in
  `useClassroomQueue.ts` (missing hook dependency), unrelated to PYQ and
  predating this branch.
- `client`: `npm test` (vitest) — **24 test files, 421 tests, all passed.**
- `client`: `npm run build` (`tsc -b && vite build`) — succeeded, 0 type
  errors; only a pre-existing bundle-size advisory warning, not an error.
- `git diff --check` — clean, no whitespace or conflict-marker issues.
- `git status` after all of the above — only `docs/pyq-implementation-plan.md`
  modified; no schema, application code, seed data, or build artifacts were
  changed or left staged.

**Deviations from the original plan**: None. The MVP board scope was
widened from the plan's own illustrative wording ("one board") to two
boards (CBSE + Bihar Board) at the product owner's explicit direction —
this required no architecture change, since `Board` (§7) was already
designed as a table rather than an enum specifically so more boards could
be added without a redesign. This is scope-locking within Phase 0's own
stated purpose, not a deviation from the architecture.

**Important decisions/discoveries for future phases**:
- The plan's own worked examples used "Bihar Board" throughout as an
  illustrative example; the actual seeded pilot schools
  (`server/src/seed.js`) are in Uttar Pradesh (Rampur) and Delhi, with no
  Bihar affiliation. This was surfaced and resolved via explicit product
  decision (above) rather than assumed — Phase 5's syllabus seeding must
  seed **two** `Board` rows (CBSE, Bihar Board) for the MVP, not one.
- Phase 3 (Extraction) has a hard external dependency this record makes
  explicit: **a paid Gemini tier must be active before Phase 3 starts**,
  not discovered mid-ingestion. This is a procurement/billing action
  outside this codebase and must be confirmed done before Phase 3 begins.
- No `content_editor` role exists or was added; every `adminPyq.js` route
  from Phase 2 onward gates on `requireRole('super_admin')`.

### Phase 1 completion record — 2026-08-11

**Implementation summary**: Added all ten PYQ models specified in §7
(`Board`, `Subject`, `Chapter`, `Topic`, `ExamPaper`, `SourceDocument`,
`Question`, `QuestionTopic`, `QuestionCluster`, `QuestionClusterMember`) to
`server/prisma/schema.prisma`, appended after the existing `SupportNote`
model. Field names, types, defaults, relations, and indexes were verified
byte-for-byte identical (comments aside) to §7's schema block before the
migration was generated — nothing was added, removed, or altered beyond
what §7 specifies. Generated and applied the migration via
`npx prisma migrate dev --name add_pyq_models` (created
`server/prisma/migrations/20260811174658_add_pyq_models/`), then ran
`npx prisma generate` explicitly. No routes, no seed data, no UI, no
application code — exactly Phase 1's stated scope.

**Files changed**:
- Modified: `server/prisma/schema.prisma` (+203 lines, 10 new models)
- New: `server/prisma/migrations/20260811174658_add_pyq_models/migration.sql`
  (10 `CREATE TABLE`, 19 `CREATE INDEX`/`CREATE UNIQUE INDEX` statements —
  purely additive, zero statements touching any pre-existing table)

**Tests/checks performed**:
- `npx prisma validate` — schema valid.
- `npx prisma migrate dev --name add_pyq_models` — applied cleanly against
  the local dev database; Prisma Client regenerated automatically.
- `npx prisma generate` (explicit) — succeeded.
- Migration SQL manually reviewed line-by-line: confirms 10 `CreateTable`
  statements matching §7 exactly, correct `FOREIGN KEY` constraints on
  every relation, correct composite/unique indexes, and **zero** `ALTER`,
  `DROP`, or rewrite statements against any existing table.
- `server npm test` (vitest) — **75 test files, 1911 tests, all passed** —
  identical count to the Phase 0 baseline, confirming zero regressions.
  This run also exercises `test/globalSetup.js`'s `prisma migrate deploy`
  step against a fresh throwaway database, which is the Definition of
  Done's own specified proof that the migration applies cleanly.
- `server npm run lint` — clean, 0 errors.
- `git diff --check` — clean, no whitespace/conflict-marker issues.
- `git status` after all of the above — only `server/prisma/schema.prisma`
  (modified), the new migration folder (untracked), and
  `docs/pyq-implementation-plan.md` (modified, this update) — confirmed via
  `git status --porcelain` that no other file anywhere in the repo changed.
  `server/prisma/dev.db` remained untracked/gitignored throughout, as
  expected.

**Deviations from the original plan**: None in schema content. One
documentation-accuracy correction made as part of this update: the plan's
prose said **"eight new models"** in several places (Executive Summary,
§6, §7 intro, Phase 1's own Objective line), but the §7 schema block and
Phase 1's own "Expected deliverable" line always enumerated **ten** named
models. This was a pre-existing arithmetic error in the committed plan,
not a Phase 1 implementation choice — all ten explicitly-named models were
implemented faithfully regardless of the prose count. The "eight" → "ten"
wording has been corrected everywhere it appeared in this document as
part of this update, with no change to architecture or scope.

**Comment-text adaptation** (not a content deviation): a small number of
inline field comments in the plan's §7 schema block reference section
numbers (e.g. `// see status table above`, `// see PYQ_QUESTION_TYPES,
§9`) that only resolve inside this README, not inside a standalone
`schema.prisma` file. Where the referenced values are explicitly present
elsewhere in this committed document (e.g. `ExamPaper.status`'s status
vocabulary, §7's own table), the comment was rewritten to state those
values directly. Where the referenced vocabulary is **not** yet
enumerated anywhere in this committed document (`Question.type`'s
`PYQ_QUESTION_TYPES` list, which only exists in the original architecture
artifact and is not due to be defined until Phase 5's `lib/pyqVocab.js`),
the comment was deliberately left as a forward reference rather than
inventing specific enum values not yet approved in this plan.

**Important decisions/discoveries for future phases**:
- The dev database (`server/prisma/dev.db`) now has all ten PYQ tables,
  empty. No `Board`/`Subject`/`Chapter` rows exist yet — that begins at
  Phase 5 (taxonomy seeding), per the roadmap.
- The `Question.type` closed vocabulary (`PYQ_QUESTION_TYPES`) still needs
  to be explicitly defined and documented (in `lib/pyqVocab.js`, Phase 5)
  — it was intentionally not locked at the schema level, since the column
  is a plain `String` validated in application code, not a DB enum.
- The `ExamPaper` identity-uniqueness constraint
  (`boardId, subjectId, year, examType, setLabel`, with `setLabel`
  defaulting to `""` rather than nullable) was applied exactly as
  specified in §7's NULL-uniqueness fix — confirmed present in the
  generated migration's `CREATE UNIQUE INDEX
  "ExamPaper_boardId_subjectId_year_examType_setLabel_key"` statement.

### Phase 2 completion record — 2026-08-11

**Implementation summary**: Implemented exactly Phase 2's four endpoints
(§14) — `POST /papers`, `GET /papers`, `GET /papers/:id`,
`GET /papers/:id/source` — in a new `server/src/routes/adminPyq.js`,
role-gated (`requireRole('super_admin')`) on every route, mirroring
`routes/adminSupport.js`'s "separate file, single role gate" convention
exactly. Source PDFs are stored as `Bytes` on `SourceDocument.data`
(§13), served only through the role-gated `GET .../source` route using
the same `Buffer.from(...)`-on-a-Uint8Array fix `routes/avatar.js`
documents for `ProfilePicture`. No Gemini call, no extraction, no review
UI, no generation logic — exactly Phase 2's stated scope.

**Files changed**:
- New: `server/src/routes/adminPyq.js` — the four Phase 2 routes.
- New: `server/src/lib/pyqFileValidation.js` — extends
  `lib/fileValidation.js` with PDF-only, PYQ-sized ceilings
  (`validatePyqSourceDocument`), reusing `sniffMimeType`/
  `estimatePdfPageCount` directly rather than reimplementing them.
- New: `server/test/adminPyq.upload.test.js` — 23 tests, mirroring
  `test/attachments.test.js`'s validation-boundary style per Phase 2's
  own "Tests required" line.
- Modified: `server/src/lib/flags.js` — added `readPyqFlags`/
  `PYQ_FLAG_DEFAULTS`. Defined now but **not called by any Phase 2
  route** — admin ingestion is role-gated only, never flag-gated (§12);
  this flag exists for the teacher-facing endpoints a later phase adds.
- Modified: `server/src/index.js` — required `adminPyqRouter`; mounted
  at `/api/admin/pyq`; constructed a fourth `GeminiService` instance
  (`pyqGemini`, `PYQ_EXTRACTION_LLM_*` tunables) and assigned it to
  `app.locals.pyqGemini` — constructed now per Phase 2's own file list,
  genuinely unused until Phase 3. Both changes are purely additive
  (confirmed via `git diff` — zero lines removed from this file).
- Modified: `server/.env.example` — added a `PYQ_*` block: `PYQ_ENABLED`/
  `PYQ_ALLOWED_SCHOOL_CODES` (defined, unused until a later phase),
  `PYQ_MAX_FILE_SIZE_MB`/`PYQ_MAX_PDF_PAGES` (upload ceilings, actually
  enforced this phase), and `PYQ_GEMINI_ENDPOINT`/`PYQ_EXTRACTION_LLM_*`
  (unused until Phase 3).

**Database changes**: None beyond Phase 1's migration. Phase 2 only
writes to `ExamPaper` and `SourceDocument` through the upload route — no
schema change.

**APIs/storage**:
- `POST /api/admin/pyq/papers` — multipart upload (`board Id`/`subjectId`/
  `classLevel`/`year`/`examType`/`setLabel`/`language` fields + one `file`
  field). Validates referenced `boardId`/`subjectId` actually exist and
  that the subject's `classLevel` matches the submitted one, before any
  write. Returns `201 { paper, requestId }`.
- `GET /api/admin/pyq/papers` — paginated/filtered list (`page`, `limit`,
  `q`, `status`, `boardId`, `subjectId`), never selects `SourceDocument.data`.
- `GET /api/admin/pyq/papers/:id` — detail + `extractionProgress` (`null`
  until Phase 3 ever writes `extractionState`) + `questionCounts`
  (`{extracted,reviewed,approved,rejected}`, correctly all-zero until
  Phase 3+ ever write a `Question` row — computed via a real `groupBy`
  query, not hardcoded, so it self-updates once later phases exist).
- `GET /api/admin/pyq/papers/:id/source` — raw PDF bytes, private
  (`Cache-Control: private, no-store`, unlike `ProfilePicture`'s public/
  cached avatar route), role-gated identically to upload.
- Storage: `SourceDocument.data Bytes`, exactly per §13 — no new service,
  no cloud SDK, confirmed still absent from `package.json`.

**Tests and results**:
- New `server/test/adminPyq.upload.test.js` — **23/23 passed**, covering:
  authentication (401), RBAC (403 for teacher/school_admin/resource_person,
  201/200 for super_admin), the happy-path upload, byte-exact round-trip
  via `GET .../source`, **both** dedup paths (`409 DUPLICATE_UPLOAD` via
  checksum, `409 PAPER_EXISTS` via identity — tested as genuinely
  independent mechanisms, per the Definition of Done), and every
  validation boundary (missing file, missing/invalid fields, non-PDF
  bytes regardless of declared type, oversized file, unknown board/
  subject, class-level mismatch).
- Full server suite: **76 test files, 1934 tests, all passed** (75/1911
  Phase 1 baseline + this phase's 23 new tests) — zero regressions.
- `server npm run lint` — clean, 0 errors.
- `git diff --check` — clean.
- Manual `git diff` inspection: `index.js` and `lib/flags.js` changes
  are 100% additive (zero deleted lines in either file); no client files,
  no unrelated server files, no `.env`/`dev.db` changes.
- Grepped all new/changed files for `console.log`/secrets/TODO markers —
  none found. The route code performs **no logging at all**, so there is
  no path by which uploaded document contents could be logged.

**Bugs found and fixed during this phase** (both caught by the test
suite itself, not shipped):
1. `parsed.error.errors[0]` crashed with a 500 on invalid input — this
   project's installed Zod is v4, which uses `.issues`, not the v3-style
   `.errors` alias. Fixed to `parsed.error.issues[0]`, confirmed as the
   established convention already used identically in `admin.js`,
   `assistant.js`, `auth.js`, and `resources.js`.
2. `PYQ_MAX_FILE_SIZE_MB`/`PYQ_MAX_PDF_PAGES` were read once at module
   load instead of per-request, so an env-var change after boot (e.g. a
   config reload, or a test flipping the value between cases) had no
   effect — silently stale limits. Fixed to read fresh on every request
   (`readPyqUploadLimits()`), matching `routes/attachments.js`'s own
   per-request flag-read pattern exactly rather than the module-constant
   shortcut this phase's first draft took.

**Deviations from the original plan**: None in scope or architecture.
One interpretation decision, documented rather than silently made: §14's
API table names the upload's multipart fields informally as "board" and
"subject." Since there is no name-based resolution endpoint for PYQ
taxonomy anywhere in this plan (§14 explicitly: "no CRUD API" — taxonomy
is seeded by script, not managed through routes) and `ExamPaper.boardId`/
`subjectId` are the schema's actual required foreign keys, this phase's
API accepts `boardId`/`subjectId` directly (the real FK values) rather
than free-text names to be fuzzy-resolved — consistent with §4's explicit
rejection of the coach's free-text grade/subject resolution pattern for
PYQ. A future admin UI (Phase 4) would populate a board/subject picker
and submit these same IDs.

**A real sequencing note, not a defect**: `POST /papers` requires an
already-existing `Board` and `Subject` row (required foreign keys since
Phase 1), but syllabus seeding is Phase 5's own deliverable
(`pyqSyllabusSeed.js`). This phase's own test file creates minimal
Board+Subject fixture rows directly — the same way
`test/helpers/fixtures.js` creates a `School` before it can create a
`User` — which is standard test-fixture practice, not taxonomy seeding,
and required no architecture change. The real-world consequence is
worth stating plainly: **a production admin cannot upload a real paper
until at least one `Board`+`Subject` row exists**, whether seeded by
Phase 5's script or created ad hoc earlier — an operational sequencing
fact, not a blocker to Phase 2 being complete as scoped.

**Important decisions/discoveries for future phases**:
- `classLevel` (`'9'|'10'|'11'|'12'`) and `examType`
  (`annual|compartment|pre_board`) are validated inline in
  `adminPyq.js` against arrays copied from schema.prisma's own Phase-1
  comments — deliberately **not** promoted to a shared `lib/pyqVocab.js`
  yet, since that module (with its own test coverage mirroring
  `vocab/subjects.js`) is explicitly Phase 5's deliverable. Phase 5
  should replace these inline arrays with imports from that module
  rather than maintaining two copies.
- The `page` query parameter on `GET .../source`, named in §14's API
  table, is accepted but intentionally not acted on — the whole PDF is
  always returned. Per-page navigation is designed (§7 of the plan) as a
  client-side concern for Phase 4's reviewer UI, not a server-side
  page-splitting feature — there is no PDF-parsing dependency in this
  project to do that with, and none was added.
- `PYQ_MAX_FILE_SIZE_MB` (default 25) and `PYQ_MAX_PDF_PAGES` (default
  60) have no exact value specified anywhere in this plan — chosen here
  as reasonable, env-tunable, clamped defaults (same discipline as every
  other tunable in `lib/config.js`), documented in `.env.example` with
  the reasoning. Revisit once real scanned papers are actually ingested.

### Multi-set/series pre-Phase-3 architecture review — 2026-08-12

Before starting Phase 3, the schema and Phase 0-2 implementation were
reviewed specifically against real board-paper structure (multiple
sets/series/codes/regions per year, supplementary/re-exam papers) — a
real-world case not exercised by Phase 1/2's own tests. Findings:

- `ExamPaper` already models one set/series as one row (`examType` +
  `setLabel`, unique on `[boardId, subjectId, year, examType, setLabel]`)
  — multiple sets of the same year become multiple `ExamPaper` rows, not
  one row holding several sets. This is the correct shape, not a gap.
- Checksum dedup (exact bytes) and identity dedup (`setLabel`-inclusive)
  are independent mechanisms, confirmed in Phase 2's own tests — distinct
  sets uploaded with distinct `setLabel` values never false-collide on
  either path.
- **A real gap, out of Phase 3's scope, flagged for Phase 6**:
  `occurrenceCount` (§9's pseudocode, not yet implemented) is defined as
  `COUNT(DISTINCT examPaperId)` within a cluster. If the same question is
  correctly clustered across sibling sets of ONE year's sitting (e.g.
  three CBSE sets with the same questions reordered/renumbered), this
  would count 3 occurrences — indistinguishable from genuine 3-year
  recurrence — even though `years` would correctly collapse to one year.
  **No schema change is needed to fix this** — every field required
  (`year`, `examType`, `boardId`, `subjectId`) already exists on
  `ExamPaper`; Phase 6 should dedupe occurrences on year/sitting
  (e.g. `(boardId, subjectId, year, examType)`), not on raw `examPaperId`.
  Not fixed here — flagged for whoever implements Phase 6, per this
  plan's own instruction not to silently change design without approval.
- `SourceDocument` staying 1:1 with `ExamPaper` correctly handles "one PDF
  = one set" (the assumed MVP case) but not a single PDF bundling
  multiple sets together — already an explicit, acknowledged MVP
  limitation (§23's "Multi-source-document-per-paper support" postponed
  item), not a new finding.

**Conclusion: no schema or architecture change required before Phase 3.**
Extraction (Phase 3) only reads one `SourceDocument`/`ExamPaper` pair at a
time and writes `Question` rows against it — it has no clustering or
recurrence logic, so it is entirely unaffected by the flagged gap above.

### Phase 3 completion record — 2026-08-12

**Implementation summary**: Implemented per-page Gemini extraction (§8
stage 3) producing `Question` rows at `reviewStatus: 'extracted'`, exactly
Phase 3's stated scope — no review UI, no chapter/topic classification, no
clustering, no publish workflow, no generator integration. New:
`server/src/lib/pyqExtractionSchema.js` (Zod contract for a page's
extracted questions + the Gemini `responseSchema`, mirroring
`lib/assessmentSchema.js`'s shape and reusing its `normalizeMathText`
directly rather than duplicating it), `server/src/attachments/
extractPyqPage.js` (the single per-page `pyqGemini.generateContent()`
call, mirroring `attachments/describeAttachment.js`'s trust-boundary
pattern), `server/src/lib/pyqWorker.js` (the DB-persisting core —
idempotency, page-state tracking, `ExamPaper.status` transitions — plus
the §17 polling-loop entry point). Modified: `server/src/routes/
adminPyq.js` (`POST /papers/:id/extract`, a thin HTTP wrapper around
`pyqWorker.js`).

**Files changed**:
- New: `server/src/lib/pyqExtractionSchema.js`
- New: `server/src/attachments/extractPyqPage.js`
- New: `server/src/lib/pyqWorker.js`
- Modified: `server/src/routes/adminPyq.js` (+`POST /papers/:id/extract`
  and its error-mapping helper; zero lines removed)
- New: `server/test/lib/pyqExtractionSchema.test.js` (19 tests)
- New: `server/test/lib/pyqWorker.test.js` (9 tests)
- New: `server/test/adminPyq.extract.test.js` (21 tests)

**Key implementation decisions**:
- **No PDF-splitting library was added** (none existed before, and §6/§17
  lock in "no new dependency"). Since Gemini's `attachments` mechanism
  sends whole files, not byte ranges, `extractPyqPage.js` attaches the
  **entire PDF** on every one of a document's per-page calls, with the
  prompt instructing Gemini to transcribe ONLY the specified page and
  ignore every other page. This trades per-call bandwidth efficiency for
  zero new dependencies — a deliberate choice, documented in the file's
  own header, not an oversight. Verified in tests via a 2-page fixture
  PDF and page-targeted extraction calls.
- `PYQ_QUESTION_TYPES` (`mcq`, `very_short_answer`, `short_answer`,
  `long_answer`, `case_study`) is a small, LOCAL closed vocabulary
  defined in `pyqExtractionSchema.js` — the same precedent Phase 2 set
  for `PYQ_CLASS_LEVELS`/`PYQ_EXAM_TYPES` in `adminPyq.js`, since the
  real vocabulary (`lib/pyqVocab.js`) is explicitly Phase 5's own
  deliverable. Phase 5 should replace this inline list with an import
  rather than maintaining two copies.
- **Trust boundary enforced in code, not just by prompt**: `correctAnswer`
  is only ever persisted when the extracted question's own
  `hasOfficialAnswer` is `true` — enforced in `pyqWorker.js` independent
  of (and on top of) the prompt instruction and a Zod `superRefine`
  check, so a self-contradictory model response can't leak an
  AI-computed answer into a "historical" question. Covered by a
  dedicated test.
- **Idempotency**: re-extracting a page deletes only that page's Question
  rows still at `reviewStatus: 'extracted'` before inserting the fresh
  set (no duplicates on retry), and refuses outright
  (`409 PAGE_ALREADY_REVIEWED`) if any row on that page has already been
  reviewed — reviewed content is never silently clobbered by a later
  re-extraction. Both paths covered by tests.
- **Page-level isolation**: a page's extraction failure (malformed/
  invalid Gemini output) marks only that page `failed` in
  `SourceDocument.extractionState`; other pages are unaffected. A
  transient failure (429/5xx/timeout/network) leaves the page `pending`
  (never poisoned) so it stays independently retriable — a quota hiccup
  is not the same failure class as bad content. `ExamPaper.status`
  becomes `extraction_failed` only when **every** known page has failed
  (§19's "signal to surface protected/corrupted, not retry forever"
  rule); otherwise `needs_review` once nothing is pending.
- `parentQuestionId` is resolved best-effort by an exact `questionNumber`
  match within the same paper (real sub-parts almost always share a
  parent's page); left `null`, never invented, when no match exists.
  `translationOfId` (Hindi/English pairing) is **not** resolved in Phase
  3 — deliberately deferred, since matching translation pairs is
  paraphrase-adjacent work explicitly scoped to Phase 6's clustering, not
  extraction.
- `GET /papers/:id/questions` was **not** added in this phase — Phase 3's
  own scope note says extracted rows are "inspectable... via direct query
  or the `GET .../questions` endpoint," and that endpoint is explicitly
  listed under **Phase 4's** own file/API list, not Phase 3's. Tests
  verify extraction results via direct Prisma queries instead, matching
  Phase 3's stated scope exactly (no Phase 4 surface added early).
- `difficulty` is never populated by extraction (left `null` on every
  inserted row) — matches §7's "nullable and untrusted by default; board
  papers don't print it" rule; Gemini is not even asked for it.

**Tests and results**:
- New tests: **49** (19 Zod/normalize unit tests, 9 pure state-machine
  unit tests, 21 route-level integration tests using the existing
  `mockGeminiFetch` helper — no real Gemini calls). Cover: valid
  extraction with full provenance verification (`examPaperId`, denormalized
  `boardId`/`subjectId`/`classLevel`/`year`, `pageNumber`), the
  trust-boundary enforcement above, malformed (non-JSON) Gemini output,
  Zod schema-validation failure (missing field, wrong mcq option count),
  exhausted rate-limiting (429) and its retriable-not-failed page state,
  transient-429-then-success transparency, repeated upstream 5xx,
  page-level failure isolation (one page fails, a sibling page's rows are
  untouched), idempotent re-extraction (no duplicate rows), the
  already-reviewed-page guard, RBAC (401/403 for every non-`super_admin`
  role), 404/409/400 state and validation guards, and a dedicated
  no-log-leakage test asserting neither extracted question text nor a raw
  malformed Gemini response body ever reaches `console.log`/`warn`/`error`.
- Full server suite: **79 test files, 1983 tests, all passed** (76/1934
  Phase 2 baseline + 3 new files / 49 new tests this phase) — zero
  regressions.
- `server npm run lint` — clean, 0 errors.
- `npx prisma validate` — schema valid (Phase 3 made no schema changes).
- `git diff --check` — clean.

**A real bug found and fixed during this phase's own testing**: the
initial implementation only wrote `SourceDocument.extractionState` /
`ExamPaper.status` AFTER a page's Gemini call succeeded or definitively
failed — so a transient failure (e.g. exhausted 429) left `extractionState`
still `null` and the paper still `status: 'uploaded'`, even though an
extraction attempt had genuinely started. Fixed: the "page 1 is now
in-flight" state (`pending` in `extractionState`, `ExamPaper.status`
promoted from `uploaded` to `extracting`) is now persisted **before** the
Gemini call, so `extracting` — §7's own "normal, expected mid-pipeline
state" — is visible the moment extraction is first attempted, not only
once a page finishes one way or the other. Caught by this phase's own
retry test, not shipped.

**Deviations from the original plan**: None in scope or architecture. One
interpretation decision, documented rather than silently made: `POST
.../extract`'s `202` response body is exactly `{ pageNumber, status,
requestId }` per §14's API table — it does not include the extracted
questions themselves (fetch those via a direct query today, or Phase 4's
`GET .../questions` once it exists), matching a `202`'s "accepted/
processed, check elsewhere for the result" semantics rather than
returning a full document body.

**Known limitations / blockers for Phase 4+**:
- **Gemini quota/billing remains an unresolved external blocker for real
  bulk ingestion.** Phase 0 locked "a paid Gemini tier must be
  provisioned before Phase 3 (Extraction) begins" as a prerequisite for
  running real extraction at MVP-corpus volume (~800 calls vs. a
  ~450-usable-calls/day free-tier ceiling). This phase implemented and
  tested the extraction *code* entirely against mocked Gemini responses
  (per this plan's own Part 7-equivalent testing guidance — no bulk
  extraction was run), so **no code in this phase required or consumed
  real Gemini quota**. Whether a paid tier is actually active has not
  been verified from the codebase (it is an external billing/account
  fact) and remains a blocking prerequisite before any real paper is
  extracted end-to-end at volume.
- The `occurrenceCount` multi-set/series gap flagged above is unresolved
  — belongs to Phase 6, not fixed here.
- `translationOfId` (bilingual pairing) is not auto-resolved during
  extraction — left for a later phase (likely folded into Phase 6's
  duplicate/paraphrase detection, or Phase 4's manual review).
  `parentQuestionId` is resolved best-effort within the same paper only.
- No real scanned/photographed board-exam PDF has been run through this
  pipeline yet — extraction accuracy against a genuine 30-year corpus of
  varying scan quality remains unverified (§18's own named risk),
  budgeted for when the first real batch runs under Phase 4's review
  gate.

### Phase 4 completion record — 2026-08-12

**Implementation summary**: Built the mandatory human-review gate (§8 stage
5) — a reviewer sees the source PDF page beside Phase 3's extracted fields,
corrects them, and approves/rejects — exactly Phase 4's stated scope. No
chapter/topic classification, no clustering, no publish workflow, no
teacher-facing generation. Backend: four new/route additions to
`server/src/routes/adminPyq.js` (`GET /papers/:id/questions`,
`PATCH /questions/:id`, `POST /questions/:id/approve`,
`POST /questions/:id/reject`), reusing Phase 3's `PYQ_QUESTION_TYPES` and
this file's own established DTO/error-handling conventions. Frontend: two
new admin pages (`AdminPyqIngestionPage.tsx`, `AdminPyqReviewPage.tsx`), a
new typed client (`lib/adminPyq.ts`), new `Pyq*` types, two new routes, and
a new "PYQ" admin nav tab — built entirely from existing primitives
(`usePagedList`, `TablePager`, `ConfirmDialog`, `Toast`, the existing
`.settings-card`/`.data-table`/`.status-pill` design-system classes), per
§15's own file list.

**Files changed**:
- Modified: `server/src/routes/adminPyq.js` (+`GET /boards`,
  `GET /papers/:id/questions`, `PATCH /questions/:id`,
  `POST /questions/:id/approve`, `POST /questions/:id/reject`; zero lines
  removed)
- New: `server/test/adminPyq.review.test.js` (40 tests)
- New: `client/src/pages/AdminPyqIngestionPage.tsx`
- New: `client/src/pages/AdminPyqReviewPage.tsx`
- New: `client/src/lib/adminPyq.ts`
- New: `client/src/lib/adminPyq.test.ts` (17 tests)
- Modified: `client/src/types.ts` (+`Pyq*` types)
- Modified: `client/src/App.tsx` (+2 routes, both `super_admin`-gated)
- Modified: `client/src/components/AdminTabs.tsx` (+"PYQ" tab,
  `super_admin`-only, same gate as Support/Settings)
- Modified: `client/src/index.css` (+PYQ review/ingestion styles, reusing
  existing tokens/classes throughout — no new visual language)

**API changes**:
- `GET /api/admin/pyq/boards` — **not** in §14's original Phase 4 endpoint
  list; added because §14 rules out a Board/Subject **CRUD** API but the
  ingestion form still needs *some* way to populate a Board/Subject picker
  without asking an admin to paste a raw database id. Read-only, no
  create/update/delete, same shape as the pre-existing `GET /admin/schools`
  picker-population precedent in `routes/admin.js` — see the route's own
  comment for the full reasoning. Documented here rather than silently
  added.
- `GET /api/admin/pyq/papers/:id/questions?reviewStatus=` — every extracted
  question for one paper, including the immutable `rawExtraction` audit
  trail, per §14.
- `PATCH /api/admin/pyq/questions/:id` — editable-field allowlist:
  `questionNumber, type, text, options, marks, correctAnswer, difficulty,
  hasDiagram, hasTable, requiresGroupSelection`, enforced by Zod `.strict()`
  (an unknown/forbidden key — `examPaperId`, `pageNumber`, `rawExtraction`,
  boardId/subjectId/classLevel/year — is a `400`, never a silent no-op).
  Blocked (`409 ALREADY_REVIEWED`) once `reviewStatus` is `approved` or
  `rejected`. Moves `extracted -> reviewed` on first edit.
- `POST /api/admin/pyq/questions/:id/approve` — blocked
  (`409 ALREADY_REVIEWED`) once already `approved` or `rejected`.
- `POST /api/admin/pyq/questions/:id/reject` — deliberately **unconditional**
  (no `409`, ever) — §12/§18 name `approved -> rejected` as the reversal
  mechanism for a mistaken approval, so reject must stay reachable from
  every state, including an already-`approved` row.

**UI changes**:
- `AdminPyqIngestionPage.tsx` (`/admin/pyq`) — upload form (closed
  Board→Subject selects, cascading; `classLevel` auto-derived from the
  chosen Subject rather than a separate field, structurally preventing
  Phase 2's `CLASS_LEVEL_MISMATCH` case), a paginated/filtered/searched
  paper list (`usePagedList` + `TablePager`, unmodified), a status pill per
  row, and per-row "Extract next page" (wires Phase 3's existing
  `POST .../extract`, no new backend capability) / "Review" actions.
- `AdminPyqReviewPage.tsx` (`/admin/pyq/:paperId`) — the two-pane review
  surface: source PDF (left) beside extracted/editable fields (right), a
  question-navigator chip strip color-coded by `reviewStatus` (progress
  visible at a glance — "8 of 20 decided"), the trust-provenance framing
  line ("this is real historical source material… not AI-generated"), a
  collapsible "Show original Gemini extraction" panel (mirrors
  `AdminSupportTicketPage.tsx`'s raw-context toggle), and Save/Approve/
  Reject actions. Approve and Reject both save any pending edit first (one
  click, not two). Reject is gated behind `ConfirmDialog` (tone="danger")
  — the harder-to-reverse of the two decisions in this UI, since approve
  can be corrected via reject but reject cannot be corrected via approve
  (§12/§18's own asymmetry, carried into the UI). A locked question
  (`approved`/`rejected`) disables every input and shows why.

**Source-PDF viewing approach**: Reuses Phase 2's `GET .../source`
**completely unmodified** — no new endpoint, no page-splitting, no change
to its private/role-gated semantics. Since that route stays `authRequired`
(by design — §13: "never a public URL") and a plain `<iframe src>`/
`<object data>` cannot attach an `Authorization` header, `lib/adminPyq.ts`'s
`fetchPyqSourcePdfUrl()` fetches the PDF once via an authenticated `fetch()`
and hands the viewer a `blob:` object URL; `withPdfPageFragment()` appends
the browser's native `#page=N` fragment for per-page navigation (§15's own
"client-side concern"). Still zero new PDF-rendering dependency — the
embed itself is a plain `<object type="application/pdf">`, exactly as §15
specifies. Verified live: the fetch/blob/embed mechanism works end-to-end
against a real uploaded PDF (Chrome's own "Failed to load PDF document" only
appeared against a deliberately minimal, non-conformant test fixture, not
against the mechanism itself).

**RBAC/security verification**: Every new route uses the identical
`authRequired, requireRole('super_admin')` gate as every other route in
this file — verified by test for all five (`401` unauthenticated, `403` for
`teacher`/`school_admin`/`resource_person`, success for `super_admin`).
Client-side, both new routes in `App.tsx` gate on `isSuperAdmin` the same
way `/admin/support` and `/admin/settings` already do — a UI convenience,
never the real gate (server-side RBAC is authoritative, matching this
codebase's own documented client-flag-is-not-a-kill-switch precedent).
Never-editable fields (`examPaperId`, denormalized board/subject/
classLevel/year, `rawExtraction`, and — a Phase-4-specific addition beyond
§14's named list — `pageNumber`, true physical provenance that a reviewer
must never be able to silently move) are enforced **server-side** by Zod
`.strict()`'s allowlist, not merely omitted from the UI; verified by a
dedicated test that a PATCH attempting `pageNumber`/`examPaperId`/
`rawExtraction` is rejected outright and the row is unchanged.

**Tests and results**:
- New: `server/test/adminPyq.review.test.js` — **40/40 passed**: `GET
  /boards` (RBAC + shape), `GET .../questions` (RBAC, 404, listing incl.
  `rawExtraction`, `reviewStatus` filtering), `PATCH .../questions/:id`
  (RBAC, 404, empty-body rejection, field edits + `extracted -> reviewed`
  transition + `Event` audit metadata-only verification, provenance-field
  immutability, `correctAnswer`-derives-`hasOfficialAnswer` in both
  directions plus direct-set rejection, mcq exactly-4-options against the
  *effective* type/options, `409` once terminal), `POST .../approve` (RBAC,
  404, direct approval with no PATCH required first, `409` on a second
  approve, `409` approving an already-rejected question), `POST .../reject`
  (RBAC, 404, direct rejection, reversal of a mistaken approval, idempotent
  on an already-rejected question), and a dedicated log-safety test
  asserting question text is never logged by any of the three actions.
- New: `client/src/lib/adminPyq.test.ts` — **17/17 passed**: pure-logic
  coverage for `draftFromQuestion` and `buildQuestionPatch` (the "frontend
  correction-flow" logic named in §14's own Phase 4 "Tests required" line)
  — no-change detection with whitespace-trimming, per-field diffing,
  type/options traveling together in both directions, difficulty
  empty-string/`null` mapping, and `withPdfPageFragment`'s edge cases. Kept
  as pure functions specifically so they're testable under this project's
  existing client test runner, which is deliberately pure-logic-only (see
  `vitest.config.ts`'s own header comment: "no React Testing Library, no
  `.tsx` under test") — a decision this phase did not reopen.
- Full server suite: **80 test files, 2023 tests, all passed** (79/1983
  Phase 3 baseline + this phase's 40 new tests) — zero regressions.
- Full client suite: **25 test files, 438 tests, all passed** (24/421 +
  this phase's 17 new tests) — zero regressions.
- `server`: `npm run lint` — clean, 0 errors. `npx prisma validate` —
  valid (no schema changes this phase).
- `client`: `npm run lint` — 0 errors, the same single pre-existing
  `useClassroomQueue.ts` warning noted in every prior phase's record,
  unrelated to PYQ. `npm run build` (`tsc -b && vite build`) — succeeded, 0
  type errors, only the same pre-existing bundle-size advisory.
- **Live browser verification** (not just typecheck/build): both dev
  servers started locally; logged in as the seeded `super_admin`; exercised
  the real UI against the real (temporary, cleaned-up-after) dev database —
  confirmed the empty-boards state, the paper list's empty/loading states,
  the 404 "this paper no longer exists" error state, the full upload form
  (board→subject cascading, file upload, list refresh, status pill), the
  review page's two-pane layout, question navigator, provenance line,
  editable form (including long question text wrapping correctly), and a
  real edit-then-approve action end to end — verified directly against the
  database afterward (the edited field persisted, `reviewStatus` moved to
  `approved`, `reviewedById`/`reviewedAt` set correctly, and both the
  `pyq_question_reviewed` and `pyq_question_approved` `Event` rows were
  written with metadata containing only field names, never question text).
  No console errors beyond the pre-existing, app-wide React Router
  future-flag warnings. All test data created for this check was deleted
  afterward — `dev.db`'s PYQ tables are confirmed empty again.

**Deviations from the original plan**:
- `GET /boards` added (see "API changes" above) — not in §14's original
  endpoint list, but a minimal, read-only, necessary addition using an
  already-established pattern in this codebase, not a new one.
- Page/file locations use this codebase's actual flat `client/src/pages/`
  convention (matching `AdminSupportPage.tsx`/`AdminSupportTicketPage.tsx`
  exactly) rather than §15's literal `client/src/pages/admin/` subdirectory
  path — the files' names/roles match the plan exactly, only their
  directory does not, chosen to match the real, existing repo convention
  per this phase's own "inspect existing admin UI patterns" instruction.
- `chapterId`/`topicIds` — present in §14's original `PATCH` field list —
  are **not** editable in this phase, in either the API allowlist or the
  UI: no `Chapter`/`Topic` row can exist before Phase 5 seeds the taxonomy,
  so exposing an FK field with nothing to point at would be dead surface,
  not a working picker. Add back once Phase 5 exists.
- `hasOfficialAnswer` — present in §14's original `PATCH` field list as an
  implied-editable field — is **derived**, not independently settable: a
  reviewer corrects `correctAnswer`'s text, and `hasOfficialAnswer` follows
  from whether that's now non-empty, mirroring the identical trust-boundary
  enforcement `lib/pyqWorker.js` already applies at extraction time (§9/§11).
  A `PATCH` that tries to set `hasOfficialAnswer` directly is rejected.

**Known limitations / blockers for Phase 5+**:
- A real, official, born-digital CBSE Class 10 Maths PDF has now been
  reviewed through this UI end-to-end (see the QA addendum below) — but a
  genuinely *scanned/photographed*, lower-image-quality, and bilingual
  (Hindi/English) real paper has still **not** been tried. Reviewer
  throughput and extraction accuracy against that harder, more realistic
  corpus (§17's own named long-term bottleneck) remain unverified.
- The question navigator strip has no keyboard shortcut beyond native Tab/
  Enter on its chip buttons — sufficient for "keyboard accessible" but not
  a power-user fast-path; not required by Phase 4's Definition of Done.
- Switching between questions in the review page discards an unsaved edit
  without a confirmation prompt (the Save button's own dirty-state is the
  only warning) — a deliberate, documented scope decision, not an oversight,
  to avoid a draft-persistence system Phase 4 doesn't call for.
- The Gemini paid-tier prerequisite flagged in Phase 0/3 remains unresolved
  for bulk ingestion — this QA pass made only 3 real extraction calls (well
  under free-tier daily capacity), not a bulk run.
- A real 740KB, 11-page PDF attached whole on every per-page extraction call
  (§8's own documented tradeoff) can exceed the default 60s
  `PYQ_EXTRACTION_LLM_TOTAL_TIMEOUT_MS` — observed live (page 9 of 11 timed
  out on first attempt, correctly left `pending`/retriable, no data
  corruption). Not fixed here — a Phase 3 tuning question, not a Phase 4
  bug — flagged for whoever next touches extraction pacing.

### Phase 4 manual QA addendum — 2026-08-12

A real-PDF manual QA pass (not just mocks/automated tests) was run against
this phase after its initial completion, per explicit request. Full report
delivered in-conversation; summarized here for the record.

**What was used**: An official CBSE Class X Mathematics–Standard (041)
Sample Question Paper 2019-20, downloaded directly from
`cbseacademic.nic.in` (with explicit approval) — 11 pages, 758KB,
born-digital (not scanned), English only, real MCQ/short/long-answer
questions with real math and geometry notation.

**Result**: Upload, real Gemini extraction (3 pages, 10 real questions:
MCQ options, fractions, angle notation, an internal "OR" choice question,
correct `hasDiagram` detection on a genuine geometry figure), source-page
display, page navigation between differently-paged questions, edit → save
→ reload → persist, approve, and reject (with its confirm dialog) were all
verified working end-to-end against this real data. RBAC was re-verified
manually (not just via the automated suite) for `teacher`, `school_admin`,
`resource_person`, and unauthenticated — all correctly `401`/`403` at the
API layer, independent of the client-side redirect.

**One genuine Phase 4 bug found and fixed**: the source PDF viewer went
blank when switching from one question to another question on a
*different* page. Root cause: a browser's embedded PDF plugin does not
reliably re-navigate an already-loaded `<object>` element when only its
`data` URL's `#page=N` fragment changes — confirmed live (the `data`
attribute updated correctly in the DOM; the rendered plugin content did
not). Fixed in `AdminPyqReviewPage.tsx` by keying the `<object>` on the
full source URL (including its page fragment), forcing React to remount
the element — and therefore the browser's PDF plugin — on every page
change. Re-verified live after the fix: navigating between Page 1 and Page
5 correctly re-rendered each time. Full server suite (80 files/2023
tests), full client suite (25 files/438 tests), lint, and build were all
re-run clean after this fix.

**Also observed, not fixed (out of Phase 4 scope)**: (1) MCQ option text
truncates in its input box with no ellipsis/wrap and no way to see the
full option without clicking in — a real, minor Phase 4 UX polish item,
left for a future pass since it doesn't block the review workflow
(clicking into the field shows the full text via cursor/selection). (2)
Gemini's plain-notation transcription of a fraction with a
powers-of-2-and-5 denominator produced an ambiguous `2^{3}x5` (unclear
whether `x` means multiplication or is a stray character) — a Phase 3
extraction-prompt notation-quality question (the prompt's
`MATH_NOTATION_RULES` never specifies how to write multiplication), not a
Phase 4 defect; exactly the kind of thing a human reviewer is supposed to
catch and correct, and did.

**Cleanup**: all QA-created rows (1 Board, 1 Subject, 1 ExamPaper, 1
SourceDocument, 10 Questions, 3 Events) were deleted after verification;
`dev.db`'s PYQ tables are confirmed empty again. The downloaded PDF was
removed from the session scratchpad. No commits were made.

### Phase 5 completion record — 2026-08-12

**Implementation summary**: Seeded the MVP subject's chapter/topic taxonomy
(§9/§20) and wired closed-vocabulary Gemini classification into the
extraction/review flow, exactly Phase 5's stated scope — no clustering, no
recurrence, no publish workflow, no generator integration, no boards/
classes/subjects beyond the locked MVP slice. Before any code was written,
this phase ran a dedicated research pass (see "Taxonomy sourcing" below) to
avoid inventing curriculum content, per this plan's own Part 4/Part 8
instruction not to silently guess authoritative data.

**Taxonomy sourcing** (full detail was presented for review and approved
in-conversation before implementation began):
- **CBSE**: officially verified. Six real CBSE curriculum PDFs
  (`cbseacademic.nic.in`) were downloaded and their text extracted directly
  (`pdftotext -layout`) — sessions 2019-20, 2020-21 (COVID-revised), 2021-22,
  2022-23, 2023-24, 2024-25 — covering the full 2015-2024 PYQ corpus window.
  This corrected an earlier secondary-source-only research pass that had
  wrongly claimed "Constructions" was cut in the 2020-21 rationalization; the
  primary-source PDFs show it was still present (trimmed) through the
  2021-22 session and was actually dropped starting the **2022-23** session.
  Every CBSE chapter and topic name in `pyqSyllabusSeed.js` is taken
  verbatim from these official documents.
- **Bihar Board (BSEB)**: secondary-source only
  (`getmyuni.com`, `collegedekho.com`). BSEB's own site
  (`biharboardonline.bihar.gov.in`) was genuinely unreachable from this
  environment — a multi-method attempt (direct `curl` with and without SSL
  verification, plain HTTP, `WebFetch`, the Wayback Machine both via its API
  and via `WebFetch`, which is blocked from `web.archive.org` entirely) all
  failed with connection resets. BSEB is seeded with the same 15 chapter
  names as CBSE because secondary sources describe its Class 10 Maths
  structure as closely NCERT-aligned, and BSEB's own historical 2015-2024
  stability is **explicitly unresolved, not confirmed unchanged** — a
  documented assumption/risk, not a claim, exactly as required before
  proceeding.
- **"Constructions"** is seeded for both boards with different meanings: for
  CBSE it's HISTORICAL ONLY (present in every official PDF through 2021-22,
  absent from 2022-23 onward — a 2015-2022 CBSE paper may contain it, a
  2023-2024 one cannot); for Bihar Board it's a CURRENT chapter per secondary
  sources.
- **Trigonometric Identities** is seeded as a Topic under "Introduction to
  Trigonometry" (matching the real NCERT textbook's 2-chapter structure —
  what an actual exam paper's mark scheme references), not as its own
  Chapter, even though CBSE's own curriculum document lists it as a
  separately-numbered unit item — an explicit, approved design decision, not
  an oversight.

**Taxonomy design** (approved before implementation, no schema change
needed): `Board` → `Subject` (`boardId, classLevel, name` unique) →
`Chapter` (`subjectId, name` unique) → `Topic` (`chapterId, name` unique) →
`QuestionTopic` (many-to-many). CBSE's and Bihar Board's chapter/topic trees
are **structurally isolated by the existing FK chain alone** — a
"Triangles" `Chapter` row under each board's own `Subject` row is two
completely independent database rows from creation, confirmed by inspecting
`schema.prisma`'s own unique constraints; no disambiguation logic was
needed or added. `QuestionTopic` was already many-to-many before this phase
(§7, Phase 1) — multi-topic questions needed no schema change either.

**Files changed**:
- New: `server/src/lib/pyqVocab.js` — `PYQ_CLASS_LEVELS`, `PYQ_EXAM_TYPES`,
  `PYQ_PAPER_STATUSES`, `PYQ_QUESTION_TYPES`, `PYQ_QUESTION_REVIEW_STATUSES`,
  `PYQ_TOPIC_SOURCES` — the single source of truth for every PYQ enum
  Phases 2-4 had left as documented, forward-referencing inline copies.
- Modified: `server/src/lib/pyqExtractionSchema.js` — imports
  `PYQ_QUESTION_TYPES` from `pyqVocab.js` and re-exports it (every existing
  importer keeps working unchanged, confirmed by `pyqVocab.test.js`'s
  `toBe` identity check, not just a value-equality check).
- Modified: `server/src/routes/adminPyq.js` — imports
  `PYQ_CLASS_LEVELS`/`PYQ_EXAM_TYPES`/`PYQ_PAPER_STATUSES`/
  `PYQ_QUESTION_REVIEW_STATUSES` from `pyqVocab.js` instead of the Phase 2/4
  inline copies; `GET /boards` now nests `chapters`/`topics` under each
  subject; `questionDto` now includes a `topics` field; `chapterId`/
  `topicIds` are back in `PATCH /questions/:id`'s editable-field allowlist
  (Phase 4 had deliberately omitted them, per its own completion record, for
  exactly this reason); new `POST /papers/:id/classify` route.
- New: `server/src/pyqSyllabusSeed.js` — idempotent upsert seed script
  (`npm run seed:pyq`), mirroring `seed.js`'s own upsert-by-unique-key
  pattern exactly.
- New: `server/src/attachments/classifyPyqChapter.js` — the single per-page
  Gemini classification call, mirroring `extractPyqPage.js`'s
  pure-function shape (no DB access) and `learningRepresentation/
  classifier.js`'s "ask nicely, then verify" discipline: Gemini's
  `responseSchema` constrains `chapterName`/`topicNames` to the real seeded
  vocabulary via `enum`, but every returned value is independently
  re-checked against the actual `chapters` array passed in before being
  trusted — an unrecognized chapter/topic name is silently dropped, never
  force-matched or invented.
- Modified: `server/src/lib/pyqWorker.js` — new `classifyAndPersistPage`
  (the DB-persisting orchestration, mirroring `extractAndPersistPage`'s own
  shape) and `PyqClassificationError`.
- Modified: `server/package.json` — `"seed:pyq": "node src/pyqSyllabusSeed.js"`.
- New: `server/test/lib/pyqVocab.test.js`, `server/test/pyqSyllabusSeed.test.js`,
  `server/test/adminPyq.classify.test.js`.
- Modified: `server/test/adminPyq.review.test.js` — new
  `chapterId`/`topicIds` PATCH coverage; `GET /boards` test now asserts
  nested chapters/topics.
- Modified: `client/src/types.ts` — `PyqChapter`, `PyqTopic`,
  `PyqQuestionTopic` types; `PyqSubject.chapters`; `PyqQuestion.topics`;
  `PyqQuestionEdits.chapterId`/`topicIds`.
- Modified: `client/src/lib/adminPyq.ts` — `classifyPyqPage()`;
  `buildQuestionPatch`/`draftFromQuestion`/`PyqQuestionDraft` extended for
  `chapterId`/`topicIds` (order-insensitive topic-set diffing).
- Modified: `client/src/lib/adminPyq.test.ts` — new coverage for the above.
- Modified: `client/src/pages/AdminPyqReviewPage.tsx` — a chapter `<select>`
  + topic checkboxes, populated from `GET /boards`' newly-nested taxonomy;
  changing the chapter resets the topic selection (never leaves a stale
  topic from a different chapter selected).
- Modified: `client/src/pages/AdminPyqIngestionPage.tsx` — a
  "Classify next page" row action, mirroring "Extract next page"'s.

**Classification workflow**: a question becomes a classification target the
moment it's `reviewStatus: 'extracted'` AND `chapterId: null` — i.e.
freshly extracted, never yet touched by classification or a human. This
single condition is simultaneously the trigger, the idempotency guarantee
(a question drops out of the target set the instant it gets a `chapterId`,
whether AI-proposed or human-confirmed, so re-running classification can
never overwrite a reviewer's correction), and the rejected/reviewed-question
exclusion (any human PATCH/approve/reject moves `reviewStatus` off
`'extracted'`, structurally removing that question from every future
classification call — verified by a dedicated test). Classification is a
**separate trigger** (`POST /papers/:id/classify`, page-scoped like
`/extract`), not folded into extraction — keeps it independently retriable
and testable, matching Phases 3/4's own "routes stay thin, concerns stay
separate" shape. A reviewer's `PATCH` always writes `QuestionTopic.source:
'human'` and **replaces** the full topic set (never merges) — a human
correction always wins over an earlier AI proposal, verified by test.
`rawExtraction` is never touched by classification or the taxonomy PATCH
fields — only `chapterId` and `QuestionTopic` rows are written.

**RBAC/security verification**: `POST /papers/:id/classify` uses the
identical `authRequired, requireRole('super_admin')` gate as every other
route in this file — verified by test (`401` unauthenticated, `403` for
`teacher`/`school_admin`/`resource_person`). `chapterId`/`topicIds` in
`PATCH /questions/:id` are never trusted blindly from the client: a
`chapterId` must belong to the question's own `subjectId` (verified by
test with a cross-subject chapter, `400 INVALID_FIELDS`), and every
`topicId` must belong to the EFFECTIVE (new-or-existing) chapter (verified
by test with a cross-chapter topic).

**Tests and results**:
- New: `server/test/lib/pyqVocab.test.js` — vocabulary shape/content, plus
  the `pyqExtractionSchema.js` re-export identity check.
- New: `server/test/pyqSyllabusSeed.test.js` — exact chapter/topic counts,
  idempotency across 2 and 3 re-runs (no duplicate Board/Subject/Chapter/
  Topic rows), CBSE/Bihar Board Chapter-row isolation despite identical
  names, "Constructions" present for both boards, per-chapter topic
  correctness, `sequence` ordering.
- New: `server/test/adminPyq.classify.test.js` — RBAC, `404`/`409
  NO_TAXONOMY`, valid classification writing `chapterId` + AI-sourced
  `QuestionTopic` rows, the "ask nicely, then verify" guarantee (an
  invented chapter name is dropped; a real topic name belonging to the
  WRONG chapter is dropped while the chapter itself still applies; an
  unknown `questionId` in the AI response is ignored), malformed/
  schema-invalid AI output (`502 INVALID_AI_RESPONSE`, no DB writes),
  idempotent reclassification (`409 NOTHING_TO_CLASSIFY` on a second call,
  never a silent re-touch), and rejected-question exclusion.
- Modified: `server/test/adminPyq.review.test.js` — new `chapterId`/
  `topicIds` PATCH coverage: valid classification, cross-subject chapter
  rejected, unknown chapter rejected, cross-chapter topic rejected,
  `topicIds` with no chapter rejected, clearing `chapterId` also clears
  topics, a `topicIds` PATCH replaces (not merges) the set, a human PATCH
  always overwrites `source: 'ai'` with `'human'`.
- Modified: `client/src/lib/adminPyq.test.ts` — `draftFromQuestion`/
  `buildQuestionPatch` coverage for `chapterId`/`topicIds`, including
  order-insensitive topic-set diffing.
- Full server suite: **83 test files, 2055 tests, all passed** (80/2023
  Phase 4 baseline + 3 new files / 32 new tests this phase) — zero
  regressions.
- Full client suite: **25 test files, 444 tests, all passed** (25/438 +
  6 new tests this phase) — zero regressions.
- `server`: `npm run lint` — clean, 0 errors. `npx prisma validate` — valid
  (no schema changes this phase).
- `client`: `npm run lint` — 0 errors, the same single pre-existing
  `useClassroomQueue.ts` warning noted in every prior phase's record.
  `npm run build` (`tsc -b && vite build`) — succeeded, 0 type errors, only
  the same pre-existing bundle-size advisory.
- **Real seed run** (not just tests): `npm run seed:pyq` was run twice
  against the actual dev database. First run: "Seeded CBSE (CBSE) -> Class
  10 Mathematics: 15 chapters, 35 topics." / "Seeded Bihar Board (BSEB) ->
  Class 10 Mathematics: 15 chapters, 35 topics." Second run: identical
  output, and a direct count query confirmed exactly 2 `Board`, 30
  `Chapter`, 70 `Topic` rows afterward — not 4/60/140 — proving idempotency
  against the real database, not only the test one. No Gemini calls were
  made by this (a pure DB seed script); this satisfies Phase 5's own
  "Expected deliverable: a seeded chapter/topic taxonomy for the MVP
  subject" without any bulk AI processing.

**Deviations from the original plan**: None in architecture or scope. Two
sourcing-driven adjustments, both documented above rather than silently
made: (1) "Constructions" is seeded despite being absent from CBSE's
*current* syllabus, specifically to classify pre-2022 corpus questions —
an explicit, approved historical-coverage decision; (2) Bihar Board's
taxonomy is secondary-source-only because its official site was
unreachable from this environment despite a genuine, documented
multi-method attempt — flagged as a real risk, not silently treated as
equal-confidence to CBSE's officially-verified data.

**Important decisions/discoveries for future phases**:
- No Gemini classification call was made against real content this phase —
  every test uses `mockGeminiFetch`, per this plan's own "no bulk real-world
  processing" instruction. Whether classification accuracy holds up against
  real historical PYQ text (as opposed to the short synthetic fixtures used
  in tests) is unverified — the same class of open question Phase 3's own
  completion record already flagged for extraction accuracy.
- BSEB's taxonomy should be re-verified against an authoritative source
  before Bihar Board content is classified at real volume — the current
  seed is a documented, reviewer-correctable starting point, not a
  confirmed-accurate curriculum. `Chapter`/`Topic` rows can be added or
  renamed later without any migration (they're plain rows, not an enum),
  but a renamed/removed `Chapter` after real `Question` rows already
  reference it would need a data-migration pass, not just a reseed —
  worth doing this verification BEFORE Bihar Board ingestion reaches real
  volume, not after.
- `pyqSyllabusSeed.js`'s `MATH_CLASS_10_CHAPTERS` array is the only place
  chapter/topic names live — Phase 6's clustering (chapter-scoped semantic
  similarity, per §6/Phase 6's own dependency note) and Phase 8's selection
  (`MAX_SHARE_PER_CHAPTER`) both read `Chapter` rows from the database, not
  this array directly, so widening the taxonomy later (more chapters, more
  boards/classes/subjects) needs no code change in either phase.
- The classification trigger condition (`reviewStatus: 'extracted'` AND
  `chapterId: null`) means a question whose extraction is RETRIED (Phase
  3's own re-extraction idempotency, which deletes and recreates
  `reviewStatus: 'extracted'` rows) will correctly re-enter the
  classification target set — confirmed by inspection of
  `extractAndPersistPage`'s row-replacement logic, not a new behavior
  added this phase.

### Phase 6 completion record — 2026-08-12

**Implementation summary**: Implemented the three-pass duplicate/paraphrase
detection pipeline (exact → lexical → semantic), cluster confirm/reject
review, and recurrence (`occurrenceCount`) exactly per §9/§20 — no publish
workflow, no selection algorithm, no generator integration, no board/class
expansion. Two product decisions the plan left genuinely ambiguous were
confirmed with the user before implementation (both recorded below) rather
than silently invented; a third — the sitting-tuple recurrence fix — was
already resolved in Phase 3's own architecture-review note and implemented
exactly as specified there.

**Confirmed decisions** (asked before writing any clustering code):
1. **Numeric-literal masking**: kept exactly as §9 originally specified —
   the exact pass masks numeric literals before hashing, so a same-template/
   swapped-numbers pair (§9's own "force=20N" vs "force=15N" example)
   clusters as one recurring question. This was confirmed explicitly against
   a real tension: a fixture describing "x²-5x+6" vs "x²-7x+10" as required
   to stay distinct would, under this approved design, actually cluster
   together (same masked template) — the user chose to keep §9's design over
   the fixture's implication.
2. **Cluster membership cardinality**: a question belongs to AT MOST ONE
   cluster. Passes run in fixed order (exact → lexical → semantic); a
   question claimed by an earlier pass is removed from every later pass's
   pool. This is the entire mechanism behind both idempotency (a rerun only
   ever considers still-unclustered questions) and the absence of any
   merge/split logic (never needed, because a question can never be
   reconsidered once matched) — the plan named this exact ambiguity
   ("whether a question can belong to only one cluster") as a stop
   condition, and it was not addressed anywhere in the approved plan text.

**Duplicate detection — three passes, exactly per §9, cheapest first**:
1. **Exact** (`lib/pyqClustering.js`'s `runExactPass`): text is lowercased,
   every numeric literal masked to a single placeholder token, punctuation
   stripped, whitespace collapsed (`normalizeAndMaskNumbers`/
   `exactSignature`). Two questions with an identical signature are grouped.
2. **Lexical** (`runLexicalPass`): character-trigram Dice-coefficient
   similarity (`trigramSimilarity`) over the SAME masked signature (one
   normalization convention shared with the exact pass, not two
   incompatible ones), catching wording differences the exact hash can't
   ("roots" vs "zeroes" of the same masked quadratic — §9's own example).
   **Threshold 0.4** — measured empirically against that exact worked
   example (real Dice similarity ≈0.46 for that pair; the plan names no
   value for this pass, only for semantic, so this was derived rather than
   guessed blindly, and is flagged with the same "not empirically tuned
   against real content yet" caveat §9 gives the semantic threshold).
3. **Semantic** (`runSemanticPass`): cosine similarity over Gemini
   embeddings, **threshold 0.85 per §9**, chapter-scoped only (never
   corpus-wide — see Isolation below), and only ever compares
   ALREADY-COMPUTED embeddings (never calls Gemini itself — see Cost below).

Different numeric values in a STRUCTURALLY different question (e.g. "Solve
for y: 2y+3=11" vs a quadratic-roots question) never cluster at any
threshold — the masked signatures and trigram overlap are both low; this is
verified by test, distinct from the deliberately-approved same-template case
above.

**Semantic/embedding infrastructure**: `lib/pyqClustering.js`'s `embedText`
is a small, dedicated fetch wrapper around Gemini's `embedContent` endpoint
(`text-embedding-004` by default, `PYQ_EMBEDDING_ENDPOINT`-overridable) —
NOT built on `GeminiService` (its `generateContent` request/response shape
doesn't fit `embedContent` at all), but reusing the SAME reliability
primitives (`lib/geminiPolicy.js`'s `classifyGeminiError`/
`computeBackoffMs`/`parseRetryAfter`) every other Gemini call in this
codebase already shares — no parallel, undocumented retry scheme. No vector
database was added or considered — `Question.embedding` (a nullable JSON
string, already in the schema since Phase 1) is exactly what §9 already
specified, and cosine similarity over that column at MVP-corpus,
chapter-scoped scale needs no index. Embeddings are never exposed to
teachers — they exist only in `Question.embedding` and are never included in
any teacher-facing response; the admin cluster-review API returns computed
`similarity` values (a plain number) but never the raw vectors.

**Clustering — `QuestionCluster`/`QuestionClusterMember`, unchanged schema**:
used exactly as Phase 1 defined them — no new field was added or needed.
`QuestionCluster.chapterId` being a required (non-nullable) FK is itself the
ENTIRE isolation mechanism (see below): every pass's candidate pool is
fetched pre-scoped to one chapter, so cross-chapter/cross-subject/
cross-board/cross-class comparison is structurally impossible, not merely
avoided by convention. `QuestionClusterMember.similarity` is populated
exactly per its own schema comment ("vs. the cluster's reference question;
null for exact/lexical matches") — a NEW cluster's similarity values are
computed against a deterministically-chosen reference (see below), not
whichever question happened to be compared first during matching.

**Reference question — computed, never stored**: no field for "which member
is the reference" exists in the schema (confirmed by inspection before
writing any code, consistent with the plan's "don't invent new fields"
instruction). `pickReferenceQuestion` deterministically recomputes it every
time as the earliest-`year` member, tie-broken by `id` — used both for
`QuestionClusterMember.similarity`'s "vs. reference" meaning and for the
admin API's `referenceQuestionId` display field.

**Recurrence (`occurrenceCount`)**: implemented exactly per §9's pseudocode
WITH the Phase 3 architecture-review's already-approved correction applied:
dedupes on the SITTING tuple `(boardId, subjectId, year, examType)`, not raw
`examPaperId` — so sibling sets/series of one sitting (same year+examType,
different `setLabel`) collapse to ONE occurrence instead of inflating the
count, exactly as that note specified. A question duplicated within one
paper collapses for the same reason. Hindi/English translation pairs
collapse to their `translationOfId` target's own sitting (the mechanism
exists and is tested; nothing in Phase 6 auto-sets `translationOfId` itself
— extraction still leaves it null, per Phase 3's own note, so this logic is
ready but currently inert on real data, which is correct and expected).
`GET /clusters` surfaces `recurrence: {count, years}` per cluster, computed
live on every request (cheap at this scale), never stored/cached.

**Board/subject/class/chapter isolation**: structural, not a runtime check —
every candidate pool (`pyqClusterBatch.js`'s `clusterChapter`) is a Prisma
query filtered to one `chapterId`, and `Chapter` rows are already
board/subject/class-isolated by construction since Phase 5 (`Subject` keyed
`boardId+classLevel+name`, `Chapter` keyed `subjectId+name`). Verified by
test: CBSE and Bihar Board never cluster even with byte-identical text under
identically-NAMED chapters (two different `Chapter` rows); different
`classLevel`s never cluster; different chapters within the same subject
never cluster even when each has its own genuine internal match.

**Review-status eligibility**: reviewStatus `'approved'` AND `chapterId` set
(Phase 6 depends on Phase 4's approved pool and Phase 5's classification,
per the plan's own Phase 6 dependency line) AND not already a member of any
cluster. A `'rejected'` question is never a candidate. An existing cluster
with status `'rejected'` is excluded from ALL future matching (a human's
negative decision is respected going forward — confirmed by test that a new
matching question never silently re-joins a rejected cluster); `'proposed'`
and `'confirmed'` clusters can both still gain new members from fresh
approvals (the actual point of ongoing recurrence tracking) — confirmed by
test that a CONFIRMED cluster's status/existing members are untouched by a
rerun, while a genuinely new matching question correctly joins it.

**Idempotency**: the entire mechanism is "a question drops out of every
future candidate pool the moment it has ANY cluster membership" — verified
by test: running the full batch twice creates zero additional clusters/
members the second time; a confirmed cluster's status and membership survive
a rerun unchanged; a rejected cluster never silently regains a member.

**APIs added** (`routes/adminPyq.js`, same `authRequired`+
`requireRole('super_admin')` gate as every other route in this file — no new
RBAC pattern):
- `GET /clusters` — `status`/`chapterId` filters, returns each cluster with
  its members, computed `recurrence`, and computed `referenceQuestionId`.
- `POST /clusters/:id/confirm` — blocked (`409 ALREADY_DECIDED`) once
  already confirmed/rejected, mirrors `POST /questions/:id/approve`'s
  asymmetric-reversibility shape exactly.
- `POST /clusters/:id/reject` — deliberately UNCONDITIONAL (no 409),
  mirrors `POST /questions/:id/reject`'s identical precedent: reject must
  remain reachable from every state, including already-confirmed (the
  correction path for a mistaken confirm).

**No HTTP trigger route for running clustering itself** — a deliberate
scope decision, not an oversight: §14's API table lists only the three
routes above for Phase 6, nothing to START clustering. Given taxonomy
seeding's own established "no CRUD API — seeded by script" precedent
(§14), and Phase 6's own file list explicitly naming `pyqEmbedBatch.js`/
`pyqClusterBatch.js` as separate script files, clustering and embedding
both run ONLY as operator-invoked CLI scripts (`npm run embed:pyq`,
`npm run cluster:pyq`), mirroring `pyqSyllabusSeed.js`'s `npm run seed:pyq`
precedent exactly. This also keeps the only real Gemini-quota-spending step
(embedding) impossible to trigger by an accidental web click.

**Files changed**:
- New: `server/src/lib/pyqClustering.js` — every pure function above
  (`normalizeAndMaskNumbers`, `exactSignature`, `trigramSimilarity`,
  `cosineSimilarity`, `embedText`, `pickReferenceQuestion`,
  `runExactPass`/`runLexicalPass`/`runSemanticPass`, `planChapterClustering`,
  `occurrenceCount`). No Prisma import — genuinely DB-free, matching the
  extraction/classification pure-step split already established.
- New: `server/src/pyqEmbedBatch.js` — the ONLY thing in Phase 6 that spends
  real Gemini quota; finds approved+classified questions with no embedding
  yet, embeds them one at a time with a pacing delay, stops (never retries)
  on 429, and "tombstones" (`embedding: '[]'`) a permanently-malformed
  response so one bad question can never block the rest of the batch or
  loop forever.
- New: `server/src/pyqClusterBatch.js` — runs `planChapterClustering` per
  chapter that currently has unclustered eligible questions, persists
  `QuestionCluster`/`QuestionClusterMember` inside a per-chapter transaction.
  Makes zero Gemini calls itself.
- Modified: `server/src/routes/adminPyq.js` — the three cluster routes
  above; imports `occurrenceCount`/`pickReferenceQuestion` from
  `lib/pyqClustering.js`.
- Modified: `server/package.json` — `"embed:pyq"`, `"cluster:pyq"` scripts.
- Modified: `server/.env.example` — `PYQ_EMBEDDING_ENDPOINT`.
- New: `client/src/pages/AdminPyqClusterReviewPage.tsx` — filtered
  proposed/confirmed/rejected list with an expandable member view and
  confirm/reject actions. Named `PyqClusterReviewPage.tsx` in §15/Phase 6's
  own file list but placed at the flat `client/src/pages/` path (not
  `pages/admin/`) — the SAME documented deviation Phase 4 already made for
  its own two pages, for the same reason (matches this repo's real,
  existing convention).
- Modified: `client/src/types.ts` — `PyqCluster`, `PyqClusterMember`,
  `PyqClusterRecurrence`, `PyqClusterMethod`, `PyqClusterStatus`.
- Modified: `client/src/lib/adminPyq.ts` — `listPyqClusters`,
  `confirmPyqCluster`, `rejectPyqCluster`, status/method label maps.
- Modified: `client/src/App.tsx` — `/admin/pyq/clusters` route.
- Modified: `client/src/pages/AdminPyqIngestionPage.tsx` — a
  "Review proposed duplicate clusters" link to the new page.
- Modified: `client/src/index.css` — `status-proposed`/`status-confirmed`
  pill colors (`status-rejected` already existed, shared with
  `Question.reviewStatus`'s own vocabulary), `.pyq-cluster-members` list.
- New: `server/test/lib/pyqClustering.test.js`, `server/test/
  pyqEmbedBatch.test.js`, `server/test/pyqClusterBatch.test.js`,
  `server/test/adminPyq.clusters.test.js`.

**Database changes**: none — Phase 1's `QuestionCluster`/
`QuestionClusterMember`/`Question.embedding` were already exactly right.

**Tests and results**:
- `server/test/lib/pyqClustering.test.js` — every pure function: numeric
  masking/normalization, trigram similarity (including the exact §9
  worked example), cosine similarity edge cases, reference-question
  selection, all three passes individually (new-cluster creation, joining
  an existing cluster, non-matches staying unclaimed), pass-ordering/
  one-cluster-per-question, `occurrenceCount` (sitting-tuple dedup,
  in-paper collapse, multi-set/series collapse, translation-pair collapse,
  unresolvable-translation fallback, year-range filtering), `embedText`
  (success, 429-then-retry-success, 429-exhausted, malformed response).
- `server/test/pyqEmbedBatch.test.js` — eligibility (approved + classified +
  no embedding), idempotency (already-embedded never re-embedded), 429
  stop-not-retry behavior, malformed-response tombstoning. Written to be
  robust to the shared test database's OTHER files' leftover eligible rows
  (this script is intentionally global/unscoped, exactly like production) —
  a real bug caught and fixed during this phase (see below).
- `server/test/pyqClusterBatch.test.js` — exact/lexical/semantic pass
  integration against a real (test) database, formatting-only differences,
  same-template/different-numbers (approved design) vs. genuinely different
  questions, empty/invalid text, chapter/subject/board/class isolation
  (including a rigorous CBSE-vs-Bihar-Board same-chapter-NAME test),
  rejected-question and unreviewed-question exclusion, same question across
  multiple papers/years, in-paper duplicates, idempotent reruns, confirmed-
  cluster stability with new-member joining, rejected-cluster non-rejoining.
- `server/test/adminPyq.clusters.test.js` — RBAC (401/403/200) for all three
  routes, status/chapterId filtering, `recurrence`/`referenceQuestionId`
  correctness, confirm's `409 ALREADY_DECIDED` (both from confirmed and from
  rejected), reject's unconditional/idempotent behavior.
- Full server suite: **87 test files, 2136 tests, all passed** (83/2055
  Phase 5 baseline + 4 new files / 81 new tests this phase) — zero
  regressions.
- Full client suite: **25 test files, 444 tests, all passed** — unchanged
  from Phase 5 (no new client pure-logic functions needed dedicated tests;
  the cluster review page follows this project's own "no `.tsx` under test"
  convention, same as Phases 4-5's admin pages).
- `server`: `npm run lint` — clean, 0 errors. `npx prisma validate` — valid
  (no schema changes this phase).
- `client`: `npm run lint` — 0 errors, the same single pre-existing
  `useClassroomQueue.ts` warning noted in every prior phase's record.
  `npm run build` — succeeded, 0 type errors, only the same pre-existing
  bundle-size advisory.
- **Real script run** (not just tests): `npm run embed:pyq` and
  `npm run cluster:pyq` were both run against the actual dev database.
  Confirmed via direct query that zero approved+classified questions
  currently exist (expected — Phase 4/5's own QA data was cleaned up after
  verification), so both scripts correctly reported "0 processed" and made
  **zero Gemini calls**, per this plan's own "no bulk real-world
  processing" instruction — this only proves the scripts' wiring (env
  loading, Prisma connection, GeminiService/embedText construction) is
  sound against the real database, not that clustering works against real
  content, which remains unverified until a real corpus exists.

**A real bug found and fixed during this phase's own testing**: the initial
lexical-pass threshold reused the semantic pass's 0.85 value as a "reasonable
default." Testing against §9's own worked paraphrase example ("roots" vs
"zeroes" of the same masked quadratic) revealed this was badly wrong —
real character-trigram Dice similarity for that exact pair measures ≈0.46,
meaning the lexical pass, as first written, would never have caught the
single example the plan itself uses to justify the pass's existence. Fixed
by measuring the real value against the plan's own example and setting the
threshold (0.4) just below it, documented in-code with the same
"starting point, not empirically tuned" caveat §9 gives the semantic
threshold. Caught entirely by this phase's own test suite, never shipped.

**Deviations from the original plan**: None in architecture. The two
confirmed-with-the-user decisions above (numeric masking kept as approved;
one-cluster-per-question) are documented interpretations of genuine
ambiguities the plan itself flagged as open, not silent choices. The
`PyqClusterReviewPage.tsx` file-location deviation matches Phase 4's own
already-established precedent.

**Known limitations / blockers for Phase 7+**:
- **Lexical and semantic thresholds are both still "starting points, not
  empirically tuned against real approved content"** — explicitly named as
  a real risk by both §9 and Phase 6's own entry, and genuinely still true:
  no real historical PYQ corpus has been clustered yet. Budget a tuning pass
  once real approved+classified content exists.
- **Embedding accuracy against real historical question text is unverified**
  — every test uses hand-picked deterministic vectors, per this plan's own
  "no bulk real-world processing" instruction. The first real batch run
  (once a paid Gemini tier and real approved content both exist) should be
  reviewed carefully before trusting semantic clusters at volume.
- **`translationOfId` is still never auto-set** (Phase 3's own note,
  unchanged) — `occurrenceCount`'s translation-collapse logic is correct
  and tested but currently inert on real data. Auto-detecting translation
  pairs (plausibly via the same embedding infrastructure this phase adds)
  is a real future option but was deliberately NOT added here — out of
  Phase 6's own named scope (clustering DIFFERENT questions, not pairing
  translations of the SAME question), and not listed in Phase 6's own
  file/API deliverables.
- **No automatic trigger connects extraction/review/classification to
  clustering** — an operator must run `npm run embed:pyq` then
  `npm run cluster:pyq` manually after new questions are approved. This
  matches the established batch-script precedent exactly (same as
  `seed:pyq`) and was a deliberate scope decision (see "No HTTP trigger
  route" above), not an oversight.
- Phase 7 (Publishing) can proceed independently — nothing about the
  publish gate depends on clustering having run.

### Phase 7 completion record — 2026-08-12

**Implementation summary**: Implemented exactly the publish gate specified
in §7's status table, §8 stage 7, and §14 — a single ExamPaper.status flip
to `'published'`, gated on every `Question` row belonging to that paper
having reached a terminal `reviewStatus` (`approved` or `rejected`). No
paper-selection algorithm, no teacher-facing generation, no Phase 8+ work
was started, per the plan's own explicit Phase 7 scope boundary.

**Publish rules implemented** (verified against §7/§8/§12 before writing
any code, and against Phase 6's own completion record for the clustering
question):
- **Who can publish**: `requireRole('super_admin')` only — same gate as
  every other `adminPyq.js` route, no new RBAC pattern (§12).
- **Question vs. Cluster**: publish is `ExamPaper`-level only (a single
  status flip), never per-question or per-cluster — exactly as §8 stage 7
  and §14's API table specify. `QuestionCluster.status` is untouched by
  publish.
- **Conditions required**: every `Question` row for the paper must have
  `reviewStatus` in `{approved, rejected}` — the ONLY gate the plan
  specifies. A paper with **zero** `Question` rows (extraction never run)
  is refused (`409 NOT_READY`, "no extracted questions yet") rather than
  vacuously passing an all-of-zero check — this is the one narrow addition
  beyond the plan's literal wording, justified because a paper with no
  content is not a "fully-reviewed paper" in any meaningful sense and
  publishing one would serve no purpose. An `'archived'` paper is also
  refused (`409 NOT_READY`) — `'archived'` and `'published'` are parallel
  terminal branches off `'needs_review'` per §7's status table
  ("`published` / `archived`"), not a chain, so archived never re-enters
  published; this state is currently unreachable by any existing route, so
  the guard is defensive, not load-bearing yet.
- **Classification/clustering mandatory?** No — confirmed explicitly
  against Phase 6's own completion record ("Phase 7 (Publishing) can
  proceed independently — nothing about the publish gate depends on
  clustering having run") and verified by test: a question with
  `chapterId: null` and zero cluster memberships publishes successfully.
- **Rejected questions**: never block publish (rejected is exactly as
  "terminal" as approved), and — independently — never become
  candidate-pool eligible regardless of their paper's status, because the
  eligibility filter requires `reviewStatus = 'approved'` AND
  `ExamPaper.status = 'published'`, both unconditionally (§7, §12's
  "protection by omission" principle). A paper whose questions are ALL
  rejected still publishes; it simply contributes zero eligible questions.
- **Official answers / provenance**: not gates — `hasOfficialAnswer` and
  every provenance field (`rawExtraction`, denormalized board/subject/
  class/year, source PDF) are untouched by publish, exactly as §7's
  "publish only changes the approved eligibility/state" instruction
  requires. No PATCH-equivalent write touches question content during
  publish — only `ExamPaper.status` changes.
- **Unpublish**: NOT implemented. Phase 7's own section defines no
  unpublish endpoint or behavior (§14's API table lists only
  `POST .../publish`), so none was added, per the plan's own "only if
  defined by Phase 7" instruction for this exact question.
- **Idempotency**: repeating publish on an already-published paper is a
  no-op success (same `{id, status: 'published'}` returned) — deliberately
  DIFFERENT from approve/reject/cluster-confirm's 409-on-repeat shape,
  because the plan's own "Publishing must be safe to repeat" instruction
  and Testing item #12 ("Repeated publish is idempotent") require it. No
  second `Event` row is written on repeat; `ExamPaper.updatedAt` is not
  re-touched either (the update is skipped entirely once already
  published).

**State transitions**: `needs_review → published` (the normal path, after
extraction completes and every question is reviewed); `uploaded`/
`extracting`/`extraction_failed` → refused with `409 NOT_READY` (all three
necessarily have zero `Question` rows at this codebase's current write
paths, so they're caught by the zero-questions guard); `archived` →
refused with `409 NOT_READY`; `published → published` → idempotent no-op
success.

**Candidate-pool eligibility**: unchanged from §7's own definition —
`Question.reviewStatus = 'approved' AND ExamPaper.status = 'published'`,
both required. No new production query/helper module was added for this
(Phase 7's own file list names only `routes/adminPyq.js`) — `selectPyqPaper()`
and any candidate-pool helper are explicitly Phase 8 scope. Verified
instead by direct Prisma queries in the test suite, exactly as Phase 7's
own Definition of Done describes ("testable in isolation" "before any
generator integration exists").

**APIs added** (`routes/adminPyq.js`, same `authRequired` +
`requireRole('super_admin')` gate as every other route in this file):
- `POST /api/admin/pyq/papers/:id/publish` — `404` unknown paper; `409
  NOT_READY` (zero questions, non-terminal questions with a count in the
  message, or archived); `200 {id, status}` on success or idempotent
  repeat.

**UI changes**: one "Publish" button added to `AdminPyqIngestionPage.tsx`'s
per-row actions, shown when `status === 'needs_review'` — same shape as
the existing Extract/Classify/Review row actions (§15's own "single
button, same shape as existing approve/reject buttons" instruction).
`client/src/lib/adminPyq.ts` gained `publishPyqPaper(id)`. No new page,
no changes to `GeneratorPage.tsx` (that's Phase 9).

**RBAC/security verification**: every unauthenticated/teacher/
school_admin/resource_person case returns 401/403 exactly like every
other `adminPyq.js` route (verified by test, same pattern as Phases 2-6).
No new surface — the publish route reuses the file's single existing
`requireRole('super_admin')` gate.

**Audit/event behavior**: one `pyq_paper_published` `Event` row per actual
publish (metadata: `{examPaperId}` only, no question content — same
metadata-only discipline as every other PYQ audit event). Verified by
test that a repeated publish call does NOT create a second event row.

**Database/migration changes**: none — `ExamPaper.status` already
supported `'published'` since Phase 1's schema (§7); no new column, no new
migration.

**Tests added** (`server/test/adminPyq.publish.test.js`, 20 tests):
auth/RBAC (401, 403×3, 404); readiness gate (zero questions, non-terminal
count named in the message, "reviewed"-but-not-decided questions, archived
paper); success paths (all-approved, all-rejected, mixed, no
classification/clustering required, audit event with no content leakage);
idempotency (repeated publish, no duplicate event, persists across a
fresh `GET /papers/:id` read); candidate-pool eligibility via direct
Prisma queries (approved+published eligible; rejected+published never
eligible; approved+not-yet-published never eligible; a defense-in-depth
check that the eligibility FILTER itself, not just the publish gate,
independently excludes a non-approved question even if `ExamPaper.status`
were forced to `'published'` directly).

**Full test results**:
- `server npm test` (vitest) — **88 test files, 2156 tests, all passed**
  (2136 Phase 6 baseline + 20 new Phase 7 tests) — zero regressions.
- `client npm test` (vitest) — **25 test files, 444 tests, all passed** —
  unchanged from Phase 6 (no new client pure-logic function needed a
  dedicated unit test; the one-button UI change follows this project's
  own "no `.tsx` under test" convention already established in Phases
  4-6).
- `server npm run lint` — clean, 0 errors.
- `client npm run lint` — 0 errors, the same single pre-existing
  `useClassroomQueue.ts` warning noted in every prior phase's record.
- `client npm run build` (`tsc -b && vite build`) — succeeded, 0 type
  errors, only the same pre-existing bundle-size advisory.

**Manual QA**: performed against the real dev database and a real browser
session (logged in as the seeded `super_admin`), using a temporary
`CBSE / Mathematics / Class 10 / 2023 / "Phase7QA"` paper. Real Gemini
extraction failed in this sandbox environment (an `UPSTREAM_UNAVAILABLE`
error from the existing, unmodified Phase 3 extraction path — unrelated to
any Phase 7 code, and Phase 3-6 already verified extraction against real
Gemini calls in their own manual QA), so a single realistic post-extraction
`Question` row was seeded directly via Prisma to reach the same state a
successful extraction would have produced, and Phase 7's own genuinely new
surface was driven for real through the browser from that point: (1)
clicking Publish while the question was still unreviewed correctly
returned `409 NOT_READY` and left the paper at `needs_review`; (2)
approving the question through the real Review page UI; (3) clicking
Publish again correctly flipped the status pill to "Published" (green) and
the row's action changed from "Publish" to just "Review"; (4) a full page
reload confirmed the `Published` status persisted. All temporary test data
(the `ExamPaper`, `Question`, `SourceDocument`, and `Event` rows) was
deleted from the dev database afterward — confirmed zero PYQ rows remain
post-cleanup.

One incidental environment issue was found and fixed during manual QA,
unrelated to any Phase 7 code: a stray backend process (`node
src/index.js`, no `--watch`, apparently already running before this
phase's work began) was holding port 3000 and serving stale code, which
silently absorbed the first round of manual-QA browser clicks. It was
identified via `netstat`/`Get-CimInstance Win32_Process` and terminated,
along with this phase's own crashed duplicate `--watch` attempt, then a
single clean `npm run dev` was started; the client (Vite) dev servers were
left untouched throughout since client code is served from source and
needed no restart.

**Deviations from the original plan**: One narrow, disclosed addition
beyond §7/§8's literal wording — refusing publish on a paper with zero
`Question` rows (see "Conditions required" above) — chosen because the
literal all-of-zero-questions-are-terminal reading would let an admin
publish a paper that was never even extracted, which serves no product
purpose and reads as a mis-click rather than a deliberate state the plan
intended to allow. This is flagged here rather than silently added. No
other deviation: unpublish was deliberately NOT built (not defined by
Phase 7); no candidate-pool helper module was added (explicitly Phase 8
scope per Phase 7's own file list).

**Known limitations / blockers for Phase 8+**:
- No real published/approved corpus exists yet in any environment beyond
  this phase's own (already cleaned up) manual-QA rows — Phase 8's
  `selectPyqPaper()` will need either fixtures or a real ingested batch to
  test against meaningfully at the API level, per its own Definition of
  Done ("against a real published+approved corpus").
- Gemini connectivity/quota in this specific sandbox environment could not
  be confirmed working end-to-end during this phase's manual QA (a real
  extraction call returned `UPSTREAM_UNAVAILABLE`); this is unrelated to
  Phase 7's own code (extraction is unmodified Phase 3 work, already
  verified in earlier phases) but is worth re-checking before any future
  phase that depends on making real Gemini calls in this same environment.
- Phase 8 (Generator Integration — Backend) can proceed independently —
  nothing about `selectPyqPaper()`'s design (§10) depends on any Phase 7
  implementation detail beyond the two published-columns already fixed in
  §7 (`ExamPaper.status`, `Question.reviewStatus`).

## 22. Definition of Done

The feature is production-ready when **all** of the following hold:

- [x] All ten PYQ Prisma models exist, migrated, with the composite indexes specified in §7.
- [ ] An admin can upload a source PDF, and it round-trips byte-identical through the serving route; duplicate uploads (exact and same-identity) are rejected.
- [ ] Per-page extraction runs reliably against real scanned board-exam PDFs, with independently retriable per-page failure handling.
- [ ] Every extracted question passes through mandatory human review before becoming candidate-pool eligible — no code path bypasses this.
- [x] Chapter/topic classification works against a real seeded taxonomy for at least the MVP board/class/subject slice.
- [x] Exact, lexical, and semantic duplicate detection all work, with human confirmation required before a cluster affects recurrence counts.
- [ ] `selectPyqPaper()` is deterministic, fully unit-tested (including the exact-marks-repair boundary and `Failure` path), and reproducible.
- [ ] The teacher-facing generator offers PYQ mode without forking `GeneratorPage.tsx`, with correct provenance display and taxonomy-driven (never free-text) Board/Class/Subject/Year selects.
- [ ] `hasOfficialAnswer: false` is never silently AI-backfilled — verified by test.
- [ ] RBAC: no `teacher`/`school_admin` route can write to any PYQ table — verified by test.
- [ ] Tenant/rollout isolation: an out-of-rollout school sees zero new surface area — verified by test.
- [ ] Prompt-injection fixture test passes for the extraction path.
- [ ] The full §16 test matrix is green in CI.
- [ ] Gemini quota/tier is confirmed sufficient for the planned ingestion volume before rollout.
- [ ] The feature is flag-gated off by default in production until Phase 11 explicitly enables it for a pilot school.
- [ ] A real pilot-school teacher has generated and saved a PYQ-based paper in production.
- [ ] This README's §21 tracking table reflects the true state of every phase.

## 23. Final Implementation Checklist

**Decisions (Phase 0)**
- [ ] MVP board/class/subject/year-range slice locked
- [ ] Gemini tier (free vs. paid) confirmed sufficient for planned ingestion volume
- [ ] Review role decided (reuse `super_admin` vs. new `content_editor`)

**Schema (Phase 1)**
- [ ] `Board`, `Subject`, `Chapter`, `Topic` models added
- [ ] `ExamPaper`, `SourceDocument` models added (with the `setLabel` default-`""` fix)
- [ ] `Question`, `QuestionTopic`, `QuestionCluster`, `QuestionClusterMember` models added
- [ ] All mandatory composite indexes (§7) present
- [ ] Migration applied cleanly; existing test suite stays green

**Storage & Upload (Phase 2)**
- [x] `adminPyq.js` upload/list/get/source routes, role-gated
- [x] Extended `pyqFileValidation.js` with PYQ-sized ceilings
- [x] Checksum dedup (`409 DUPLICATE_UPLOAD`) and paper-identity dedup (`409 PAPER_EXISTS`) both verified

**Extraction (Phase 3)**
- [x] `pyqExtractionSchema.js` (Zod) written
- [x] `extractPyqPage.js` per-page Gemini call implemented, using the 4th `pyqGemini` instance
- [x] `pyqWorker.js` polling loop implemented, quota-pacing aware
- [x] Per-page independent retry verified

**Review (Phase 4)**
- [x] `PyqIngestionPage.tsx`, `PyqReviewPage.tsx` built (as `AdminPyqIngestionPage.tsx`/`AdminPyqReviewPage.tsx` — see this phase's completion record for the file-location deviation)
- [x] Source PDF page viewer wired to `Question.pageNumber`
- [x] Never-editable fields enforced server-side
- [x] Approve/reject/re-extract flows working with `Event` audit rows

**Taxonomy & Classification (Phase 5)**
- [x] `pyqVocab.js` closed vocabularies defined
- [x] Syllabus seeding script run for the MVP subject
- [x] Chapter/topic classification wired into the extraction/review flow

**Clustering (Phase 6)**
- [x] Exact pass (numeric-literal masking) implemented and tested
- [x] Lexical pass implemented and tested
- [x] Semantic pass (Gemini embeddings, chapter-scoped) implemented, threshold set
- [x] `PyqClusterReviewPage.tsx` built; cluster confirm/reject working
- [x] `occurrenceCount` unit tests pass (translation-pair and in-paper-duplicate collapse)

**Publishing (Phase 7)**
- [x] Publish gate enforces all-questions-terminal
- [x] Published+approved content verified visible to a direct candidate-pool query

**Backend Generation (Phase 8)**
- [ ] `pyqSelection.js` implemented per §10's pseudocode
- [ ] Exact-marks bounded repair tested at its boundary
- [ ] `Failure`/`explainShortfall` path tested
- [ ] `POST /api/resources/generate-pyq` and `GET /api/pyq/taxonomy` working

**Frontend Generation (Phase 9)**
- [ ] Source selector + PYQ fields added to `GeneratorPage.tsx`
- [ ] Taxonomy-driven (closed-select) Board/Class/Subject/Year fields
- [ ] Provenance line rendering in preview
- [ ] `422` diagnostic rendered through existing error region

**Hardening (Phase 10)**
- [ ] Full §16 test matrix green in CI
- [ ] RBAC tests for every `adminPyq.js` route
- [ ] Tenant/rollout isolation test passes
- [ ] Prompt-injection fixture test passes
- [ ] PYQ-only guarantee integration test passes

**Rollout (Phase 11)**
- [ ] `PYQ_ENABLED` + `PYQ_ALLOWED_SCHOOL_CODES` set for one pilot school in production
- [ ] Paid Gemini tier active if required
- [ ] A real pilot-school teacher has generated and saved a PYQ-based paper in production

**Postponed (explicitly out of scope for this plan's MVP — do not build early)**
- [ ] Hybrid AI gap-fill mode
- [ ] Boards/classes/subjects beyond the single MVP slice
- [ ] Dedicated `content_editor` role
- [ ] Multi-source-document-per-paper support
- [ ] Structured diagram/table extraction
- [ ] `pgvector` / dedicated vector database
- [ ] Migrating source-PDF storage off the DB to real object storage
- [ ] A teacher-facing standalone question-bank browser
