// Decides whether a browser 'storage' event should make this tab resync its session with the shared auth token.
// localStorage is shared across tabs but each tab's `user` state (auth.tsx) is a snapshot, so a tab left open kept showing a
// stale identity and admin-only UI after another tab signed in as someone else, signed out or lost its session
// (docs/enterprise-exploratory-qa-report.md).
// The 'storage' event fires only in other same-origin tabs, never the one that wrote, so reacting to it can't loop.
// A pure function so the client's logic-only test runner covers it; auth.tsx itself is covered by manual QA.
export function shouldResyncAuthOnStorageEvent(key: string | null, tokenStorageKey: string): boolean {
  // key === null means localStorage.clear(); the event can't say whether the token survived, so resync.
  if (key === null) return true;

  // Only the access-token key means identity may have changed. setSession() writes or removes both tokens together, so a
  // sign-in/out produces a pair of events; keying off this one de-dupes to a single resync and ignores unrelated keys
  // (theme, fontScale, a lone refresh_token).
  return key === tokenStorageKey;
}
