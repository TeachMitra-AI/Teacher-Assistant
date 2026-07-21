# Teacher Assistant — Mobile & Responsive Testing Guide

> **Status: Current.** Detailed manual test cases for the mobile/responsive layer added in the
> recent responsive redesign: the mobile **bottom navigation**, the essentials-only mobile top
> bar, the adaptive Coach scrolling (welcome vs active chat), safe-area handling, and the density
> polish. The main [`MANUAL-TESTING-GUIDE.md`](./MANUAL-TESTING-GUIDE.md) keeps only a concise
> mobile regression section (area P) and points here for full coverage.

Mark each case: ⬜ Not Run · ✅ Pass · ❌ Fail · ⚠️ Blocked.

## 1. Scope & how to test

Covers layout/behavior at mobile and tablet widths; **no** functional (auth/API/AI) behavior is
re-tested here — see the main guide for that. Test with the browser dev-tools device toolbar and,
where noted, a real phone (for safe-area and address-bar behavior).

**Reference breakpoints in the code (all in `client/src/index.css`):**
- `≤640px` — the mobile layer: top-bar nav hidden, **bottom nav shown**, Coach shell height =
  `100dvh − var(--bottomnav-h) − env(safe-area-inset-bottom)`, pages padded to clear the bottom nav.
- `≤400px` — logo-only brand, slightly smaller greeting.
- `768px` — sidebar becomes a fixed drawer (`≤768px`).
- `≥641px` — desktop/tablet top-bar nav; bottom nav hidden.

**Design intent (mobile ≤640px):** `Header → compact greeting → quick-action cards → context
controls → composer → bottom navigation`, scrolling naturally, with no nested scroll in the
welcome state.

## 2. Test widths

Test every applicable case at: **320, 360, 375, 390, 430** (phones), **768** (tablet), **1440**
(desktop). Where a case is width-specific it says so.

---

## A. Mobile top bar (≤640px)

### TC-MOB-001 — Essentials only, no overlap
**Steps:** Log in; at 320/360/375/390/430px inspect the top bar on the Coach page.
**Expected:** Top bar shows only: sidebar/menu toggle, compact logo, theme toggle, profile avatar.
The Coach/Library/Generator links are **not** in the top bar. Nothing overlaps the brand at any
width.

### TC-MOB-002 — Brand collapses gracefully
**Steps:** Compare 430px vs ≤400px.
**Expected:** At ≤640px the brand subtitle is hidden; at ≤400px the brand text collapses to the
logo only. No clipping or wrap.

### TC-MOB-003 — Profile & theme reachable
**Steps:** At 320px tap the theme toggle, then the profile avatar.
**Expected:** Theme switches; profile menu opens with Settings / Sign out reachable.

### TC-MOB-004 — Sidebar toggle (Coach only)
**Steps:** On Coach at 375px tap the menu toggle; open/close the history drawer.
**Expected:** Drawer slides in over content (fixed), closes via toggle/Escape/backdrop; the bottom
nav is covered by the drawer/backdrop while open and works again after closing.

---

## B. Mobile bottom navigation (≤640px)

### TC-MOB-010 — Bottom nav appears only on mobile
**Steps:** At ≤640px confirm the fixed bottom nav (Coach / Library / Generator with icons+labels);
at 768/1440px confirm it is **absent** and the top-bar links are used instead.
**Expected:** Exactly one primary nav is visible per width (no duplication).

### TC-MOB-011 — Navigation works
**Steps:** Tap Coach, Library, Generator in turn.
**Expected:** Each routes to `/`, `/library`, `/generator` respectively.

### TC-MOB-012 — Active state
**Steps:** On each route, observe the bottom nav.
**Expected:** The current item is highlighted (orange) and marked `aria-current="page"`. Library
stays active on `/library/:id` and `/library/:id/edit`; Generator active on `/generator`.

### TC-MOB-013 — Fixed & safe-area aware
**Steps:** On a notched phone (or emulated safe-area), scroll any page.
**Expected:** The bar stays pinned to the bottom; its content sits above the home indicator
(`env(safe-area-inset-bottom)` padding); labels/icons fully visible; comfortable tap targets.

### TC-MOB-014 — Does not cover content
**Steps:** On Library, Generator, Resource view, Workspace, Settings, Admin, scroll to the very
bottom.
**Expected:** The last content/control clears the bottom nav (pages are padded by
`--bottomnav-h + safe-area`); nothing is hidden behind the bar.

### TC-MOB-015 — Hidden in print
**Steps:** Open a saved assessment in the Workspace → Print / Export.
**Expected:** The bottom nav does **not** appear in the print preview/output.

### TC-MOB-016 — Above content, below modals/drawer
**Steps:** Open the Workspace AI suggestion dialog and the history drawer on mobile.
**Expected:** The AI dialog and the sidebar drawer/backdrop appear **above** the bottom nav; toasts
appear above the bottom nav too.

---

## C. Coach welcome/empty state — natural scroll (≤640px)

### TC-MOB-020 — Single natural scroll (no nested scrollbar)
**Steps:** Fresh Coach page (no messages) at 375px. Scroll the page.
**Expected:** The whole page scrolls as one column: greeting → all quick-action cards → context
controls → composer. There is **no** inner/nested scrollbar trapping the cards.

### TC-MOB-021 — All five quick actions reachable
**Steps:** Scroll through the welcome content at 320/375/430px.
**Expected:** All five quick-action cards are fully reachable and readable (title + wrapping
description, not truncated); comfortable tap size.

### TC-MOB-022 — Order and density
**Expected:** Order is greeting → subtitle → cards → context (Grade/Subject/Language/More) →
composer. Spacing is compact but not cramped; at ~375px roughly 2.5–3 cards plus the greeting are
visible before scrolling (device-height dependent).

### TC-MOB-023 — Composer reachable, nothing hidden
**Steps:** Scroll to the bottom of the welcome content.
**Expected:** The composer is fully usable and sits above the bottom nav (page padding clears it);
no content hidden behind composer or nav.

### TC-MOB-024 — Quick action seeds the composer
**Steps:** Tap a quick-action card (e.g. "Create a Lesson Plan").
**Expected:** The composer is seeded with the starter prompt and focused (view scrolls to it); not
auto-submitted.

### TC-MOB-025 — No horizontal overflow
**Steps:** At 320px, drag horizontally.
**Expected:** No horizontal scrolling anywhere on the welcome screen.

---

## D. Coach active-chat state — fixed viewport (≤640px)

### TC-MOB-030 — Layout switches on first message
**Steps:** Submit a question.
**Expected:** The layout switches to a fixed-viewport chat: the message thread scrolls in its own
area; the composer is docked at the bottom (above the bottom nav).

### TC-MOB-031 — Latest message fully visible
**Steps:** After a long AI response, scroll to the end.
**Expected:** The final message scrolls fully above the composer; the composer never covers message
content.

### TC-MOB-032 — Composer above the bottom nav
**Expected:** The composer sits directly above the bottom nav; the two never overlap (shell height
= `100dvh − bottomnav − safe-area`).

### TC-MOB-033 — Response & follow-up actions reachable
**Steps:** On an answer, use Read aloud / Copy / WhatsApp / Save to Library and a follow-up chip.
**Expected:** All are reachable within the scrollable thread; none hidden behind the composer/nav.

### TC-MOB-034 — Keyboard open does not break layout
**Steps:** On a real phone, focus the composer so the on-screen keyboard opens; type and send.
**Expected:** The composer stays usable; the thread remains scrollable; no broken/overlapping
layout (dynamic viewport `dvh` adapts).

### TC-MOB-035 — Empty ⇄ active transition
**Steps:** Send a message, then use "New chat".
**Expected:** Returns to the natural-scroll welcome state; no leftover fixed-height artifacts or
double scrollbars.

---

## E. Context controls & composer (mobile)

### TC-MOB-040 — Context controls wrap
**Steps:** At 320/375px inspect Grade / Subject / Language / More context.
**Expected:** Pills wrap across rows as needed; no horizontal overflow; text readable; tap targets
comfortable.

### TC-MOB-041 — More-context popover fits
**Steps:** Tap "More context".
**Expected:** The popover is anchored to the composer width and stays within the viewport (never
clipped past the edge); Classroom/Focus selects work.

### TC-MOB-042 — Composer functionality intact
**Steps:** Type; watch the 500-char counter; use voice input; auto-grow by typing several lines;
send.
**Expected:** Counter updates and warns near the limit; voice toggles; textarea auto-grows within
its max height; send works. (Behavior identical in welcome and active states.)

---

## F. Other pages at mobile widths

### TC-MOB-050 — Library
**Expected:** Cards become a single column; search/filters usable; last card clears the bottom nav.

### TC-MOB-051 — Resource detail (`/library/:id`)
**Expected:** Readable document; Edit/Delete reachable; content clears the bottom nav.

### TC-MOB-052 — Workspace (`/library/:id/edit`)
**Expected:** Single-column; sticky toolbar collapses to icon buttons; Save/Print reachable; editor
and AI Assist usable; content clears the bottom nav; the Print version menu (assessments) is
reachable.

### TC-MOB-053 — Generator (`/generator`)
**Expected:** Single-column form; Generate/preview/Save usable; the Save button clears the bottom
nav.

### TC-MOB-054 — Settings / Admin
**Expected:** Usable single-column layout; content clears the bottom nav (bottom nav shows no
active item on these secondary pages — expected).

---

## G. Breakpoint & theme matrix

### TC-MOB-060 — Width sweep
**Steps:** For Coach (welcome + active), Library, Workspace, Generator, sweep 320 → 360 → 375 → 390
→ 430 → 768 → 1440.
**Expected:** No header overlap, no horizontal scroll, no hidden content at any width. The mobile
layer engages ≤640px; 768/1440 use the desktop layout unchanged.

### TC-MOB-061 — Dark & light
**Steps:** Toggle theme at mobile widths across the pages above.
**Expected:** Bottom nav, top bar, cards, and composer render correctly in both themes (design
tokens only; no theme-breaking colors).

### TC-MOB-062 — Desktop/tablet unchanged
**Steps:** At 768 and 1440, compare against the pre-mobile-redesign layout.
**Expected:** Top-bar nav present, no bottom nav, sidebar inline (desktop) / drawer (≤768),
Coach uses the fixed-viewport layout — visually unchanged from before.

### TC-MOB-063 — Address-bar show/hide (real device)
**Steps:** On a phone, scroll the welcome page so the browser address bar collapses/expands.
**Expected:** Layout adapts smoothly via `dvh`; the composer/nav never jump behind chrome; no fixed
`vh` trapping.

---

## H. Accessibility (mobile)

### TC-MOB-070 — Focus-visible on bottom nav
**Steps:** With a Bluetooth keyboard (or tab order), focus each bottom-nav item.
**Expected:** A visible focus outline appears; items are activatable via keyboard.

### TC-MOB-071 — Single primary landmark
**Steps:** Inspect landmarks at ≤640px vs ≥641px.
**Expected:** Only one `nav` with the "Primary" label is in the accessibility tree per width (the
hidden one is `display:none`), so navigation is not announced twice.

### TC-MOB-072 — Icon-only controls labelled
**Expected:** The menu toggle, theme toggle, and profile trigger expose `aria-label`s; bottom-nav
items expose visible text labels + `aria-label`.

---

## Checklist

Legend: ⬜ Not Run · ✅ Pass · ❌ Fail · ⚠️ Blocked

| Test ID | Area | Test Case | Status | Notes |
|---------|------|-----------|--------|-------|
| TC-MOB-001 | Top bar | Essentials only, no overlap | ⬜ | |
| TC-MOB-002 | Top bar | Brand collapses gracefully | ⬜ | |
| TC-MOB-003 | Top bar | Profile & theme reachable | ⬜ | |
| TC-MOB-004 | Top bar | Sidebar toggle (Coach) | ⬜ | |
| TC-MOB-010 | Bottom nav | Appears only on mobile | ⬜ | |
| TC-MOB-011 | Bottom nav | Navigation works | ⬜ | |
| TC-MOB-012 | Bottom nav | Active state / aria-current | ⬜ | |
| TC-MOB-013 | Bottom nav | Fixed & safe-area aware | ⬜ | |
| TC-MOB-014 | Bottom nav | Does not cover content | ⬜ | |
| TC-MOB-015 | Bottom nav | Hidden in print | ⬜ | |
| TC-MOB-016 | Bottom nav | Below modals/drawer, above content | ⬜ | |
| TC-MOB-020 | Welcome scroll | Single natural scroll | ⬜ | |
| TC-MOB-021 | Welcome scroll | All 5 quick actions reachable | ⬜ | |
| TC-MOB-022 | Welcome scroll | Order and density | ⬜ | |
| TC-MOB-023 | Welcome scroll | Composer reachable, nothing hidden | ⬜ | |
| TC-MOB-024 | Welcome scroll | Quick action seeds composer | ⬜ | |
| TC-MOB-025 | Welcome scroll | No horizontal overflow | ⬜ | |
| TC-MOB-030 | Active chat | Layout switches on first message | ⬜ | |
| TC-MOB-031 | Active chat | Latest message fully visible | ⬜ | |
| TC-MOB-032 | Active chat | Composer above the bottom nav | ⬜ | |
| TC-MOB-033 | Active chat | Response & follow-up actions reachable | ⬜ | |
| TC-MOB-034 | Active chat | Keyboard open does not break layout | ⬜ | |
| TC-MOB-035 | Active chat | Empty ⇄ active transition | ⬜ | |
| TC-MOB-040 | Context/composer | Context controls wrap | ⬜ | |
| TC-MOB-041 | Context/composer | More-context popover fits | ⬜ | |
| TC-MOB-042 | Context/composer | Composer functionality intact | ⬜ | |
| TC-MOB-050 | Pages | Library | ⬜ | |
| TC-MOB-051 | Pages | Resource detail | ⬜ | |
| TC-MOB-052 | Pages | Workspace | ⬜ | |
| TC-MOB-053 | Pages | Generator | ⬜ | |
| TC-MOB-054 | Pages | Settings / Admin | ⬜ | |
| TC-MOB-060 | Matrix | Width sweep | ⬜ | |
| TC-MOB-061 | Matrix | Dark & light | ⬜ | |
| TC-MOB-062 | Matrix | Desktop/tablet unchanged | ⬜ | |
| TC-MOB-063 | Matrix | Address-bar show/hide | ⬜ | |
| TC-MOB-070 | A11y | Focus-visible on bottom nav | ⬜ | |
| TC-MOB-071 | A11y | Single primary landmark | ⬜ | |
| TC-MOB-072 | A11y | Icon-only controls labelled | ⬜ | |

**Total: 38 mobile/responsive test cases across 8 areas.**
