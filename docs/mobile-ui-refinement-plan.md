# Mobile UI Refinement Plan — bringing the native app onto the web app's design language

**Status**: PLAN ONLY. Nothing in this document has been implemented. No
application code has been changed on this branch (`feature/mobile-ui-refinement`).

**Scope**: every mobile screen shipped through Phase 7/7b — Auth, bottom
navigation, Coach, Classroom (Phase 2 shell), Library, Generator,
Notifications, More/Profile, and every nested screen — plus the shared
component layer under `mobile/src/components/` and `mobile/src/theme/`.

**Not in scope**: new features, new backend surface, Phase 8+ functionality.
This is a visual/interaction-consistency pass over what already exists. Where
a screen is a deliberate Phase 2 stub (Classroom, Settings, Sessions, Help &
Support), this plan refines its *chrome* only and hands the real design to the
phase that builds it.

**Method**: every claim below was read out of the actual source. Web reference
is `client/src/index.css` (4,791 lines, the single source of the web design
system) plus the components that consume it. Mobile reference is
`mobile/src/**`. No component, token, class or screen is invented here — where
something does not exist on either side, this document says so explicitly.

---

## 1. Current UI problems found

Ordered by how much each one costs the "same product" feeling. Every item
names the file it was found in.

### 1.1 Severe — the mobile app contradicts the web's visual language

1. **The Coach conversation looks like a different product.**
   - `mobile/src/screens/coach/MessageBubble.tsx:26` paints the teacher's own
     message as a **solid orange bubble with white text**. The web
     (`index.css:1238` `.user-bubble`) paints it as `--surface-2` with normal
     `--text`, radius `16px 16px 4px 16px`. Orange on the web is reserved for
     brand/primary-action/active-state — never for a message body.
   - `MessageBubble.tsx:57` wraps the **assistant answer in a bordered
     `surface-2` card with a bubble tail**. The web has no assistant bubble at
     all: `.ai-message-content`/`.response-body` (`index.css:1436-1447`) is
     plain full-width prose on the page background. The mobile version reads
     as a chat toy; the web reads as a document.
   - Net effect: the single most-used screen in the app is the one that looks
     least like Teacher Assistant.

2. **Semantic colors on mobile do not exist anywhere in the web app.**
   The web has one consistent success/danger/warning system, always with a
   dark-mode counterpart:

   | Role | Web light | Web dark | Web source |
   |---|---|---|---|
   | danger text | `#b91c1c` | `#fca5a5` | `index.css:2704, 2782, 3409` |
   | danger border / bg | `#fca5a5` / `#fef2f2` | `#7f1d1d` / `rgba(127,29,29,.35)` | `index.css:2932, 3409, 3411` |
   | danger action | `#dc2626` | `#f87171` | `index.css:295-296, 1686-1688` |
   | success text | `#15803d` | `#6ee7a8` | `index.css:2931, 3370, 3372` |
   | success border / bg | `#86efac` / `#f0fdf4` | `#14532d` / `rgba(20,83,45,.35)` | `index.css:2931, 3408, 3410` |
   | warning | `#b45309` / `#fcd34d` / `#fffbeb` | — | `index.css:3133` |

   Mobile instead uses **`#e5484d`** (13 occurrences across
   `TextField.tsx:31,79`, `QuestionCard.tsx:55,100,305,340`,
   `AuthScreen.tsx:408`, `ForgotPasswordScreen.tsx:102`,
   `Composer.tsx:31`, `GeneratorFormScreen.tsx:214`,
   `ResourceListScreen.tsx:154`, `ResourceViewScreen.tsx:145`,
   `ResourceEditScreen.tsx:387`, `NotificationsScreen.tsx:66`),
   **`#2f9e58` / `#d64545`** (`SummaryTile.tsx:20`, `ToggleButton.tsx:24`),
   and **`#fdeceb` / `#f3b4b0` / `#a02622`** (`MessageBubble.tsx:118-119`).
   None of these six values appears anywhere in `client/src/index.css`.

3. **Two mobile surfaces are hardcoded light-mode and break in dark theme.**
   `MessageBubble.tsx:118` `errorCard: { backgroundColor: '#fdeceb',
   borderColor: '#f3b4b0' }` with `errorText: '#a02622'` is painted
   unconditionally — in dark mode a near-white error card sits inside a
   `#12151c` screen. Same class of bug in the `rgba(229,72,77,0.12)` error
   banners (`AuthScreen.tsx:407`, `ForgotPasswordScreen.tsx:101`,
   `GeneratorFormScreen.tsx:213`), which are tuned for a light background.

4. **The mobile app has no way to change theme.** `ThemeContext.tsx` exposes
   `setOverride`, and **zero components call it** (verified: no callers
   outside the context file). The app silently follows the OS only, while the
   web has a theme toggle in the top bar (`TopBar.tsx:127-131`, `Sun`/`Moon`)
   *and* on the auth screen (`.auth-theme`, `index.css:2484`). The preference
   is also not persisted (`ThemeContext.tsx` header comment says so).

5. **Every list/card treatment is a different shape from screen to screen.**
   - Library rows: `Card` (border + shadow + radius 14) —
     `ResourceListScreen.tsx:180`.
   - Notification rows: `Card` too, but unread = orange **border**
     (`NotificationsScreen.tsx:103`); the web uses a flat row with **no
     border/shadow at all** and unread = `--orange-soft` **background**
     (`index.css:3851-3865`), with the icon in a **circle** (`border-radius:
     999px`, `index.css:3867-3869`) — mobile uses a rounded square
     (`NotificationsScreen.tsx:151`).
   - More menu rows: each item is its own `Card` (`MoreMenuScreen.tsx:50`),
     which on the web would be a `.profile-dropdown-item` list — flat rows in
     one container, not five floating cards.
   - Classroom shortcut tiles: centred label-only `Card`s
     (`ClassHomeScreen.tsx:37`), with none of `.quick-action-card`'s
     icon + title + description + chevron structure (`index.css:1057-1089`).

### 1.2 Moderate — polish and hierarchy gaps

6. **No screen has the web's page header.** Web pages open with a title +
   subtitle pair (`.library-title` 1.5rem/700 + `.library-subtitle`
   0.95rem/muted, `index.css:1582-1583`; same pattern on Generator/Classroom).
   On mobile the native stack header supplies a bare title only
   (`useStackScreenOptions.ts`), so Library/Notifications/Classroom open
   straight into content with no orienting line.

7. **Coach markdown headings are not styled.** `MarkdownText.tsx:33` renders
   headings with a font *size* only — no `fontWeight`, and none of the web's
   `.response-body h2/h3 { color: var(--orange) }` (`index.css:1449-1450`). A
   Coach answer's structure is nearly invisible on mobile.

8. **The composer does not match the web composer.** Web `.composer-box`
   (`index.css:1953-1963`) is a `--surface-2` panel at `--radius` (14) with a
   `--border`, and a focus state of `border-color: var(--orange)` +
   `box-shadow: 0 0 0 3px var(--orange-soft)`; the send control is a **38px
   circle** (`index.css:2222-2235`). Mobile `Composer.tsx` has no boxed
   surface (just a top border on the dock), no focus treatment, and a
   **rounded-square 44px** send button.

9. **Resource View is not a document card.** Web wraps the resource in
   `.resource-doc` — a `--surface` card with `--radius`, `--shadow`, and a
   `.resource-doc-header` divided by a `border-bottom` (`index.css:1717-1738`).
   Mobile renders title + meta + body flat on `--bg`
   (`ResourceViewScreen.tsx:146-166`).

10. **Empty states are inconsistent with the web's.** The web empty state is a
    **60px circular `--surface-2` icon well** + title + hint + CTA
    (`.library-empty`/`.library-empty-icon`, `index.css:1690-1711`). Mobile
    renders a bare 30px icon with no well and no CTA
    (`ResourceListScreen.tsx:158-171`, `NotificationsScreen.tsx:78-83`).

11. **Loading is a bare spinner where the web shows skeletons.** The web has
    `.sk-line` shimmer lines for the Coach answer (`index.css:1370-1393`) —
    correctly ported in `RunStatus.tsx` — and `.notif-loading` skeleton rows
    (`index.css:3838`). Library/Notifications/Resource View on mobile all fall
    back to `ActivityIndicator` + a text line.

12. **No toast/confirm system exists on mobile.** Web has
    `Toast.tsx`/`.toast-*` (`index.css:2914-2932`) and `ConfirmDialog.tsx`.
    Mobile uses the OS `Alert.alert` for destructive confirms
    (`ResourceListScreen.tsx:79`, `ResourceViewScreen.tsx:73`) and silently
    rolls back on failure (`CoachScreen.tsx:104`, comment says so explicitly).
    Alert is acceptable and arguably better on Android for *confirmation*, but
    there is no success/failure feedback surface at all.

13. **Button variants do not cover the web's set.** Mobile `Button.tsx` has
    `primary` / `secondary` / `text`. The web additionally has `.icon-btn`
    (40×40 `--surface-2` + border, `index.css:95-112`) and `.action-chip`
    (`index.css:1519-1546`), both of which mobile re-implements ad hoc inside
    screens (`ResourceViewScreen.tsx` toolbar, `GeneratorFormScreen.tsx`
    stepper, `NotificationsScreen.tsx` mark-all row).

### 1.3 Android/accessibility specifics

14. **Sub-44dp touch targets.** `SuggestionChips.tsx` chips are
    `paddingVertical: 5` + 12px text ≈ **26dp tall**. `ChipPicker.tsx` chips
    are `minHeight: 36`. `ResourceListScreen.tsx` filter chips have no
    `minHeight` at all. `ResourceListScreen.tsx:207` delete button is
    `padding: spacing.xs` (≈24dp) with `hitSlop={8}` — the hitSlop saves it
    functionally but it still *looks* cramped.

15. **No `edge-to-edge` / bottom-inset handling on the tab bar.** Only
    `CoachScreen.tsx:129` applies `insets.bottom`. Every other screen relies on
    the default tab bar. Android 15 forces edge-to-edge for `targetSdk 35+`, so
    this needs an explicit decision rather than a default.

16. **No horizontal-scroll guard on wide content.** The web scopes wide tables
    with `.fmt-table` inside an overflow container and drops font size at
    ≤640px (`index.css:1478-1516`). `MarkdownText.tsx` does not implement
    tables at all (documented), so nothing overflows today — but the Generator
    preview and Resource View both render long unbroken strings unguarded.

17. **No small-screen adaptation.** Every mobile layout uses fixed `spacing.lg`
    (16) page padding and fixed font sizes. There is no equivalent of the
    web's density step-down at ≤640px / ≤400px (`index.css:637`, `817`).

### 1.4 Copy and metadata divergences

18. Coach quick-action labels were shortened on mobile ("Lesson Plan") vs web
    ("Create a Lesson Plan") — `EmptyState.tsx:24-29` vs `client/src/config.ts:75-78`.
19. Web hides the 4th quick action on mobile (`hideOnMobile: true`,
    `client/src/config.ts:78`, enforced by
    `.quick-action-card--mobile-hidden`, `index.css:~700`). The native app
    shows all four.

### 1.5 What is already right (do not "fix" these)

- **Icons**: `RESOURCE_TYPE_META` and `NOTIFICATION_TYPE_META` in
  `mobile/src/config.ts:40-45, 151-157` use the **same lucide names** as
  `client/src/config.ts:185-190, 416-422`. `MainTabs.tsx` uses the same
  `Sparkles`/`GraduationCap`/`Library`/`FileQuestion` as `BottomNav.tsx`.
- **Base palette**: `mobile/src/theme/tokens.ts` copies `:root` /
  `[data-theme='dark']` 1:1 and says so.
- **Primary button**: `Button.tsx` reproduces `.btn-primary`'s orange→amber
  135° gradient via `expo-linear-gradient`, exactly as §22 asked.
- **Underline tabs**: `GeneratorResultScreen.tsx` / `ResourceEditScreen.tsx`
  preview/edit tabs match `.classroom-tabs`' bottom-border-orange idiom
  (`index.css:3170-3186`).
- **RunStatus skeleton**: a faithful port of `.sk-line`.
- **System font only**: matches `index.css:64`'s deliberate choice.

---

## 2. Web vs mobile UI comparison

| Element | Web (source) | Mobile today (source) | Verdict |
|---|---|---|---|
| Palette tokens | `index.css:1-53` | `theme/tokens.ts` — 1:1 copy | ✅ keep |
| Semantic colors | `#15803d`/`#b91c1c`/`#b45309` families with dark variants | `#2f9e58`/`#e5484d`/`#d64545`, no dark variants | ❌ replace |
| Radius | `--radius` 14 / `--radius-sm` 10 | `radius.md` 14 / `radius.sm` 10 | ✅ keep |
| Shadow | `--shadow` two-layer | `shadow.ios` / `shadow.android` elevation 3 | ✅ keep |
| Spacing | per-component rem literals | `spacing` 4/8/12/16/24/32 scale | ✅ keep, formalise |
| Primary button | `.btn-primary` gradient, radius-sm, 0.7/1.4rem | `Button.tsx` gradient, radius-sm, 12/22 | ✅ keep |
| Secondary button | `.icon-btn` surface-2 + border | `Button.tsx` variant `secondary` | ✅ close enough |
| Text button | `.btn-text` muted, hover surface-2 | `Button.tsx` variant `text` | ✅ keep |
| Chip / filter | `.library-filter` (active = solid orange) | `ResourceListScreen` filter chip (same) | ✅ keep, add minHeight |
| Action chip | `.action-chip` (`index.css:1519`) | none — ad hoc `Pressable`s | ❌ add component |
| Input | `.auth-input input` 46px, focus = orange border + 3px orange-soft ring | `TextField.tsx` 48px, focus = none | ⚠️ add focus state |
| Card | `--surface` + `--border` + `--shadow` + radius 14 | `Card.tsx`, identical | ✅ keep |
| Top bar | `.topbar` sticky surface + border-bottom + shadow, 62px | native stack header, `headerShadowVisible: false` | ⚠️ align |
| Bottom nav | `.bottom-nav` 58px + safe-area, icon 20 + 0.7rem/600 label, active `--orange` | RN bottom tabs, default sizing, active `--orange` | ⚠️ align sizing |
| Notification badge | `.notif-badge` 17px pill, orange, `0 0 0 2px var(--surface)` ring | `tabBarBadge` default + `MoreMenuScreen` custom 20px | ⚠️ align |
| User message | `.user-bubble` surface-2, `16px 16px 4px 16px` | solid orange, white text | ❌ replace |
| Assistant answer | `.response-body` plain prose, orange h2/h3 | bordered surface-2 card, unstyled headings | ❌ replace |
| Composer | `.composer-box` surface-2 panel, radius 14, focus ring; circular 38px send | flat dock, no focus, square 44px send | ❌ replace |
| Notification row | flat row, radius-sm, unread = orange-soft bg, circular icon | `Card`, unread = orange border, square icon | ❌ replace |
| Empty state | 60px circular icon well + title + hint + CTA | bare 30px icon + title + hint | ❌ replace |
| Loading | skeleton lines / spinner + `--orange` top | `ActivityIndicator` (orange) + text | ⚠️ add skeletons |
| Error inline | `.auth-error` tinted panel + icon + border | tinted panel, no icon, no border, light-only | ⚠️ align |
| Toast | `.toast` + `Toast.tsx` | none | ⚠️ add |
| Theme toggle | `TopBar` Sun/Moon + `.auth-theme` | none (`setOverride` unused) | ❌ add |
| Page header | title 1.5rem/700 + muted subtitle | none | ❌ add |
| Document view | `.resource-doc` card | flat | ❌ replace |
| Summary tile | `.classroom-summary-tile` surface-2, radius-sm, value 1.15rem/700 | `SummaryTile.tsx` uses `Card` (surface + shadow), value 24 | ⚠️ align |
| Present/Absent | tinted pill (bg `#f0fdf4`, text `#15803d`, border `#86efac`) | solid fill + white text | ❌ replace |

---

## 3. Overall design system to follow

**Rule: the web app is the design authority.** `client/src/index.css` is not a
stylesheet to be admired from a distance — it is the spec. Anything not
derivable from it needs a written reason in the code comment, matching this
repo's existing commenting convention.

Three layers, in dependency order:

1. **`mobile/src/theme/` — tokens.** Colors, semantic colors, radius, spacing,
   shadow, typography scale. No component may hardcode a color, radius or
   font size that is not a token. This is enforced by review, and by a lint
   rule if one can be added cheaply (see §24).
2. **`mobile/src/components/` — primitives.** One implementation per web
   primitive: `Button`, `IconButton`, `ActionChip`, `Chip`, `Card`,
   `TextField`, `Badge`, `StatusPill`, `SummaryTile`, `ToggleButton`,
   `Skeleton`, `EmptyState`, `ErrorBanner`, `ScreenHeader`, `Toast`.
3. **`mobile/src/screens/` — composition only.** After this refactor a screen
   file should contain almost no raw color/size values; its `StyleSheet` should
   be layout (flex, gap, padding from `spacing`) plus references to primitives.

**Non-negotiables carried over from the web:**
- Orange (`#ff6b35`) means brand, primary action, or active state. Never a
  content background.
- The orange→amber 135° gradient belongs to the primary CTA only.
- `--surface` for raised things, `--surface-2` for recessed/secondary things,
  `--bg` for the page. Mobile currently respects this; keep it.
- One border weight (`hairlineWidth`, the RN analogue of the web's 1px).
- Dark theme is a token swap, never a separate component tree.

---

## 4. Color / token strategy

### 4.1 Keep exactly as-is
`mobile/src/theme/tokens.ts`'s `light` / `dark` objects — they already mirror
`index.css:1-53` value-for-value, including the fact that the brand colors do
not change between themes.

### 4.2 Add: the missing web tokens

The web defines four `:root` values mobile never ported. Add them:

```
--orange-soft  light: rgba(255,107,53,0.10)   dark: rgba(255,107,53,0.16)
--sk-mid       light: #f7f8fa                 dark: #2a3040
--sk-peak      light: #fdf8f5                 dark: #333b4c
--bottomnav-h  58                             (a layout constant, not a color)
```

`orangeSoft` is the single highest-value addition: the web uses it for
*every* soft-active state — `.action-chip.active`, `.notif-row-unread`,
`.composer-menu-btn.active`, `.auth-tabs button.active` in dark mode, and the
composer focus ring. Mobile currently fakes each of these differently.

### 4.3 Add: the semantic scale (this is the big one)

A new `semantic` export in `tokens.ts`, keyed light/dark, transcribed from the
web values catalogued in §1.1 item 2:

```
danger:  { text, textStrong, border, bg, action }
success: { text, border, bg }
warning: { text, border, bg }
```

with light = `#b91c1c / #dc2626 / #fca5a5 / #fef2f2` and
`#15803d / #86efac / #f0fdf4` and `#b45309 / #fcd34d / #fffbeb`, and dark =
`#fca5a5 / #f87171 / #7f1d1d / rgba(127,29,29,.35)` and
`#6ee7a8 / #14532d / rgba(20,83,45,.35)`. Warning has no dark override on the
web; derive one and comment that it is derived, not copied.

Then replace every one of the 13 `#e5484d` sites, both `#2f9e58`/`#d64545`
sites, and the three `#fdeceb`/`#f3b4b0`/`#a02622` sites. This single change
fixes finding 2 and finding 3 together.

### 4.4 Access pattern

`useTheme()` already returns `colors`. Extend its return with `semantic` and
`orangeSoft` so a component gets theme-correct values from one hook call, with
no new context and no consumer-side branching on `mode`. `ThemeColors` gains
the new keys; the compiler then finds every incomplete palette object.

### 4.5 Rule

**No hex literal outside `tokens.ts`**, with exactly two allowed exceptions,
both already present and both correct: `'#fff'` as the foreground on a filled
orange/gradient surface (`Button.tsx:83`, `ChipPicker.tsx:45`), and the print
stylesheet in `lib/buildResourcePdfHtml.ts`, which deliberately targets paper
and is documented as such.

---

## 5. Typography

The web has no type scale token — it uses per-component rem literals. Reading
them off `index.css` gives a de-facto scale, which mobile should formalise
once in `tokens.ts` (base 16px, so 1rem = 16dp):

| Token | dp | Weight | Web origin |
|---|---|---|---|
| `display` | 24 | 700 | `.auth-brand h1` 1.5rem/700 (`2668`) |
| `pageTitle` | 24 | 700 | `.library-title` 1.5rem/700 (`1582`) |
| `sectionTitle` | 18 | 700 | `.notif-panel-title` 1rem + `.classroom-panel-title` (`3215`) |
| `cardTitle` | 16 | 600 | `.library-card-title` 0.98rem/600 (`1669`) |
| `body` | 15 | 400 | `.user-bubble` 0.95rem (`1242`) |
| `bodyStrong` | 15 | 600 | `.classroom-att-name` 0.92rem/600 (`3390`) |
| `subtitle` | 15 | 400 muted | `.library-subtitle` 0.95rem (`1583`) |
| `label` | 13 | 600 muted | `.auth-field-label` 0.82rem/600 (`2702`) |
| `caption` | 12 | 400 muted | `.library-card-meta` 0.75rem (`1671`) |
| `micro` | 11 | 600 | `.bottom-nav-item` 0.7rem/600 (`222`) |
| `eyebrow` | 12 | 700 uppercase, `letterSpacing: 0.5` | `.library-card-type` 0.72rem/700/uppercase/0.04em (`1659-1667`) |

Line heights: the web sets `1.5` on bubbles, `1.7` on `.response-body`, `1.45`
on snippets, `1.25` on headings. Mobile should carry `lineHeight` on every
variant rather than letting RN's default win — this is the difference between
prose that reads and prose that looks cramped.

`ThemedText` gains these as `variant` values, replacing today's
`title | body | muted` triple (which conflates *size* and *color* — `muted` is
a color, `title` is a size). Keep `muted` working as a colour modifier for
backwards compatibility during the migration, then fold it into a `tone` prop.

**Do not add a custom font.** `index.css:64` deliberately uses the system
stack, and `§22` of the mobile plan re-confirms it. Roboto is the system font
on the Samsung target; nothing to load, nothing to license, no bundle cost.

---

## 6. Spacing / layout system

Keep `spacing = { xs:4, sm:8, md:12, lg:16, xl:24, xxl:32 }` — it is already
in use everywhere and maps cleanly onto the web's `0.25/0.5/0.75/1/1.5/2rem`
literals.

Add three layout constants so screens stop re-deriving them:

- `layout.screenPadding = spacing.lg` (16) — matches the web's `1.25rem` page
  padding at mobile width (`index.css:1580` `.library-main`, `1714`
  `.resource-main`).
- `layout.cardGap = spacing.md` (12) — matches `.library-grid`'s `0.9rem`.
- `layout.bottomNavHeight = 58` — the `--bottomnav-h` the web already defines
  (`index.css:26`), needed for list bottom padding so the last card is never
  under the tab bar.

**Standard screen skeleton** (every screen adopts it):

```
SafeAreaView-aware container (bg)
 └ ScreenHeader        (title + optional subtitle + optional trailing action)
 └ sticky controls     (search / filters), if any
 └ content             (FlatList or ScrollView)
      contentContainerStyle: { padding: screenPadding,
                               gap: cardGap,
                               paddingBottom: bottomNavHeight + insets.bottom + xl }
 └ optional bottom action bar (surface + top border + safe-area bottom pad)
```

Today six screens each invent their own version of this (`container: { flex:1,
padding:16 }` in `MoreMenuScreen`/`ClassListScreen`/`ClassHomeScreen`;
`{ flex:1, paddingHorizontal: lg, paddingTop: md }` in
`ResourceListScreen`/`NotificationsScreen`; `{ flex:1 }` +
`scroll: { padding: lg }` in the Generator/Library detail screens). Unifying
them is most of the "randomness" complaint, fixed structurally rather than
screen-by-screen.

---

## 7. Navigation / header / bottom-tab design

### 7.1 Bottom tab bar

Match `.bottom-nav` (`index.css:200-230`) precisely:

| Property | Web | Action on mobile |
|---|---|---|
| Height | 58 + safe-area inset | set `tabBarStyle.height = 58 + insets.bottom`, `paddingBottom = insets.bottom` |
| Background | `--surface` | already correct |
| Top border | `1px --border` | already correct |
| Shadow | `0 -2px 10px rgba(20,24,33,.06)` | add elevation/shadow (currently none) |
| Icon size | 20 | pin `size={20}` (currently RN default ~24-28) |
| Label | 0.7rem / 600 | `tabBarLabelStyle: { fontSize: 11, fontWeight: '600' }` |
| Icon↔label gap | 0.15rem | `tabBarIconStyle` margin |
| Active color | `--orange` | already correct |
| Inactive color | `--text-muted` | already correct |

**Keep the 5th "More" tab.** It is a deliberate, documented improvement
(`MainTabs.tsx` header comment, plan §10): a full-screen native app has no
persistent top bar to hold Settings/Sessions/Help, unlike the web. This is a
case where mobile *should* differ, and it already does correctly.

Badge: replace the default `tabBarBadge` styling with `.notif-badge`'s spec —
17dp min-width, fully round, `--orange`, white 11dp/700 text, and the 2dp
`--surface` ring the web uses (`index.css:1781-1796`) so the badge reads
cleanly against the icon.

### 7.2 Stack headers

`useStackScreenOptions.ts` currently sets background/tint and
`headerShadowVisible: false`. The web's `.topbar` has both a
`border-bottom: 1px --border` **and** `box-shadow: var(--shadow)`
(`index.css:126-132`). Align by:
- keeping `headerShadowVisible: false` (Android's default header shadow is
  heavier than the web's), and
- adding an explicit 1px `--border` bottom edge, so the header separates from
  content the same way it does on the web.
- `headerTitleStyle`: 17dp/700 — between the web's `.brand-title` (1.05rem/700)
  and `.library-title`, and the Android platform norm.
- `headerBackTitleVisible: false` (Android has no back title anyway; makes the
  iOS path consistent for free).

### 7.3 Header vs page title — resolve the duplication

Right now Library shows "Library" in the stack header and nothing else; the
web shows "My Library" + "Everything you've saved…". Proposal:

- **List/root screens** (`ResourceList`, `Notifications`, `MoreMenu`,
  `ClassList`, `GeneratorForm`, `Coach`): keep the native header for the short
  name, and add a `ScreenHeader` block at the top of the content with the
  web's **subtitle** line only (not a duplicate title). This gets the web's
  orienting copy without stuttering the title twice.
- **Detail screens** (`ResourceView`, `ResourceEdit`, `GeneratorResult`): the
  native header carries the back affordance; the in-content header carries the
  eyebrow (type) + title + meta, exactly as `.resource-doc-header` does.

### 7.4 Auth navigator

`AuthNavigator` runs headerless, which is right. Add a theme toggle in the
top-right of `AuthScreen` mirroring `.auth-theme`'s absolutely-positioned
toggle (`index.css:2484`) — this is also how a user first discovers the
override exists.

---

## 8. Button / input / card / component standards

### 8.1 `Button`
Keep the three variants. Add:
- `size`: `md` (default, 44 min-height — current behaviour) and `sm` (36, for
  in-card actions). The web has this implicitly (`.save-submit` at 0.5/1.1rem
  vs `.btn-primary` at 0.7/1.4rem).
- `tone`: `default | danger`. The web has destructive text buttons
  (`.profile-dropdown-danger`, `.history-clear`); mobile re-implements them
  ad hoc.
- `icon`: an optional leading `LucideIcon`, since almost every web button in
  this app carries one.
- Pressed feedback: today it is `opacity: 0.6` for both *pressed* and
  *disabled*, which makes a pressed button look broken. Split them —
  disabled `opacity: 0.6` (matching `.btn-primary:disabled`), pressed a
  subtle scale/darken. Add `android_ripple` on the non-gradient variants;
  Android users expect it and the web's `:hover` has no touch equivalent.

### 8.2 New `IconButton`
Port `.icon-btn` (`index.css:95-112`): 40×40, `--surface-2` background, 1px
`--border`, `--radius-sm`, `--text` icon. Used by the Resource View toolbar,
the Generator stepper, header actions, and the notification mark-all row —
all of which currently hand-roll it.

### 8.3 New `ActionChip`
Port `.action-chip` (`index.css:1519-1546`): `--surface-2` + border pill,
with `.active` = `--orange-soft` bg + `--orange` text/border, and `.chosen` =
solid orange. This is the right primitive for Coach's feedback controls and
any future response actions.

### 8.4 `Chip` (consolidating `ChipPicker` + filter chips + `SuggestionChips`)
Three near-identical implementations exist (`ChipPicker.tsx`,
`ResourceListScreen.tsx:126-142`, `SuggestionChips.tsx`). Collapse to one
`Chip` with `selected` and `size` props, matching `.library-filter`
(`index.css:1609-1623`): border pill, active = solid `--orange` + white.
**Every variant gets `minHeight: 44`** — fixing finding 14 in one place.

### 8.5 `TextField`
Add the web's focus treatment (`index.css:2736-2746`): on focus, border →
`--orange` and a 3dp `--orange-soft` ring (RN: an outer `View` with
`borderWidth: 3` in `orangeSoft`, or `shadowColor`+`elevation` on Android —
the outer-view approach renders identically on both and is preferred). Also
switch the error color to the new `semantic.danger.text`.

### 8.6 `Card`
No change to the primitive. Add two documented usage modes so screens stop
mixing them:
- `elevated` (default, today's behaviour) — for genuinely raised objects:
  library resource cards, the document card, the identity card.
- `flat` — `--surface-2`, no shadow, `--radius-sm` — for list rows inside a
  screen: notification rows, More-menu rows, attendance rows. This is what
  the web actually uses for row-like content (`.notif-row`,
  `.classroom-att-row`, `.classroom-history-item`).

### 8.7 New `Badge` / `StatusPill`
`Badge` = `.notif-badge`. `StatusPill` = `.status-pill` (`index.css:3121-3148`),
with the semantic variants. Needed by Phase 8+ (class archived, fee paid,
approval pending) and by the notification badge today.

### 8.8 New `ErrorBanner`, `EmptyState`, `Skeleton`, `ScreenHeader`, `Toast`
Covered in §16 (states) and §7 (header). `Toast` ports `.toast`/`Toast.tsx`
with a bottom offset above the tab bar, mirroring the web's own
`.toast-stack { bottom: calc(var(--bottomnav-h) + ...) }` rule.

---

## 9. Screen-by-screen refinement plan

Sections 10-15 give the per-feature detail. Summary of the change surface:

| Screen | File | Change size |
|---|---|---|
| Auth (login/register/pending/rejected/school-picker) | `screens/auth/AuthScreen.tsx` | Medium |
| Forgot password | `screens/auth/ForgotPasswordScreen.tsx` | Small |
| Coach | `screens/coach/*` (6 files) | **Large** |
| Class list / Class home | `screens/classroom/*` | Small (shell only) |
| Library list | `screens/library/ResourceListScreen.tsx` | Medium |
| Resource view | `screens/library/ResourceViewScreen.tsx` | Medium |
| Resource edit | `screens/library/ResourceEditScreen.tsx` | Small |
| AI assist / suggestion modal / exam header | `screens/library/*` | Small |
| Generator form | `screens/generator/GeneratorFormScreen.tsx` | Small |
| Generator result | `screens/generator/GeneratorResultScreen.tsx` | Small |
| Notifications | `screens/notifications/NotificationsScreen.tsx` | Medium |
| More menu | `screens/MoreMenuScreen.tsx` | Medium |
| Placeholder | `screens/PlaceholderScreen.tsx` | Small |
| Navigation chrome | `navigation/MainTabs.tsx`, `useStackScreenOptions.ts` | Medium |

### 9.1 Auth screens

- Replace the hand-rolled `errorBanner` with `ErrorBanner`, which ports
  `.auth-error` faithfully: tinted background **plus 1px border**, an
  `AlertCircle` leading icon (the web has `.auth-error svg`), and semantic
  colors that flip with the theme.
- Brand block: the web's `.auth-brand-logo` is a 54px rounded square
  (`radius 16`) with a soft orange gradient tint and a border
  (`index.css:2655-2667`). Mobile shows a bare 40dp emoji
  (`AuthScreen.tsx:406`). Wrap it to match — this is the first thing a user
  ever sees and it currently looks unfinished.
- Tabs: mobile's Sign in/Register segmented control is already close to
  `.auth-tabs`. Two fixes: the active pill needs the web's dark-mode
  correction (`[data-theme='dark'] .auth-tabs button.active { background:
  var(--orange-soft) }`, `index.css:2694-2697`) — mobile currently uses
  `colors.surface`, which in dark mode is *darker* than the track and reads
  as a dent, exactly the bug the web comment describes; and the track should
  be `--surface-2` (currently transparent).
- Add the `.auth-theme` toggle (§7.4).
- The school-picker view renders each school as a full-width **primary
  gradient button** (`AuthScreen.tsx:227`) — four orange gradients stacked.
  Make them selectable list rows (flat `Card` + name + code + chevron), with
  one primary action if any.

### 9.2 Placeholder screen
Give it the `EmptyState` treatment (circular icon well, title, hint) so the
not-yet-built screens look intentional rather than unfinished. Same component
the real empty states use — zero extra cost.

---

## 10. Coach UI

This is the largest and highest-value change.

**10.1 User message** — adopt `.user-bubble` exactly:
`--surface-2` background, `--text` color, `borderRadius` `16/16/4/16`,
`maxWidth: '80%'`, 15dp/1.5 line height, right-aligned. Delete the orange fill
and the white text.

**10.2 Assistant answer** — delete the card wrapper entirely. The web renders
the answer as plain prose at full column width (`.ai-message-content` /
`.response-body`, `index.css:1436-1447`). This also solves a real mobile
problem: a bordered card inside a 16dp-padded screen wastes ~32dp of the
already-narrow reading width on every answer.

**10.3 Markdown typography** — bring `MarkdownText.tsx` up to `.response-body`:

| Block | Web | Mobile change |
|---|---|---|
| paragraph | `line-height: 1.7`, `margin: 0.7rem 0` | 15dp / lineHeight 25 |
| h1 | 1.3rem, `--text` | 21dp / 700 |
| h2 | 1.15rem, **`--orange`**, `margin-top: 1.3rem` | 18dp / 700 / orange |
| h3 | 1.05rem, **`--orange`** | 16dp / 700 / orange |
| list item | `margin: 0.3rem 0`, indent 1.3rem | keep, set 21dp indent |
| bold | 700 | already correct |

Adding `fontWeight` and the orange headings is the single change that makes a
Coach answer look like the web's.

**10.4 Composer** — rebuild to `.composer-box`:
- `--surface-2` panel, `--radius` (14), 1px `--border`, sitting **inside** the
  dock's padding rather than being the dock.
- Focus state: `--orange` border + 3dp `--orange-soft` ring.
- Send button: **circular 38dp**, solid `--orange`, white icon; disabled =
  `opacity: 0.4` (the web's exact value, `index.css:2237`).
- Keep the character counter, but restyle to `.char-count` (0.78rem muted,
  `--orange` + 700 when warning — the web warns in *orange*, not red;
  mobile currently turns it `#e5484d`).
- The web puts controls on their own row beneath the text
  (`.composer-controls`, with a documented reason: controls must never share
  horizontal space with what the teacher is typing). Mobile puts the send
  button beside the input. **Keep the mobile arrangement** — with no
  attachment/voice/mode controls yet, a second row would be empty chrome, and
  a thumb-reachable trailing send is the Android norm. Revisit if Coach gains
  attachments.

**10.5 Empty state / quick actions** — adopt `.quick-action-card`
(`index.css:1057-1089`) and its ≤640px overrides (`index.css:~690-700`):
- **Single column, not the current 2-up grid.** The web explicitly switches
  `.quick-action-grid` to `grid-template-columns: 1fr` on mobile. Two 47%-wide
  cards on a phone force 2-line titles and truncated descriptions.
- Row layout: icon well (36dp on mobile per `index.css`'s own override) +
  title/description stack + a chevron at 0.5 opacity (the web reveals the
  chevron on touch devices precisely because there is no hover —
  `index.css` comment: "No hover on touch — reveal the chevron so cards read
  as tappable").
- Restore the web's full labels ("Create a Lesson Plan" etc.,
  `client/src/config.ts:75-78`) so the two products say the same thing.
- **Recommendation, not a requirement**: the web hides the 4th quick action on
  mobile (`hideOnMobile: true`) so the composer stays reachable without
  scrolling. With a single-column list the native app has the same problem.
  Matching the web here is both consistent *and* better UX — recommended.
- Greeting: web `.welcome-title` is 1.4rem on mobile with a tighter rhythm;
  mobile uses 22dp, close enough — align to 22/1.4rem and keep.

**10.6 Error turn** — replace the hardcoded light-only error card with
`ErrorBanner` + a `Button variant="text" tone="danger"` retry, themed.

---

## 11. Classroom UI

`ClassListScreen` and `ClassHomeScreen` are **Phase 2 navigation shells with
mock data**, and their own file comments say Phase 8 replaces them. This plan
therefore does **not** design the real Classroom UI — that belongs to Phase 8,
which should build directly on the primitives this refinement lands.

What this pass does do:

1. Apply the standard screen skeleton and `ScreenHeader`.
2. Rebuild the four Class Home shortcuts as `.quick-action-card`-shaped rows
   (icon well + label + description + chevron) instead of centred label-only
   tiles. The web's own `.quick-action-card` is the right precedent, and
   Phase 8 then has a card shape to reuse rather than invent.
   Suggested icons, from the lucide set the web already uses:
   `ClipboardCheck` (Attendance), `Users` (Students), `IndianRupee` or
   `Wallet` (Fees), `BarChart3` (Reports) — to be confirmed against
   `client/src/components/classroom/*` when Phase 8 starts, so the two apps
   pick the same icon per concept.
3. Make the class list row match `.classroom-class-item`
   (`index.css:3219-3244`): flat `--surface-2` row, `--radius-sm`, name at
   0.92rem/600, meta muted beneath, active/selected = `--orange` border.
4. Keep the "Mock classes shown above…" note but move it into a proper
   `ErrorBanner`-style info note rather than centred grey text.

Deferred to Phase 8 with the primitives ready for them: `SummaryTile` row
(§8.6), `ToggleButton` (§8 below), the sticky save bar (`.classroom-save-bar`),
and the attendance roster row (`.classroom-att-row`).

**`ToggleButton` correction (do it now, it is a primitive):** the web's
Present/Absent active state is a *tinted* pill — `background: #f0fdf4`,
`color: #15803d`, `border-color: #86efac` (and the dark counterparts). Mobile
fills it solid green/red with white text. Change to the web's tinted treatment
using the new semantic tokens. Same for `SummaryTile`: the web tile is
`--surface-2` at `--radius-sm` with **no shadow** and a 1.15rem/700 value in
the semantic color; mobile uses an elevated `Card` with a 24dp value.

---

## 12. Library UI

**12.1 List screen**
- Add `ScreenHeader` subtitle (web: `.library-subtitle`).
- Search box: match `.library-search` (`index.css:1586-1606`) — currently
  close; add the focus-within `--orange` border the web has.
- Filter chips: use the shared `Chip` (§8.4) with `minHeight: 44`.
- Card: the web's delete control is a **full-height 40px rail on the card's
  right edge with a left border** (`index.css:1672-1685`), not a floating
  icon. Adopt it — it is more discoverable and gives a proper 40×card-height
  touch target instead of today's 24dp + hitSlop.
- Type label: adopt `.library-card-type`'s eyebrow style (0.72rem, 700,
  **uppercase**, `letter-spacing: 0.04em`, `--orange`). Mobile currently uses
  12dp/600 muted — losing both the uppercase treatment and the orange.
- Empty state → the shared `EmptyState` with a circular icon well and, when
  the library is genuinely empty (not filtered), a CTA to Coach — the web's
  `.library-empty` has exactly this CTA slot.
- Loading → skeleton cards (3 placeholder rows) instead of a centred spinner.

**12.2 Resource view**
- Wrap content in a `.resource-doc` card: `--surface`, `--radius`, `--shadow`,
  16dp padding, with the header separated by a `--border` bottom rule
  (`index.css:1717-1738`).
- Header: eyebrow (type, uppercase orange) + title 22dp/700 + muted meta —
  this already exists structurally, just needs the eyebrow treatment and the
  card.
- Bottom toolbar: currently `Pressable` + text pairs of unequal weight next to
  a gradient Edit button. Rebuild as: `IconButton` (share/export),
  `IconButton` (delete, `tone="danger"`), spacer, `Button` (Edit, primary).
  Add safe-area bottom padding — it currently has none.
- `ExamHeaderView` should sit inside the document card, matching the web's
  `.exam-header` inside `.resource-doc`.

**12.3 Resource edit**
- Tabs already match `.classroom-tabs`. Add the `--orange` active color
  explicitly and a 44dp min height.
- The markdown editor `TextInput` should adopt the `TextField` focus ring.
- `AiAssistSection` / `SuggestionModal`: the modal overlay is
  `rgba(0,0,0,0.4)` — keep (the web's own `.highlight-overlay` uses the same
  scrim convention), but give the sheet `--surface`, `--radius` top corners,
  a drag handle, and safe-area bottom padding.

---

## 13. Generator UI

The Generator form is the closest screen to web parity already. Changes are
small:

- `ScreenHeader` with the existing intro copy as the subtitle (it is currently
  a floating muted paragraph).
- All chip rows → shared `Chip` at 44dp.
- The `-`/`+` stepper: replace the two ad hoc `Pressable`s with `IconButton`
  (already 44dp, just not a shared component). Keep the stepper itself — the
  web uses a number input, which is a poor mobile control; a stepper is a
  genuine Android improvement and should be kept and documented as one.
- Error banner → `ErrorBanner`.
- The Generate button should sit in a **sticky bottom action bar** rather than
  at the end of a long scroll. On a phone, the form is 9 fields tall; the
  primary action being below the fold on every screen size is a real usability
  cost. The web's own `.classroom-save-bar` (`position: sticky; bottom`) is
  the precedent for this pattern in this product, so it is consistent, not
  invented.
- Result screen: preview body inherits the improved `MarkdownText`; the
  preview/edit tabs get the same treatment as Resource Edit;
  `QuestionCard`/`QuestionListEditor` get the semantic-color and 44dp-target
  fixes (they currently use `#e5484d` in four places).

---

## 14. Notifications UI

Rebuild the row to `.notif-row` (`index.css:3851-3890`):

| Property | Web | Mobile today | Change |
|---|---|---|---|
| Container | flat, no border/shadow, `--radius-sm`, 0.55/0.5rem padding | `Card` (border + shadow + radius 14) | → flat row |
| Unread | `background: var(--orange-soft)` | `borderColor: orange` + `surface-2` bg | → orange-soft bg |
| Icon | 30px **circle**, `--surface-2` bg, `--orange` glyph | 32dp rounded square | → circle |
| Title | 0.86rem / 600 | 15dp / 600 | → 14dp/600 |
| Message | 0.8rem muted, 2-line clamp | 13dp muted, 3-line clamp | → 2-line clamp |
| Time | 0.72rem muted | 11dp muted | ✅ |
| Dot | 8px orange | 8dp orange | ✅ |
| Row gap | 0.15rem (rows nearly touch) | 8dp + card margin | → tighten |

Also:
- Row min-height 56dp so the whole row is one comfortable target.
- "Mark all read" → `.notif-mark-all`'s treatment (orange, 600, leading
  `CheckCheck` icon) inside the `ScreenHeader`'s trailing-action slot rather
  than a right-floated row above the list.
- Empty state → shared `EmptyState`. The web's `.notif-empty svg` is
  `--border` colored (a very light glyph); match it.
- Loading → skeleton rows (`.notif-loading`), not a spinner.
- **Now that Phase 7b ships deep linking**, a notification row with a `link`
  should navigate via `navigateToNotificationLink()` on tap, not only mark
  read. `NotificationsScreen.tsx`'s header comment scopes this to "Phase 7b";
  Phase 7b built `pushLinking.ts` but wired it only to push taps. This is the
  one *behavioural* change in this plan, and it closes a gap the code comments
  already anticipate.

---

## 15. More / Profile UI

- The five menu items are five separate elevated `Card`s. Replace with **one
  grouped container** holding flat rows separated by hairline dividers — the
  web's `.profile-dropdown` + `.profile-dropdown-item` pattern
  (`index.css:264-296`). Each row: leading lucide icon, label, trailing
  chevron, 56dp min height.
- Identity card: adopt the web's `.user-chip` / `.user-avatar` treatment —
  a 34px (mobile: 48dp) **circular avatar with the orange→amber gradient** and
  the user's initials in white 700 (`index.css:245-257`), name 600, role
  muted. Today it is three stacked text lines with no avatar, while the web
  shows an avatar on every single page.
- Show the **role** (`user.role`) as the web's `.user-role` line does; mobile
  currently shows email + school but not role.
- **Add the theme toggle here** as a proper row (Light / Dark / System),
  calling `setOverride` — closing finding 4. Three-way is right for mobile:
  the web is two-way only because it has no OS-follow concept in
  `usePreferences`, whereas RN's `useColorScheme()` gives us "System" for
  free and Android users expect it.
- Persisting the choice needs storage. `expo-secure-store` is already a
  dependency and `ThemeContext`'s own comment names it as the intended
  mechanism — use it rather than adding AsyncStorage.
- Sign out: keep as a distinct `Button` at the bottom, but `tone="danger"`
  text variant, matching `.profile-dropdown-danger`.

---

## 16. Loading / empty / error / success states

One component each, used everywhere. No screen may hand-roll these again.

**`Skeleton`** — ports `.sk-line` (`index.css:1370-1393`): a pulsing bar
between `--sk-mid` and `--sk-peak`. `RunStatus.tsx` already implements this
animation correctly; extract it. Compose into `SkeletonCard` (3 lines) and
`SkeletonRow` (icon + 2 lines) presets for list loading.

**`EmptyState`** — ports `.library-empty` (`index.css:1690-1711`):
- 60dp circular `--surface-2` well with a muted 24dp icon,
- title 16dp/600,
- hint 14dp muted, `lineHeight` 21, centered, max ~280dp wide,
- optional CTA button.

**`ErrorBanner`** — ports `.auth-error` (`index.css:2776-2790`): leading
`AlertCircle`, `semantic.danger.text` text, `semantic.danger.bg` background,
1px `semantic.danger.border`, `--radius-sm`, 13dp/500, `lineHeight` 18. Both
themes. Optional retry action.

**`Toast`** — ports `.toast` (`index.css:2915-2932`) with `success`/`error`
variants and the same 2.5s-ish auto-dismiss the web uses. Anchored above the
tab bar (`bottom = bottomNavHeight + insets.bottom + 12`), mirroring the web's
own `.toast-stack` mobile offset. This gives Coach's feedback rollback, the
Library delete, and the Generator save real confirmations instead of silence.

**Destructive confirms**: keep `Alert.alert`. It is the Android convention,
it is already used consistently, and replicating `ConfirmDialog.tsx` natively
would be *less* familiar to an Android user, not more. Document this as a
deliberate divergence.

**Full-screen loading**: keep `ActivityIndicator` in `--orange` (matches
`.spinner`'s `border-top-color: var(--orange)`), but only for genuinely
unknown-shape waits (auth restore). Anything with a known shape gets skeletons.

---

## 17. Dark / light theme

1. Every color reaches a component from `useTheme()`. After §4.5 there are no
   theme-blind literals left, which structurally eliminates findings 2 and 3.
2. `semantic` carries its own light/dark pairs, transcribed from the web's
   `[data-theme='dark']` blocks. Where the web has no dark override (warning
   pills, `.toast` variants are covered; `.status-pill.status-pending` is
   not), derive one and comment that it is derived.
3. Two web dark-mode *corrections* must be carried over, because they exist
   specifically to fix bugs mobile currently has:
   - `.auth-tabs button.active` → `--orange-soft` in dark (§9.1).
   - `.quick-action-card:hover` shadow is heavier in dark
     (`index.css:1073`) — the mobile pressed state should darken more in dark
     mode for the same reason.
4. `StatusBar` already flips with the theme (`App.tsx`). Also set the
   navigation bar background on Android to `--surface` so the system nav bar
   does not sit as a light strip under a dark tab bar.
5. Verification: every screen, in both themes, is a required checklist item
   (§24) — this is exactly what `§23` of the mobile plan already demands.

---

## 18. Android-specific adaptations

Adopt (genuinely better on Android, and none of them changes the visual
language):

1. **Ripple feedback** (`android_ripple`) on rows, chips, list items and
   non-gradient buttons. The web's entire interaction feedback model is
   `:hover`, which does not exist on touch; ripple is the platform's answer.
2. **Edge-to-edge + insets.** Apply `useSafeAreaInsets()` bottom padding to
   the tab bar and every bottom action bar. Currently only `CoachScreen` does.
3. **Back handling.** Native stack gives hardware-back for free; confirm the
   Coach composer does not swallow it and that a modal sheet closes on back.
4. **Keyboard.** `KeyboardAvoidingView` is already used on Auth/Coach/Generator
   form. Add to `ResourceEditScreen` (a long form with a big textarea) and use
   `keyboardShouldPersistTaps="handled"` consistently.
5. **Stepper over number input** for question count — already done, keep,
   document as a deliberate improvement.
6. **`Alert.alert` for destructive confirms** — already done, keep, document.
7. **Overscroll/scroll indicators**: hide horizontal indicators on chip rows
   (already done in Library; apply to Generator).
8. **Font scaling**: allow OS font scaling but cap it
   (`maxFontSizeMultiplier` ~1.4) on chrome elements (tab labels, badges,
   eyebrows) so a large-font user does not break the tab bar. Do **not** cap
   body/answer text — a teacher who needs larger text should get it.

Reject (mobile-for-mobile's-sake changes with no usability payoff):
- Material 3 components, Material color roles, or any Android-native design
  language. The product has one design language and it is the web's.
- A hamburger drawer. The 5-tab bar is correct and already decided.
- Renaming or reordering tabs.

---

## 19. Accessibility / touch targets

1. **44dp minimum** on every interactive element. Current offenders, all
   listed in finding 14: `SuggestionChips` (~26dp), `ChipPicker` (36dp),
   Library filter chips (unbounded), Library card delete (~24dp + hitSlop),
   `MessageBubble` feedback icons (16dp icon + hitSlop 8 → ~32dp).
2. **`accessibilityRole` / `accessibilityLabel` / `accessibilityState`** on
   every `Pressable`. Coverage today is good but uneven — `MoreMenuScreen`'s
   rows and `ClassHomeScreen`'s tiles have none.
3. **Contrast**: verify `--text-muted` on `--surface-2` in both themes (light
   `#5c6472` on `#f0f2f5` ≈ 5.4:1, passes; dark `#a1a8b6` on `#232833` ≈
   6.8:1, passes). The new semantic colors must be checked the same way —
   in particular `semantic.warning.text` on its tinted background.
4. **Live regions**: already used correctly for the Coach run status and the
   char counter. Add to `ErrorBanner` and `Toast`.
5. **Focus order / labels on icon-only controls**: `IconButton` should require
   an `accessibilityLabel` prop in its TypeScript signature, so it cannot be
   used unlabelled.
6. **Screen reader pass**: TalkBack on the Samsung device for one full flow
   (sign in → Coach question → save to Library → Notifications) as part of §24.

---

## 20. Reusable component strategy

Target inventory of `mobile/src/components/` after this work
(★ = new, ↻ = reworked, ✓ = unchanged):

| Component | Web origin |
|---|---|
| ✓ `Card` (+ `flat` mode ↻) | `--surface`/`--radius`/`--shadow` |
| ↻ `Button` (size, tone, icon, ripple) | `.btn-primary` / `.btn-text` |
| ★ `IconButton` | `.icon-btn` |
| ★ `ActionChip` | `.action-chip` |
| ↻ `Chip` (replaces `ChipPicker` + `SuggestionChips` + inline filter chips) | `.library-filter` |
| ↻ `TextField` (focus ring, semantic error) | `.auth-input` |
| ↻ `ThemedText` (full type scale) | the rem literals in §5 |
| ★ `ScreenHeader` | `.library-header` / `.library-title` / `.library-subtitle` |
| ★ `Badge` | `.notif-badge` |
| ★ `StatusPill` | `.status-pill` |
| ★ `EmptyState` | `.library-empty` |
| ★ `ErrorBanner` | `.auth-error` |
| ★ `Skeleton` / `SkeletonCard` / `SkeletonRow` | `.sk-line` / `.notif-loading` |
| ★ `Toast` + `ToastProvider` | `.toast` / `Toast.tsx` |
| ★ `ListRow` | `.notif-row` / `.profile-dropdown-item` / `.classroom-att-row` |
| ★ `BottomActionBar` | `.classroom-save-bar` / `.composer-dock` |
| ↻ `SummaryTile` (flat, semantic value color) | `.classroom-summary-tile` |
| ↻ `ToggleButton` (tinted, not filled) | `.classroom-att-btn` |
| ✓ `QuestionCard` / `QuestionListEditor` (token fixes only) | web equivalents |

Each new component carries a header comment naming the exact web selector and
line range it ports — the convention every existing file in this repo already
follows, and what makes the next phase's author able to check parity without
re-deriving it.

---

## 21. What should be copied exactly from web

- The full color palette and both theme variants (already done — keep).
- The complete semantic color scale, including every dark-mode override.
- `--radius` / `--radius-sm`, `--shadow`'s visual weight, `--orange-soft`.
- The orange→amber 135° primary gradient (already done — keep).
- `.btn-primary`, `.btn-text`, `.icon-btn`, `.action-chip`, `.library-filter`
  geometry and states.
- `.user-bubble` shape, color and radius asymmetry.
- `.response-body` typography, **including orange h2/h3**.
- `.composer-box` surface, radius, focus ring; the circular send button.
- `.notif-row` / `.notif-badge` / `.notif-empty` in full.
- `.library-card` structure including the right-edge delete rail and the
  uppercase orange type eyebrow.
- `.resource-doc` document card and its header rule.
- `.library-empty` empty-state anatomy.
- `.auth-error` error banner anatomy.
- `.toast` and its two variants.
- `.quick-action-card` anatomy **and its mobile single-column override**.
- `.classroom-summary-tile`, `.classroom-att-btn`, `.classroom-class-item`
  (as primitives now; consumed by Phase 8).
- `.bottom-nav` height, icon size, label size/weight, colors.
- Every lucide icon name (already 1:1 — keep).
- All user-facing copy that exists on both sides.

---

## 22. What should be changed only for mobile

Each of these is a deliberate divergence with a reason. Anything not on this
list follows the web.

| Change | Reason |
|---|---|
| 5-tab bottom nav with a "More" tab (web has 4) | No persistent top bar natively; already decided and documented in `MainTabs.tsx` |
| Nested stacks per tab instead of routes | Native navigation idiom; already decided |
| `Alert.alert` for destructive confirms instead of `ConfirmDialog` | Android convention; more familiar than a custom modal |
| Number stepper instead of a number input | Numeric keyboards are a poor fit for a 3-20 range |
| Chip rows instead of `<select>` | No native select; already decided |
| Ripple feedback instead of `:hover` | Touch has no hover |
| Sticky bottom action bar on long forms (Generator, Resource Edit) | The primary action must be thumb-reachable; precedent exists on web (`.classroom-save-bar`) |
| Three-way theme control (Light/Dark/System) vs the web's two-way | RN gives OS-follow for free and Android users expect it |
| Composer send beside the input, not on a second row | No attachment/voice/mode controls exist on mobile yet; revisit when they land |
| Bottom sheet instead of a centred modal for AI-assist suggestions | Reachability; already implemented this way |
| Safe-area insets everywhere | No web equivalent |
| `maxFontSizeMultiplier` cap on chrome only | Android OS font scaling has no web equivalent |
| Skeletons sized for a phone column, not the web's grid | Layout, not language |

---

## 23. What should NOT be changed

- **The palette values.** They are already correct; re-deriving them is pure
  risk.
- **Icon choices and `*_TYPE_META` maps.** Already 1:1 with web.
- **The primary button gradient.**
- **Navigation structure**: 5 tabs, their order, their names, the nested
  stacks, the More menu's contents.
- **`RunStatus`'s staged waiting copy and skeleton behaviour** — a faithful
  port that the plan explicitly asked for.
- **Any API call, request shape, feature flag, or business logic.** This is a
  visual pass. If a UI change appears to require a data change, it is out of
  scope and goes to the relevant feature phase.
- **The Phase 7b push implementation** in any form.
- **Phase 8+ screens' functionality.** Classroom stays a shell.
- **Test assertions that describe behaviour** (`testID`s, accessibility
  labels, visible copy the tests match on). Where a restyle must move a
  `testID`, move it deliberately and update the test in the same commit —
  never delete an assertion to make a restyle pass.
- **System-font-only typography.**

---

## 24. Testing / visual verification strategy (physical Samsung device)

Automated first, device second — the device pass is for what tests cannot see.

**24.1 Automated (must stay green at every step)**
- `npx jest` in `mobile/` — currently **254/254, 32 suites**. Restyling will
  touch snapshot-free tests that query by `testID`/role/text; any breakage is
  a signal, not noise.
- `tsc --noEmit` — the `ThemeColors` interface change will surface every
  incomplete palette object at compile time. That is the intended mechanism.
- `expo lint`.
- Consider adding an ESLint rule banning hex literals in
  `mobile/src/components/**` and `mobile/src/screens/**` (allowing `'#fff'`),
  so §4.5 is enforced mechanically rather than by review.

**24.2 Device pass — Samsung, via the existing workflow**
`mobile/DEVICE_TESTING.md` already documents the setup: platform-tools only
(no Android Studio), USB debugging, `adb reverse tcp:8081`, `npx expo start`.
Push work additionally produced an EAS dev-client APK. Either runtime is fine
for a UI pass — Expo Go is sufficient and faster to iterate with, since none
of this work touches native modules.

**Per-phase device checklist** (run at the end of each implementation phase in
§25, not once at the end):

1. **Both themes.** Toggle System → Light → Dark from the new More-menu
   control and walk every screen. Nothing hardcoded, nothing unreadable,
   nothing white-on-white. This is the check that catches findings 2/3/4.
2. **Every state per screen**: loading, empty, error, populated, success.
   Force errors by stopping the dev server mid-request; force empty by
   filtering to a type with no resources.
3. **Touch targets**: tap every chip, every icon button, every list row with a
   thumb, not a fingernail. Anything that needs a second attempt fails.
4. **Scrolling**: no content hidden behind the tab bar; no horizontal page
   scroll anywhere; long unbroken strings wrap.
5. **Keyboard**: open every form, confirm the focused field stays visible and
   the submit control is reachable.
6. **Rotation**: portrait is locked (`app.json` `"orientation": "portrait"`),
   so this reduces to confirming nothing assumes a fixed height.
7. **Font scale**: Settings → Display → Font size at max; confirm the tab bar,
   badges and headers survive, and body text grows.
8. **TalkBack**: one full flow (§19 item 6).
9. **Screenshots**: capture each screen in both themes into
   `docs/assets/mobile-ui/` (the `docs/assets/` directory already exists) so
   before/after is reviewable without a device.

**24.3 Screen-size coverage**
The Samsung device is one size. Cover the range with the emulator-free options
available: Expo's own dev tools plus a second physical device if one is
available. At minimum, reason about and visually check:
- a **small** phone (~360×640dp) — the Coach quick actions and Generator form
  are the ones at risk,
- the **Samsung target** (~412×915dp),
- a **large/tablet-ish** width — confirm content does not stretch to
  unreadable line lengths (the web caps the Coach column at
  `--chat-max-width: 720px`; consider the same `maxWidth` on wide screens).

---

## 25. Implementation phases / order

Six phases, each independently shippable, each ending green on tests + a
device pass. Ordered so the foundation lands before anything consumes it.

**Phase U1 — Token foundation** *(no visible change on most screens)*
- Add `semantic`, `orangeSoft`, skeleton stops, `layout` constants, and the
  typography scale to `tokens.ts`; extend `useTheme()`.
- Replace all 18 hardcoded-color sites with tokens.
- Fix the two light-only surfaces (finding 3).
- Exit: `tsc` clean, 254 tests green, dark mode has no light artefacts.

**Phase U2 — Primitives**
- Rework `Button`, `TextField`, `ThemedText`, `Card`, `SummaryTile`,
  `ToggleButton`; consolidate `Chip`.
- Add `IconButton`, `ActionChip`, `Badge`, `StatusPill`, `ScreenHeader`,
  `EmptyState`, `ErrorBanner`, `Skeleton`, `ListRow`, `BottomActionBar`,
  `Toast` + provider.
- Exit: every primitive rendered in both themes on-device; unit tests for the
  new ones matching the existing component-test style.

**Phase U3 — Navigation chrome**
- Tab bar sizing/shadow/badge; stack header rules; safe-area insets;
  Android nav-bar color; theme toggle in More + `expo-secure-store`
  persistence; the More menu restyle and avatar.
- Exit: chrome is identical across every tab in both themes.

**Phase U4 — Coach** *(highest value, highest risk — its own phase)*
- User bubble, assistant prose, markdown typography, composer, quick actions,
  error turn.
- Exit: a Coach answer on the phone and the same answer in a mobile browser
  are visually the same document.

**Phase U5 — Library, Generator, Notifications**
- Screen-by-screen per §12, §13, §14, all on U2's primitives.
- Includes the notification tap-to-deep-link wiring (§14).
- Exit: all three feature areas match their web counterparts.

**Phase U6 — Auth, Classroom shell, Placeholder, and the sweep**
- §9.1, §9.2, §11.
- Full-app consistency sweep: screen-to-screen padding, header treatment,
  empty/error/loading parity; the small/large screen pass (§24.3);
  TalkBack pass; screenshot capture.
- Exit: acceptance criteria in §26 all met.

Commit discipline: one phase per branch commit (or a small number of focused
commits), tests/lint/typecheck green before each, no mixing of token changes
with screen changes.

---

## 26. Acceptance criteria for "production / enterprise quality"

The UI refinement is done when **all** of the following are true and have been
verified on the physical device in both themes.

**Consistency**
1. No hex or rgba literal exists outside `mobile/src/theme/tokens.ts`, except
   `'#fff'` on filled brand surfaces and the print stylesheet.
2. Every screen uses the standard skeleton of §6 — same page padding, same
   card gap, same bottom clearance above the tab bar.
3. Every list row in the app is one of two shapes (elevated card, flat row),
   never a third.
4. Every interactive element is one of the §20 primitives; no screen defines
   its own button, chip, badge or banner.
5. Any two screens showing the same *kind* of thing (a resource card and a
   notification row; two empty states; two error banners) are visually
   siblings.

**Web parity**
6. Every item in §21 is implemented as specified, verifiable by reading the
   named `index.css` selector next to the component's header comment.
7. Every divergence from the web is on the §22 list, and is explained in a
   code comment at the point of divergence.
8. A Coach answer, a Library card, a notification row and the primary button
   are indistinguishable in visual language from their web counterparts on the
   same device.

**Theme**
9. Every screen, in every state, is correct in light and dark. No white card
   in dark mode, no unreadable muted text, no theme-blind color.
10. The theme control exists, offers Light/Dark/System, and persists across an
    app restart.

**Android quality**
11. Every interactive element is ≥44dp on its smallest axis.
12. Nothing is hidden behind the tab bar or the system navigation bar on any
    screen.
13. No screen scrolls horizontally.
14. Ripple or an equivalent press state exists on every tappable surface.
15. The app is usable at the OS's maximum font scale — chrome intact, body
    text enlarged.
16. Portrait layouts hold at ~360dp, ~412dp, and a tablet-ish width.

**States**
17. Every async screen has a purpose-built loading state (skeleton where the
    shape is known), a designed empty state with an icon well and a hint, and
    a themed error state with a retry path.
18. Every destructive action confirms; every mutating action gives visible
    success or failure feedback.

**Accessibility**
19. Every interactive element has a role and an accessible label;
    `IconButton` cannot compile without one.
20. One full TalkBack flow completes without a dead end.
21. Text/background contrast meets 4.5:1 for body text in both themes,
    including the new semantic colors.

**Engineering**
22. `npx jest` green (≥254 tests), `tsc --noEmit` clean, `expo lint` clean.
23. No behavioural regression: every feature working before this branch works
    after it, including Phase 7b push registration, deep linking and logout
    unregistration.
24. `docs/mobile-app-plan.md`'s status table records this work, and
    before/after screenshots for every screen in both themes are committed
    under `docs/assets/mobile-ui/`.

---

## Appendix — source references used

**Web**: `client/src/index.css` (tokens `1-53`; buttons `71-124`; topbar
`126-198`; bottom nav `200-231`; profile/avatar `233-296`; responsive
`611-833`; composer dock `944-978`; welcome/quick actions `980-1130`; messages
`1235-1300`; run status/skeleton `1367-1417`; response body `1436-1546`;
library `1580-1712`; resource doc `1714-1745`; composer box `1952-2040`;
composer send `2222-2238`; auth `2466-2830`; toast `2914-2933`; status pill
`3121-3150`; classroom `3158-3470`; notifications `3780-3907`).
`client/src/components/BottomNav.tsx`, `TopBar.tsx`, `Notifications.tsx`,
`Toast.tsx`; `client/src/config.ts`; `client/src/pages/LoginPage.tsx`,
`LibraryPage.tsx`, `ResourceView.tsx`, `GeneratorPage.tsx`.

**Mobile**: `mobile/App.tsx`; `mobile/src/theme/tokens.ts`,
`ThemeContext.tsx`; `mobile/src/components/*` (8 files);
`mobile/src/navigation/*` (MainTabs, AuthNavigator, useStackScreenOptions, 5
stacks); `mobile/src/screens/**` (21 files); `mobile/src/config.ts`;
`mobile/package.json`; `mobile/DEVICE_TESTING.md`.

**Plan**: `docs/mobile-app-plan.md` §10 (navigation), §11 (screens), §12
(classroom UX), §22 (design system), §23 (testing), §26 (roadmap).
