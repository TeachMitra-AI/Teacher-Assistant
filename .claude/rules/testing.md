---
paths:
  - "server/test/**"
  - "**/*.test.{js,ts,tsx}"
---

# Tests

- Test observable behaviour through the public surface: Supertest against the real app
  (`server/test/helpers/testApp.js`) on the server, and exported functions on the client
  and mobile. Reuse `test/helpers/` (`fixtures.js`, `auth.js`, `geminiMock.js`,
  `emailMock.js`) rather than writing new mocks.
- Server tests run against the throwaway DB from `test/helpers/testEnv.js`. Never point a
  test at `prisma/dev.db` or any real database, and never make a live Gemini, email, or
  push call from a test.
- For a change to auth, RBAC, ownership, validation, rate limits, or prompt construction,
  cover the **rejection** paths: 401 without a token, 403 for the wrong role, 404 for
  another user's record, 400 for an invalid body, and the untrusted-content placement for
  prompts.
- Never weaken an assertion, skip a test, raise a limit, or relax a security control to
  make a test pass. If the test is wrong, fix the test and explain why.
- Fake values only: fake emails like `@example.com`, and keys like the CI dummies.
