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

## 3. Set up the database and seed demo data

```bash
cd server
npx prisma migrate dev     # creates prisma/dev.db and applies migrations
npx prisma generate        # generate the Prisma client
npm run seed               # optional: demo schools + accounts (all use PIN 123456)
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

All seeded demo accounts use PIN **`123456`**. Sign in with a **school code + name + PIN**:

| School code | Name | Role |
| --- | --- | --- |
| `RAMPUR01` | Demo Teacher | Teacher |
| `RAMPUR01` | Rampur Admin | School Admin |
| `RAMPUR01` | Rampur RP | Resource Person |
| `RAMPUR01` | Super Admin | Super Admin |

New teachers can self-register on the **Register** tab with a valid school code.

## Troubleshooting

- **`FATAL: GEMINI_API_KEY is not set`** — set `GEMINI_API_KEY` in `server/.env` and restart.
- **`FATAL: JWT_SECRET is not set`** — set `JWT_SECRET` in `server/.env` and restart.
- **Voice input not working** — use Chrome/Edge and allow microphone access.
- **Dashboard link missing** — it is admin-only; log in as an admin/super-admin account.
- **CORS errors in production** — set `NODE_ENV=production` and list your frontend origin(s) in
  `CORS_ORIGINS`.

For everything else, see [`README.md`](./README.md).
