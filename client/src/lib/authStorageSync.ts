// Decides whether a browser 'storage' event should trigger this tab's
// session to resync with whatever the shared auth token now says.
//
// localStorage is shared per-origin across every open tab, but each tab's
// `user` state (auth.tsx) is only a snapshot taken at its own last sign-in
// or resync. Without this, a tab left open kept showing a stale signed-in
// identity — and stale admin-only UI — after a DIFFERENT tab signed in as
// someone else, signed out, or ended up with an invalid session. See
// docs/enterprise-exploratory-qa-report.md EQA-002 for the original finding.
//
// The 'storage' event is the platform's own answer to this: it fires in
// every OTHER same-origin tab whenever localStorage changes, but NEVER in
// the tab that made the write (a browser-guaranteed property, not something
// this code has to enforce) — so a tab reacting to it can never be reacting
// to its own change, which is what rules out a same-tab feedback loop.
//
// Extracted as its own pure function (rather than inlined in the event
// listener) so it's covered by this project's PURE-LOGIC-only client test
// runner (see vitest.config.ts) — auth.tsx itself, like the rest of this
// codebase's React components, is covered by manual QA, not
// component-rendering tests.
export function shouldResyncAuthOnStorageEvent(key: string | null, tokenStorageKey: string): boolean {
  // key === null means localStorage.clear() was called. There's no way to
  // tell from the event alone whether the token key survived that, so treat
  // it the same as "the token may have changed" and resync.
  if (key === null) return true;

  // Only the access-token key itself means identity may have changed.
  // setSession() (api.ts) always writes or removes the access token
  // alongside the refresh token in the same call, so a single sign-in/out
  // produces a *pair* of 'storage' events (one per key) — keying off just
  // this one field de-dupes that pair down to a single resync, and ignores
  // unrelated keys this app also keeps in localStorage (theme, fontScale,
  // refresh_token on its own).
  return key === tokenStorageKey;
}
