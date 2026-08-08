# Teacher Assistant 👨‍🏫

> **शिक्षक सहायक** — An AI-powered just-in-time coaching assistant and teaching-resource
> workspace for Indian government school teachers.

Teachers ask classroom questions in plain language (typed or spoken) and get immediate,
grade- and subject-specific coaching from Google Gemini. They can save useful answers to a
personal **Library**, edit them in a document-style **Lesson Plan Workspace**, generate
AI-assisted revisions, and print/export a classroom-ready PDF. Admins get role-scoped usage
analytics and school/user management.

---

## Overview

Teachers in rural India often wait weeks for a resource person to visit, and the feedback is
generic. This app closes that gap with on-demand, context-aware coaching and a lightweight
place to keep and refine teaching materials.

The system has **two deployable parts**:

- **`client/`** — a Vite + React + TypeScript PWA that teachers and admins use in the browser.
- **`server/`** — a Node.js + Express + Prisma backend that keeps the Gemini API key
  server-side, enforces authentication and role-based access, stores data, and builds all AI
  prompts.

---

## Key Features

All features below are verified against the current source code.

### AI Teacher Coach
- **AI coaching** via Google Gemini `2.5-flash`, called **only from the server** — the API key
  is never shipped to the browser.
- **Context-aware responses** — optional **Grade**, **Subject**, **Classroom type**, and
  **Issue type** are sent with each question and used to select a server-side prompt template.
- **Multilingual answers** — 9 Indian languages plus Hinglish (English, Hindi, Bengali, Telugu,
  Marathi, Tamil, Gujarati, Kannada, Odia).
- **Preferred response style** — balanced / concise / detailed / step-by-step / practical
  (read server-side from the teacher's saved profile so it can't be spoofed).
- **Voice input** — dictate a question using the browser Web Speech API.
- **Read aloud** — text-to-speech playback of an answer (SpeechSynthesis).
- **Copy** and **share to WhatsApp** an answer.
- **Follow-up actions** under each answer — *Make it simpler*, *Create a worksheet*,
  *5-minute activity*, *Translate to Hindi*, *Translate to English* (each resubmits a new,
  self-contained request).
- **Conversation history** — every question/answer is saved per teacher; reopen a past answer
  instantly (no new API call), delete a single entry, or clear all history.
- **Feedback** — mark an answer helpful / not helpful (feeds the admin analytics).
- **Reliability & safety** — server-side retries, answer continuation for truncated long
  answers, prompt-injection-resistant prompt structure, an emergency-detection prompt path,
  and output sanitization.

### My Library (saved resources)
- **Save to Library** from any AI answer, with an auto-suggested title and resource type.
- **Library listing** with **search** (title/content) and **type filters**
  (Lesson Plan, Classroom Activity, Assessment, Explanation, General Resource).
- **Resource detail view** with rendered Markdown, plus **delete**.
- **Owner isolation** — every resource is private to its owner; a resource that doesn't exist
  *or* belongs to someone else returns the same 404, so existence is never leaked.

### Lesson Plan / Resource Workspace
- **Document-style editor** at `/library/:id/edit` (labelled "Lesson Plan Workspace" for lesson
  plans, "Resource Workspace" otherwise).
- **Edit** title, type, grade, subject, language, and Markdown content.
- **Edit ⇄ Preview** toggle (lightweight Markdown rendering — no heavy rich-text dependency).
- **Save Changes** — disabled until something changes; sends only changed fields via
  `PATCH /api/resources/:id`; shows loading/success/error states.
- **Unsaved-changes protection** — a `beforeunload` warning and a confirm on Back/Cancel.
- **AI Workspace Assist** — *Make it simpler*, *Add classroom activities*,
  *Add assessment questions*, *Adapt for another grade*. Suggestions are generated server-side
  and shown in a **preview** dialog; the user explicitly **Applies** (stages into the editor) or
  **Cancels** — nothing is auto-overwritten and nothing is persisted until an explicit Save.
- **Print / Export PDF** — uses the browser print dialog with dedicated `@media print` styles:
  app chrome, buttons, and toasts are hidden; the sheet is forced to a white background with
  dark text (even from dark mode); branding, title, grade, subject, language, type, and the
  updated date are included.

### Quiz & Worksheet Generator
- **Dedicated generator** at `/generator` — configure **format** (Quiz / Worksheet), grade,
  subject, **topic**, **difficulty** (Easy/Medium/Hard), **question type**
  (Multiple Choice / True-False / Short Answer / Mixed), **number of questions** (3–30), language,
  and optional additional instructions.
- **Structured, schema-validated AI generation** (`POST /api/resources/generate`) — the request is
  validated with Zod; Gemini returns **question content only** as JSON (validated against a Zod
  schema, not a formatted document). The server — never the model — deterministically builds
  question numbering, MCQ option letters (A–D), and the answer-key heading, so document structure
  can't drift from one generation to the next. The key stays server-side and **nothing is
  auto-saved**.
- **Exam-paper letterhead ("Paper details")** — an optional, deterministic letterhead (school name,
  exam name, teacher name, date/time toggles, maximum marks, custom instructions) rendered above
  the questions in both preview and print, independent of the AI-generated content. Class/Subject/
  Maximum Marks and Student Name/Roll No. lines always print (blank fill-in lines when unset);
  Date/Time rows show only once toggled on. Per-paper values default from **site-wide paper
  defaults** configurable on the **Settings** page (school name, teacher name, default
  instructions, date/time visibility), pre-filled from the teacher's school/profile.
- **Math notation (LaTeX via KaTeX)** — the generation prompt requires all mathematical notation
  (equations, fractions, exponents, roots, trig functions, symbols) to be written as LaTeX
  delimited with `$...$` / `$$...$$`; the client renders it as real mathematical notation with
  [KaTeX](https://katex.org/) in both preview and print. AI-mangled LaTeX (from JSON-escaping
  artifacts) is repaired before rendering; an unrenderable expression falls back to the escaped
  source text rather than breaking the page.
- **Preview & edit** the generated Markdown, then **Save to Library** as an **Assessment** resource
  (reuses the existing Resource model — no separate quiz/worksheet tables; the letterhead and
  generator config are kept alongside it in `Resource.structured`). Saving opens it in the
  Workspace for full editing, AI assist, and printing.
- **Structural answer-key separation** — the answer key is the final Markdown section under a
  canonical heading (`## Answer Key` / `## Teacher Answer Key`), guaranteed present by the
  server-side rendering above. Printing offers a **Student version** (questions only — the answer
  key is omitted from the print DOM, not merely CSS-hidden) and a **Teacher version** (with the
  answer key). If no answer-key heading can be found (e.g. after a hand-edit that removed it), the
  Student version print **fails closed**: the teacher must explicitly confirm before printing,
  rather than silently printing content that might still contain answers. Assessments print as a
  clean exam paper using the letterhead — unlike other resource types, they omit the app's generic
  branded print header.
- **Assessment AI follow-ups** (in the Workspace, for assessments): *Make easier*, *Make harder*,
  *Generate more questions*, *Simplify wording* — go through the same structured JSON pipeline as
  generation and re-render deterministically onto the resource's existing title/metadata, with the
  same preview→apply→save flow as Workspace Assist. The letterhead is never touched by these.

### Admin & Super Admin
- **Admin Dashboard** (`/admin`) — role-scoped usage analytics rendered with Recharts:
  totals (queries, teachers, active teachers, feedback, helpful ratio), queries-by-day,
  by-subject, by-issue-type, by-language, and top questions.
- **Manage** (`/admin/manage`) — user list (scoped by role); super admins can create schools
  and change user roles.
- **Paginated admin tables** — the Users, Pending teachers, and Schools tables are paginated,
  searchable, and filterable **server-side**: 25 rows per page with a "showing 1–25 of N" count
  and Prev/Next, a debounced search box (name/email for users, name/code/district for schools),
  and Role + Status filters on the user list. The page size is clamped server-side (max 100), so
  no admin list endpoint can return an unbounded result set regardless of what a client asks for.
- **Session revocation** — admins can revoke a user's active sessions ("kill a compromised
  account"); teachers can view and revoke their own sessions.
- **Admin Settings** (`/admin/settings`, super admin only) — runtime configuration for a small,
  allowlisted set of existing env-var settings, changeable without a redeploy or restart:
  **Feature Management** (e.g. Learning Representation on/off) and **AI Access** (which roles
  may use the AI Assistant). Every override is DB-backed (survives restarts, consistent across
  instances), audited, and always falls back to the existing environment variable if unset or
  unreadable. See [`docs/admin-feature-flags-architecture.md`](docs/admin-feature-flags-architecture.md)
  for the full design and how to add another setting.

### Cross-cutting
- **Dark / light theme** with the choice persisted in `localStorage`.
- **Responsive / mobile** layout down to ~320px. At ≤640px the top bar reduces to essentials
  (menu toggle, compact logo, theme toggle, profile) and primary navigation moves to a fixed
  **bottom navigation** (Coach / Library / Generator); the history sidebar becomes a slide-in
  drawer. `env(safe-area-inset-bottom)` is respected and content is padded so nothing hides
  behind the bottom nav or composer.
- **Adaptive Coach scrolling** — the empty/welcome state scrolls as one natural page
  (greeting → quick actions → context → composer), while an active conversation uses a
  fixed-viewport layout (messages scroll; composer stays docked above the bottom nav).
- **Onboarding** — a first-run "Getting started" intro on the welcome screen (feature overview,
  role-aware for admins) plus one-time inline tips on My Library, the Generator, and the
  Workspace / AI Assist. Dismissed state is stored per account in `preferences.onboarding`
  (`seenWelcomeIntro`, `dismissedTips[]`), so it follows the user across devices; the intro is
  re-openable anytime from the profile menu's **Getting started** item.
- **Accessibility** — `:focus-visible` outlines, `aria-label`s on icon-only controls,
  `role`/`aria-*` on menus, tabs, and dialogs; the bottom nav marks the active route with
  `aria-current`.
- **Installable PWA** — the app shell is cached; API calls are never cached.

### Planned / Roadmap
These are **not implemented** yet (see `docs/` and the code comments):
- Migration from SQLite to PostgreSQL (`docs/postgres-migration-plan.md` — plan only).
- One-time git-history secret purge (`docs/git-history-secret-purge.md` — runbook only).
- Additional languages, video micro-learning, native mobile app, SMS/feature-phone support.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| **Frontend** | React 18, TypeScript, Vite 5, React Router 6, Recharts, `vite-plugin-pwa`, Lucide icons, KaTeX (math rendering) |
| **Backend** | Node.js 18+ (CI uses 20), Express 4 |
| **Database** | SQLite via Prisma ORM 6 (datasource is swappable to PostgreSQL — see `docs/`) |
| **AI** | Google Gemini `2.5-flash` (`generateContent`), called only from the server |
| **Auth & security** | JWT access tokens (`jsonwebtoken`), rotating server-tracked refresh tokens, `bcryptjs` password hashing, Google Sign-In (`google-auth-library`), password reset by email (Brevo), `helmet`, `cors`, `express-rate-limit`, `zod` validation |
| **Testing** | Vitest + Supertest (server); `tsc` + ESLint + Vite build (client) |
| **CI / Security** | GitHub Actions (secret scan + server + client jobs), gitleaks secret scanning, optional local pre-commit hook |
| **Deployment** | Static frontend build + Node API; `npm start` runs `prisma migrate deploy` then boots (migrations-on-start) |
| **Browser APIs** | Web Speech API (voice input), SpeechSynthesis (read aloud), Clipboard |

---

## Project Structure

```
Teacher-Assistant/
├── client/                         # Vite + React + TypeScript PWA
│   └── src/
│       ├── pages/                  # LoginPage, CoachPage, LibraryPage, ResourceView,
│       │                           #   ResourceWorkspace, GeneratorPage, SettingsPage,
│       │                           #   AdminPage, ManagePage
│       ├── components/             # TopBar, BottomNav (mobile), Sidebar, Composer, ContextBar,
│       │                           #   MessageList, MessageBubble, ResponseCard, FollowUpChips,
│       │                           #   SaveToLibrary, WelcomeScreen, AdminTabs, Toast,
│       │                           #   ExamHeader / ExamHeaderEditor (paper letterhead)
│       ├── hooks/                  # usePreferences (theme/font), useVoiceInput, useDismissable
│       ├── lib/                    # api resources client, format (Markdown→HTML), math (KaTeX),
│       │                           #   assessment (answer-key split), examMeta, tts, followUp
│       ├── api.ts                  # fetch wrapper: JWT bearer + silent refresh-on-401
│       ├── auth.tsx                # auth context (login/register/me/logout)
│       ├── config.ts              # languages, grades, subjects, roles, resource types
│       └── types.ts               # shared TypeScript types
│
├── server/                         # Node.js + Express + Prisma backend (holds the API key)
│   ├── src/
│   │   ├── index.js                # app setup, CORS, rate limits, POST /api/coach, error handler
│   │   ├── gemini.js               # Gemini client: retries, continuation, generateContent()
│   │   ├── prompts.js              # prompt templates + language & response-style directives
│   │   ├── seed.js                 # demo schools + accounts
│   │   ├── middleware/auth.js      # JWT sign/verify, authRequired, requireRole, refresh helpers
│   │   ├── routes/                 # auth.js, queries.js, resources.js, admin.js
│   │   ├── safety/                 # inputGuard.js, outputGuard.js
│   │   └── lib/                    # db.js, config.js, geminiPolicy.js, asyncHandler.js,
│   │                               #   assessmentSchema.js (Zod schema + LaTeX repair)
│   ├── prisma/
│   │   ├── schema.prisma           # School, User, Session, Query, Feedback, Event, Resource
│   │   └── migrations/             # SQLite migration history (4 migrations)
│   └── test/                       # Vitest + Supertest suites and helpers
│
├── docs/                           # MANUAL-TESTING-GUIDE.md, MOBILE-RESPONSIVE-TESTING-GUIDE.md,
│                                   #   postgres-migration-plan.md, git-history-secret-purge.md
├── archive/                        # ⚠️ Legacy vanilla HTML/JS prototype — reference only
├── .github/workflows/ci.yml        # CI: secret scan + server (lint/test) + client (lint/build)
├── .githooks/pre-commit            # optional local gitleaks pre-commit scan
└── .gitleaks.toml                  # secret-scanning rules + allowlist
```

---

## Local Development Setup

**Prerequisites:** Node.js 18+ (20 recommended), npm, and a free
[Google Gemini API key](https://aistudio.google.com/app/apikey).

> **Windows / PowerShell note:** if `npm`/`npx` are blocked by the execution policy
> (`running scripts is disabled on this system`), either run
> `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` once, **or** use the
> `.cmd` forms shown below (`npm.cmd`, `npx.cmd`).

### 1. Clone and install

```bash
git clone <your-repo-url> Teacher-Assistant
cd Teacher-Assistant

cd server && npm install     # Windows: npm.cmd install
cd ../client && npm install  # Windows: npm.cmd install
```

### 2. Configure environment variables

```bash
# from the repo root
cd server
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env

cd ../client
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
```

Edit `server/.env` and set at least `GEMINI_API_KEY` and a strong `JWT_SECRET`
(see [Environment Variables](#environment-variables)). `client/.env` only needs `VITE_API_BASE`
(defaults to `http://localhost:3000/api`).

### 3. Set up the database (SQLite via Prisma)

```bash
cd server
npx prisma migrate dev        # creates prisma/dev.db and applies all migrations
npx prisma generate           # generate the Prisma client (also run by migrate dev)
npm run seed                  # optional: demo schools + accounts (see Auth & Roles)
```

### 4. Start the backend

```bash
cd server
npm run dev                   # node --watch src/index.js  (or: npm start)
```

The API listens on `http://localhost:3000` by default.

### 5. Start the frontend

```bash
cd client
npm run dev                   # Vite dev server, default http://localhost:5173
```

### 6. Verify and open

```bash
curl http://localhost:3000/api/health   # -> {"status":"ok","timestamp":"..."}
```

Open the URL Vite prints (default `http://localhost:5173`) and log in with a seeded demo
account (below).

---

## Environment Variables

Document **names and purpose only** — never commit real values. `server/.env` is git-ignored.

### Server (`server/.env`)

**Required**

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Google Gemini API key. The server refuses to start without it. |
| `JWT_SECRET` | Secret used to sign JWT access tokens. Use a long random string. Required to start. |
| `DATABASE_URL` | Prisma datasource URL. Default `file:./dev.db` (SQLite, relative to `prisma/`). |

**Required in production only**

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Set to `production` to enable the strict CORS allowlist and production rate-limit defaults. |
| `CORS_ORIGINS` | Comma-separated allowlist of frontend origins. **Required when `NODE_ENV=production`** (the server won't boot if empty); ignored in development (any origin is reflected). |

**Optional (sensible defaults)**

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_ENDPOINT` | `…/models/gemini-2.5-flash:generateContent` | Gemini model endpoint. |
| `PORT` | `3000` | Backend port. |
| `ACCESS_TOKEN_TTL` | `15m` | Access-token lifetime (kept short; refreshed silently). |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | Refresh-token lifetime ("stay logged in" window). |
| `LOGIN_MAX_ATTEMPTS` | `5` | Failed password attempts before lockout. |
| `LOGIN_LOCKOUT_MINUTES` | `15` | Lockout duration. |
| `BREVO_API_KEY` | — | Brevo key for password-reset email. Unset = no email sent; the app still runs. |
| `EMAIL_FROM` | — | From address on reset email, as `Name <address>`. The address must be verified in Brevo. |
| `APP_URL` | `http://localhost:5173` | Frontend URL used to build the reset link. |
| `PASSWORD_RESET_TTL_MINUTES` | `60` | How long a reset link stays valid. |
| `GOOGLE_CLIENT_ID` | — | Google OAuth Web client ID; verified as each ID token's audience. Unset = Google sign-in disabled (503). Must match the client's `VITE_GOOGLE_CLIENT_ID`. |
| `RATE_LIMIT_WINDOW_MINUTES` | `15` | Rate-limit window for `POST /api/coach`. |
| `RATE_LIMIT_MAX_REQUESTS` | `60` prod / `300` dev | Max coach requests per window per IP (env-aware default; explicit value always wins). |
| `LLM_TIMEOUT_MS` | `30000` | Timeout for a single Gemini call. |
| `LLM_TOTAL_TIMEOUT_MS` | `60000` | Overall deadline for one coach request (all calls combined). |
| `LLM_MAX_RETRIES` | `2` | Retries per logical call on transient failures. |
| `LLM_MAX_CALLS_PER_REQUEST` | `8` | Hard cap on total Gemini calls per request. |
| `LLM_MAX_CONTINUATIONS` | `4` | Max continuation calls for truncated answers. |
| `LLM_MAX_OUTPUT_TOKENS` | `8192` | Max output tokens per Gemini call. |

Out-of-range LLM/rate-limit values are clamped to safe bounds with a startup warning rather than
crashing.

### Client (`client/.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE` | `http://localhost:3000/api` | Base URL of the backend API (set at build time for production). |

---

## Database & Prisma

- **Provider:** SQLite (`provider = "sqlite"` in `server/prisma/schema.prisma`), suitable for the
  pilot. The datasource can later be switched to PostgreSQL — see
  `docs/postgres-migration-plan.md` (**plan only, not executed**).
- **Models:** `School`, `User`, `Session`, `Query`, `Feedback`, `Event`, `Resource`.
- **Migrations (4):** `…_init`, `…_add_teacher_preferences`, `…_add_sessions`, `…_add_resources`.

Common commands (run inside `server/`):

```bash
npx prisma migrate dev        # apply migrations locally + regenerate client (development)
npx prisma migrate deploy     # apply pending migrations without generating (production / CI-like)
npx prisma generate           # regenerate the Prisma client only
npm run seed                  # load demo schools + accounts
npx prisma studio             # browse/edit the database in a local GUI
```

**Production migration behavior:** `npm start` runs `prisma migrate deploy && node src/index.js`,
so pending migrations are applied automatically on server start.

---

## Authentication & Roles

**Login identity:** the teacher's **email address**. Passwords are hashed with bcrypt and never
stored in plain text. A **school code** is required only at **sign-up**, to pick the tenant —
signing back in needs just email + password. (If one email holds accounts at more than one school,
sign-in shows a "which school?" picker.)

**Sign-in methods** — two fully parallel options, both on the Sign in and Register tabs:

1. **Email + password**, with self-service reset by email (`POST /auth/forgot-password` →
   `POST /auth/reset-password`). Reset tokens are single-use, expire after
   `PASSWORD_RESET_TTL_MINUTES`, are stored only as a SHA-256 hash, and revoke every existing
   session when redeemed.
2. **Google Sign-In.** The ID token is verified **server-side** against `GOOGLE_CLIENT_ID` as the
   expected audience — a client-asserted email or subject is never trusted. Sign-in matches on
   Google's stable `sub`, never on the email alone, so a Google token can't take over an account
   created with a password.

**Approval gate:** every new sign-up — by either method — is created with `status: 'pending'` and
**receives no session at all** until a `school_admin` (their own school) or `super_admin` (any
school) approves it from **Manage → Pending teachers**. A `resource_person` can see the queue but
not act on it. Each decision writes a `user_approved` / `user_rejected` `Event` row for audit.
This closes the earlier gap where a school code alone was enough to create an account.

**Token model:** a short-lived **access token** (JWT, default 15 minutes) plus a **rotating
refresh token** (default 7 days) whose hash is stored in the `Session` table. The client keeps
both in `localStorage`; on a 401 it silently calls `POST /api/auth/refresh` once and retries.
Refresh tokens rotate on every use; presenting an already-revoked token revokes all of the user's
sessions (theft protection). Accounts lock after `LOGIN_MAX_ATTEMPTS` failed passwords.

**Roles & what they can access:**

| Role | Coach + Library + Settings | Dashboard / Manage | Analytics & user scope |
| --- | :---: | :---: | --- |
| `teacher` | ✅ | — | Only their own history & resources |
| `school_admin` | ✅ | ✅ | Their own school |
| `resource_person` | ✅ | ✅ | All schools in their district |
| `super_admin` | ✅ | ✅ | All schools; can create schools & change roles |

The admin roles (`school_admin`, `resource_person`, `super_admin`) see the **Dashboard** and
**Manage** navigation; teachers do not. Route guards live in `client/src/App.tsx`, and every
admin API route is protected server-side with `requireRole(...)`.

### Demo accounts (development only)

`npm run seed` creates the following **development-only** demo accounts, all `active` and all
using the password **`demo1234`**. Do not use these in production.

| Email | School | Role |
| --- | --- | --- |
| `superadmin@example.com` | `RAMPUR01` | Super Admin |
| `admin.rampur01@example.com` | `RAMPUR01` | School Admin |
| `rp.rampur01@example.com` | `RAMPUR01` | Resource Person |
| `teacher@example.com` | `RAMPUR01` | Teacher |
| `sunita@example.com` | `RAMPUR02` | Teacher |
| `ravi@example.com` | `DELHI01` | Teacher |

New teachers self-register on the **Register** tab with a school code, name, email and password
(or with Google). Remember that a fresh sign-up is **pending** until an admin approves it.

---

## API Overview

All routes are under `/api`. Protected routes require an `Authorization: Bearer <accessToken>`
header; admin routes additionally enforce role.

**Auth** (`server/src/routes/auth.js`)
- `POST /auth/register` — sign-up under a valid school code; creates a **pending** account and
  returns `201 { status: 'pending' }` with **no token**
- `POST /auth/login` — email + password sign-in (no school code). May return
  `{ needsSchoolSelection, schools }` instead of a session; `403 pending_approval` /
  `403 registration_rejected` for accounts not yet let in
- `POST /auth/google` — Google sign-up (with `schoolCode`) or sign-in (without), same outcomes
- `POST /auth/forgot-password` · `POST /auth/reset-password` — self-service reset by email
- `POST /auth/refresh` — exchange a refresh token for a new access+refresh pair
- `POST /auth/logout` — revoke one refresh-token session
- `GET /auth/me` · `PATCH /auth/me` · `PATCH /auth/me/password` — profile, preferences, password change
- `GET /auth/sessions` · `DELETE /auth/sessions/:id` — list / revoke the caller's own sessions

**Coach / AI** (`server/src/index.js`)
- `POST /coach` — generate a coaching response (auth + rate-limited + validated)

**Queries / History** (`server/src/routes/queries.js`)
- `GET /queries` — the caller's history · `POST /feedback` — 👍/👎 on a response
- `DELETE /queries/:id` · `DELETE /queries` — delete one / clear all

**Resources / Library & Workspace AI** (`server/src/routes/resources.js`)
- `GET /resources` — list (supports `?type=`, `?q=`, `?limit=`)
- `POST /resources` · `GET /resources/:id` · `PATCH /resources/:id` · `DELETE /resources/:id`
- `POST /resources/generate` — Quiz/Worksheet Generator: AI-generate assessment Markdown (never persisted here)
- `POST /resources/:id/ai-action` — generate a Workspace AI suggestion (never persisted here)

**Admin** (`server/src/routes/admin.js`)
- `GET /admin/analytics` — role-scoped usage analytics
- `GET /admin/schools?page=&limit=&q=` · `POST /admin/schools` — super admin only; the listing is
  paginated and searchable on name/code/district
- `GET /admin/users?page=&limit=&q=&role=&status=&schoolId=` — scoped user list, paginated;
  `q` matches name/email and every filter can only *narrow* the caller's school scope
  (an out-of-scope `schoolId` is ignored, never applied)
- `GET /admin/users/pending?page=&limit=&q=` — scoped list of sign-ups awaiting approval
  (all admin roles), paginated
- `PATCH /admin/users/:id/approve` · `PATCH /admin/users/:id/reject` — decide on a pending sign-up
  (`school_admin` / `super_admin` only; writes an audit `Event`)
- `PATCH /admin/users/:id/role` — super admin changes a role
- `POST /admin/users/:id/revoke-sessions` — revoke a user's sessions

**Admin Settings** (`server/src/routes/adminSettings.js`) — super admin only; see
[`docs/admin-feature-flags-architecture.md`](docs/admin-feature-flags-architecture.md)
- `GET /admin/feature-flags` — every admin-controllable setting's effective state
  (boolean feature flags under Feature Management, role-list access controls under AI
  Access), and whether each came from an admin override or the env-var default
- `PATCH /admin/feature-flags/:id` — update one setting's override: `{ enabled: boolean }`
  for a boolean flag (e.g. `learning-representation`), or `{ roles: string[] }` for a
  role-list access control (e.g. `assistant-allowed-roles` — which roles may use the AI
  Assistant; an empty array is valid and disables the Assistant for everyone). Writes
  an audit `Event`. The underlying env var remains the safe fallback for both.

**Health**
- `GET /health` — liveness check

---

## Testing

There is a full **server** test suite (Vitest + Supertest) and standard **client** checks
(there is intentionally no client unit-test runner today).

```bash
# Server (run inside server/)
npm test          # vitest run — full suite (auth, RBAC, resources, coach, safety, isolation…)
npm run lint      # eslint src

# Client (run inside client/)
npm run lint      # eslint src
npm run build     # tsc -b (typecheck) + vite build
```

CI runs these on every pull request and on pushes to `main` (see `.github/workflows/ci.yml`),
using Node 20, plus a gitleaks secret scan.

**Manual / QA testing:** step-by-step manual test cases live in
[`docs/MANUAL-TESTING-GUIDE.md`](docs/MANUAL-TESTING-GUIDE.md) (auth, RBAC, Coach, Library,
Workspace, Generator, admin, etc.), with detailed mobile/responsive coverage in
[`docs/MOBILE-RESPONSIVE-TESTING-GUIDE.md`](docs/MOBILE-RESPONSIVE-TESTING-GUIDE.md).

---

## Deployment

The app ships as **two pieces**: a static frontend build and a Node API server. There is no
committed platform-specific deploy file (e.g. no `railway.json`/`Procfile`); deployment relies on
the standard scripts below. (The server does trust exactly one reverse-proxy hop via
`app.set('trust proxy', 1)`, which is compatible with PaaS platforms such as Railway.)

### 1. Frontend

```bash
cd client
npm run build     # outputs a static site to client/dist/
```

Host `client/dist/` on any static host (Netlify, Vercel, Nginx, GitHub Pages…). Set
`VITE_API_BASE` **at build time** to point at the deployed API URL.

### 2. Backend

```bash
cd server
npm ci
npm start         # runs: prisma migrate deploy && node src/index.js  (migrations-on-start)
```

Or run under a process manager (pm2, systemd, or a PaaS start command).

### Production notes
- Set `NODE_ENV=production` and list exact origins in `CORS_ORIGINS` (the server won't boot
  otherwise).
- Provide `GEMINI_API_KEY`, a strong `JWT_SECRET`, and `DATABASE_URL` as environment variables —
  never commit them.
- For higher write concurrency or multiple instances, switch Prisma to PostgreSQL and re-run
  migrations (see `docs/postgres-migration-plan.md`). ⚠️ **Before going multi-instance**, note that
  the assistant's per-user daily budget is process-local and would multiply — see the runbook below.

### AI Action Router — operating a feature-flagged rollout

The assistant (a teacher types "Generate a Class 5 fractions worksheet" and lands on a pre-filled
Generator) ships **switched off**. Every gate defaults to off, so a deployment that configures none
of them runs a completely inert assistant.

- **Kill switch:** `ASSISTANT_ENABLED=false` + restart. Effective in seconds, and it is the **only**
  reliable incident control — the client is a PWA, so `VITE_ASSISTANT_ENABLED` is a build-time
  convenience, never an emergency lever.
- **Staged exposure:** `ASSISTANT_ALLOWED_SCHOOL_CODES` narrows the rollout to named schools.
  ⚠️ **An empty value means ALL schools** — it is a filter, not a gate.
- **Role rollout, at runtime:** `ASSISTANT_ALLOWED_ROLES` (default `teacher`) is also
  temporarily overridable from **Admin Settings > AI Access** — a `super_admin` can widen or
  narrow which roles may reach the assistant without a redeploy. ⚠️ Unlike the school-code
  filter above, an **empty role override means NO role** (server-enforced) — see
  [`docs/admin-feature-flags-architecture.md`](docs/admin-feature-flags-architecture.md) §4.1.
- **Read the launch metric:** `npm run assistant:metrics` (field-edit rate; `n/a` means no evidence,
  not 0%).
- **Retention:** schedule `npm run assistant:prune-events` weekly once the feature is enabled —
  assistant telemetry is kept 90 days and nothing prunes it automatically, on purpose.

Every variable is documented in `server/.env.example`. **The operational procedures — stage matrix,
daily watchlist, rollback tiers, incident steps — live in
[`docs/ai-action-router-rollout-runbook.md`](docs/ai-action-router-rollout-runbook.md).**

---

## Security

Verified controls in the current codebase:

- **Server-side Gemini key** — the key lives only in `server/.env` (git-ignored) and is used only
  by `server/src/gemini.js`. The browser never receives it; all AI calls are server-side.
- **Authentication** — bcrypt-hashed PINs, short-lived JWT access tokens, rotating server-tracked
  refresh tokens (revocable), account lockout after repeated failures.
- **RBAC** — `requireRole(...)` guards every admin route; analytics and user lists are scoped by
  role (own school / district / all).
- **Owner-scoped resources & history** — resources and history entries are private to their owner;
  a missing-or-not-yours resource returns the same 404 (existence not leaked).
- **Input validation** — Zod schemas (mostly `.strict()`) validate request bodies; the coach input
  is length-limited and normalized.
- **Prompt-injection resistance** — trusted instructions go in Gemini's `systemInstruction`; the
  teacher's question and resource content are passed as delimited untrusted user content.
- **HTTP hardening** — `helmet`, CORS allowlist (strict in production), and per-IP rate limiting
  on `/api/coach` and auth endpoints.
- **Secret scanning** — gitleaks runs in CI as a hard gate on new commits, with an optional local
  pre-commit hook (`git config core.hooksPath .githooks`). `.env`/`*.env` are git-ignored
  (`*.env.example` excepted).

> **Historical note:** earlier commits in this repository's history contained Gemini keys from
> before secret scanning existed. A manual cleanup runbook is in
> `docs/git-history-secret-purge.md` (**not yet executed**); any such keys must be rotated in the
> Google console regardless.

---

## Educational Context

Aligned with **NIPUN Bharat** (Foundational Literacy & Numeracy), **NEP 2020** (continuous teacher
development), and **Teaching at the Right Level (TaRL)**. Target users: primary/secondary
government school teachers and cluster/academic/block resource persons.

---

## Legacy prototype

The original vanilla HTML/JS prototype lives in `archive/` (`index.html`, `app.js`, `styles.css`,
`config.js`, etc.). It is **superseded** by the React client in `client/` and no longer works
against the API (which now requires authentication). It is kept for reference only. The old
`SETUP.md` that described it has been updated to point at the current setup above.

---

**Made with ❤️ for Indian Teachers** — *"Empowering teachers with just-in-time support to
transform classrooms."*
