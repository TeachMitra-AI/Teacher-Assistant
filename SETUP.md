# 🚀 Quick Setup Guide

> **Status: Current.** This guide covers the current React (`client/`) + Node/Express
> (`server/`) application. An older version of this file described the retired vanilla
> HTML/JS prototype now in `archive/` — that content has been removed to avoid confusion.
> For full details (features, environment variables, API, deployment) see [`README.md`](./README.md).

## Prerequisites
- **Node.js 18+** (20 recommended) and npm
- A free **Google Gemini API key** — https://aistudio.google.com/app/apikey

> **Windows / PowerShell:** if you see `running scripts is disabled on this system`, either run
> `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` once, or use the `.cmd`
> forms (`npm.cmd`, `npx.cmd`).

## 1. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

## 2. Configure environment variables

```bash
cd server
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env

cd ../client
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
```

In `server/.env`, set at minimum:

```env
GEMINI_API_KEY=<your-gemini-api-key>
JWT_SECRET=<a-long-random-secret>
```

`client/.env` only needs `VITE_API_BASE` (defaults to `http://localhost:3000/api`).

Two optional integrations, both safe to leave blank while you get started:

| Feature | Server var(s) | Client var | Behaviour when unset |
| --- | --- | --- | --- |
| Password reset emails | `BREVO_API_KEY`, `EMAIL_FROM`, `APP_URL` | — | "Forgot password" still responds normally, but no email is sent |
| Google Sign-In | `GOOGLE_CLIENT_ID` | `VITE_GOOGLE_CLIENT_ID` | Google buttons are hidden; email + password is unaffected |

`GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` must be the **same** value — the server verifies
each Google ID token's audience against it. See `server/.env.example` for how to obtain both.

## 3. Set up the database and seed demo data

```bash
cd server
npx prisma migrate dev     # creates prisma/dev.db and applies migrations
npx prisma generate        # generate the Prisma client
npm run seed               # optional: demo schools + accounts (all use password demo1234)
```

## 4. Start the backend

```bash
cd server
npm run dev                # or: npm start
```

Verify it is up:

```bash
curl http://localhost:3000/api/health   # -> {"status":"ok", ...}
```

## 5. Start the frontend

```bash
cd client
npm run dev
```

Open the URL Vite prints (default **http://localhost:5173**).

## 6. Log in (demo accounts)

Sign in with just an **email + password** — no school code. All seeded demo accounts use the
password **`demo1234`**:

| Email | Role |
| --- | --- |
| `teacher@example.com` | Teacher |
| `admin.rampur01@example.com` | School Admin |
| `rp.rampur01@example.com` | Resource Person |
| `superadmin@example.com` | Super Admin |

New teachers self-register on the **Register** tab with a school code (e.g. `RAMPUR01`), their
name, an email and a password — or with **Sign up with Google**, if you configured a client ID.

> **Every new sign-up starts as _pending_ and cannot log in until it is approved.** Sign in as a
> School Admin or Super Admin, open **Manage**, and use the **Pending teachers** table to approve
> or reject it. This is intentional: a school code alone is no longer enough to get an account.

## Troubleshooting

- **`FATAL: GEMINI_API_KEY is not set`** — set `GEMINI_API_KEY` in `server/.env` and restart.
- **`FATAL: JWT_SECRET is not set`** — set `JWT_SECRET` in `server/.env` and restart.
- **Voice input not working** — use Chrome/Edge and allow microphone access.
- **Dashboard link missing** — it is admin-only; log in as an admin/super-admin account.
- **"Your account is awaiting approval"** — expected for a fresh sign-up. Approve it from
  **Manage → Pending teachers** as a School Admin or Super Admin.
- **No password reset email arrives** — `BREVO_API_KEY` is probably unset (the request still
  succeeds by design). Also check `APP_URL` points at the frontend, or the link will 404.
- **CORS errors in production** — set `NODE_ENV=production` and list your frontend origin(s) in
  `CORS_ORIGINS`.

For everything else, see [`README.md`](./README.md).
