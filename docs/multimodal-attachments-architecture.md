# Multimodal Attachments — Architecture

**Status:** Implemented (Phase 1 + multi-attachment) · **Owner:** Teacher Assistant engineering

> Companion documents: [`ai-action-router-architecture.md`](./ai-action-router-architecture.md) (the
> feature this one deliberately does NOT extend — see "Relationship to the AI Action Router" below).

## Amendment log

**Multi-attachment upgrade.** Phase 1 shipped single-file only. A follow-up UX pass required true
multi-file support (several images and/or a PDF attached to ONE message, reasoned over together by
Gemini in a single call) — a real backend/pipeline change, called out and explicitly approved before
implementation rather than assumed. §2, §4, §5, §6, and §9 below describe the current (array-based)
shape; single-file is simply the one-element case throughout, not a separate code path.

## 1. What this is

Lets a teacher attach one or more JPEG/PNG/WEBP images and/or PDFs to a Coach question — "Solve
Question 5" over a photographed worksheet, "Explain these two pages together" over several photos,
"Summarize this chapter" over a PDF. Voice and typed text needed no backend change (voice is
transcribed client-side by the Web Speech API before it ever reaches the server); this feature adds
the two genuinely new input modalities, images and PDFs.

## 2. Architecture overview

A sibling of Coach, not an extension of the AI Action Router. `POST /api/coach/attachment` is a new
endpoint returning the same response envelope as `POST /api/coach`, sharing one small, additive
extension to `gemini.js` and nothing else. `/api/coach` itself, `/api/assistant/*`, and every existing
test are untouched.

Files are **never written to disk or the database**. Multer's `memoryStorage` buffers an upload in
process memory for the duration of one request; the buffer is base64-encoded into a Gemini
`inlineData` part, sent, and discarded. No migration, no storage bucket, no cleanup job — Railway's
filesystem is ephemeral and the project stays on SQLite until Postgres is set up, so "never persist
it" is both the simplest and the correct answer here.

```
CLIENT                                          SERVER
Composer + attachment tray (flag-gated)
  │ files selected → client-side batch validate
  │ (type/size/count/combined-size, courtesy only)
  │ → compact chip tray, "+N more", remove/clear-all
  ▼
submit (text ± attachments[]) ───────────────►   multipart, repeated 'files' fields
  │                                                 │
  │ no attachments                                  │ one or more
  ▼                                                 ▼
POST /api/coach (unchanged)              POST /api/coach/attachment
                                            1. authn + rollout flags (before multer runs)
                                            2. multer memoryStorage, .array('files', maxFiles)
                                            3. per-file magic-byte sniff + allowlist + PDF page estimate,
                                               PLUS batch count cap + combined-size cap
                                            4. normalize query text (existing inputGuard)
                                            5. per-user daily budget (one unit per REQUEST, not per file)
                                            6. describeAttachment() → gemini.generateContent({..., attachments: [...]})
                                               — ALL files in ONE call, same contents block
                                            7. sanitizeOutput (existing, inside gemini.js)
                                            8. respond — SAME envelope shape as /api/coach, ONE answer
                                            (buffers discarded, nothing persisted)
```

## 3. Relationship to the AI Action Router

**Deliberately not extended, and not bypassed forever — fed later, through the front door.**

The Router's job (per its own architecture doc, §2.1 and §3.4 invariant 2) is classifying a text
utterance into a registered navigation/prefill action; "the router adds no capability — only things a
teacher could already do by clicking." Understanding an uploaded photo is a new capability, so by the
Router's own rule it does not belong there. It also runs on a deliberately starved second
`GeminiService` instance (`geminiFast` — 512 output tokens, 3.5s/call) sized for emitting a small JSON
classification, not for vision tokens and a written answer.

A message with an attachment therefore skips the client-side intent gate entirely and goes straight to
`POST /api/coach/attachment` — the same outcome the Router would produce anyway for an open-ended
question (passthrough to Coach), just without spending a classification call to learn it.

**This is not a permanent wall.** The extraction seam below (§5) is the reused path for a future
action-shaped attachment request ("generate a quiz from this worksheet"): extract text from the file,
feed that text into the *existing, unmodified* `interpret()` pipeline as an utterance, let the Router
resolve it exactly as it would resolve typed text. The Router never needs to learn about file bytes;
it keeps trusting text, which is what makes it cheap and safe today.

## 4. Gemini integration

`server/src/gemini.js`'s `buildRequestBody`/`generateContent` gained one optional parameter:
`attachments: Array<{ mimeType, data }>` (base64), each appended as its own `parts` entry alongside
the text part, **all in the same `contents` block** — one logical Gemini call carries the whole batch,
never one call per file, so the model reasons over every attachment and the question together.
Omitted or empty, behavior is byte-for-byte identical to every existing caller (`/coach`,
`/resources/generate`, `ai-action`) — this was verified with a dedicated backward-compatibility test
(`server/test/gemini.multimodal.test.js`), including the exact single-attachment shape Phase 1
originally shipped.

A third `GeminiService` instance (`attachmentGemini`, alongside `gemini` and `geminiFast`) has its own
timeout/retry/output-token tunables (`ATTACHMENT_LLM_*` in `.env.example`) — multimodal calls are
slower and costlier than either text-only coaching or classification, and isolating the budget keeps a
slow attachment request from ever affecting Coach's or the Router's own deadlines.

No `responseSchema` is used — the response is free-form prose, symmetric with how Coach already works,
rather than inventing a new structured-output contract for Phase 1.

## 5. The extraction seam

`server/src/attachments/describeAttachment.js` exports one function:

```
describeAttachment({ gemini, attachments: [{ buffer, mimeType }, ...], query, language, correlationId }) → { text, metrics }
```

It builds the trusted systemInstruction + delimited untrusted userText (same
systemInstruction/`contents` boundary discipline used throughout `routes/resources.js` and
`prompts.js` — every attachment's bytes and the teacher's question are all untrusted user-turn
content, never instructions, even if any of them contains adversarial text) and makes ONE
`generateContent` call carrying every attachment. A small helper, `describeAttachmentSet`, turns the
list of mimeTypes into a natural-language phrase ("an image", "2 images and a PDF document") so the
prompt reads naturally whether the teacher attached one file or several of mixed types — see the
"singular vs. plural wording" cases in `server/test/attachments/describeAttachment.test.js`.

**Deliberately a plain function in a leaf module, not a class or a formal "layer" yet.** It has exactly
one consumer today (the attachment route). Promoting it to a fuller module (multi-format dispatch,
a typed/versioned output contract) is the right move at the moment a *second* real consumer exists —
mirroring `lib/resourceFields.js`'s own documented promotion trigger ("born the moment a second file
needs it") — not before. Building a formal contract against a guessed future need (see §3's
Router-feed scenario, or a structured "extract the questions from this exam paper" case) risks
designing it wrong and redesigning anyway once the real second consumer's requirements are known.

**Why one call, not "describe, then answer" — and why one call for the WHOLE BATCH, not one call per
file:** the `query` parameter IS the prompt. Today's caller passes the teacher's own question ("Solve
Question 5") and the model's answer to it is the response. A future Router-feed caller would pass a
neutral extraction prompt ("Describe these files' content in plain text") to get derived text instead.
Same function, same one Gemini call, different instruction — not two calls, which would double
cost/latency and lose fidelity between an "extract" pass and an "answer" pass. And when several files
are attached, they all go in that SAME one call rather than being fanned out one-request-per-file: a
teacher attaching three pages of the same worksheet is asking one question about the complete set, and
only a single call where Gemini sees every page at once can actually answer that — N independent calls
would produce N independent, uncoordinated answers with no way to merge them back into one coherent
response.

## 6. Validation and security

`server/src/lib/fileValidation.js` — a leaf module, no HTTP/multer knowledge:

- **Magic-byte sniffing**, not the declared `Content-Type`. A client's declared MIME type is exactly
  as spoofable as any other client-supplied value; the only trustworthy signal is the actual leading
  bytes, checked against each format's published signature (JPEG `FFD8FF`, PNG's 8-byte signature,
  WEBP's `RIFF`+`WEBP` tag pair, PDF's `%PDF-`). Covered by `server/test/lib/fileValidation.test.js`,
  including a spoofed-extension case (real PNG bytes declared as `image/jpeg`).
- **Hard allowlist** (JPEG/PNG/WEBP/PDF) — not env-configurable, unlike most tunables in this app;
  widening it is a code change with its own review.
- **Byte-size cap** (`ATTACHMENT_MAX_FILE_SIZE_MB`, default 8), per file, via both multer's own
  `limits.fileSize` and a second check inside the handler.
- **PDF page-count estimate** (`ATTACHMENT_MAX_PDF_PAGES`, default 30), per file — a cheap
  `/Type /Page` marker count, not a real parse. A byte-size cap alone does not bound Gemini's per-page
  processing cost for a PDF (a well-compressed multi-hundred-page PDF can be small in bytes); an
  unknown page count fails OPEN rather than rejecting, since this is a cost guard, not a correctness
  gate.
- **Batch file-count cap** (`ATTACHMENT_MAX_FILES`, default 5) — checked BEFORE any byte is sniffed,
  so an over-large batch fails fast.
- **Batch combined-size cap** (`ATTACHMENT_MAX_TOTAL_SIZE_MB`, default 15) — a SEPARATE guard from
  `maxFileSizeMb x maxFiles`, in `lib/fileValidation.js`'s `validateAttachmentBatch`. Gemini's
  inline-data request ceiling is a property of the WHOLE request, and base64 adds ~33% on top of raw
  bytes, so several files each just under the per-file cap could still add up to a request too large
  or too slow for Gemini's inline-data path — 15MB raw stays comfortably under Gemini's ~20MB
  inline-request ceiling once that overhead is added. A batch fails on the FIRST problem found (one
  bad file, too many files, or too much combined weight) rather than silently dropping the offending
  file(s) — the whole request is one message, so a bad file in it means the whole message failed to
  attach, matching `validateAttachment`'s own "one clear reason" contract.
- **No malware surface by construction**: files are never written to disk, never executed, never
  served back to any user.
- **Prompt injection via file content**: no special handling needed beyond what already exists — the
  file is `contents`, never `systemInstruction`, so adversarial text inside an image gets no more
  privilege than adversarial typed text does today.

## 7. Rollout

Mirrors the AI Action Router's proven flag discipline exactly:

- **Server kill switch**: `ATTACHMENTS_ENABLED` (default `false`). `POST /api/coach/attachment`
  returns 503 and never buffers an upload when off or out of an optional school allow-list
  (`ATTACHMENT_ALLOWED_SCHOOL_CODES`).
- **Client gate**: `VITE_ATTACHMENTS_ENABLED` (default `false`). When off, the Composer never renders
  the attach button at all — a deployment that sets nothing shows zero new UI, not a button that
  errors when pressed. This is a UX gate, not the incident control; per-app PWA caching means the
  server flag is what takes effect within a minute for already-loaded clients.
- **Cost controls**: a dedicated rate limiter (`ATTACHMENT_RATE_LIMIT_MAX_REQUESTS`, tighter than
  `/coach`'s) and a per-user daily budget (`ATTACHMENT_DAILY_BUDGET_PER_USER`, default 20 — lower than
  the Router's own budget, since this is the single most expensive request shape in the product). Both
  ship from day one, rather than being added after the fact the way `/resources/generate`'s limiter
  was (M9).

## 8. Known Phase 1 limitation — single-turn only

There is no way to ask a follow-up question about an already-submitted attachment without re-attaching
the file. This is a conscious scope cut, not an oversight: Coach is stateless per turn by design (the
client resends context on every call), and nothing about this feature persists a file or its extracted
content anywhere a later turn could reference it. Concretely in the client:

- `MessageBubble` suppresses the canned follow-up chips ("Make it simpler," "Create a worksheet")
  for any turn carrying an attachment, since resubmitting those through plain-text `/coach` would ask
  about "this file" with no file attached.
- Retrying a failed attachment turn shows a toast asking the teacher to re-attach and ask again,
  rather than silently retrying without the file (`CoachPage.handleRetry`).

Revisiting this is a real, separate storage-strategy decision (keep the file, or its extracted text,
somewhere for the session) — deliberately out of scope here. Multiple attachments on ONE turn does
not reopen this: all files on a turn are still sent and answered together in the single request that
created that turn; there is still no cross-turn memory of any file.

## 9. The attachment tray (UX)

`client/src/components/AttachmentTray.tsx` is the one place chip rendering logic lives — reused
as-is for both the editable pre-send tray (`Composer`, with remove/clear-all wired up) and the
read-only display of a past message's attachments (`MessageBubble`, neither passed). It is
deliberately decoupled from `useAttachments`' `SelectedAttachment` (which carries a live `File` and
only exists pre-send) via a minimal `AttachmentTrayItem` shape (`{ id, name, kind, previewUrl? }`) —
a sent message has only display metadata (`types.ts`'s `AttachmentMeta`, no `File`, no live object
URL), so both callers adapt to this shared shape rather than the component branching on which caller
it is.

Compact by construction: a fixed number of chips show (`ATTACHMENT_TRAY_VISIBLE_COUNT`, default 3),
the rest collapse behind a clickable "+N more" that expands in place (and "Show less" to re-collapse);
the chip row itself wraps (`flex-wrap`) and is height-bounded with internal scroll
(`max-height` + `overflow-y: auto`) so an expanded tray with many files never grows the page
unboundedly tall. Icon-per-kind is one lookup table (`KIND_ICONS`) — only `image` and `pdf` exist
today, but adding a future kind (DOCX, PPTX, TXT, an OCR output) is a two-line change there and in
`AttachmentKind`/`ALLOWED_ATTACHMENT_MIME_TYPES`, not a redesign of the tray itself.

`client/src/hooks/useAttachments.ts` manages the live pre-send collection: `add(files)` runs a batch
validation (`lib/attachmentValidation.ts`'s `validateNewAttachments` — per-file type/size plus the
tray-wide count and combined-size caps, mirroring the server's own batch limits) and accepts as many
of the newly-picked files as fit rather than rejecting the whole selection; `remove(id)` drops one;
`clear()` drops all. Every image gets an object URL for its thumbnail, tracked in a `Map` keyed by
attachment id and revoked on remove/clear/unmount — never left to leak.

## 10. Files

**Backend — added:** `src/lib/fileValidation.js` (`validateAttachment` per-file, `validateAttachmentBatch`
for the count/combined-size checks), `src/attachments/describeAttachment.js`, `src/routes/attachments.js`,
plus `test/lib/fileValidation.test.js`, `test/attachments/describeAttachment.test.js`,
`test/attachments.test.js`, `test/gemini.multimodal.test.js`.
**Backend — modified:** `src/gemini.js` (`attachments` array param), `src/index.js` (third
`GeminiService` instance, budget, limiter, route mount), `src/lib/flags.js` (`readAttachmentFlags`,
now including `maxFiles`/`maxTotalSizeMb`), `.env.example`, `package.json` (added `multer`).

**Frontend — added:** `src/hooks/useAttachments.ts`, `src/components/AttachmentTray.tsx`,
`src/lib/attachmentValidation.ts` (+ `.test.ts`, now including `validateNewAttachments`).
**Frontend — modified:** `src/api.ts` (FormData body support), `src/config.ts` (attachment +
batch constants, `ATTACHMENTS_ENABLED`), `src/types.ts` (`Turn.attachments[]`),
`src/components/Composer.tsx` (multi-select attach button, flag-gated, renders `AttachmentTray`),
`src/components/MessageBubble.tsx` (read-only `AttachmentTray`, suppressed follow-ups),
`src/pages/CoachPage.tsx` (`runTurnWithAttachments`/`submitTurnWithAttachments`, retry guard),
`src/index.css`, `.env.example`, `vitest.config.ts` (added `src/lib/**/*.test.ts` to the existing
pure-logic-only test scope — no React Testing Library, no component rendering, per that file's own
documented decision).
