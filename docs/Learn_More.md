# "Learn more" — Terms of Service & Privacy Policy

## Summary

Added a "Learn more" item to the account menu (`ProfileMenu.tsx`), positioned
between "Need Help?" and "Sign out". Hovering (desktop) or tapping
(touch/keyboard) it reveals a flyout submenu with two options — "Terms of
Service" and "Privacy Policy" — each opening a real, standalone page for that
document in a new browser tab.

`ProfileMenu.tsx` is shared by both places the account menu appears (the
Sidebar footer on the Coach page, and the TopBar on every other page), so this
one change covers both. Scoped to the web client (`client/`) only — the mobile
app has its own, separate UI.

## Files added

- `client/src/components/LegalLayout.tsx` — shared page chrome for the two
  legal pages: sticky header (brand + "Back to app"), hero (icon, title,
  intro, "Last updated" pill), a sticky "On this page" table of contents,
  and a footer that cross-links to the other policy.
- `client/src/pages/TermsOfServicePage.tsx` — Terms of Service content.
- `client/src/pages/PrivacyPolicyPage.tsx` — Privacy Policy content.

## Files changed

- `client/src/components/ProfileMenu.tsx` — the new "Learn more" submenu:
  state, positioning, and the two links.
- `client/src/index.css` — styles for the submenu flyout and the `.legal-*`
  page design.
- `client/src/App.tsx` — new `/terms` and `/privacy` routes, added to both the
  signed-in and signed-out route trees (so the pages work whether or not the
  tab that opens them is authenticated).

## Feature details

### The submenu

- Opens on hover (`onMouseEnter`) for desktop, and on click/tap for
  touch and keyboard users. The click handler explicitly opens rather than
  toggles — a tap (and even a real mouse click) fires a hover-in on the
  trigger first via `onMouseEnter`, so a toggle would immediately flip it
  straight back closed.
- Portalled to `document.body` (`createPortal`) instead of being positioned
  in place, because the sidebar variant's dropdown lives inside `.sidebar`,
  which has `overflow: hidden` for its open/close width transition — an
  in-place flyout would be silently clipped there. This is the same fix
  `HistoryItemMenu.tsx` already documents for the identical problem.
- Position is computed from the trigger's `getBoundingClientRect()`:
  - **Vertical**: opens upward (bottom-aligned with the trigger) by default,
    matching the account menu's own upward-opening direction, falling back to
    downward only when there isn't room above.
  - **Horizontal**: opens on whichever side of the trigger has more available
    space, then clamps the result so it always stays fully within the
    viewport. Comparing available space (rather than a fixed preferred side)
    matters for the sidebar variant on mobile — its "Learn more" row spans
    nearly the full drawer width, so flipping to a fixed side can land the
    flyout back on top of the drawer's own list items.
- `z-index: 1300`, matching `.history-item-menu-popover` / `.share-menu-popover`
  — the value those two portalled popovers already use to clear the mobile
  sidebar drawer's `z-index: 1200`.
- The Terms/Privacy items are real `<a href target="_blank" rel="noopener">`
  links, not a `window.open()` call in a click handler — mobile browsers
  routinely block a scripted `window.open` once it's a state update or two
  removed from the raw tap, while a genuine link click is treated as normal
  navigation and isn't blocked.

### The legal pages

- Built from the app's existing design tokens (orange accent, surface/border
  colors, shadows) so they match the rest of the product in both light and
  dark themes, rather than a one-off palette.
- Sticky header with the app's own logo/brand and a "Back to app" control.
- Hero: icon badge, title, one-line intro, "Last updated" pill.
- "On this page" table of contents (desktop only — hidden under 900px) with
  **scroll-spy**: an `IntersectionObserver` highlights whichever section is
  currently under a thin band near the top of the viewport, updating live as
  the reader scrolls up or down. A second, lightweight scroll listener snaps
  the highlight to the last entry once the page is scrolled to its end —
  the observer band alone can never fully activate for the last section(s),
  since there's no more page left to scroll them into it.
- Icon-badged section headings (e.g. `Sparkles` for AI-generated content,
  `ShieldCheck` for data security, `GraduationCap` for children's data) drawn
  from the app's existing icon vocabulary where possible.
- Footer cross-links between the two documents.
- Content is realistic placeholder copy reflecting what this app actually
  does (bcrypt-PIN + JWT auth, school/district-scoped data, Gemini-based AI
  generation, attendance/classroom records, admin roles) — **not
  attorney-reviewed legal language**. Worth a lawyer's pass before treating it
  as the live, binding policy.

### "Back to app"

These pages are reached by opening a new tab from the account menu, so
clicking "Back to app" calls `window.close()` to return to the original app
tab, rather than navigating this new tab. If the tab wasn't opened by script
(e.g. bookmarked, or reached via the Terms ↔ Privacy footer cross-link, which
stays in the same tab) and `window.close()` is refused, it falls back to an
in-page navigation to `/` after a short delay instead of doing nothing.

## Bugs found and fixed along the way

1. **Toggle button fighting its own hover handler.** The "Learn more" trigger's
   `onClick` originally toggled the submenu open/closed. Since a click also
   fires a hover-in first (which already opens it), the toggle immediately
   closed it again — a tap would flash the submenu open then instantly shut.
   Fixed by making the click always *open* instead of toggle.
2. **Flyout clipped by the sidebar's `overflow: hidden`.** An in-place,
   absolutely-positioned flyout was invisible for the sidebar variant because
   `.sidebar` clips overflow for its width transition. Fixed by portalling
   the flyout to `document.body` with a JS-computed `position: fixed`.
3. **Flyout landing off-screen on mobile.** The horizontal flip math didn't
   clamp to the viewport — on a narrow phone, neither "beside" position
   technically fit, and the flyout was rendering almost entirely off the left
   edge of the screen (`left: -181px`). Fixed by clamping the computed
   position to stay fully on-screen.
4. **Flyout invisible behind the mobile sidebar drawer.** Even after fixing
   the position, the flyout still didn't appear on mobile: its `z-index: 160`
   was far below the mobile sidebar drawer's `z-index: 1200`. Fixed by raising
   it to `1300`, matching the codebase's existing convention for portalled
   popovers that need to clear that drawer.
5. **Flyout covering other menu items.** After the above fixes, the flyout was
   visible but still landed on top of "Settings" and other sidebar items on
   mobile, because the horizontal placement always preferred a fixed side
   before clamping. Fixed by choosing whichever side of the trigger has more
   available space before clamping, which pushes the flyout toward the
   drawer's edge (and the backdrop beyond it) instead of back onto the list.
6. **Popup blocked / not visible on mobile Chrome.** A `window.open()` call in
   a click handler was intermittently blocked by mobile popup blockers. Fixed
   by switching the two links to real `<a target="_blank">` navigation.
7. **Scroll-spy never highlighting the last section(s).** The
   `IntersectionObserver`'s tracking band near the top of the viewport can
   never be reached by the last section(s) once the page is scrolled to its
   end — there's no more room to scroll them up into it. Fixed with a
   secondary check that snaps the highlight to the last entry when the page
   is scrolled to its bottom.

## Verification

- `cd client && npm run lint && npm test && npm run build` — all green
  throughout (0 lint errors, all 710 tests passing, build succeeds) after
  every change in this session.
- Manual verification via a scripted, real Chromium browser (Playwright):
  - Desktop sidebar and topbar variants, in both light and dark themes.
  - The submenu's hover-open, click-open, and outside-click/Escape dismissal.
  - Horizontal/vertical flip behavior at desktop and mobile viewport widths.
  - Mobile emulation (Pixel 7 profile, touch taps) through the full flow:
    opening the drawer, the account menu, the submenu, and the resulting new
    tab.
  - Scroll-spy behavior scrolling to the top, middle, bottom, and back up.
  - "Back to app" closing a script-opened tab, and falling back to in-page
    navigation for a tab that wasn't script-opened.
- Not verified: a real physical mobile device (all mobile testing here used
  Chromium's device emulation).
