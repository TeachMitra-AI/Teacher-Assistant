# Read-Aloud — Manual Testing Guide

> **Scope:** the Read-Aloud (text-to-speech) button on Coach response cards.
> Code: `client/src/components/ResponseCard.tsx`, `client/src/lib/tts.ts` (voice choice, chunked playback,
> stop/replace ownership), `client/src/lib/speechText.ts` (Markdown → speakable text).
> General app QA lives in [`MANUAL-TESTING-GUIDE.md`](./MANUAL-TESTING-GUIDE.md).

## 1. Automated vs manual — read this first

| Kind | What it proves | What it cannot prove |
| --- | --- | --- |
| **Automated** (Vitest, §8) | Text cleaning, chunking, voice selection, stop/replace/unmount logic, button state — against a *mocked* `speechSynthesis`. | That a real browser engine produces audible speech. |
| **Manual** (§5–§7) | Real Chrome + real `speechSynthesis` + real AI responses: engine events, voice picked, UI state. | Audio quality/intelligibility **unless a human listens**. |

**Audio limitation of the 2026-10-11 run:** the browser was driven by automation, so no one listened.
"Speech started" below means the browser engine reported `speaking === true` and fired real
`start`/`end` events with speech-like durations (~10 characters/second). It is strong evidence, **not** an
audible confirmation. A human re-run of the "Audible?" column (§6) is still required for sign-off.

## 2. Prerequisites and setup

- Node 18+ (20 recommended), Chrome/Chromium (the run below used Chrome 154, Windows 11).
- A working `server/.env` with a Gemini key (AI responses are needed; existing chat history can be reused for
  cases that don't need new answers).
- OS text-to-speech voices installed. Check in the DevTools console:
  `speechSynthesis.getVoices().map(v => v.name + ' ' + v.lang)`.

```bash
cd server && npm run seed && npm run dev      # API on http://localhost:3000  (health: /api/health)
cd client && npm run dev                      # open http://localhost:5173 in Chrome
```

Sign in with a seeded demo teacher (see README → *Demo accounts*; development only), pick a school if
prompted, and use the **Coach** tab. Response language is set in the top-right **tune/filters menu →
Language** (not detected from the text).

### Observing playback without listening (optional spy)

Paste in the console to log every utterance/event while leaving real speech untouched:

```js
const L = window.__spy = [], S = speechSynthesis, os = S.speak.bind(S), oc = S.cancel.bind(S);
S.speak = u => { L.push({ ev:'speak', lang:u.lang, voice:u.voice?.name, text:u.text });
  ['start','end','error'].forEach(e => u.addEventListener(e, x => L.push({ ev:e, err:x.error })));
  return os(u); };
S.cancel = () => { L.push({ ev:'cancel' }); return oc(); };
```

## 3. Behaviour to know before testing

- Controls are **Read aloud ⇄ Stop reading** only. **There is no Pause/Resume** in this implementation, so
  those cases are *Not applicable*.
- Long text is spoken as a queue of ~200-character chunks, one at a time.
- Voice = the language chosen in the filters menu (`SPEECH_LOCALE`: en-US, hi-IN, bn-IN, te-IN, mr-IN,
  ta-IN, gu-IN, kn-IN, or-IN; **Hinglish → hi-IN**). Response text is not language-detected.
- Starting another card replaces the current speech; unmounting/changing the response stops it.
- Fractions are spoken as "3 by 4"; `/` and `=` are read as words; URLs and Markdown symbols are removed.

## 4. Test cases

Status values: **Pass / Fail / Blocked / Not applicable / Not run**.

| ID | Case | Steps | Expected |
| --- | --- | --- | --- |
| RA-01 | Short response plays | Click *Read aloud* | Speech starts; button → *Stop reading* |
| RA-02 | Long response, sequential chunks | Play a multi-paragraph answer | Chunks in order, no skip/repeat, short gaps |
| RA-03 | Natural completion | Let speech finish | Button returns to *Read aloud* |
| RA-04 | Stop | Click *Stop reading* mid-speech | Speech stops immediately; label resets |
| RA-05 | Replace | While card A plays, start card B | A stops, B plays, only one *Stop reading* |
| RA-06 | Unmount / chat switch | Play, then open another chat | Speech stops |
| RA-07 | Numbered/bulleted lists | Play an answer with lists | Items read in order; labels kept with items |
| RA-08 | MCQs | Play MCQs with A–D options + answer key | Question → options → key, in order |
| RA-09 | Table | Play an answer with a table | Rows read as "Column: value" lines |
| RA-10 | Prices | Text containing `Rs. 45.50` | Read as one phrase, no break inside the price |
| RA-11 | Math | `3/4 + 1/2 = 5/4` | Spoken as words |
| RA-12 | Links | Answer with a URL | URL not read out |
| RA-13 | English voice | Language = English | en-US voice |
| RA-14 | Hindi | Language = Hindi | hi-IN voice |
| RA-15 | Hinglish | Language = Hinglish | hi-IN voice |
| RA-16 | Other Indian language, voice absent | Bengali/Tamil on a device with no such voice | Clear "no voice" message or sensible fallback |
| RA-17 | Pause/Resume | — | Not supported |
| RA-18 | Console errors | Watch console during the above | No errors |
| RA-19 | Accessibility | Tab to button, Enter/Space; read label | Labelled, keyboard-operable, label changes with state |
| RA-20 | Browser compatibility | Chrome, Edge, Firefox, Safari, Android Chrome | Works or fails gracefully (button hidden/disabled when unsupported) |

## 5. Results — run of 2026-10-11

**Environment:** branch `feature/read-aloud-speech-text-clean` (uncommitted working tree), Chrome 154 /
Windows 11 driven by browser automation, frontend `http://localhost:5173`, backend `http://localhost:3000`,
seeded demo teacher account, 22 installed voices (including `Google हिन्दी` hi-IN and
`Microsoft David` en-US; **no** bn/ta/te/mr/gu/kn/or voices). Audio was **not** listened to.

| ID | Expected | Actual | Status | Remarks |
| --- | --- | --- | --- | --- |
| RA-01 | Speech starts | Engine `speaking=true`, real `start` event ~0.4 s after click, voice `Microsoft David`, label → *Stop reading* | **Pass** (engine-level; not audibly confirmed) | Real mouse click and clicks via script both worked |
| RA-02 | Ordered chunks | Real playback: chunks of 65/187/160 chars arrived in text order, ~0.17 s between chunks, chunk durations scale with length (4.7 s for 65 chars). Whole-answer order checked on a 25-chunk MCQ answer with the engine **stubbed** (text order only, no audio) — no skipped or repeated content | **Pass** (order); audible pauses **Blocked** | Full long answer was not played to the end in real time |
| RA-03 | Label resets at end | Real engine: a one-sentence utterance via `speak()` ended after 4.8 s with `onEnd` called. Label reset after the last chunk verified only with a stubbed engine | **Pass** (partial) | Never saw a *card* finish a long answer with the real engine |
| RA-04 | Stops | `cancel` issued, engine `speaking=false`, `pending=false`, utterance error `interrupted` (treated as intentional), label → *Read aloud* | **Pass** | Triggered via script click, not a mouse click |
| RA-05 | Old speech does not continue | Starting card B while A played: A got `interrupted`, B started, labels `[Read aloud, Stop reading, …]` (exactly one Stop), no stray old chunks | **Pass** | |
| RA-06 | Stops on unmount | Playing, then switched chat: `speaking=false`, `pending=false`, 0 *Stop reading* buttons | **Pass** | |
| RA-07 | List order/labels | "1. Write the expression: 3 by 4 plus 1 by 2." / "2. Show that…" / "3. Add the numerators…" kept in order, labels attached to items | **Pass** | An existing answer has "3. … 4. …" on one line in its source; read as written |
| RA-08 | MCQ order | `Q1.` → question → `A) … D)` → `Q2.` … → `Answer Key: 1. B…` correct order | **Pass** (text) | See defect D-3 (pause after "Q1.") |
| RA-09 | Table rows | Read as "Fraction: 1 by 4, Decimal: 0.25, Meaning: Quarter." per row | **Pass** (text) | |
| RA-10 | No break in price | `Rs.` and `45.50` landed in **different chunks** (3 of 3 occurrences) | **Fail** | Defect D-1 |
| RA-11 | Math as words | "3 divided by 4 plus 1 divided by 2 equals 4 divided by 6"; "3 by 4 plus 1 by 2" | **Pass** (text) | "1 1/4" is read "1 1 by 4" — D-4 |
| RA-12 | URL not read | No answer with a URL was generated/inspected | **Blocked** | Covered by automated tests only |
| RA-13 | en-US voice | `lang: en-US`, `Microsoft David` | **Pass** | |
| RA-14 | Hindi voice | With Hindi selected: `lang: hi-IN`, voice `Google हिन्दी`, started and advanced through chunks. With English selected, Hindi text is spoken with the English voice (by design, §3) | **Pass** (engine-level; pronunciation not heard) | See D-5 note |
| RA-15 | Hinglish | `speak(…, 'hinglish')` → `hi-IN`, `Google हिन्दी` | **Pass** (engine-level) | Done through the app's `speak()` helper, not the UI picker |
| RA-16 | No-voice handling | Bengali: requested `bn-IN` with no voice; no error or toast surfaced. Tamil: same. Could not tell what (if anything) the browser played | **Blocked** (outcome unverified) | Needs a listener; see D-2. Telugu/Marathi/Gujarati/Kannada/Odia not tried |
| RA-17 | Pause/Resume | Not implemented | **Not applicable** | |
| RA-18 | No console errors | Console tracking attached mid-session; no errors/exceptions reported | **Pass** (limited) | Messages before tracking began aren't covered |
| RA-19 | Accessibility | Button has `aria-label` *Read aloud* / *Stop reading*, `title`, decorative icon `aria-hidden`. Screen-reader and keyboard-only operation **not exercised** | **Blocked** | |
| RA-20 | Other browsers | Chrome only | **Blocked** | Firefox, Safari, Edge, Android not tested |

### Additional notes

- **Voice follows the selected language, not the text.** Hindi text with English selected is read with the
  English voice. By design, but a likely teacher surprise (see D-5).
- One AI request (Hindi, Coach) timed out once and succeeded on retry — an AI-service latency issue,
  unrelated to Read-Aloud.

## 5a. Re-run after the code fixes — 2026-10-11 (second session)

**Environment:** same branch (`feature/read-aloud-speech-text-clean`, uncommitted tree preserved), Chrome 154 /
Windows 11 driven by browser automation, `http://localhost:5173` + API on `:3000`, seeded demo teacher, the same
22 installed voices. Existing chat with 4 responses reused; no application or test code was changed.

**Audio limitation (unchanged):** the automation can see engine events but cannot hear or record sound. Every
"Audible?" check below is therefore **Blocked — requires a human listener**. Nothing in this section proves how
anything *sounds*.

### Engine-level results (real `speechSynthesis`, real UI, no mocks) — not audible verification

| Case | What was executed | Observed | Status |
| --- | --- | --- | --- |
| Currency chunking (D-1) | MCQ/price answer, rendered card, played with the **real engine** through the chunk containing `Rs. 45.50` (10 chunks, ~116 s) | The chunk handed to the engine was `If a vendor charges Rs. 45.50 for 3 by 4 kg…` — `Rs.` and the amount in one utterance. Full chunk list (engine stubbed, text only): all three `Rs.` occurrences share a chunk with their amount; no chunk ends in `Rs.` | **Engine-level: no split.** Audible naturalness: **Blocked — requires a human listener** |
| Q-label (D-3) | Same chunk list | Chunk starts `Q1. What is the sum of 3 by 4 plus 1 by 2?…`; no chunk ends in `Qn.` | **Engine-level: label attached.** Audible: **Blocked** |
| Mixed fraction (D-4) | `$1\frac{1}{4}$` | Text handed to the engine: `(or 1 and 1 by 4)` | **Text verified.** Exact pronunciation and intelligibility: **Blocked — requires a human listener** |
| Heading colon (D-6) | Same chunk list | `…Remediate:` with no `:.` in any chunk | **Text verified.** Audible: **Blocked** |
| Plain fraction `3/4` | `toSpeechText('Use 3/4 cup… 1 1/4 kg')` | Passed to the engine **unchanged** (`3/4`, `1 1/4`). How Chrome/Windows voices read it is **not known** | **Blocked — requires a human listener** |
| Long response | Rendered card, real engine, played to natural completion | 25 of 25 chunks, text order identical to the expected list, 25 `end` events, **0 errors**, inter-chunk gaps 157–266 ms, finished by itself after ~355 s, button back to *Read aloud*. Skipped/repeated *speech* cannot be heard | **Engine-level Pass.** Audible skips/repeats/pauses: **Blocked** |
| Stop | Real mouse click on *Stop reading* mid-speech | `cancel` + `interrupted`, `speaking=false`, `pending=false`, 0 Stop buttons | **Engine-level Pass.** That sound actually ceased: **Blocked** |
| Replacement | Real clicks: Hindi card playing, then first (English) card | Hindi chunk got `interrupted`, English utterance started, one *Stop reading* only, no stray Hindi chunk afterwards | **Engine-level Pass.** No audible overlap: **Blocked** |
| Language | English card → `en-US` / Microsoft David. Hindi card (generated with Hindi selected in the filters menu) → `hi-IN` / Google हिन्दी | Correct locale and voice selected | **Engine-level Pass.** What it sounds like: **Blocked** |
| Console | Console tracking during this session | No errors | Pass (limited to this session's tracking) |

**Not changed by this session:** RA-10 stays **Fail** in §5 (it records what was observed before the fix). The
fix is verified at engine/text level only; it must **not** be marked fixed until a person has heard
`Rs. 45.50` read without an unnatural pause. D-2, D-5, D-7 are unchanged and still open.

## 6. Human sign-off sheet (audio)

*Still empty on purpose — no one has listened yet.*

Perform on a real machine with speakers. Mark only what you heard.

| ID | Audible? (Y/N) | Intelligible? (Y/N) | Notes |
| --- | --- | --- | --- |
| RA-01 short response | | | |
| RA-02 long response (listen for skips/repeats/long gaps) | | | |
| RA-10 price `Rs. 45.50` (listen for an unnatural pause) | | | |
| RA-14 Hindi | | | |
| RA-15 Hinglish | | | |
| RA-16 language with no voice | | | |

## 7. Performance observations

- Voice lookup is synchronous when voices are loaded, so playback started ~0.4 s after the click.
- Inter-chunk gap measured at ~0.13–0.18 s.
- 187 characters took ~13 s at `rate 0.95` with the English voice.
- Long answers take minutes to read; there is no seek or pause, only Stop.

## 8. Automated verification (`client/`)

**Latest run — 2026-10-11, after the D-1/D-3/D-4/D-6 code fixes:**

| Check | Command | Result |
| --- | --- | --- |
| Tests | `npm test` | 77 files, **1,119** tests passed |
| Lint | `npm run lint` | 0 errors, 1 warning (pre-existing: `react-hooks/exhaustive-deps` in `src/hooks/useClassroomQueue.ts:171`) |
| Type check | `npx tsc -b` | exit 0 |
| Build | `npm run build` | exit 0 |

**Earlier run — 2026-10-11, before those fixes (the baseline used during the manual session):** 77 files,
1,110 tests passed; lint, type check and build had the same results as above. The difference of 9 is the
regression tests added for the fixes (§9).

These do not exercise a real speech engine (§1).

## 9. Defects found

| ID | Severity | Summary | Reproduction | Impact |
| --- | --- | --- | --- | --- |
| D-1 | Low–Medium | A price such as `Rs. 45.50` is split across two chunks (one ending `…for Rs.`, the next starting `45.50 …`) because `Rs.` is treated as a sentence end | Language = English; ask for an answer containing "Rs. 45.50" near a chunk boundary (e.g. "3/4 kg … Rs. 45.50"); log chunks with the spy | An audible pause between "Rupees" and the amount; may be read oddly |
| D-2 | Medium (needs audio check) | No error or message when no voice exists for bn/ta | Select Bengali or Tamil on a machine without those voices, play a response | Teacher may hear nothing or an English voice mangling the text, with no explanation |
| D-3 | Low | A bare `Q1.` is a chunk end, so the question label is separated from its text | Play an MCQ answer; see chunk ending "…Q1." | Short unnatural pause after the label |
| D-4 | Low | Mixed number `1 1/4` is read "1 1 by 4" | Play text with `(or 1 1/4)` | Ambiguous when heard |
| D-5 | Low (UX) | Response in Hindi with language set to English is read with an English voice | Ask in Hindi while language = English; play | Unintelligible speech unless the teacher changes the Language setting |
| D-6 | Cosmetic | Headings ending with a colon get an extra full stop: `…उदाहरण):.` / `Remediate:.` | Play an answer with a bold heading ending in `:` | Probably inaudible |
| D-7 | Cosmetic | A bold heading directly after a list item runs into it with no break ("3. C (0.75 kg) How to Check Understanding…") | MCQ answer key followed by a heading | Small missing pause |

The table above is the **original 2026-10-11 manual finding** and its results (RA-10 *Fail*, etc.) are unchanged:
they describe what was observed before any fix. D-1–D-7 were observations, not yet triaged when the run was written.

### Code-level fixes since that run (audible verification still pending)

| ID | Change | Where | Regression tests |
| --- | --- | --- | --- |
| D-1 | `Rs.`, `Re.`, `No.`, `Fig.`, `Eq.` followed by a number no longer end a sentence; `Rs.`/`No.` stay attached to the next word when a long sentence is split | `lib/tts.ts` (`ABBREVIATION`, `LABEL_WORD`) | `tts.test.ts` → "Q-labels and currency abbreviations" |
| D-3 | Letter+digits labels (`Q1.`, `Q10.`) are treated as labels | `lib/tts.ts` (`LINE_LABEL`, `LABEL_WORD`) | same block |
| D-4 | `$1\frac{1}{4}$` → "1 and 1 by 4"; only numeric numerator and denominator (`$2\frac{x}{y}$` unchanged) | `lib/speechText.ts` (`mathToSpeech`) | `speechText.test.ts` → "toSpeechText: math" |
| D-6 | A heading ending in `:` inside `**…**` no longer gains an extra `.` | `lib/speechText.ts` (`ENDS_SENTENCE`) | `speechText.test.ts` → "toSpeechText: Markdown" |

These are verified by unit tests on the produced text and chunks only. **RA-10 and the audible behaviour of each
item stay unverified until a person re-runs them with sound (§6)** and RA-10's status must not be changed
before that. D-2, D-5 and D-7 were deliberately not changed.

## 10. Sign-off criteria

Release-ready for Read-Aloud when:

1. Automated checks in §8 pass on the release commit.
2. RA-01–RA-09, RA-13–RA-15 are **Pass** *and* the §6 audio column is filled in by a human on at least one
   desktop Chrome and one Android Chrome device.
3. RA-10 (price) and RA-16 (no voice) are either fixed or consciously accepted, in writing.
4. RA-19 (keyboard / screen reader) and RA-20 (other browsers) are executed, or recorded as out of scope.
5. No console errors during any case.
