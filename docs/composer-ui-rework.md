# Composer + Mobile Coach UI Rework (branch `feature/ui-fix`)

**Status:** Implemented, uncommitted at time of writing · **Scope:** client only — no server, API,
schema or prompt change · **Owner:** Teacher Assistant engineering

> Companion documents: [`classroom-mode.md`](./classroom-mode.md) (the feature whose `+` button and
> pill this rework moved/removed — its "Files as built" list is annotated with a SUPERSEDED note
> pointing here) and [`multimodal-attachments-architecture.md`](./multimodal-attachments-architecture.md)
> (the attachment pipeline, which this rework does **not** touch: only how staged files are
> displayed changed, never how they are validated, sent or stored).

## 1. What this branch did

A visual and interaction rework of the Coach composer — the box a teacher types into. Nothing about
what gets sent to Gemini changed. Every item below is presentation or client-side state.

| # | Change | Why |
|---|---|---|
| 1 | Chat + composer width 840px → 720px, via one shared token | More compact; the two widths were separate literals that could drift |
| 2 | `+` and the paperclip swapped roles | `+` now opens Capture Photo / Upload File; the mode control took the paperclip's slot |
| 3 | Staged files show as thumbnails **inside** the box, no file name | The name is noise for a file picked seconds ago; it made the composer taller |
| 4 | Text box starts at one line and grows with the text | Matches ChatGPT/Claude; the old version only resized while typing |
| 5 | Tap a thumbnail → full-size preview dialog | 56px is enough to recognise a photo, not to check it is usable before sending |
| 6 | One ✕ per file (the clear-all ✕ is gone) | Beside a single photo, a second ✕ read as a second control for that photo |
| 7 | Everything on ONE row, stacking only when the text is long | The composer is a pill like ChatGPT's until it needs to be more |
| 8 | Character count hidden until 80% of the limit | A permanent `0/500` spent a slot on the one row to say nothing |
| 9 | Mode control labelled **Assistant Mode**, no icon | Names the control, not the mode — so a second mode does not make the label a lie |
| 10 | The orange "Classroom Mode" banner deleted | Duplicated state the button already shows, and one banner per mode is not a layout |
| 11 | **Phone:** context row moved from the composer dock to under the header | The answer was short because the fixed furniture at the bottom was tall — see §2b |
| 12 | **Phone:** answer gets 65–72% of the screen, with reading typography | The point of the whole mobile pass: response first, controls second |
| 13 | **Phone:** ↓ scroll-to-latest indicator | A long answer no longer ends anywhere near the composer |
| 14 | **Phone:** filter labels dropped; the empty option names the field | "Grade" instead of a "Grade" label plus an "Any" value — same meaning, half the width |
| 15 | Composer menus re-anchored to the composer box | They were positioned against their button but sized against the viewport, so the Mode menu sat 60–70px off-screen |

## 2. Files

**New**

- `client/src/components/ClassroomModeMenu.tsx` — the Assistant Mode dropdown (right of the row).
- `client/src/components/AttachmentPreviewModal.tsx` — full-size preview dialog, portalled to
  `document.body`.

**Renamed**

- `ModeMenu.tsx` → `AddMenu.tsx`. It was the Classroom Mode toggle on a `+` button; it is now the
  `+` "add anything" menu. Named `AddMenu`, not `AttachMenu`, because `+` is the growth slot for
  anything a teacher adds to a message (Library picks, generated images), not just attachments.

**Deleted**

- `ClassroomModePill.tsx` — see change #10. Its CSS (`.classroom-pill*`) went with it.

**Modified**

- `Composer.tsx` — the bulk of the work: single-row layout, auto-grow, the two file inputs.
- `AttachmentTray.tsx` — gained a `variant` prop (`'chips' | 'preview'`).
- `useAttachments.ts` — object URLs are now created for **every** kind, not just images.
- `index.css` — `--chat-max-width` token, `.composer-row`, `.composer-menu-*` (renamed from
  `.mode-menu-*`, now shared by both menus), preview tiles, dialog.
- `CoachPage.tsx` — pill removed; onboarding tip copy re-pointed; two manual textarea height
  resets removed (the Composer owns its own height now).

## 2b. Mobile Coach layout — "response first, controls second"

A second pass on the same branch, scoped to **phones only** (≤640px). The complaint it answers:
the answer had very little room, because the context row sat in the composer dock at the *bottom*,
stacked above the composer, making the fixed furniture tall and the scrollable answer short.

**The one structural change:** on a phone the context row is rendered **under the header** instead of
in the composer dock. Order is now header → context row → answer → composer → bottom nav.

- `client/src/hooks/useMediaQuery.ts` — **new.** Subscribes a component to a media query. Needed
  because this is a *DOM position* change, which CSS cannot make. `Composer` uses it too (its
  placeholder tiers), replacing a local `matchMedia` block.
- `client/src/pages/CoachPage.tsx` — `isPhoneLayout` renders `ContextBar` in exactly ONE of the two
  places. **Do not "simplify" this into rendering both and hiding one** — that puts a second set of
  Grade/Subject/Language comboboxes in the accessibility tree. Also adds `.chat-area`, a wrapper
  around the scroller only, so the scroll-to-latest button can be positioned against the answer area
  rather than the whole column (pinned to the column it sat on top of the send button).
- `client/src/components/ScrollToBottom.tsx` — **new.** The ↓ indicator. Phone-only, and only
  rendered when there is actually something below. Watches scroll + `ResizeObserver`.
- `client/src/components/ContextBar.tsx` — the popover now opens **downward** when there isn't room
  above; "More context" is icon-only on phones (with a permanent `aria-label` and a count badge) and
  `position: sticky` so it never scrolls off; on phones the pill labels are dropped entirely and the
  empty option names the field instead ("Grade", "Subject"; the language value names itself).
- `client/src/index.css` — `.coach-context-row`, reading typography for `.response-body`
  (1rem/1.78, paragraph and heading spacing), tighter scroller/dock padding, `.chat-scroll-down`,
  the composer menus re-anchored to the composer box, and a ≤400px block that trims the composer
  buttons so 320px still works.

**Two breakpoints now exist on this page and they are not the same number:** `isMobile` (768px,
pre-existing, controls the sidebar drawer and the resize handle) and `isPhoneLayout` (640px, the
Coach phone layout). Each must stay in step with the `@media` block that styles what it decides.

### Traps found here too

**A `<select>` is as wide as its widest OPTION, not its selected one.** "Social Studies" alone made
the Subject pill 188px and pushed the filter row off a 390px screen while it displayed "Any". The
phone rules cap the select width so the control's size is decoupled from the vocabulary behind it.

**Source order beats media queries at equal specificity.** A bare `.coach-context-row { display:
none }` guard placed *after* the phone `@media` block hid the row at every width. It is written as a
`@media (min-width: 641px)` rule instead.

**An element pinned to both `top` and `bottom` is stretched between them.** The popover's stylesheet
rule sets `bottom`, so setting `top` inline to open it downward collapsed the panel and left its two
fields hanging outside it over the answer. Both edges are now set explicitly, one of them to `auto`.

**A clipped placeholder reads as a rendering bug.** At 320px the text slot is ~75px; because the box
is deliberately one line tall, "Ask anything…" was clipped mid-word rather than wrapping. There is
now a third placeholder tier (`Ask…`) below 360px.

**A popover positioned against its button but sized against the viewport will leave the screen.**
The composer menus used `width: calc(100vw - 2.5rem)` while `--right` anchored the Mode menu's right
edge to its button — ~280px in from the left of a 390px screen — so a 340px panel started at −60px
and hung off the left edge at every phone width (measured: −70 / −70 / −60 at 320 / 360 / 390). The
`+` menu survived only because its button sits near the left edge, clearing the right edge by ~15px.
Both now span the **composer box**, so position and size come from the same element and neither can
leave the screen. The rule needs a `.composer-box` prefix to out-specify the later `--right` rule.

**Source order beats media queries, twice.** The same trap caught a
`.attachment-preview-remove` size bump written inside the phone `@media` block: the base rule for
that button is defined later in the file, so at equal specificity it won and the change silently did
nothing. Any phone override of a component styled further down the file needs a prefix
(`.attachment-tray--preview …`, `.composer-box …`) to out-specify it.

**`flex: 1 0 auto` means "don't shrink" on whichever axis the parent runs.** Applied to
`.coach-main-chat` — an item of the *row* that is `.coach-body` — it stopped the column shrinking
horizontally, so it took its max-content width (728px in a 390px viewport) and overflowed the page
sideways. Vertical growth belongs on the elements whose parent is a column.

**`box-sizing: border-box` makes `min-height: calc(100dvh - nav)` plus `padding-bottom: nav` subtract
the nav twice.** In the welcome state that left a nav-sized band of bare page background between the
composer and the bottom nav.

**The filter row's cramping was self-inflicted.** Squeezing every pill so nothing ever scrolled bought
a cramped control on every phone to avoid scrolling on the smallest. The labels are now dropped on
phones and the empty option names the field ("Grade", "Subject"; the language value names itself), so
the row is both roomier and fits a 390px screen. "More context" is `position: sticky; right: 0` — as
the last item in a scrolling row it started off-screen at 320px, and a control you cannot see is one
you do not have.

## 2c. Manual test pass (post-implementation)

An exploratory pass driving the real components through whole flows in a browser, rather than
re-running the assertions that were already green. Eight scenarios: welcome/empty state · attachments
at the 5-file maximum (3 tiles + "+N more", expand, preview dialog, `+` disabled) · long question
plus an attachment at 320px · dark theme (row, sticky background, fade gradient, menus) · landscape
740×360 · the tablet band 641–768px where `isMobile` is true but the phone layout is not · keyboard
(Escape, outside click, tab order, focus rings) · Assistant Mode on. No console or runtime errors in
any of them.

**Three defects found and fixed:**

1. **Dead band in the welcome state.** With nothing asked yet, the composer stopped wherever the
   quick-action cards ended, leaving ~150px of bare page background above the bottom nav. The
   empty-state shell is now a flex column that fills the viewport, so the composer sits flush above
   the nav; taller content still grows the page and scrolls, which is what that block exists for.
2. **Horizontal page overflow — introduced by the fix for (1)** and caught by re-measuring rather
   than trusting it. See the `flex: 1 0 auto` trap in §4.
3. **The ✕ on a staged photo was an 18px touch target**, below the 24×24 CSS-px floor of WCAG 2.2
   SC 2.5.8. Now 24px on phones. The first attempt silently did nothing — see the source-order trap
   in §4, which this hit for the second time.

**Suggested improvements, deliberately NOT done** (they change behaviour beyond the brief):

- The ↓ button covers a word or two of the last visible line. ~48px of bottom padding inside the
  scroller would let text clear it.
- A phone in **landscape** (740×360) leaves the phone layout entirely, because the breakpoint is
  width-only: the bottom nav disappears and the answer gets ~161px. A height-aware condition
  (`max-height: 480px`) would keep it coherent.
- Long filter values truncate ("Social Studies" → "Social Stud…"). Shorter display labels for the
  longest subjects would fix it without widening the row.
- Thumbnails could be 64px rather than 56px on phones — there is room, and it makes a photo easier
  to recognise.
- "+N more" takes a row of its own in the tray; inline with the tiles would save ~30px of composer
  height.

## 3. Decisions worth keeping

**`+` is left, modes are right.** Adding something is a per-message action; a MODE is a property of
the whole turn. This matches ChatGPT, where `+` holds files/tools and "Think" sits by the mic.

**The button names the control, the popover names the choices.** "Assistant Mode" on the button,
"Off" / "Classroom Mode" inside. This is what lets mode #2 be added without touching the button.

**Feature flags are now independent.** Previously `+` rendered only under `CLASSROOM_MODE_ENABLED`
while the paperclip rendered under `ATTACHMENTS_ENABLED`. After the swap each control is gated by
its own matching flag, so neither feature can be hidden by the other's flag. **Do not re-couple
these.**

**`AttachmentTray` has one `preview` caller and one `chips` caller.** `chips` (name + icon) is for a
SENT message in `MessageBubble`, which has no live object URL and where the name is the only thing
identifying the file. Do not "unify" them.

## 4. Traps found the hard way

Each of these was a real failure caught in a browser, not a hypothetical. They are all easy to
reintroduce.

**A textarea's `scrollHeight` counts its placeholder when the box is empty.** A placeholder that
wrapped in the narrow single-row slot reported two lines of content that did not exist, so the box
pinned itself at two lines' height and then stacked itself to make room for nothing. The height is
now measured with the placeholder blanked.

**A flex item's `flex-basis` overrides its `width`.** Two separate bugs came from this. First,
`.composer-textarea { width: 100% }` became its flex basis, so it claimed the whole row and pushed
every control onto its own line. Second, an attempt to widen the textarea inline before measuring it
*silently did nothing* — it kept reporting the current layout.

**The single-row/stacked decision must not be measured from the element being laid out.** Text that
wraps in the narrow slot stacks the layout, which widens the box, so the same text fits one line
again, which un-stacks it — forever, until React throws "Maximum update depth exceeded". The
decision now measures the **string** with a canvas against the row's width, which does not depend on
the answer. Anything that makes the row's width differ between the two states (a padding change was
enough) reintroduces the loop: **keep per-state styling off the horizontal axis.**

**Headless Chromium has no PDF viewer** (`navigator.pdfViewerEnabled === false`), so an `<iframe>`
to a PDF renders a blank white panel indistinguishable from a failed upload. Real browsers can also
have it disabled by policy. The dialog detects this and offers "Open it in a new tab" instead.

**The stylesheet sets no global anchor colour.** A link with no explicit colour comes out
browser-default blue — invisible on the dark theme.

## 5. How this was tested

There are **no component tests** for any of this, by the project's standing decision (see the
comment in `client/vitest.config.ts` — pure-logic modules only, no React Testing Library). That
decision was respected rather than quietly reversed.

Instead it was verified in a real browser: a throwaway Vite harness (no backend, no auth, no AI call)
driven by Playwright — which is already installed in `server/`, along with Chromium. **Four suites**,
run in both headless Chromium and real Chrome (they disagree about PDFs, so each covers one branch of
that code):

| Suite | What it covers |
|---|---|
| composer | the single-row/stacked composer, attachments, preview dialog, menus |
| single-row | the one-line→stacked transition, including the oscillation sweep |
| mobile | every phone check at **320 / 360 / 390 / 430px**, then 1280px for desktop parity |
| manual | the exploratory whole-flow pass described in §2c |

The harness mounts the real `ContextBar`, `Composer`, `ScrollToBottom`, `WelcomeScreen` and
`BottomNav` inside the Coach page's real shell structure and class names; only `TopBar` and the
message markup are stand-ins, because the real ones need auth/help-support contexts and a backend.

Coverage included: the shared width token; one-line-to-grown-to-capped heights; no clipping on
resize; the `+` menu contents; the camera input's `accept`; dropdown state and popover placement;
thumbnails inside the box with **no filename in the box's text**; one ✕ per file positioned on the
tile; the dialog's role/focus/scroll-lock/Escape/backdrop behaviour and the fact that clearing files
closes an open dialog; the single-row layout at desktop and 390px; and a **character-by-character
sweep from 1 to 140 characters** confirming the layout crosses the single/stacked boundary exactly
once and never flip-flops.

For the mobile layout, per width: the context row sits directly under the header, stays one line and
keeps all three filters; the answer area is >55% of viewport height and scrolls independently with no
document scroll; no band overlaps another (answer ends where the composer starts, composer clears the
bottom nav, nav is on screen, no horizontal overflow); line-height ≥1.65; the placeholder fits its
slot; the composer dock stays under 16% of the screen; the popover opens downward, contains its
fields and stays on screen; and the ↓ indicator appears only when there is more below. The desktop
pass asserts the context row is still in the dock, there is no bottom nav, no ↓ button, the full
"More context" label is intact, typography is unchanged and the column is still 720px.

The mobile suite also asserts what the manual pass turned into permanent checks: both composer menus
stay fully on screen, "More context" is reachable without scrolling the row, the filter pills are a
comfortable size, the filter text is not truncated, the welcome-state composer sits flush above the
bottom nav, and the remove ✕ meets the 24px touch-target floor.

The harness and Playwright scripts were deliberately **not** committed — they are scaffolding, and
keeping them would half-introduce the component-testing culture `vitest.config.ts` rules out. To
re-verify, recreate a harness that mounts these components inside the shell markup above and drive it
the same way.

## 6. Open / not done

- **Multi-mode support.** The Assistant Mode dropdown is still binary (Off / Classroom Mode). The
  agreed shape for more modes is: button shows `Modes` with nothing on, the mode's name with one on,
  and a count (`3 modes`) with several; popover becomes a checklist with ticks. **Blocked on one
  decision: can several modes be on at once, or only one?** The checklist shape works either way.
- **Sent messages still show chips, not thumbnails.** Object URLs are revoked when a turn is sent
  (`CoachPage` clears attachments), so a past message has no image to display. Showing thumbnails
  there is a change to attachment *lifetime*, not to this UI.
- **The drag-to-resize handle was kept.** It still pins the dock to a fixed height, which is a
  second, older answer to "how tall is the composer". Worth revisiting now that the box sizes itself.
  (It is already desktop-only — `resizeEnabled = !isMobile && !isEmpty` — so it does not affect the
  phone layout.)
- **The five UI improvements listed at the end of §2c** — scroller padding under the ↓ button,
  a height-aware landscape rule, shorter subject labels, 64px thumbnails, inline "+N more".
- **The phone welcome/empty state** uses a different layout path (`.coach-shell.coach-empty` drops
  the fixed-height/overflow chain for natural page scroll). `.chat-area` was added to that unwinding,
  but the empty state was not otherwise redesigned in this pass.
