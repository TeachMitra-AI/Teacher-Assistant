# Teacher Assistant — Manual Testing Guide

> **Status: Current.** Covers the React (`client/`) + Node/Express (`server/`) application as
> implemented today, including My Library, the Lesson Plan Workspace, Workspace AI Assist,
> Print/Export, and the Quiz & Worksheet Generator. Every test case below was written against
> verified source behavior.
>
> **Mobile/responsive:** this guide keeps a concise mobile **regression** section (area P).
> Detailed mobile coverage — the bottom navigation, essentials-only top bar, adaptive Coach
> scrolling, safe-area handling, and the breakpoint/theme matrix — lives in
> **[`MOBILE-RESPONSIVE-TESTING-GUIDE.md`](./MOBILE-RESPONSIVE-TESTING-GUIDE.md)**.

## 1. Purpose

This guide lets a developer or QA engineer manually verify the current application **without
reading the source code**. It covers authentication, role-based access, the AI Coach, history,
response actions, My Library, resource ownership/isolation, the Lesson Plan Workspace, Workspace
AI Assist, Print/Export, the Admin Dashboard and Management, theming, responsiveness,
accessibility, error handling, persistence, and safe security checks.

Mark each case using the checklist in [Section 25](#25-test-execution-checklist):
⬜ Not Run · ✅ Pass · ❌ Fail · ⚠️ Blocked.

## 2. Prerequisites

- **Node.js 18+** (20 recommended) and npm.
- A valid **Google Gemini API key** (AI test cases need this; UI-only cases do not).
- Two modern browsers or one browser + a private/incognito window (for two-user isolation tests).
- Chrome or Edge recommended for voice input (Web Speech API).

> **Windows / PowerShell:** if `npm`/`npx` are blocked (`running scripts is disabled on this
> system`), either run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`
> once, or use the `.cmd` forms (`npm.cmd`, `npx.cmd`) shown below.

## 3. Test Environment Setup

Run from the repository root. Use placeholders — never paste real secrets into tracked files.

```bash
# 1. Install dependencies
cd server && npm install          # Windows: npm.cmd install
cd ../client && npm install       # Windows: npm.cmd install

# 2. Configure environment
cd ../server
cp .env.example .env              # Windows PowerShell: Copy-Item .env.example .env
#   Edit server/.env and set:
#     GEMINI_API_KEY=<your-gemini-api-key>
#     JWT_SECRET=<a-long-random-secret>
cd ../client
cp .env.example .env              # Windows PowerShell: Copy-Item .env.example .env
#   (VITE_API_BASE defaults to http://localhost:3000/api)

# 3. Database: apply migrations, generate client, seed demo data
cd ../server
npx prisma migrate dev            # Windows: npx.cmd prisma migrate dev
npx prisma generate               # Windows: npx.cmd prisma generate
npm run seed                      # demo schools + accounts (all PIN 123456)

# 4. Start the backend (terminal A)
npm run dev                       # or: npm start

# 5. Start the frontend (terminal B)
cd ../client
npm run dev                       # default http://localhost:5173

# 6. Verify backend health
curl http://localhost:3000/api/health   # -> {"status":"ok","timestamp":"..."}
```

Open the URL Vite prints (default **http://localhost:5173**).

**Optional — inspect the database (persistence tests):**
```bash
cd server
npx prisma studio                 # opens a local GUI at http://localhost:5555
```

## 4. Test Accounts / Roles

All seeded demo accounts use PIN **`123456`** and are **development-only**. Sign in with
**school code + name + PIN**.

| School code | Name | Role | Sees |
| --- | --- | --- | --- |
| `RAMPUR01` | Demo Teacher | Teacher | Only their own history & library; Coach, Library, Settings |
| `RAMPUR01` | Rampur Admin | School Admin | + Dashboard/Manage for their **own school** |
| `RAMPUR01` | Rampur RP | Resource Person | + Dashboard/Manage for their **whole district** |
| `RAMPUR01` | Super Admin | Super Admin | + Dashboard/Manage for **all schools**, create schools, change roles |
| `RAMPUR02` | Sunita Devi | Teacher | Own data only (second school — useful for isolation tests) |
| `DELHI01` | Ravi Kumar | Teacher | Own data only (third school) |

**Role visibility summary**
- **Teacher:** Coach, Library, Settings. No Dashboard/Manage links or access.
- **School Admin / Resource Person / Super Admin:** all of the above **plus** the Dashboard link
  and `/admin`, `/admin/manage`.
- **Super Admin only:** create schools, change user roles.

---

## Manual Test Case Format

Each case has a unique ID, preconditions, steps, and an expected result. Terms:
- **"Log in as X"** = go to `/login`, enter that account's school code + name + PIN, submit.
- **App URL** = `http://localhost:5173` (adjust if Vite prints a different port).

---

## 5. A — Authentication

### TC-AUTH-001 — Valid teacher login
**Preconditions:** Demo data seeded; app open at `/login`.
**Steps:**
1. On the **Login** tab, enter school code `RAMPUR01`, name `Demo Teacher`, PIN `123456`.
2. Click the login/submit button.
**Expected:** Authenticated; redirected to the Coach page (`/`). Primary nav shows **Coach**,
**Library**, and **Generator** with a profile chip; **no** Dashboard link. (On desktop these are
top-bar links; at ≤640px they appear in the fixed bottom navigation instead — see the
[Mobile & Responsive Testing Guide](./MOBILE-RESPONSIVE-TESTING-GUIDE.md).)

### TC-AUTH-002 — Invalid school code
**Preconditions:** At `/login`.
**Steps:** Enter school code `NOPE99`, name `Demo Teacher`, PIN `123456`; submit.
**Expected:** Login rejected with an "Invalid school code" style error; user stays on `/login`.

### TC-AUTH-003 — Unknown user name
**Steps:** School code `RAMPUR01`, name `Ghost User`, PIN `123456`; submit.
**Expected:** Rejected with an "Incorrect name or PIN" error (existence not confirmed); stays on `/login`.

### TC-AUTH-004 — Invalid PIN
**Steps:** School code `RAMPUR01`, name `Demo Teacher`, PIN `000000`; submit.
**Expected:** Rejected with "Incorrect name or PIN".

### TC-AUTH-005 — Account lockout after repeated failures
**Steps:** With `Demo Teacher`, submit a wrong PIN 5 times in a row.
**Expected:** After the 5th failure the account is locked; a "Too many attempts. Try again in N
minute(s)." message appears (HTTP 423). A correct PIN is also refused until the lockout expires.
> Note: default lockout is 15 minutes. Use a **different** account for later tests, or wait it out.

### TC-AUTH-006 — Teacher self-registration
**Preconditions:** At `/login`, **Register** tab.
**Steps:** Enter a valid school code `RAMPUR01`, a new unique name (e.g. `QA Tester 1`), PIN `246810`; submit.
**Expected:** Account created and logged in as a **teacher**; lands on Coach.

### TC-AUTH-007 — Register duplicate name at same school
**Steps:** On **Register**, use `RAMPUR01` + `Demo Teacher` + any 6-digit PIN; submit.
**Expected:** Rejected (409) with a "name is already registered" message.

### TC-AUTH-008 — Logout
**Preconditions:** Logged in.
**Steps:** Open the profile menu (top-right) → **Sign out**.
**Expected:** Session cleared; redirected to `/login`. Navigating to `/` redirects back to `/login`.

### TC-AUTH-009 — Session persistence across reload
**Preconditions:** Logged in.
**Steps:** Refresh the browser (F5).
**Expected:** Still logged in (session restored via `/api/auth/me`); the same page loads without
returning to `/login`.

### TC-AUTH-010 — Silent token refresh (long session)
**Preconditions:** Logged in. (Access token TTL is short, default 15m.)
**Steps:** Leave the app idle past the access-token TTL, then perform an action (e.g. open Library).
**Expected:** The action succeeds without a forced re-login — the client silently refreshes the
token once (`POST /api/auth/refresh`). *(Optional/observational; may require waiting.)*

### TC-AUTH-011 — Protected route requires auth
**Preconditions:** Logged out.
**Steps:** Manually visit `http://localhost:5173/library`.
**Expected:** Redirected to `/login` (client route guard); no protected content shown.

---

## 6. B — Role-Based Access Control

### TC-RBAC-001 — Teacher navigation
**Preconditions:** Logged in as `Demo Teacher`.
**Expected:** Primary nav shows **Coach**, **Library**, **Generator** only. No **Dashboard** link
(desktop: top bar; ≤640px: bottom navigation).

### TC-RBAC-002 — Teacher cannot reach admin routes
**Steps:** As `Demo Teacher`, visit `http://localhost:5173/admin` then `/admin/manage`.
**Expected:** Redirected to `/` (Coach); no dashboard/management UI shown.

### TC-RBAC-003 — School Admin navigation & scope
**Preconditions:** Logged in as `Rampur Admin`.
**Expected:** **Dashboard** link visible. `/admin` and `/admin/manage` load. Analytics/users are
scoped to **their own school** only.

### TC-RBAC-004 — Resource Person district scope
**Preconditions:** Logged in as `Rampur RP`.
**Expected:** Dashboard loads with data for **all schools in the same district** (RAMPUR01 +
RAMPUR02 share the "Rampur" district).

### TC-RBAC-005 — Super Admin full scope
**Preconditions:** Logged in as `Super Admin`.
**Expected:** Dashboard shows **all schools**; the Manage page shows the **Create school** form
and the ability to change user roles.

### TC-RBAC-006 — Non-super-admin cannot create schools / change roles
**Preconditions:** Logged in as `Rampur Admin`.
**Steps:** Open `/admin/manage`.
**Expected:** No "Create school" form (super-admin only) and no role-change control. The user list
is limited to their scope.

### TC-RBAC-007 — Server-side enforcement (defense in depth)
**Preconditions:** Logged in as `Demo Teacher`; browser dev tools open.
**Steps:** From the console, call the admin analytics endpoint with the teacher's token:
`fetch('/api/admin/analytics',{headers:{Authorization:'Bearer '+localStorage.getItem('auth_token')}}).then(r=>console.log(r.status))` (adjust base URL to `http://localhost:3000/api`).
**Expected:** HTTP **403** (role enforced server-side, not just hidden in the UI).

---

## 7. C — Coach / AI

> AI cases require a valid `GEMINI_API_KEY`.

### TC-COACH-001 — Ask a normal question
**Preconditions:** Logged in as a teacher; Coach page.
**Steps:** Type "How do I keep a large class engaged?"; submit.
**Expected:** A loading indicator appears, then a structured AI answer renders in the thread. A new
history entry appears in the sidebar.

### TC-COACH-002 — Grade / Subject context
**Steps:** Set **Grade** = `Class 3-5` and **Subject** = `Mathematics` in the context bar, then ask
"Explain borrowing in subtraction with zeros."
**Expected:** The answer references the chosen grade/subject; context is applied.

### TC-COACH-003 — More Context (classroom type / issue type)
**Steps:** Open **More context**, set Classroom type and Issue type, then submit a question.
**Expected:** The popover applies without layout overflow; the request succeeds and history records
the context.

### TC-COACH-004 — Language selection
**Steps:** Change the language selector to **हिंदी (hi)**; ask a question.
**Expected:** The AI answer is returned in Hindi.

### TC-COACH-005 — Hinglish
**Steps:** Set language to **Hinglish**; ask a question.
**Expected:** Answer is a natural Hindi+English mix in Roman script.

### TC-COACH-006 — Empty submission guard
**Steps:** Leave the composer empty; try to submit.
**Expected:** Blocked with a "Please enter a question" toast; no request sent.

### TC-COACH-007 — Retry after an error
**Preconditions:** Force a failure (see TC-ERR-002) or use a transient failure.
**Steps:** After an errored turn, click **Retry**.
**Expected:** The turn re-runs; on success the answer replaces the error state.

### TC-COACH-008 — Long prompt limit
**Steps:** Paste a very long question (>500 characters) and submit.
**Expected:** Rejected client- or server-side (max query length is 500 chars); a clear error is
shown, not a crash.

---

## 8. D — Quick Actions (Welcome screen)

### TC-QA-001 — Quick action seeds the composer
**Preconditions:** Logged in; a fresh Coach page (no turns) shows the welcome screen.
**Steps:** Click **Create a Lesson Plan**.
**Expected:** The composer is pre-filled with a starter prompt (e.g. "Create a lesson plan for ")
and focused; it is **not** auto-submitted.

### TC-QA-002 — Each quick action
**Steps:** Repeat for **Create Classroom Activity**, **Explain a Concept**, **Create Assessment**,
**Manage Classroom**.
**Expected:** Each seeds its corresponding starter prompt into the composer.

### TC-QA-003 — Admin shortcuts on welcome screen
**Preconditions:** Logged in as an admin; fresh Coach page.
**Expected:** Admin shortcut cards (**Dashboard**, **Manage**) are shown and navigate to `/admin`
and `/admin/manage`. Teachers do not see these.

---

## 9. E — Conversation History

### TC-HIST-001 — History entry is created
**Steps:** Ask a question; check the sidebar.
**Expected:** A new entry with the question text appears at the top of the history list.

### TC-HIST-002 — Open a past answer (no new API call)
**Steps:** Click a history entry.
**Expected:** The saved answer loads instantly into the thread without a new AI request.

### TC-HIST-003 — New chat
**Steps:** Click **New chat**.
**Expected:** The thread clears; the welcome screen returns; context resets.

### TC-HIST-004 — Delete a single history entry
**Steps:** Use the delete control on one history item; confirm if prompted.
**Expected:** That entry is removed (optimistically) and stays gone after reload.

### TC-HIST-005 — Clear all history
**Steps:** Use **Clear all**; confirm the dialog.
**Expected:** All history entries are removed; the empty state is shown.

### TC-HIST-006 — Empty state
**Preconditions:** A teacher with no history (e.g. a freshly registered account).
**Expected:** The sidebar shows an empty-history state rather than an error.

---

## 10. F — Response Actions

### TC-RESP-001 — Read aloud
**Steps:** On an answer, click **🔊 Read aloud**.
**Expected:** Text-to-speech begins; the control toggles to **Stop**; clicking again stops playback.
*(Requires a browser with SpeechSynthesis and audio output.)*

### TC-RESP-002 — Copy
**Steps:** Click **📋 Copy** on an answer.
**Expected:** A success toast; the answer text is on the clipboard (paste to verify).

### TC-RESP-003 — Share to WhatsApp
**Steps:** Click **💬 WhatsApp**.
**Expected:** A WhatsApp share URL opens (new tab / app) pre-filled with the answer text.

### TC-RESP-004 — Feedback helpful / not helpful
**Steps:** Click 👍 then (on another answer) 👎.
**Expected:** The choice is highlighted and a "Thanks for your feedback" toast appears; the rating
persists on that turn. (Feeds the admin analytics helpful ratio.)

---

## 11. G — AI Follow-Up Actions

> These resubmit a new, self-contained request based on the original question.

### TC-FUP-001 — Make it simpler
**Steps:** Under an answer, click **Make it simpler**.
**Expected:** A new turn is submitted and a simpler answer is returned.

### TC-FUP-002 — Create a worksheet
**Expected:** A new turn asks for a printable worksheet and returns one.

### TC-FUP-003 — 5-minute activity
**Expected:** A new turn returns a quick 5-minute classroom activity.

### TC-FUP-004 — Translate to Hindi
**Steps:** Click **Translate to Hindi**.
**Expected:** The language switches to Hindi and a Hindi answer is produced.

### TC-FUP-005 — Translate to English
**Expected:** Produces an English answer (language switches to English).

---

## 12. H — My Library

### TC-LIB-001 — Save an answer to Library
**Preconditions:** An AI answer is on screen.
**Steps:** Click **Save to Library**; review the auto-filled **Title** and suggested **Type**; click **Save**.
**Expected:** A "Saved to your library" toast; the button shows a **Saved** state.

### TC-LIB-002 — Auto-filled title & suggested type
**Steps:** Ask "Create a lesson plan for fractions" then open **Save to Library**.
**Expected:** Title is pre-filled from the question; Type defaults sensibly (e.g. **Lesson Plan**).

### TC-LIB-003 — Empty title guard
**Steps:** In the Save popover, clear the Title; click Save.
**Expected:** Blocked with a "Please enter a title" error.

### TC-LIB-004 — Library listing
**Steps:** Go to **Library** (top nav).
**Expected:** Saved resources appear as cards (type, title, snippet, grade/subject, date), newest first.

### TC-LIB-005 — Search
**Steps:** Type a keyword present in a saved title/content into the search box.
**Expected:** The list filters (debounced) to matching resources.

### TC-LIB-006 — Type filter
**Steps:** Click a type filter (e.g. **Lesson Plan**), then **All**.
**Expected:** The list narrows to that type, then shows everything again.

### TC-LIB-007 — Empty state (no resources)
**Preconditions:** A teacher with no saved resources.
**Expected:** An empty-library message with a "Go to Coach" action.

### TC-LIB-008 — No-results state (filtered)
**Steps:** Search for a string that matches nothing.
**Expected:** A "No matching resources" message (distinct from the empty-library state).

### TC-LIB-009 — Resource detail view
**Steps:** Click a resource card.
**Expected:** The detail page (`/library/:id`) renders the title, type, grade/subject, updated date,
rendered Markdown content, and **Edit** + **Delete** controls.

### TC-LIB-010 — Delete a resource
**Steps:** From the detail page or a card, click **Delete**; confirm.
**Expected:** A "Resource deleted" toast; the resource is removed and stays gone after reload.

---

## 13. I — Resource Ownership / Isolation

### TC-ISO-001 — Teacher B cannot see Teacher A's resources in the list
**Preconditions:** Two teachers in different browsers/windows: A = `RAMPUR01 / Demo Teacher`,
B = `RAMPUR02 / Sunita Devi`.
**Steps:** As A, save a resource. As B, open **Library**.
**Expected:** B's library does **not** include A's resource.

### TC-ISO-002 — Direct URL access is blocked
**Steps:** Note the ID of A's resource (URL `/library/<id>`). As B, visit `/library/<id>`.
**Expected:** B sees a "This resource no longer exists" style 404 state — existence is not leaked.

### TC-ISO-003 — Direct API access is blocked
**Steps:** As B (console), `GET http://localhost:3000/api/resources/<A's id>` with B's bearer token.
**Expected:** HTTP **404** (same response as a non-existent id).

### TC-ISO-004 — Cross-user edit blocked
**Steps:** As B (console), `PATCH /api/resources/<A's id>` with `{ "title": "hacked" }`.
**Expected:** HTTP **404**; A's resource is unchanged (verify as A or in Prisma Studio).

---

## 14. J — Resource Workspace (Edit)

### TC-WS-001 — Open the workspace
**Steps:** Open a saved resource → click **Edit**.
**Expected:** Route `/library/:id/edit` loads; a document-style editor with a sticky toolbar
(**Back**, workspace title, **Print / Export**, **Save Changes**). A lesson-plan resource shows
"Lesson Plan Workspace"; other types show "Resource Workspace".

### TC-WS-002 — Save button disabled when unchanged
**Expected:** On first load with no edits, **Save Changes** is disabled.

### TC-WS-003 — Edit the title
**Steps:** Change the title field.
**Expected:** Save Changes becomes enabled.

### TC-WS-004 — Edit type / grade / subject / language
**Steps:** Change the **Type** select, **Grade** (datalist input), **Subject** (datalist input),
and **Language** select.
**Expected:** Each edit marks the form dirty; values persist in the fields.

### TC-WS-005 — Edit content
**Steps:** Modify the Markdown content in the editor textarea.
**Expected:** Dirty state set; text updates.

### TC-WS-006 — Edit ⇄ Preview toggle
**Steps:** Click **Preview**, then **Edit**.
**Expected:** Preview renders the current Markdown as formatted HTML; Edit returns to the raw
textarea with edits intact.

### TC-WS-007 — Save changes
**Steps:** With edits made, click **Save Changes**.
**Expected:** A "Saving…" state (button disabled), then a "Changes saved" toast; Save Changes
becomes disabled again (form no longer dirty).

### TC-WS-008 — Persistence after reload
**Steps:** After saving, refresh the page.
**Expected:** The saved values (title/type/grade/subject/language/content) are shown.

### TC-WS-009 — "No changes to save"
**Steps:** Make an edit, revert it manually to the original value, click Save (if enabled) — or make
a whitespace-only title change and save.
**Expected:** An informational "No changes to save" toast (no needless PATCH); no error.

### TC-WS-010 — Unsaved-changes warning on Back/Cancel
**Steps:** Make an edit, then click **Back**.
**Expected:** A confirm dialog warns about unsaved changes; **Cancel** stays on the page, **OK**
navigates away discarding edits.

### TC-WS-011 — Unsaved-changes warning on refresh/close
**Steps:** Make an edit, then refresh or close the tab.
**Expected:** The browser's native "Leave site?" prompt appears (beforeunload guard active only
while dirty).

### TC-WS-012 — Empty title blocked on save
**Steps:** Clear the title; click Save Changes.
**Expected:** Blocked with a "Please enter a title" error; nothing saved.

### TC-WS-013 — Long title does not break layout
**Steps:** Enter a very long title.
**Expected:** No horizontal overflow; the toolbar and document remain usable.

---

## 15. K — Workspace AI Assist

> Requires a valid `GEMINI_API_KEY`. Suggestions are **never** auto-applied or auto-saved.

### TC-WSAI-001 — Make it simpler (generate + preview)
**Preconditions:** In the workspace for a resource with content.
**Steps:** In **AI Assist**, click **Make it simpler**.
**Expected:** A loading spinner on the action; then a **Suggested revision** dialog opens showing a
rendered preview and **Apply / Cancel**.

### TC-WSAI-002 — Cancel a suggestion
**Steps:** In the preview dialog, click **Cancel** (or the ✕).
**Expected:** The dialog closes; the editor content is **unchanged**.

### TC-WSAI-003 — Apply does not auto-persist
**Steps:** Generate a suggestion → **Apply to editor**.
**Expected:** The editor content is replaced with the suggestion; a "Suggestion applied — review and
Save" toast; the form is now **dirty** but **not saved**. Reloading **without** saving discards it.

### TC-WSAI-004 — Apply then Save then reload
**Steps:** Apply a suggestion → **Save Changes** → refresh.
**Expected:** The applied content persists after reload.

### TC-WSAI-005 — Add classroom activities
**Steps:** Click **Add classroom activities** → preview.
**Expected:** The suggestion keeps the original document and appends a "Classroom Activities" section.

### TC-WSAI-006 — Add assessment questions
**Expected:** The suggestion appends an "Assessment Questions" section (5–8 questions).

### TC-WSAI-007 — Adapt for another grade (requires target grade)
**Steps:** Click **Adapt for another grade**. Without choosing a grade, click Generate.
**Expected:** Blocked with a "Choose a target grade first" error. After selecting a grade and
clicking **Generate**, a suggestion adapted to that grade is produced.

### TC-WSAI-008 — Buttons disabled while one action runs
**Steps:** Start an action and watch the other AI buttons.
**Expected:** Other AI Assist actions are disabled until the running one completes.

---

## 16. L — Print / Export PDF

### TC-PRINT-001 — Open print preview
**Preconditions:** In the workspace for a resource with content.
**Steps:** Click **Print / Export**.
**Expected:** The browser print dialog opens showing a clean document.

### TC-PRINT-002 — App chrome is hidden
**Expected:** The print preview shows **no** top navigation, sidebar, toolbar, editor controls,
AI Assist buttons, or toasts.

### TC-PRINT-003 — Content & metadata present
**Expected:** The printed page includes subtle "Teacher Assistant" branding, the title, and the
metadata line (type, grade, subject, language) plus the updated date, followed by the content.

### TC-PRINT-004 — White background & dark text
**Expected:** The sheet has a white background with dark text.

### TC-PRINT-005 — Print from dark mode
**Steps:** Enable dark theme, then click **Print / Export**.
**Expected:** The print output is **still** white background / dark text (theme does not bleed into print).

### TC-PRINT-006 — Save as PDF
**Steps:** In the print dialog, choose "Save as PDF" and save.
**Expected:** A readable PDF is produced matching the preview.

### TC-PRINT-007 — Long content pagination
**Preconditions:** A long resource (multiple sections/pages).
**Expected:** Content flows across pages; headings are not orphaned at the bottom of a page where
avoidable (page-break rules applied).

### TC-PRINT-008 — Print does not affect normal styles
**Steps:** After closing the print dialog, interact with the app.
**Expected:** The on-screen UI is unchanged (print styles are print-only).

---

## 17. M — Admin Dashboard

### TC-DASH-001 — Dashboard loads (admin)
**Preconditions:** Logged in as an admin; some queries exist (ask a few as a teacher first).
**Steps:** Open **Dashboard** (`/admin`).
**Expected:** Summary totals (queries, teachers, active teachers, feedback, helpful ratio) and
charts render.

### TC-DASH-002 — Charts render
**Expected:** Queries-by-day (area), by-subject (bar), by-issue-type (bar), by-language (pie), and
a top-questions list are shown, populated from real data.

### TC-DASH-003 — Empty-data handling
**Preconditions:** A scope with no queries.
**Expected:** Charts show a "No data yet." placeholder instead of erroring.

### TC-DASH-004 — Scope correctness
**Steps:** Compare the dashboard as `Rampur Admin` (own school) vs `Super Admin` (all schools).
**Expected:** Super Admin totals are ≥ School Admin totals; scoping matches the role.

### TC-DASH-005 — Overview/Manage sub-tabs
**Expected:** The admin sub-nav offers **Overview** and **Manage**, navigating to `/admin` and
`/admin/manage`.

---

## 18. N — Admin Management

### TC-MANAGE-001 — User list (scoped)
**Preconditions:** Logged in as an admin; open `/admin/manage`.
**Expected:** A list of users within scope (name, role, school, last login) — no PIN hashes.

### TC-MANAGE-002 — Create a school (super admin)
**Preconditions:** Logged in as `Super Admin`.
**Steps:** Fill the Create-school form (name, unique code ≥ 3 chars, optional district/state); submit.
**Expected:** The school is created and appears in the schools list; a success toast.

### TC-MANAGE-003 — Duplicate school code rejected
**Steps:** Try to create a school with an existing code (e.g. `RAMPUR01`).
**Expected:** Rejected (409) with an "already exists" message.

### TC-MANAGE-004 — Change a user's role (super admin)
**Steps:** As `Super Admin`, change a teacher's role (e.g. to School Admin).
**Expected:** The role updates in the list; that user gains/loses admin access on their next
session accordingly.

### TC-MANAGE-005 — Revoke a user's sessions
**Steps:** As an admin, use the "revoke sessions" action on a user within scope.
**Expected:** Success; the target user is forced to log in again (within one access-token TTL).

### TC-MANAGE-006 — Non-super-admin restrictions
**Preconditions:** Logged in as `Rampur Admin`.
**Expected:** No Create-school form and no role-change control; only the scoped user list.

---

## 19. O — Theme

### TC-THEME-001 — Toggle dark/light
**Steps:** Click the sun/moon toggle in the top bar.
**Expected:** The UI switches between dark and light immediately; colors, surfaces, and text remain
readable.

### TC-THEME-002 — Theme persistence
**Steps:** Set dark mode, refresh the page.
**Expected:** Dark mode is retained (stored in `localStorage`).

### TC-THEME-003 — Theme across pages
**Steps:** With a theme set, navigate Coach → Library → Workspace → Settings.
**Expected:** The chosen theme applies consistently on every page.

---

## 20. P — Responsive / Mobile (regression summary)

> This is a **concise regression pass**. Full mobile/responsive coverage — the bottom navigation,
> essentials-only top bar, adaptive Coach scrolling, safe-area handling, per-page checks, and the
> breakpoint/theme matrix — lives in
> **[`MOBILE-RESPONSIVE-TESTING-GUIDE.md`](./MOBILE-RESPONSIVE-TESTING-GUIDE.md)** (38 cases,
> TC-MOB-###). Run that guide for a full mobile sign-off; run the five checks below as a quick
> regression gate. Test at ~375px unless noted.

### TC-RWD-001 — No horizontal scrolling / no header overlap
**Steps:** Sweep 320/375/430/768/1440 across Coach, Library, Resource detail, Workspace, Generator.
**Expected:** No horizontal page scroll and no top-bar overlap at any width; wide content scrolls
within its own container. *(Full sweep: TC-MOB-060.)*

### TC-RWD-002 — Mobile navigation (bottom nav + drawer)
**Steps:** At ≤640px use the bottom nav (Coach/Library/Generator) and open/close the history drawer.
**Expected:** Bottom nav routes correctly with a clear active state and respects the safe-area; the
sidebar drawer opens/closes and does not permanently cover content. *(Detail: TC-MOB-010…016, 004.)*

### TC-RWD-003 — Coach welcome scrolls naturally
**Steps:** On a fresh Coach page, scroll the welcome content.
**Expected:** One natural page scroll (greeting → all quick actions → context → composer); no nested
scrollbar; all five cards reachable; nothing hidden behind composer/nav. *(Detail: TC-MOB-020…025.)*

### TC-RWD-004 — Active chat + composer
**Steps:** Send a question; scroll the thread; use response/follow-up actions.
**Expected:** Messages scroll; the latest message is fully visible above the composer; the composer
stays docked above the bottom nav and never overlaps content. *(Detail: TC-MOB-030…035.)*

### TC-RWD-005 — Workspace / dialogs / print on mobile
**Steps:** Open the Workspace at ~375px; open the AI suggestion dialog; open Print / Export.
**Expected:** Single-column workspace with toolbar collapsed to icons; Save/Print reachable; the AI
dialog fits and scrolls; the bottom nav is hidden in print. *(Detail: TC-MOB-052, 015, 016.)*

---

## 21. Q — Accessibility / Keyboard

### TC-A11Y-001 — Tab navigation
**Steps:** From page load, press Tab repeatedly through the Coach page.
**Expected:** Focus moves through interactive controls in a logical order.

### TC-A11Y-002 — Visible focus rings
**Expected:** Focused controls show a visible `:focus-visible` outline (e.g. orange ring).

### TC-A11Y-003 — Icon-only button labels
**Steps:** Inspect icon-only controls (theme toggle, sidebar toggle, delete, AI preview close).
**Expected:** Each has an `aria-label` / `title` describing its action.

### TC-A11Y-004 — Dialog keyboard behavior
**Steps:** Open the AI suggestion preview; interact via keyboard.
**Expected:** The dialog is announced (`role="dialog"`/`aria-modal`), its buttons are keyboard
operable, and it can be dismissed.

### TC-A11Y-005 — Form labels
**Steps:** Inspect Login, Settings, and Workspace fields.
**Expected:** Inputs have associated labels; the Edit/Preview tabs expose `role="tab"`/`aria-selected`.

### TC-A11Y-006 — Keyboard activation of primary flows
**Steps:** Log in, submit a question, and save a workspace edit using only the keyboard (Enter/Space).
**Expected:** Each primary action is operable without a mouse.

---

## 22. R — Error Handling

### TC-ERR-001 — Backend unavailable
**Steps:** Stop the backend (`Ctrl+C` in terminal A). In the app, submit a question or open Library.
**Expected:** A graceful error/toast ("Network error" / "Could not load"), not a blank crash. Restart
the backend and confirm recovery.

### TC-ERR-002 — AI failure handling
**Steps:** Temporarily set an invalid `GEMINI_API_KEY` (or trigger upstream failure), restart the
backend, and ask a question.
**Expected:** The coach turn shows an error state with a **Retry** option; the app remains usable.
Restore the real key afterward.

### TC-ERR-003 — 404 resource (detail)
**Steps:** Visit `/library/does-not-exist`.
**Expected:** A "This resource no longer exists" state with a link back to Library (not a crash).

### TC-ERR-004 — 404 resource (workspace)
**Steps:** Visit `/library/does-not-exist/edit`.
**Expected:** A friendly not-found state with a **Back to Library** action.

### TC-ERR-005 — Unauthorized resource
**Covered by TC-ISO-002/003** — another user's resource returns a 404 state, not an error leak.

### TC-ERR-006 — Save failure rollback
**Steps:** In the workspace, make an edit; stop the backend; click **Save Changes**.
**Expected:** An error toast ("Could not save changes"); the editor keeps the unsaved edits so no
work is lost. Restart backend and save successfully.

### TC-ERR-007 — Delete failure rollback (Library)
**Steps:** Stop the backend; delete a resource from the Library list.
**Expected:** The optimistic removal rolls back (the card reappears) and an error toast is shown.

---

## 23. S — Database Persistence & Security Checks

### TC-DB-001 — Conversations persist
**Steps:** Ask a question, then reload / re-login.
**Expected:** The history entry is still present (stored server-side).

### TC-DB-002 — Library resources persist
**Steps:** Save a resource; reload / re-login.
**Expected:** The resource remains in the Library.

### TC-DB-003 — Resource edits persist
**Steps:** Edit and save a resource in the workspace; reload.
**Expected:** The edited values persist. *(Optional: verify the `Resource` row in Prisma Studio.)*

### TC-DB-004 — Deletes persist
**Steps:** Delete a resource; reload.
**Expected:** It stays deleted. *(Optional: confirm the row is gone in Prisma Studio.)*

### TC-DB-005 — Prisma Studio verification (optional)
**Steps:** `npx prisma studio` → open `Resource` / `Query` tables.
**Expected:** Rows match the UI state; `Resource.userId` matches the owning user; no PIN in plaintext
anywhere (`User.pinHash` is a bcrypt hash).

### TC-SEC-001 — Unauthenticated protected endpoint
**Steps:** With no token, `GET http://localhost:3000/api/resources` and `GET /api/queries`.
**Expected:** HTTP **401** for both.

### TC-SEC-002 — Cross-user resource access
**Covered by TC-ISO-003 / TC-ISO-004** — 404 for another user's resource on GET/PATCH/DELETE.

### TC-SEC-003 — Admin route restriction
**Covered by TC-RBAC-007** — teacher token on `/api/admin/*` returns 403.

### TC-SEC-004 — No API key in the frontend
**Steps:** Open dev tools → Network. Ask a question. Inspect the request to `/api/coach` and the JS
bundle.
**Expected:** The request goes to the **backend** (`/api/coach`), not to Google directly; the Gemini
API key is **never** present in any request payload, response, or the client bundle.

### TC-SEC-005 — Sensitive fields not returned
**Steps:** Inspect responses from `/api/resources/:id` and `/api/admin/users`.
**Expected:** Resource DTOs omit `userId`/`schoolId`; user lists omit `pinHash`. No secrets leak.

### TC-SEC-006 — AI suggestion is not persisted server-side
**Steps:** In the workspace, generate an AI suggestion but do **not** apply/save. Reload.
**Expected:** The stored resource content is unchanged (the AI-action endpoint never writes to the DB).

---

## 24. U — Quiz & Worksheet Generator

> The Generator creates classroom-ready quizzes/worksheets via AI, previews them for editing, and
> saves them to My Library as **Assessment** resources (reusing the Resource model — no separate
> store). AI cases require a valid `GEMINI_API_KEY`.

### TC-GEN-001 — Navigate to the Generator
**Preconditions:** Logged in as any user.
**Steps:** Click **Generator** in the top navigation (or visit `/generator`).
**Expected:** The "Quiz & Worksheet Generator" page loads with a config form (Format, Topic, Grade,
Subject, Difficulty, Question type, Number of questions, Language, Additional instructions).

### TC-GEN-002 — Generate a quiz (MCQ)
**Steps:** Format **Quiz**, Topic `Fractions`, Grade `Class 3-5`, Subject `Mathematics`,
Difficulty **Medium**, Question type **Multiple Choice**, Count `5`, Language English → **Generate**.
**Expected:** A loading state appears; then a Preview shows a titled quiz with 5 numbered MCQs
(options A–D) and a separate **Answer Key** section at the end.

### TC-GEN-003 — Generate a worksheet
**Steps:** Format **Worksheet**, Topic `Water cycle`, Count `6` → **Generate**.
**Expected:** The preview includes a title, metadata, **Student Name / Date** lines, an Instructions
section, questions, and a **Teacher Answer Key** section at the end.

### TC-GEN-004 — Difficulty options
**Steps:** Generate the same topic at **Easy**, **Medium**, and **Hard**.
**Expected:** Each generates successfully; difficulty is reflected in the questions.

### TC-GEN-005 — Question type: True / False
**Steps:** Question type **True / False** → Generate.
**Expected:** Questions are statements formatted for True/False; the answer key marks each.

### TC-GEN-006 — Question type: Short Answer
**Steps:** Question type **Short Answer** → Generate.
**Expected:** Short-answer questions with space to write; answer key present.

### TC-GEN-007 — Question type: Mixed
**Steps:** Question type **Mixed** → Generate.
**Expected:** A sensible blend of MCQ / True-False / short-answer questions.

### TC-GEN-008 — Question count validation
**Steps:** Try to set the count to `2` and to `31`.
**Expected:** The input clamps to the allowed range **3–30** (min 3, max 30). Generation uses a value
in range.

### TC-GEN-009 — Language
**Steps:** Set Language to **हिंदी** → Generate.
**Expected:** The generated quiz/worksheet is in Hindi.

### TC-GEN-010 — Additional instructions
**Steps:** Add "Focus on real-life examples" → Generate.
**Expected:** The output reflects the instruction (real-life framing) without breaking structure.

### TC-GEN-011 — Missing topic validation
**Steps:** Leave Topic empty → click Generate.
**Expected:** Blocked with a "Please enter a topic" error; no request is sent (the Generate button is
also disabled while Topic is empty).

### TC-GEN-012 — Loading state / no duplicate requests
**Steps:** Click Generate and immediately try clicking again.
**Expected:** The button shows "Generating…" and is disabled; only one request runs.

### TC-GEN-013 — Generation error handling
**Steps:** Temporarily set an invalid `GEMINI_API_KEY`, restart the backend, and Generate.
**Expected:** A clear error message appears (no crash); the form remains usable. Restore the key.

### TC-GEN-014 — Preview and edit before saving
**Steps:** After generating, use the **Edit ⇄ Preview** toggle; edit the **Title** and the **content**.
**Expected:** Edits are reflected in the preview; nothing is saved yet.

### TC-GEN-015 — Regenerate warning after editing
**Steps:** Edit the generated content, then click **Regenerate**.
**Expected:** A confirm warns that regenerating replaces the edited preview; Cancel keeps edits, OK
regenerates.

### TC-GEN-016 — Save to Library
**Steps:** Click **Save to Library**.
**Expected:** A "Saved to your library" toast; you are taken into the **Workspace**
(`/library/:id/edit`) for the new resource.

### TC-GEN-017 — Appears under the Assessment filter
**Steps:** Go to **Library** → filter by **Assessment**.
**Expected:** The saved quiz/worksheet appears (type = Assessment). Search by its title also finds it.

### TC-GEN-018 — Reopen and edit in the Workspace
**Steps:** Open the saved assessment → **Edit**; change something → **Save Changes** → reload.
**Expected:** Edits persist (standard Workspace behavior).

### TC-GEN-019 — Student print version (no answer key)
**Preconditions:** In the Workspace for a saved quiz/worksheet that has an answer key.
**Steps:** Click **Print / Export** → choose **Student version**.
**Expected:** The print preview shows the questions and a "Student Version" label but **no answer
key** anywhere.

### TC-GEN-020 — Teacher print version (with answer key)
**Steps:** **Print / Export** → **Teacher version**.
**Expected:** The print preview shows the questions **and** the answer key, labelled "Teacher
Version — includes answer key".

### TC-GEN-021 — Answer-key isolation is structural
**Steps:** With the **Student version** print preview open, inspect the page / use the browser's
"view source of print" or select-all.
**Expected:** The answer-key text is **not present in the document at all** for the student version
(it is omitted from the DOM, not merely hidden with CSS).

### TC-GEN-022 — AI follow-up: Make easier
**Preconditions:** Workspace for a saved assessment.
**Steps:** In **AI Assist**, click **Make easier** → preview → **Apply** → **Save Changes**.
**Expected:** A suggestion is generated; Apply stages it (dirty, not saved); Save persists it. The
answer key remains present and correct.

### TC-GEN-023 — AI follow-up: Make harder
**Steps:** Click **Make harder** → preview → Apply/Cancel.
**Expected:** A harder version is suggested; preview→apply flow works; nothing auto-saves.

### TC-GEN-024 — AI follow-up: Generate more questions
**Steps:** Click **Generate more questions** → preview.
**Expected:** The suggestion keeps existing questions and adds more, with the answer key extended.

### TC-GEN-025 — AI follow-up: Simplify wording
**Steps:** Click **Simplify wording** → preview.
**Expected:** Question wording is simplified without changing the number of questions or answers.

### TC-GEN-026 — Assessment actions only show for assessments
**Steps:** Open a **non-assessment** resource (e.g. a lesson plan) in the Workspace.
**Expected:** The four assessment-only actions (Make easier/harder, Generate more questions, Simplify
wording) are **not** shown; the generic actions still appear.

### TC-GEN-027 — Mobile layout
**Steps:** At ~375px, use the Generator form, generate, preview, and save.
**Expected:** Single-column form; no horizontal overflow; all controls usable.

### TC-GEN-028 — Dark / light theme
**Steps:** Toggle theme on the Generator page and the assessment Workspace.
**Expected:** Both render correctly in both themes; print output stays white/dark regardless.

### TC-GEN-029 — Keyboard accessibility
**Steps:** Complete a full generate → save flow using only the keyboard; open the Print version menu.
**Expected:** All controls are reachable/operable via keyboard with visible focus; the print menu is
keyboard-navigable.

### TC-GEN-030 — Authentication & ownership
**Steps:** (a) Logged out, `POST http://localhost:3000/api/resources/generate` → expect **401**.
(b) As Teacher B, open Teacher A's saved assessment via `/library/<A's id>/edit` → expect a 404 state.
**Expected:** Generation requires auth; saved assessments remain owner-isolated like all resources.

---

## 25. Test Execution Checklist

Legend: ⬜ Not Run · ✅ Pass · ❌ Fail · ⚠️ Blocked

| Test ID | Area | Test Case | Status | Notes |
|---------|------|-----------|--------|-------|
| TC-AUTH-001 | Authentication | Valid teacher login | ⬜ | |
| TC-AUTH-002 | Authentication | Invalid school code | ⬜ | |
| TC-AUTH-003 | Authentication | Unknown user name | ⬜ | |
| TC-AUTH-004 | Authentication | Invalid PIN | ⬜ | |
| TC-AUTH-005 | Authentication | Account lockout after failures | ⬜ | |
| TC-AUTH-006 | Authentication | Teacher self-registration | ⬜ | |
| TC-AUTH-007 | Authentication | Register duplicate name | ⬜ | |
| TC-AUTH-008 | Authentication | Logout | ⬜ | |
| TC-AUTH-009 | Authentication | Session persistence on reload | ⬜ | |
| TC-AUTH-010 | Authentication | Silent token refresh | ⬜ | |
| TC-AUTH-011 | Authentication | Protected route requires auth | ⬜ | |
| TC-RBAC-001 | RBAC | Teacher navigation | ⬜ | |
| TC-RBAC-002 | RBAC | Teacher blocked from admin routes | ⬜ | |
| TC-RBAC-003 | RBAC | School Admin scope | ⬜ | |
| TC-RBAC-004 | RBAC | Resource Person district scope | ⬜ | |
| TC-RBAC-005 | RBAC | Super Admin full scope | ⬜ | |
| TC-RBAC-006 | RBAC | Non-super-admin restrictions | ⬜ | |
| TC-RBAC-007 | RBAC | Server-side role enforcement (403) | ⬜ | |
| TC-COACH-001 | Coach/AI | Ask a normal question | ⬜ | |
| TC-COACH-002 | Coach/AI | Grade/Subject context | ⬜ | |
| TC-COACH-003 | Coach/AI | More Context popover | ⬜ | |
| TC-COACH-004 | Coach/AI | Language selection (Hindi) | ⬜ | |
| TC-COACH-005 | Coach/AI | Hinglish | ⬜ | |
| TC-COACH-006 | Coach/AI | Empty submission guard | ⬜ | |
| TC-COACH-007 | Coach/AI | Retry after error | ⬜ | |
| TC-COACH-008 | Coach/AI | Long prompt limit | ⬜ | |
| TC-QA-001 | Quick Actions | Quick action seeds composer | ⬜ | |
| TC-QA-002 | Quick Actions | Each quick action | ⬜ | |
| TC-QA-003 | Quick Actions | Admin shortcuts | ⬜ | |
| TC-HIST-001 | History | History entry created | ⬜ | |
| TC-HIST-002 | History | Open past answer (no API call) | ⬜ | |
| TC-HIST-003 | History | New chat | ⬜ | |
| TC-HIST-004 | History | Delete single entry | ⬜ | |
| TC-HIST-005 | History | Clear all | ⬜ | |
| TC-HIST-006 | History | Empty state | ⬜ | |
| TC-RESP-001 | Response Actions | Read aloud | ⬜ | |
| TC-RESP-002 | Response Actions | Copy | ⬜ | |
| TC-RESP-003 | Response Actions | Share to WhatsApp | ⬜ | |
| TC-RESP-004 | Response Actions | Feedback helpful/not helpful | ⬜ | |
| TC-FUP-001 | Follow-Up | Make it simpler | ⬜ | |
| TC-FUP-002 | Follow-Up | Create a worksheet | ⬜ | |
| TC-FUP-003 | Follow-Up | 5-minute activity | ⬜ | |
| TC-FUP-004 | Follow-Up | Translate to Hindi | ⬜ | |
| TC-FUP-005 | Follow-Up | Translate to English | ⬜ | |
| TC-LIB-001 | My Library | Save to Library | ⬜ | |
| TC-LIB-002 | My Library | Auto-filled title & type | ⬜ | |
| TC-LIB-003 | My Library | Empty title guard | ⬜ | |
| TC-LIB-004 | My Library | Library listing | ⬜ | |
| TC-LIB-005 | My Library | Search | ⬜ | |
| TC-LIB-006 | My Library | Type filter | ⬜ | |
| TC-LIB-007 | My Library | Empty state | ⬜ | |
| TC-LIB-008 | My Library | No-results state | ⬜ | |
| TC-LIB-009 | My Library | Resource detail view | ⬜ | |
| TC-LIB-010 | My Library | Delete a resource | ⬜ | |
| TC-ISO-001 | Isolation | B can't see A's resources | ⬜ | |
| TC-ISO-002 | Isolation | Direct URL blocked (404) | ⬜ | |
| TC-ISO-003 | Isolation | Direct API GET blocked (404) | ⬜ | |
| TC-ISO-004 | Isolation | Cross-user PATCH blocked (404) | ⬜ | |
| TC-WS-001 | Workspace | Open the workspace | ⬜ | |
| TC-WS-002 | Workspace | Save disabled when unchanged | ⬜ | |
| TC-WS-003 | Workspace | Edit title | ⬜ | |
| TC-WS-004 | Workspace | Edit type/grade/subject/language | ⬜ | |
| TC-WS-005 | Workspace | Edit content | ⬜ | |
| TC-WS-006 | Workspace | Edit ⇄ Preview toggle | ⬜ | |
| TC-WS-007 | Workspace | Save changes | ⬜ | |
| TC-WS-008 | Workspace | Persistence after reload | ⬜ | |
| TC-WS-009 | Workspace | "No changes to save" | ⬜ | |
| TC-WS-010 | Workspace | Unsaved warning on Back/Cancel | ⬜ | |
| TC-WS-011 | Workspace | Unsaved warning on refresh/close | ⬜ | |
| TC-WS-012 | Workspace | Empty title blocked on save | ⬜ | |
| TC-WS-013 | Workspace | Long title layout | ⬜ | |
| TC-WSAI-001 | Workspace AI | Make it simpler (preview) | ⬜ | |
| TC-WSAI-002 | Workspace AI | Cancel a suggestion | ⬜ | |
| TC-WSAI-003 | Workspace AI | Apply does not auto-persist | ⬜ | |
| TC-WSAI-004 | Workspace AI | Apply → Save → reload | ⬜ | |
| TC-WSAI-005 | Workspace AI | Add classroom activities | ⬜ | |
| TC-WSAI-006 | Workspace AI | Add assessment questions | ⬜ | |
| TC-WSAI-007 | Workspace AI | Adapt for another grade | ⬜ | |
| TC-WSAI-008 | Workspace AI | Buttons disabled while running | ⬜ | |
| TC-PRINT-001 | Print/Export | Open print preview | ⬜ | |
| TC-PRINT-002 | Print/Export | App chrome hidden | ⬜ | |
| TC-PRINT-003 | Print/Export | Content & metadata present | ⬜ | |
| TC-PRINT-004 | Print/Export | White background/dark text | ⬜ | |
| TC-PRINT-005 | Print/Export | Print from dark mode | ⬜ | |
| TC-PRINT-006 | Print/Export | Save as PDF | ⬜ | |
| TC-PRINT-007 | Print/Export | Long content pagination | ⬜ | |
| TC-PRINT-008 | Print/Export | Print doesn't affect normal styles | ⬜ | |
| TC-DASH-001 | Admin Dashboard | Dashboard loads | ⬜ | |
| TC-DASH-002 | Admin Dashboard | Charts render | ⬜ | |
| TC-DASH-003 | Admin Dashboard | Empty-data handling | ⬜ | |
| TC-DASH-004 | Admin Dashboard | Scope correctness | ⬜ | |
| TC-DASH-005 | Admin Dashboard | Overview/Manage sub-tabs | ⬜ | |
| TC-MANAGE-001 | Admin Manage | User list (scoped) | ⬜ | |
| TC-MANAGE-002 | Admin Manage | Create a school | ⬜ | |
| TC-MANAGE-003 | Admin Manage | Duplicate school code rejected | ⬜ | |
| TC-MANAGE-004 | Admin Manage | Change a user's role | ⬜ | |
| TC-MANAGE-005 | Admin Manage | Revoke a user's sessions | ⬜ | |
| TC-MANAGE-006 | Admin Manage | Non-super-admin restrictions | ⬜ | |
| TC-THEME-001 | Theme | Toggle dark/light | ⬜ | |
| TC-THEME-002 | Theme | Theme persistence | ⬜ | |
| TC-THEME-003 | Theme | Theme across pages | ⬜ | |
| TC-RWD-001 | Responsive | No horizontal scroll / no header overlap | ⬜ | |
| TC-RWD-002 | Responsive | Mobile navigation (bottom nav + drawer) | ⬜ | |
| TC-RWD-003 | Responsive | Coach welcome scrolls naturally | ⬜ | |
| TC-RWD-004 | Responsive | Active chat + composer | ⬜ | |
| TC-RWD-005 | Responsive | Workspace / dialogs / print on mobile | ⬜ | |
| _see_ | Responsive | Full mobile coverage → MOBILE-RESPONSIVE-TESTING-GUIDE.md (TC-MOB-###) | ⬜ | 38 cases |
| TC-A11Y-001 | Accessibility | Tab navigation | ⬜ | |
| TC-A11Y-002 | Accessibility | Visible focus rings | ⬜ | |
| TC-A11Y-003 | Accessibility | Icon-only button labels | ⬜ | |
| TC-A11Y-004 | Accessibility | Dialog keyboard behavior | ⬜ | |
| TC-A11Y-005 | Accessibility | Form labels | ⬜ | |
| TC-A11Y-006 | Accessibility | Keyboard activation of flows | ⬜ | |
| TC-ERR-001 | Error Handling | Backend unavailable | ⬜ | |
| TC-ERR-002 | Error Handling | AI failure handling | ⬜ | |
| TC-ERR-003 | Error Handling | 404 resource (detail) | ⬜ | |
| TC-ERR-004 | Error Handling | 404 resource (workspace) | ⬜ | |
| TC-ERR-005 | Error Handling | Unauthorized resource | ⬜ | |
| TC-ERR-006 | Error Handling | Save failure rollback | ⬜ | |
| TC-ERR-007 | Error Handling | Delete failure rollback | ⬜ | |
| TC-DB-001 | Persistence | Conversations persist | ⬜ | |
| TC-DB-002 | Persistence | Library resources persist | ⬜ | |
| TC-DB-003 | Persistence | Resource edits persist | ⬜ | |
| TC-DB-004 | Persistence | Deletes persist | ⬜ | |
| TC-DB-005 | Persistence | Prisma Studio verification | ⬜ | |
| TC-SEC-001 | Security | Unauthenticated endpoint (401) | ⬜ | |
| TC-SEC-002 | Security | Cross-user resource access | ⬜ | |
| TC-SEC-003 | Security | Admin route restriction (403) | ⬜ | |
| TC-SEC-004 | Security | No API key in frontend | ⬜ | |
| TC-SEC-005 | Security | Sensitive fields not returned | ⬜ | |
| TC-SEC-006 | Security | AI suggestion not persisted | ⬜ | |
| TC-GEN-001 | Generator | Navigate to the Generator | ⬜ | |
| TC-GEN-002 | Generator | Generate a quiz (MCQ) | ⬜ | |
| TC-GEN-003 | Generator | Generate a worksheet | ⬜ | |
| TC-GEN-004 | Generator | Difficulty options | ⬜ | |
| TC-GEN-005 | Generator | Question type: True/False | ⬜ | |
| TC-GEN-006 | Generator | Question type: Short Answer | ⬜ | |
| TC-GEN-007 | Generator | Question type: Mixed | ⬜ | |
| TC-GEN-008 | Generator | Question count validation (3–30) | ⬜ | |
| TC-GEN-009 | Generator | Language | ⬜ | |
| TC-GEN-010 | Generator | Additional instructions | ⬜ | |
| TC-GEN-011 | Generator | Missing topic validation | ⬜ | |
| TC-GEN-012 | Generator | Loading state / no duplicates | ⬜ | |
| TC-GEN-013 | Generator | Generation error handling | ⬜ | |
| TC-GEN-014 | Generator | Preview and edit before saving | ⬜ | |
| TC-GEN-015 | Generator | Regenerate warning after editing | ⬜ | |
| TC-GEN-016 | Generator | Save to Library | ⬜ | |
| TC-GEN-017 | Generator | Appears under Assessment filter | ⬜ | |
| TC-GEN-018 | Generator | Reopen and edit in Workspace | ⬜ | |
| TC-GEN-019 | Generator | Student print version (no key) | ⬜ | |
| TC-GEN-020 | Generator | Teacher print version (with key) | ⬜ | |
| TC-GEN-021 | Generator | Answer-key isolation is structural | ⬜ | |
| TC-GEN-022 | Generator | AI: Make easier | ⬜ | |
| TC-GEN-023 | Generator | AI: Make harder | ⬜ | |
| TC-GEN-024 | Generator | AI: Generate more questions | ⬜ | |
| TC-GEN-025 | Generator | AI: Simplify wording | ⬜ | |
| TC-GEN-026 | Generator | Assessment actions only for assessments | ⬜ | |
| TC-GEN-027 | Generator | Mobile layout | ⬜ | |
| TC-GEN-028 | Generator | Dark / light theme | ⬜ | |
| TC-GEN-029 | Generator | Keyboard accessibility | ⬜ | |
| TC-GEN-030 | Generator | Authentication & ownership | ⬜ | |

**Total: 149 test cases across 21 areas** (main guide). Detailed mobile/responsive coverage is in
**[`MOBILE-RESPONSIVE-TESTING-GUIDE.md`](./MOBILE-RESPONSIVE-TESTING-GUIDE.md)** — a further **38**
cases (TC-MOB-###).
