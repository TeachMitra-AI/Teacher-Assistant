# Admin Settings — Architecture

## 1. What this is

Lets a `super_admin` temporarily override existing env-var configuration at runtime,
from **Admin Dashboard > Admin Settings**, with no redeploy and no server restart.
Two kinds of setting are supported, both driven by one allowlisted registry:

- **Feature flags** (`kind: 'feature_flag'`, `type: 'boolean'`) — shown under
  **Feature Management**. Currently: `LEARNING_REPRESENTATION_ENABLED` (see
  `docs/learning-representation-system-adr.md`).
- **Access controls** (`kind: 'access_control'`, `type: 'role_list'`) — shown under
  **AI Access**. Currently: `ASSISTANT_ALLOWED_ROLES`, which roles may use the AI
  Assistant / Action Router.

This is deliberately an **override layer**, not a replacement for env-var
configuration (`server/src/lib/flags.js`, entirely untouched by this feature). The env
var remains the safe default/fallback for both kinds: a deployment that never opens
this screen behaves exactly as it did before this feature existed, and clearing an
override (not currently exposed in the UI — see §9) returns a setting to its env-var
baseline.

Only settings present in the registry (`server/src/lib/systemSettings.js`'s
`ADMIN_SETTINGS_REGISTRY`) are reachable through the admin API — this is the
allowlist. No other env var, secret, or config value is ever exposed through it, and
nothing outside this file decides what's admin-controllable.

**Currently registered settings:**

| API id | Env var (fallback) | Type | Controls |
| --- | --- | --- | --- |
| `learning-representation` | `LEARNING_REPRESENTATION_ENABLED` | `boolean` | Whether Coach shows "View as visual". |
| `assistant-allowed-roles` | `ASSISTANT_ALLOWED_ROLES` | `role_list` | Which roles may use the AI Assistant / Action Router. |

**Not every env var belongs here.** The registry is a deliberate allowlist, not a
mirror of `server/.env`. Before adding a setting, check it's actually a good fit — see
§10 below. In particular, the master **kill switches** (`ASSISTANT_ENABLED`,
`ATTACHMENTS_ENABLED`, `HELP_SUPPORT_ENABLED`) and numeric tuning knobs (budgets,
size/page limits) are deliberately left env-only, with no registry entry: this codebase
already documents `ASSISTANT_ENABLED` as "the one reliable incident control"
(`config.ts`'s G28 comment, `docs/ai-action-router-rollout-runbook.md`) precisely
because it's the single simplest lever an operator can reach for — env var + restart,
no extra moving part. Note that `learning-representation`'s own *master* env var
(`LEARNING_REPRESENTATION_ENABLED`) is exactly this kind of switch, and it stays fully
intact as the fallback here — the registry only ever *adds* a DB-backed override on
top of an env var, never replaces one as the sole control.

## 2. Data model

One additive table, reused as-is for both setting kinds — no new table or migration
for AI Access:

```prisma
model SystemSetting {
  key         String   @id
  value       String
  updatedAt   DateTime @updatedAt
  updatedById String?
}
```

`value` is a plain string whose meaning depends on the setting's `type`:
- `boolean` → the literal `"true"` or `"false"` (unchanged since this table was added).
- `role_list` → a JSON-serialized array of role strings, e.g. `["teacher","school_admin"]`.

Absence of a row for a given key is a first-class state ("no override yet"), not an
error. A row whose value doesn't parse for its declared `type` (corrupt data) is
treated the same way — falls back to the env default, never throws, never partially
applies. `updatedById` is a soft reference to the acting admin (not a foreign key,
mirroring `Resource.sourceQueryId`'s existing precedent) — the durable audit trail is
the `Event` row the same write also creates (see §5), not this table.

## 3. Registry: what "an admin-controllable setting" is

`server/src/lib/systemSettings.js`'s `ADMIN_SETTINGS_REGISTRY` maps a stable API id
(e.g. `learning-representation`, `assistant-allowed-roles`) to the `SystemSetting` key
it overrides, its `kind`/`type`, a label/description for the UI, the existing env
reader that supplies its fallback default, and (optionally) a `validate` function:

```js
const ADMIN_SETTINGS_REGISTRY = {
  'learning-representation': {
    kind: 'feature_flag', type: 'boolean',
    settingKey: 'learning_representation_enabled',
    label: 'Learning Representation',
    envDefault: () => readLearningRepresentationFlags(process.env).enabled,
  },
  'assistant-allowed-roles': {
    kind: 'access_control', type: 'role_list',
    settingKey: 'assistant_allowed_roles',
    label: 'Assistant Access',
    envDefault: () => readAssistantFlags(process.env).allowedRoles,
    validate: (roles) => Array.isArray(roles) && roles.every((r) => APP_ROLES.includes(r)),
  },
};
```

Adding a future admin-controllable setting is a one-line addition here (plus a
client-side section entry) — not a new route, migration, or table, as long as its
value fits one of the two existing `type`s.

**Roles** (`APP_ROLES` in `server/src/lib/roles.js`) mirror — do not replace — the same
four strings already inline-declared in `routes/admin.js`, `seed.js`, and the client's
`types.ts`/`config.ts`/`ManagePage.tsx`. This codebase's established convention for a
closed vocabulary like this one is deliberate duplication over a shared import (see
`config.ts`'s `LANGUAGES`/`GRADES`/`SUBJECTS` comments) — `roles.js` exists only
because this feature's server-side *validation* needed one importable copy; it does
not refactor the existing copies.

## 4. Server: reading and writing a setting

Generic, type-aware helpers in `lib/systemSettings.js`:

- `resolveSetting(key, { type, fallback })` → `{ value, source, updatedAt }`. `boolean`
  wraps as `resolveBoolSetting(key, fallback)` → `{ enabled, source, updatedAt }`
  (unchanged shape/behavior from before this extension). `role_list` wraps as
  `resolveRoleListSetting(key, fallbackRoles)` → `{ roles, source, updatedAt }`.
- `setSetting(key, value, updatedById, { type })`, wrapped as `setBoolSetting` /
  `setRoleListSetting`.
- `describeSetting(id)` / `listAdminSettings()` / `setAdminSetting(id, value, updatedById)`
  — the registry-driven layer the admin route calls; these are what's new here (the
  boolean-only `describeFeatureFlag`/`listFeatureFlags`/`setFeatureFlag` names were
  generalized, but their behavior for `learning-representation` is unchanged).

**Precedence**, resolved fresh on every read, identical for both kinds:

1. A `SystemSetting` row for the key exists and parses for its `type` → its value wins
   (`source: 'override'`).
2. No row, or the row doesn't parse → the caller's env-derived default
   (`source: 'env-default'`).
3. The DB read itself fails → same env-derived default, and never throws — matching
   the "a database we cannot read is never treated as an unsafe state" discipline
   `routes/learningRepresentation.js`'s and `routes/assistant.js`'s `isWithinRollout`
   already use for their own gates.

Deliberately **no in-memory caching**: every read is a fresh query, so every server
instance behind a load balancer sees the same value on its very next request — for
both a boolean flag and a role list. A per-request DB read is not a new class of cost
here: both `isWithinRollout` implementations already do one for their own gates.

Because every override lives in `SystemSetting` and nowhere in process memory, it
**survives a server restart or redeploy** (unlike the in-memory rate-limit/budget
counters elsewhere in this codebase, which reset on restart by design) and is
**immediately consistent across every server instance** reading the same database —
there is no "instance A still has the old value" window to reason about.

### 4.1 Empty role list: deliberate, not an error

An admin can override `assistant-allowed-roles` to `[]` — every checkbox unchecked.
This is accepted and means **"no role may use the Assistant"**, the maximally
restrictive state, exactly mirroring how the boolean flag's `false` fully disables
Learning Representation. It is validated (must be an array of known roles — an empty
array trivially satisfies "every element is a known role") and persisted like any
other override.

This is the **opposite** convention from `ASSISTANT_ALLOWED_SCHOOL_CODES`, where an
empty list means "no restriction, all schools" (see `lib/flags.js`'s own comment).
That's deliberate, not an inconsistency: `allowedSchoolCodes` is a *filter* layered on
top of an already-narrow gate, while `allowedRoles` (env or override) **is** the
primary access gate. Reading empty-roles as "no restriction" there would silently
grant the Assistant to every role — exactly the outcome the requirement "never
accidentally grant access to additional roles" rules out. So role_list settings must
never adopt the school-code list's "empty = permissive" reading.

## 5. Server: the two enforcement points

- `routes/learningRepresentation.js`'s `isWithinRollout` calls `resolveBoolSetting`
  instead of reading `flags.enabled` directly (unchanged from before this extension).
- `routes/assistant.js`'s `isWithinRollout` (shared by `GET /catalog`,
  `POST /interpret`, `POST /events` — all three call the same predicate, so they can
  never disagree) now calls `resolveRoleListSetting(ASSISTANT_ALLOWED_ROLES_SETTING_KEY,
  flags.allowedRoles)` instead of checking `flags.allowedRoles.includes(user.role)`
  directly. `flags.allowedRoles` (the untouched, still-supported
  `ASSISTANT_ALLOWED_ROLES` env reader) is the fallback, exactly like `flags.enabled`
  and `flags.allowedSchoolCodes` already are in that same function.

Everything downstream of each of those calls (budget, classify, render, cache,
catalog-building, interpret) is untouched — the Action Router itself is not
redesigned.

## 6. API

**`GET /api/admin/feature-flags`** and **`PATCH /api/admin/feature-flags/:id`**
(`server/src/routes/adminSettings.js`) — both `authRequired` + `requireRole('super_admin')`
only, matching `routes/adminSupport.js`'s established reasoning: an app-wide switch is
not a school's own data, so it gets the same stricter gate as the ticket inbox rather
than the role-scoped model the rest of `routes/admin.js` uses.

`GET` returns every registered setting in one array, each with `kind`/`type` plus
either `enabled` (boolean) or `roles` (role_list) — the client groups by `kind` into
its two page sections.

`PATCH` body shape depends on the target setting's `type` (looked up from the
registry, not the caller): `{ enabled: boolean }` for a boolean setting — **unchanged**
from before this extension — or `{ roles: string[] }` for a role_list setting, each
entry validated against `APP_ROLES` (`z.enum`), any unknown name rejected with 400.
Both write the `SystemSetting` row and an `Event` audit row
(`type: 'feature_flag_updated'`, `metadata: { key, enabled }` or `{ key, roles }`) —
the same convention `routes/admin.js`'s `decidePendingUser` already uses for
approve/reject.

## 7. Client

**Admin Settings UI** (`client/src/pages/AdminSettingsPage.tsx`, route
`/admin/settings`, tab in `AdminTabs.tsx`, `super_admin`-only like `/admin/support`):
one `GET` populates two sections.

- **Feature Management** — unchanged: a clear ON/OFF badge and a checkbox toggle per
  boolean flag. Flipping it `PATCH`es and shows a toast (`"<Label> enabled"` /
  `"...disabled"` on success, an error toast on failure; the control never optimistically
  changes before the round trip succeeds, so a failure simply leaves it as it was).
- **AI Access** — new: one checkbox per application role (reusing the client's
  existing `ROLE_LABELS`, no new role list declared client-side), checked according to
  the setting's current `roles`. Each checkbox click sends the *complete* updated role
  list in one `PATCH` and shows the same success/error toast pattern, with the whole
  row disabled while that request is in flight.

**Why Assistant Access needs no session-bootstrap wiring** (unlike Learning
Representation): the Assistant endpoints already degrade to an inert response
(`DISABLED_CATALOG` / `passthrough: true`) for a caller outside the rollout — the
client never needed to pre-know whether it's allowed before calling them. So
`getEffectiveFeatureFlags()` (the `featureFlags` field on `GET /auth/me`/login/Google
responses) deliberately still only carries `learningRepresentationEnabled` — nothing
was added there for this feature, because nothing client-side needs it.

## 8. Security

- Every route requires `super_admin`; every other role gets 403, matching
  `adminSupport.js`'s precedent exactly. A `teacher`/`school_admin`/`resource_person`
  can neither read nor write any admin setting.
- Every write creates an `Event` audit row naming the acting admin and the new value.
- The registry is the allowlist: no env var, secret, or config value outside its
  handful of entries is ever readable or writable through this API.

## 9. Deliberately out of scope (Phase 1)

- **Clearing an override** back to "no row" (falling back to the env var) isn't
  exposed in the UI yet — only setting an explicit value. A future addition would be a
  `DELETE /api/admin/feature-flags/:id`, additive to this design.
- **Real-time push** to already-open tabs (websocket/poll) — not built. For Learning
  Representation this means a teacher mid-session won't see the flag flip until their
  next sign-in or session restore — the same "eventually consistent, not real-time"
  contract this codebase already documents for every env-var flag (`config.ts`'s G28
  comments). For Assistant Access this has no client-visible analog: the *next*
  `/catalog`/`/interpret`/`/events` call (there is no session-cached copy) is what
  respects the change, and that's immediate.
- Any setting beyond the two currently registered — the registry supports more, but
  only genuinely safe, already-existing configuration gets added; see the "safe
  settings" survey in the implementation plan for what was deliberately excluded
  (kill switches, numeric budgets, tenant allow-lists).

## 10. Adding a new runtime-configurable setting

**First: should this setting even be here?** Only expose configuration that already
exists as an env var, is genuinely safe to flip at runtime by a `super_admin`, and
fits one of the two existing types below. Kill switches, per-request budgets, and
tenant allow-lists are examples that were deliberately kept out (see §1). When in
doubt, don't add it — a smaller registry is easier to reason about than a large one.

Given a setting that qualifies, adding it is additive — no new route, no new migration
(unless its value genuinely doesn't fit `boolean` or `role_list`):

1. **Registry entry** — add one object to `ADMIN_SETTINGS_REGISTRY` in
   `server/src/lib/systemSettings.js`:
   ```js
   'attachments-enabled': {
     kind: 'feature_flag',            // or 'access_control' if it's a role_list
     type: 'boolean',                 // or 'role_list'
     settingKey: 'attachments_enabled',
     label: 'Attachments',
     description: 'Lets teachers attach an image or PDF to a Coach question.',
     envDefault: () => readAttachmentFlags(process.env).enabled,
     // validate: (value) => ...    // role_list settings need this; boolean settings don't
   },
   ```
   `settingKey` is the `SystemSetting.key` this override is stored under — make it
   unique and not already used by another entry.
2. **Type / validation** — reuse `boolean` or `role_list`; both already have
   serialize/deserialize and a fail-safe-to-default read path (`resolveSetting`, see
   §4). A genuinely new value shape (neither fits) would need a third `type` branch in
   `serializeValue`/`deserializeValue` and a matching zod schema in the route — that's
   real new work, not the common case.
3. **Env fallback** — nothing to write: `envDefault` just calls the existing
   `lib/flags.js` reader for that variable. The env var's own behavior is completely
   unchanged by adding a registry entry for it.
4. **DB override** — nothing to write: `resolveSetting`/`setSetting` handle both types
   generically already.
5. **API handling** — nothing to write for `GET`; it already iterates the registry.
   For `PATCH`, `bodySchemaFor(type)` in `server/src/routes/adminSettings.js` already
   has a case for `boolean` (`{ enabled }`) and `role_list` (`{ roles }`) — add a new
   `if` branch only if you introduced a third `type`.
6. **Admin UI** — in `client/src/pages/AdminSettingsPage.tsx`, the existing
   `kind === 'feature_flag'` / `kind === 'access_control'` sections already render any
   registry entry of that kind generically. A `boolean` entry needs **no client
   changes at all**; a `role_list` entry needs `client/src/types.ts`'s
   `AdminFeatureFlag` shape to already have `roles?` (it does, shared by all
   role_list settings). Only a genuinely new `type` would need a new UI section.
7. **Server-side enforcement** (`access_control` settings only) — find the one place
   that currently checks the env-derived value directly (e.g.
   `flags.allowedRoles.includes(user.role)`) and change it to call
   `resolveRoleListSetting(YOUR_SETTING_KEY, flags.allowedRoles)` first, keeping
   `flags.*` as the fallback — the exact edit `routes/assistant.js`'s `isWithinRollout`
   already makes (see §5). **A `feature_flag` boolean must get the equivalent
   one-line change** wherever its env flag is currently read (see
   `routes/learningRepresentation.js`'s `isWithinRollout` for the boolean version) —
   adding a registry entry alone does not wire up enforcement by itself.
8. **Tests** — add to `server/test/lib/systemSettings.test.js` (or extend the existing
   describe blocks): DB override wins, no-row falls back to env, a DB error falls back
   to env, and — for `role_list` — that an empty override is accepted and means "deny
   all" (never "no restriction"). Add to `server/test/routes/adminSettings.test.js`:
   RBAC (403 for every non-`super_admin` role, 401 unauthenticated), a successful
   `PATCH` persists and is reflected by the next `GET`, invalid input is rejected, and
   the `Event` audit row has the right `key`/value. If you added server-side
   enforcement in step 7, add a precedence test at the enforcement point itself
   (mirrors `assistant.catalog.test.js`'s "AI Access override precedence" block) —
   proving the override actually changes real request behavior, not just what the
   admin API reports.
9. **Audit** — nothing to write: `PATCH /api/admin/feature-flags/:id` already writes
   an `Event` row (`type: 'feature_flag_updated'`) for every registered setting.

That's the whole checklist — for a `boolean` feature flag with an existing env
reader, steps 1, 7, and 8 are the only ones that require writing new code; the rest is
already generic.
