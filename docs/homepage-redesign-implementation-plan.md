# Homepage Redesign — Implementation Plan

Branch: `feature/homepage-design`.

**Status: planning only. Nothing in this plan has been implemented.** This
document is the result of inspecting the real homepage implementation
(`client/src/pages/HomePage.tsx`, `client/src/index.css`) and the approved
visual-direction mockup (`sarastech-homepage-mockup.html` /
the published design-canvas artifact) side by side, so every recommendation
below is grounded in what actually exists in the repo, not assumed.

**Scope: `client/` only.** The `mobile/` folder is not part of this feature.
This plan does not read, reference, or propose touching a single file under
`mobile/`, and implementation must not either.

---

## 0. What was inspected

- `client/src/pages/HomePage.tsx` (369 lines) — the real, currently-shipping
  logged-out landing page at `/`.
- `client/src/index.css` lines 6047–6436 — the `.home-*` CSS block backing
  it, plus the shared component classes it depends on (`.btn-primary`,
  `.btn-outline`, `.btn-text`, `.icon-btn`) defined earlier in the same file
  (lines ~102–150) and reused **globally**, not just on the homepage.
- `client/src/App.tsx` — route table (confirms `/` renders `HomePage` only
  when signed out; signed-in users get `CoachPage` at the same path).
- `client/src/config.ts` — `QUICK_ACTIONS` (the 4 hero task tiles, real
  `lucide-react` icons + copy).
- `client/src/lib/welcome.ts` — `getWelcomeGreeting()`, the real function the
  hero preview and the signed-in Coach welcome screen both call.
- `client/src/hooks/usePreferences.ts` — the real theme system (`data-theme`
  attribute on `<html>`, persisted in `localStorage`, defaults to
  `prefers-color-scheme`).
- `client/package.json` — confirms no animation library is installed
  (`framer-motion`, `gsap`, etc. — none present); the whole app's motion is
  hand-written CSS.
- Existing `@keyframes` / `@media (prefers-reduced-motion: reduce)` usage
  elsewhere in `index.css` (11 keyframes, 10 reduced-motion blocks across
  other pages) — establishes this codebase's own motion conventions.
- A class-collision check against the mockup's CSS class names (see §9).
- The mockup file itself: `Main.dc.html` (its working source) —
  structure, copy, and the CSS techniques it uses.

---

## 1. What will be changed

The homepage's **visual layout, spacing rhythm, and motion** will be rebuilt
to match the approved mockup direction: a centered oversized hero with a
full-width product-preview panel below it (instead of the current 2-column
hero), a bento-style feature grid (one featured tile + 3 supporting tiles,
replacing the 4 equal boxes), a connected numbered stepper (replacing 3
identical cards), a borderless divided FAQ list (replacing bordered FAQ
cards), background depth (layered gradient + ambient glow + dot texture),
and hover/entrance/scroll-reveal motion throughout.

**Not changed:** the homepage's copy, messaging, claims, feature list,
FAQ content, routes, or information architecture. This is a visual/layout
implementation, not a content rewrite — every string currently in
`HomePage.tsx`'s data arrays (`FEATURES`, `STEPS`, `CLASSROOM_FACTS`,
`FAQS`) carries over verbatim.

---

## 2. Files that will be modified

| File | Change |
|---|---|
| `client/src/pages/HomePage.tsx` | JSX structure rewritten to the new layout (new sections/wrapper elements, new class names). Same data arrays, same imports, same routing (`<Link>` targets unchanged), same accessibility attributes (`aria-labelledby`, `aria-label`, landmark roles) — carried over and re-applied to the new markup, not dropped. |
| `client/src/index.css` | The `.home-*` block (lines 6047–6436) replaced with the new rule set. Nothing outside that block is touched. The shared classes it depends on (`.btn-primary`, `.btn-outline`, `.icon-btn`, CSS custom properties in `:root` / `[data-theme='dark']`) are **read, not redefined** (see §9's scoping rule). |

No other file needs to change. No routing changes, no new dependencies, no
`package.json` edits.

---

## 3. New files/components needed

**None.** This stays consistent with the existing pattern: the homepage is
one component (`HomePage.tsx`) backed by one shared stylesheet
(`index.css`); there's no per-page CSS file or component-splitting
convention elsewhere in `client/src/pages/` to break from. The redesign is
large but stays inside those same two files.

No new npm dependency is needed — the mockup's motion is pure CSS
(`@keyframes`, `animation-timeline: view()`, hover transitions), matching
the fact that this codebase has zero animation libraries today and every
other page's motion is hand-written CSS too.

---

## 4. How the mockup design will be integrated

The mockup (`Main.dc.html`) was authored as a **static, standalone
visual reference** — it intentionally uses plain `<span>`/`<div>` markup,
hand-drawn placeholder SVG icons, hardcoded dark-theme hex colors, and
invented example copy (a "Sample output" lesson-plan snippet) because it
was built to be viewed in isolation, not dropped into the app. Integration
means **translating the visual design back onto the real component**, not
copy-pasting the mockup's HTML:

- **Layout/CSS** — the mockup's section structure, spacing scale,
  typography scale, gradients, card treatments, and motion rules are the
  source of truth for the new `.home-*` CSS. Class names are renamed to the
  existing `.home-` prefix convention (see §9 — several of the mockup's
  generic names collide with real global classes).
- **Icons** — the mockup's hand-drawn SVGs are replaced with the actual
  `lucide-react` icon components already used for these exact items:
  `NotebookPen`, `Target`, `Lightbulb`, `ClipboardCheck` (from
  `QUICK_ACTIONS` in `config.ts`) and `MessageCircleQuestion`, `Languages`,
  `ClipboardCheck`, `Library` (the `FEATURES` array already in
  `HomePage.tsx`). No new icon set is introduced.
- **Hero preview panel** — the mockup hardcodes `"Good afternoon, Teacher
  👋"` as static text. The real implementation keeps calling
  `getWelcomeGreeting('Teacher')` (already imported as `PREVIEW_GREETING`)
  exactly as today, per the existing code comment that this preview must
  reflect real product behavior, not a fabricated screenshot.
- **CTAs/links** — the mockup's CTA buttons are non-functional `<span>`s.
  The real implementation keeps the existing `<Link to="/login?mode=register">`
  and `<Link to="/login">` targets, just restyled and with unified copy
  ("Get Started" everywhere, already decided in an earlier pass of this
  redesign).
- **Footer legal links** — the mockup's `Terms of Service` / `Privacy
  Policy` footer links point to `#`. The real implementation points them at
  the real, already-existing routes `/terms` and `/privacy` (confirmed
  present in `App.tsx`'s logged-out route table).
- **"Sample output" callout content** — this is illustrative example copy
  invented for the mockup (a sample lesson-plan snippet), not a real
  screenshot or a verifiable product claim. `HomePage.tsx` currently carries
  an explicit comment banning invented stats, pricing, testimonials, or
  unverified claims. A clearly-labeled "Sample output" card arguably doesn't
  violate that (it's not presented as real data), but this is a judgment
  call the plan flags rather than resolves — **confirm before implementation**
  whether to keep it, reword it, or cut it.
- **"Free to get started — no credit card needed"** — this claim was
  verified during the mockup phase (grepped the whole repo for
  `pricing|subscription|billing|paywall|stripe|payment` — no app-level
  paywall exists; registration has no payment step). Safe to carry over as
  a true statement, not an invented one.

---

## 5. Visual/design changes

- **Hero**: centered layout (was: 2-column split) — kicker pill, oversized
  gradient-accented headline (`clamp()`-scaled), single-line subhead
  (tightened from the current 3-sentence paragraph), CTA row, "free to
  start" note, then a full-width **product-stage panel** below (the real
  `QUICK_ACTIONS` grid + real greeting), with a small "Sample output" card
  peeking over its bottom edge.
- **Background depth**: subtle full-page vertical gradient (barely
  perceptible, same base hue as today's `--bg`), two soft orange/amber glow
  blobs behind the hero, a faint dot-grid texture, masked to fade out by
  the bottom of the hero.
- **"Why SarasTech"**: asymmetric 2-column (was: 2 equal cards) — plain
  statement text on the left with a large low-opacity clock-icon watermark
  behind it, a bordered/glowing highlight panel on the right.
- **Features**: bento grid (was: 4 equal cards) — one wide featured tile
  for "AI Classroom Coach" (icon + copy + a small illustrative chat-bubble
  exchange), 3 standard tiles below for the other three features.
- **How It Works**: connected stepper (was: 3 identical cards) — numbered
  circles joined by a gradient line, no card borders.
- **Made for India**: one wide tinted panel, 2-column (statement left,
  checklist right — was: 3 separate bordered cards).
- **FAQ**: flat divider-line list (was: bordered card per question), plus
  icon instead of chevron.
- **CTA band**: full-bleed gradient band with a diagonal texture overlay
  and a soft radial light sheen (was: a smaller rounded-rectangle inset).
- **Footer**: expanded to a real 3-column layout — brand block, product
  quick-links, account/legal links (including the new Terms/Privacy links)
  — was: a single thin row with just a copyright and one Sign In link.
- **Typography/spacing**: larger type scale for the hero and section
  headings, more generous vertical rhythm between sections throughout.

---

## 6. Animation and transition changes

All motion is pure CSS — no new dependency, matching this codebase's
existing convention of hand-written `@keyframes` per page.

- **Ambient background drift** — the two hero glow blobs slowly
  drift/scale on an infinite loop (16–19s).
- **Staggered hero entrance** — kicker → headline → subhead → CTA row →
  free-note fade up in sequence on load.
- **Product-stage entrance + callout bob** — the stage panel fades in,
  the "Sample output" card fades/scales in slightly after, then gently
  bobs on a slow infinite loop.
- **Hover feedback** on every interactive surface: stage task tiles, bento
  cards (icon micro-rotation on hover), the "why" panel, the India panel,
  stepper number circles (glow ring on hover), nav links (underline
  sweep), FAQ rows (color shift + fade-in answer on open).
- **Scroll-driven reveal** on each major section (why/features/stepper/
  India/FAQ/CTA), implemented with **pure CSS `animation-timeline:
  view()`** — deliberately not `IntersectionObserver`/JS. *(One existing
  use of `IntersectionObserver` exists in the codebase,
  `LegalLayout.tsx:55`, for TOC active-link highlighting — unrelated, not
  a precedent for scroll-reveal, and not something this plan touches.)*
- **`prefers-reduced-motion` handling** — see §9 for the one meaningful
  deviation from the mockup this requires.

---

## 7. Responsive implementation

The current homepage already has its own working responsive breakpoints
and a functioning mobile hamburger menu (`menuOpen` state in
`HomePage.tsx`, `.home-mobile-menu` / `.home-mobile-toggle` in CSS, driven
by `@media (max-width: 780px)` / `(min-width: 781px)` in `index.css`). The
mockup has **no mobile nav at all** — it just hides the nav links at
880px with nothing in their place. That's a real functional gap, not a
visual one (see §9 — this must be preserved, not dropped).

Plan:
- Keep the existing hamburger menu behavior and markup pattern exactly as
  today; only its visual styling (colors, spacing) gets updated to match
  the new design language.
- Re-align the mockup's ad-hoc breakpoints (880px / 560px) to this
  codebase's actual established breakpoints for this exact page: **900px**
  (hero/grids collapse to 1 column — matches the current
  `@media (max-width: 900px)` block), **780px** (nav → hamburger, already
  the exact cutoff in use), **640px** (small-phone type/spacing
  adjustments — the dominant mobile breakpoint used 17× elsewhere in
  `index.css`).
- The absolutely-positioned "Sample output" callout card (which overlaps
  the stage panel on desktop) drops to static, in-flow position below the
  stage panel under 900px, exactly as already validated in the mockup.

---

## 8. What existing functionality will be preserved

- All routing: `/login`, `/login?mode=register`, `/forgot-password`,
  `/terms`, `/privacy` — every `<Link>` target stays exactly as it is
  today.
- The **mobile hamburger menu** (open/close state, focus/aria attributes,
  `Menu`/`X` icon swap).
- The **theme toggle** (`Sun`/`Moon` icon, `usePreferences().toggleTheme`)
  — light mode must keep working, not just dark (see §9 — this needs new
  design work the mockup didn't do).
- The **real hero preview data**: `QUICK_ACTIONS` (icons, labels,
  descriptions) and `getWelcomeGreeting('Teacher')` — not replaced with
  static mockup text.
- All existing accessibility markup: `aria-labelledby` on each section
  heading, `aria-label` on the nav landmarks and icon-only buttons,
  `aria-expanded`/`aria-controls` on the mobile menu toggle, semantic
  `<nav>`/`<section>`/`<footer>` — the mockup used generic `<span>`/`<div>`
  for buttons and nav items for rapid prototyping; the real implementation
  restores proper `<Link>`/`<button>` semantics and ARIA attributes.
- Smooth in-page anchor scrolling to `#why-sarastech` / `#features` /
  `#how-it-works` / `#faq` and their `scroll-margin-top` offset (currently
  wired via `html:has(.home-page)` in `index.css`) — **section `id`s stay
  as they are today**; the mockup renamed them (`#why`, `#how`) and that
  rename is not carried over, avoiding any risk of breaking an existing
  inbound anchor link.
- All existing FAQ content, feature descriptions, step descriptions, and
  the three "Made for India" facts, verbatim.

---

## 9. Important technical considerations

**a) Shared global classes must not be redefined — only scoped.**
`.btn-primary`, `.btn-outline`, `.btn-text`, and `.icon-btn` are **not**
homepage-only classes — they're the app's shared button/icon-button
components, used on the login page, Coach, Settings, and everywhere else.
The current CSS already establishes the correct pattern for
homepage-specific tweaks to shared classes:

```css
.home-page a.btn-primary,
.home-page a.btn-outline,
.home-page a.btn-text { text-decoration: none; }
```

Any new visual flourish this redesign wants on buttons (extra glow,
gloss highlight, etc.) must follow this same `.home-page .btn-primary`
scoping — never edit the bare `.btn-primary` rule, or every button in the
entire app changes. Note also that `.btn-primary`/`.btn-outline` **already**
have a hover lift (`transform: translateY(-1px)`) defined globally — the
redesign should rely on that rather than re-declare it.

**b) Class-name collisions with the rest of the app.**
The mockup uses several short, generic class names — `.brand`, `.icon`,
`.nav`, `.card`, `.section`, `.header`, `.footer`, `.row`, `.reveal`,
`.chev`, `.eyebrow`, `.kicker`, `.stage`, `.bento`. A direct check against
`index.css` found real, currently-in-use collisions: bare `.brand` is
already defined (line 190, the app shell's logo/wordmark, also reused by
`LegalLayout.tsx`'s `.legal-page`), and `.icon`/`.nav` patterns are also in
active use elsewhere. **Every new class must use the existing `.home-`
prefix** (as the current homepage CSS already does) — e.g. `.home-stage`,
`.home-bento`, `.home-reveal` — not the mockup's bare names.

**c) Light theme needs new design work — the mockup only explored dark.**
The real homepage supports a working light/dark toggle
(`usePreferences`), with light as the *default* for a new visitor whose
system is in light mode. The mockup is dark-only with hardcoded hex
values (glow-blob colors, stage-panel gradient, watermark opacity, etc.).
Implementing this redesign means designing a light-theme equivalent for
every new visual element — reusing the existing `--surface`/`--border`/
`--text`/`--orange`/`--amber` custom properties (which already swap
correctly under `[data-theme='dark']`) — before this can ship without
regressing the light-mode experience. **This is new work, not a
mechanical port**, and is likely the single largest chunk of implementation
effort in this whole plan.

**d) `prefers-reduced-motion` — invert the mockup's approach to match
this codebase's convention.** The mockup gates every animation *on*
inside `@media (prefers-reduced-motion: no-preference)`. Every other
page in this codebase does the opposite: animations are defined
unconditionally, then a `@media (prefers-reduced-motion: reduce)` block
neutralizes them (10 existing examples in `index.css`). For consistency
with the rest of the app, the real implementation should follow the
established pattern, not introduce a second convention.

**e) `animation-timeline: view()` is a new-to-this-codebase, Chromium-only
CSS feature.** No `browserslist` config exists in `package.json` to check
against. The scroll-reveal effect is wrapped in `@supports
(animation-timeline: view())`, so it fails safe (content just renders
fully visible, no animation) in Firefox/Safari today — but this is the
first use of this technique anywhere in the app. **Flagging for explicit
sign-off**: ship it as a Chrome-only progressive enhancement (recommended),
or drop scroll-reveal entirely for simplicity/predictability.

**f) No HomePage test file exists today**, so there's no existing test
suite to update for the markup changes — but the full client verification
gate (`npx prisma generate` is server-only; for `client/`: `npm run lint`
→ `npm test` → `npm run build`) must still pass afterward, since shared
classes and the route tree are touched.

**g) `mobile/` is completely out of scope** and is not read, referenced,
or modified anywhere in this implementation.

---

## 10. Step-by-step implementation order

1. **CSS foundation first**: add the new `.home-` prefixed rules
   (background/gradient tokens, `--surface-grad`-equivalent, keyframes
   renamed to the `home-` prefix, e.g. `home-fade-up`, `home-hero-drift`,
   `home-reveal-in`) alongside the existing `.home-*` block — don't delete
   the old rules yet, so the current page keeps rendering correctly while
   the new styles are built up.
2. **Hero section**: rebuild the JSX structure (centered text stack, full
   width product-stage panel, sample-output callout), wire the real
   `QUICK_ACTIONS`/`PREVIEW_GREETING` data, verify both themes.
3. **"Why SarasTech" section**: asymmetric layout, watermark icon, both
   themes.
4. **Features section**: bento grid, real feature icons, the illustrative
   chat-bubble preview, both themes.
5. **How It Works**: connected stepper, both themes.
6. **Made for India**: wide panel + checklist layout, both themes.
7. **FAQ**: flat divided list, both themes, verify the native
   `<details>`/`<summary>` fade-in still works with keyboard navigation.
8. **CTA band + footer**: full-bleed band, expanded 3-column footer with
   the new Terms/Privacy links, both themes.
9. **Responsive pass**: re-verify the hamburger menu still works
   end-to-end at each of the three breakpoints (900/780/640), confirm the
   callout card drops to static position correctly.
10. **Remove the old `.home-*` CSS block** once every section above is
    confirmed working in both themes and at all breakpoints (avoids dead
    CSS accumulating).
11. **Run the verification gate**: `npm run lint`, `npm test`,
    `npm run build` in `client/`; fix anything that fails.
12. **Manual QA pass** against §11's checklist below, in an actual
    browser (light + dark, desktop + mobile widths, keyboard nav).

---

## 11. Final verification / testing checklist

- [ ] `npm run lint` passes in `client/`
- [ ] `npm test` passes in `client/`
- [ ] `npm run build` passes in `client/`
- [ ] Homepage renders correctly in **light mode** (default for a
      light-system visitor) — not just dark
- [ ] Homepage renders correctly in **dark mode**
- [ ] Theme toggle button still works and persists via `localStorage`
- [ ] All nav anchor links (`Why SarasTech` / `Features` / `How It Works`
      / `FAQ`) still scroll to the correct section with correct offset
- [ ] Mobile hamburger menu still opens/closes, still lists all 4 nav
      links + Sign In + Get Started
- [ ] All CTA buttons ("Get Started" ×3, "Sign In" ×3) still route to the
      correct real pages (`/login?mode=register`, `/login`)
- [ ] Footer "Terms of Service" and "Privacy Policy" links route to the
      real `/terms` and `/privacy` pages
- [ ] Hero preview panel shows the real `QUICK_ACTIONS` (4 real tiles,
      real icons, real copy) and the real time-of-day greeting from
      `getWelcomeGreeting`
- [ ] FAQ accordion opens/closes via mouse **and** keyboard
      (space/enter on a focused `<summary>`)
- [ ] Responsive check at desktop (≥1200px), tablet (~900px), and phone
      (~375px) widths — no overlapping elements, no horizontal scroll
- [ ] `prefers-reduced-motion: reduce` (OS-level or emulated in DevTools)
      removes all drift/entrance/bob/reveal/hover-lift motion, while
      content remains fully visible and buttons still show a fast
      color/border hover response
- [ ] Every button/link on the page is reachable and operable by keyboard
      alone (Tab order, visible focus states)
- [ ] No other page in the app (Login, Coach, Settings, etc.) changed
      appearance as a side effect (confirms shared classes were scoped
      correctly per §9a)
- [ ] `mobile/` folder has zero diff (`git status` / `git diff --stat
      mobile/` shows nothing)
