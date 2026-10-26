---
paths:
  - "client/**"
---

# Client (React 18, TypeScript, Vite 5)

- **HTML sink.** Model and user text reach the DOM only through `formatResponse`
  (`client/src/lib/format.ts`), which escapes first and then adds a fixed tag set. Every
  `dangerouslySetInnerHTML` in `client/src` wraps it. Never pass raw or un-escaped text to
  `dangerouslySetInnerHTML`. Don't add a Markdown/HTML library that renders raw HTML. When
  you change `format.ts` or `lib/math.ts`, keep KaTeX's default `trust: false` and add an
  XSS case to the tests (see `format.table.test.ts`).
- **Session.** The web client keeps the refresh token in the HttpOnly `sarastech_refresh`
  cookie and sends `X-Session-Transport: cookie` on `/api/auth` calls. Don't move tokens
  into `localStorage` or readable cookies. Use the existing session code in
  `client/src/lib/` and `client/src/api.ts`.
- **Secrets.** Anything in a `VITE_*` variable is public in the built bundle. API keys never
  go there. The client calls the server, never Gemini.
- **Server is the authority.** Hiding a control by role or flag is UX only. The server must
  enforce the same rule. Say so when a change relies on it.
- **Tests** are Vitest + jsdom. Prefer pure-logic tests next to the module (`*.test.ts`).
- **Gate** from `client/`: `npm run lint` → `npm test` → `npm run build` (the build is the
  typecheck).
