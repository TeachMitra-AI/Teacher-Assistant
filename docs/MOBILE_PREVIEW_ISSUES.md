# Mobile Preview — Known Issues & Observations

Tracking document for findings from manual end-to-end testing of the mobile
Preview feature (paper-formatted exam preview, `feature/mobile-ui-refinement`,
commit `8a65deb`), run on a fresh Pixel 8 / API 35 emulator with the real
backend + Metro dev server. Nothing in this document has been fixed yet —
it's a record so these don't need to be re-discovered later.

Related code: `mobile/src/lib/formatMarkdown.ts`, `mobile/src/screens/coach/MarkdownText.tsx`,
`mobile/src/theme/tokens.ts`, `mobile/src/theme/ThemeContext.tsx`,
`mobile/src/screens/generator/GeneratorResultScreen.tsx`,
`mobile/src/screens/library/ResourceEditScreen.tsx`,
`mobile/src/screens/library/ResourceViewScreen.tsx`. Web source of truth:
`client/src/lib/format.ts`, `client/src/index.css`.

## Confirmed bugs

### Bug 1 — Numbered questions restart at "1." after an MCQ options block

**Where:** Legacy/fallback markdown preview — any screen rendering
`MarkdownText` (`ResourceViewScreen`, `ResourceEditScreen`'s Preview tab,
`GeneratorResultScreen`'s legacy-content Preview tab, and in principle Coach
chat if a numbered list is ever interrupted mid-answer).

**Steps to reproduce:**
1. Have (or seed) an assessment resource whose `structured` field is null/not
   schemaVersion 2, so it falls back to legacy markdown rendering, with
   content shaped like:
   ```
   1. What is the primary source of energy for the water cycle?
   A. Wind
   B. Earth's core
   C. Sun
   D. Moon

   2. Explain the term "condensation" in one sentence.
   ```
2. Open the resource's Preview (View or Edit → Preview).

**Current behavior:** The second question renders as "1." again instead of
"2." — every numbered question after the first MCQ-options interruption
resets to "1." Reproduced identically on `ResourceViewScreen` and
`ResourceEditScreen`'s Preview for the same test resource (3 questions, all
of questions 2 and 3 showed "1.").

**Expected behavior:** Sequential numbering (1, 2, 3, ...) across the whole
document, matching web's behavior — web avoids this exact problem by keeping
the *literal* source number in each `<li>` (`client/src/lib/format.ts:126-129`
comment) specifically because a numbered question is immediately followed by
MCQ option lines, which breaks the "consecutive `<li>`" run a single `<ol>`
would need for auto-numbering to stay correct.

**Likely cause / affected files:** `mobile/src/lib/formatMarkdown.ts`'s
`parseMarkdownBlocks` — the `list` block type stores only `items:
InlineSegment[][]` (no literal number), and `MarkdownText.tsx` renders the
ordered-list number as `${j + 1}` (array index within *that* block) rather
than a running or literal count. Each options-block interruption starts a
new `list` block, so its internal counter restarts at 0. A fix likely means
either threading the literal source number through the `list`/`options`
block data (mirroring web's approach) or tracking a persistent counter
across blocks in the renderer.

---

### Bug 2 — `ResourceViewScreen` never wired to `PaperThemeProvider`

**Where:** `mobile/src/screens/library/ResourceViewScreen.tsx` — the screen
opened by default when tapping a resource from the Library list (before
tapping "Edit").

**Steps to reproduce:**
1. Open any saved assessment resource from the Library list (tap the card,
   not "Edit").
2. Compare against the same resource's Preview tab in `ResourceEditScreen`
   (tap "Edit" from the same screen).

**Current behavior:** `ResourceViewScreen` renders the exam header and
questions/markdown content using the app's ordinary light/dark theme colors
(orange headings on dark background, etc.) — not the fixed white/serif
"paper" look. `GeneratorResultScreen.tsx` and `ResourceEditScreen.tsx` both
wrap their Preview content in `PaperThemeProvider`; `ResourceViewScreen.tsx`
was never updated to do the same.

**Expected behavior:** All three screens should render an assessment's paper
content identically — as a fixed white/serif sheet regardless of app theme,
matching web's `.workspace-preview.exam-paper` behavior which this feature
was built to port.

**Likely affected files:** `mobile/src/screens/library/ResourceViewScreen.tsx`
(needs the same `PaperThemeProvider` + `styles.paper` wrapping already
present in `GeneratorResultScreen.tsx`/`ResourceEditScreen.tsx`), pulling
`paper` from `mobile/src/theme/tokens.ts`.

## UI/UX observations & suggested improvements

These are not bugs — they didn't produce incorrect output — but are worth a
design/polish pass.

1. **Light-theme paper contrast is weak.** In dark app theme the paper card
   reads clearly as a distinct white sheet against the dark background. In
   light app theme, the paper card's border/background barely stands out
   against the light app UI, so the "this is a distinct printed sheet"
   effect that dark mode gives for free is much subtler in light mode.
   Worth a look at border weight/shadow for the light-theme case.

2. **Table columns force horizontal scroll unnecessarily.**
   `formatMarkdown.ts`'s `tableCell` style gives every column a uniform
   110dp `minWidth`, so even a simple 3-column table (e.g. a `#` / "Teacher
   Activity" / "Student Activity" pairing table) needs horizontal scrolling
   on a Pixel-8-width screen. Web narrows short columns
   (`td:first-child { width: 1%; white-space: nowrap }` in `index.css`) —
   mobile has no equivalent per-column sizing, so every column gets the same
   minimum width regardless of actual content length.

3. **MCQ options grid is always 2-column, even on narrow screens.** Web
   drops its `.fmt-options` grid to a single column below a 640px viewport
   (`@media (max-width: 640px)` in `index.css`). A phone is always narrower
   than that breakpoint, so web itself would render single-column at phone
   width — but mobile's `MarkdownText.tsx` `styles.options` grid
   (`flexBasis: '45%'`) is unconditionally 2-column. Worth checking how this
   reads with longer option text at typical phone widths, and considering a
   single-column fallback to match what web would actually do at this
   viewport size.

4. **Navigation quirk after "Save to Library" (not preview-specific, but
   encountered during this testing pass).** After saving a quiz from the
   Generator, back-navigation from the resulting `ResourceEditScreen` pops
   out of the Library tab entirely to the Coach home screen rather than to
   the Library list. Re-tapping "Library" then reopens the same
   `ResourceEditScreen` (React Navigation's normal per-tab state
   preservation) rather than showing the list — a teacher wanting the list
   view has to navigate back further than expected.

## Remaining limitations / not yet tested

- **LaTeX/KaTeX math rendering** is still not ported to mobile (a
  pre-existing, deliberately deferred scope item per
  `docs/mobile-app-plan.md` §26 Phase 4/§28 — not something this session's
  changes were meant to address). A `$...$`/`$$...$$` question renders with
  literal delimiters instead of typeset math, in both the on-screen preview
  and the PDF export path.
- **PDF export was not visually verified.** The Share/Export action was
  confirmed reachable (icon present, screen navigable to) but the actual
  `expo-print`-generated PDF containing the new table/MCQ-grid content was
  not opened and inspected.
- **Non-English / RTL script content was not tested.** All test content used
  in this pass was English; the paper preview (letterhead, instructions,
  question text) has not been verified with Hindi or other non-Latin-script
  resource content.
- **Automated test suite was not re-run after this manual session** since no
  code was changed during testing — the last known automated result stands
  at 66/66 suites, 519/519 tests passing (from the pre-testing validation
  pass on commit `8a65deb`).
