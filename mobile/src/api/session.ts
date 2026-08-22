// Native equivalent of client/src/api.ts's getToken/getRefreshToken/setSession
// (localStorage-backed on web). Verified during implementation
// (docs/mobile-app-plan.md §16, §29 open question resolved here): the plan
// assumed these could keep an identical *synchronous* signature.
// expo-secure-store does expose a synchronous getItem/setItem, but has no
// synchronous delete — only deleteItemAsync — and setSession's clear-on-logout
// path needs exactly that. Rather than mixing sync reads with async deletes
// (a real source of bugs — a caller could read a stale value mid-clear), every
// function here is async and awaited at every call site. This is a strict
// upgrade in correctness over the web version, at the (unavoidable) cost of
// call sites needing `await`.
import * as SecureStore from 'expo-secure-store';

export const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

// Access token and refresh token are always set/cleared together — mirrors
// client/src/api.ts's own invariant comment.
export async function setSession(token: string | null, refreshToken: string | null): Promise<void> {
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);

  if (refreshToken) await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
  else await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}
