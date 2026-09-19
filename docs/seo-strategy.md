# SEO strategy and how to maintain it

Scope: the public, signed-out site at `https://www.sarastech.co.in` (`client/`). The signed-in app is
`Disallow`ed in `client/public/robots.txt` and is not part of this.

## Approach

A brand-new domain cannot win head terms ("AI tools for teachers", "AI teacher assistant") against
MagicSchool, Brisk, Teachmint and listicle sites. So the strategy is:

1. **Own the brand** (`SarasTech`, `Saras Tech`) — clean `WebSite` name + `alternateName`, consistent naming.
2. **Compete on specific, honest intents** where SarasTech genuinely differs — Indian languages, Indian
   classroom realities (multi-grade, FLN, low-resource), answer-key/print workflow.
3. **Earn trust with useful guides**, not keyword pages, and link them to the tools.

Pages are hand-written entries in `client/src/seo/pages.ts` (7 today). This is deliberately **not** a page
factory — Google's spam policies target scaled, low-value pages.

| Path | Intent |
| --- | --- |
| `/` | Brand + "AI teaching assistant for teachers in India" |
| `/ai-lesson-plan-generator` | AI lesson plan generator |
| `/ai-worksheet-generator` | AI worksheet generator with answer key |
| `/ai-quiz-generator` | Quiz / MCQ / question paper generator |
| `/ai-teaching-assistant-in-indian-languages` | AI tools for teachers in Hindi / regional languages |
| `/guides/lesson-plan-format` | Informational: lesson plan format (India), worked example |
| `/guides/how-to-use-ai-for-lesson-planning` | Informational: responsible AI lesson planning |
| `/guides/multigrade-classroom-teaching` | Informational: multigrade teaching |

## How the pieces fit

- `seo/pages.ts` is the single registry. `App.tsx` routes, `scripts/prerender.mjs`, `seo/sitemap.ts`,
  the header/footer link lists and the home page "Explore" section all read from it.
- `npm run build` prerenders every registry page to `dist/<path>/index.html`, writes `dist/sitemap.xml`
  (there is no static `public/sitemap.xml` any more) and `dist/404.html`.
- `vercel.json` lists the SPA routes explicitly instead of a catch-all rewrite, so unknown URLs get a real
  **404** (`dist/404.html`) instead of a 200 home page (a soft 404).
- `useDocumentMeta` sets title, description, canonical **and** the Open Graph / Twitter tags per page.
- JSON-LD is built in `seo/schema.ts`. There is deliberately no `offers`, `aggregateRating` or `review`
  — SarasTech has no verifiable data for them.

## Adding a page

1. Add `seo/content/<name>.ts` (copy an existing one) and register it in `seo/pages.ts`.
2. **Only claim features that ship unflagged.** Check `client/src/config.ts` — anything behind a
   `*_ENABLED` flag (Classroom Mode, attachments, structured question types, attendance, classroom
   management) must not be described unless it is confirmed live in production.
3. Path rules: lowercase kebab-case, and it must **not** start with a `robots.txt` `Disallow` prefix
   (`/generator-…` would be blocked — Disallow is a prefix match).
4. Set `published`/`updated` honestly; `updated` becomes the sitemap `<lastmod>`. Bump it only when the
   page's content really changes.
5. `npm test` enforces: unique titles/descriptions/H1s, title ≤ 65 and description 90–165 chars, ≥ 4
   sections and ≥ 3 FAQs, all internal links resolve, robots doesn't block it, sitemap contains it, no
   "free / unlimited / auto-grading / percentages / user counts" claims.
6. If you add a route to `App.tsx` for the signed-in app, add its path to `vercel.json` too — a test fails
   if you forget (otherwise it would 404 in production).

## After deploying

- `curl -I https://www.sarastech.co.in/some-nonexistent-page` → expect `404` (not 200).
- `curl -s https://www.sarastech.co.in/sitemap.xml` → 10 URLs.
- Google Search Console: verify the domain property, submit `sitemap.xml`, then URL-inspect the home
  page and each new page and "Request indexing".
