// Expo push dispatch — the OS-level-push half of Phase 7b
// (docs/mobile-app-plan.md §15, §26). Reached ONLY from
// notificationService.js's createNotification/createBroadcast choke point,
// as an ADDITION alongside the existing best-effort Socket.IO emit — never a
// replacement for it or for the REST notification list. Gated by
// MOBILE_PUSH_ENABLED (lib/flags.js); with it off this module makes zero
// network calls and reads no table.
//
// expo-server-sdk ships ESM-only (its package.json is "type": "module", with
// no CJS build) while this server is CommonJS throughout — a plain
// `require('expo-server-sdk')` would throw ERR_REQUIRE_ESM on any Node
// runtime older than the ~22.12 line that added synchronous require-of-ESM
// interop, which server/package.json's own "engines": { "node": ">=18" }
// does not guarantee. A cached dynamic import() sidesteps that: it has
// worked from CJS on every Node 18+ runtime since dynamic import() was
// introduced, so this module never assumes a specific Node minor version.
const { prisma } = require('./db');
const { readMobilePushFlags } = require('./flags');

let expoModulePromise = null;
function loadExpoModule() {
  if (!expoModulePromise) expoModulePromise = import('expo-server-sdk');
  return expoModulePromise;
}

let cachedClient = null;
async function getExpoClient() {
  const { Expo } = await loadExpoModule();
  if (!cachedClient) {
    // EXPO_ACCESS_TOKEN enables Expo's "Enhanced Push Security" (an
    // additional bearer credential on top of the project owning the push
    // tokens) — optional, matching every other optional credential in this
    // app's .env.example (e.g. GOOGLE_CLIENT_ID, BREVO_API_KEY): the feature
    // still works without it, just without that extra layer.
    cachedClient = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN || undefined });
  }
  return cachedClient;
}

/**
 * Sends one push message to every device the given recipients have
 * registered (DeviceToken rows), best-effort. NEVER THROWS — a push-delivery
 * failure must never affect the Notification write or the realtime Socket.IO
 * emit it accompanies (same non-blocking-side-channel contract that emit
 * already has, docs/mobile-app-plan.md §17).
 *
 * Any token Expo reports back as `DeviceNotRegistered` (the uninstalled-app /
 * revoked-permission case) is deleted from the DeviceToken table as part of
 * this call — the only cleanup this phase does; a token that merely goes
 * temporarily stale (app backgrounded, network down) is untouched, since
 * Expo itself queues and retries delivery on its side.
 *
 * @param {string[]} recipientIds
 * @param {{ id: string, title: string, message: string, link: string|null }} payload
 * @param {{ expoClient?: { sendPushNotificationsAsync: Function, chunkPushNotifications?: Function } }} [deps]
 *   Test-only seam: pass a fake Expo-shaped client to avoid the real network call.
 */
async function dispatchPush(recipientIds, payload, deps = {}) {
  if (!readMobilePushFlags(process.env).enabled) return;
  if (!Array.isArray(recipientIds) || recipientIds.length === 0) return;

  try {
    const tokens = await prisma.deviceToken.findMany({
      where: { userId: { in: recipientIds } },
    });
    if (tokens.length === 0) return;

    const { Expo } = await loadExpoModule();
    const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t.token));
    if (validTokens.length === 0) return;

    const messages = validTokens.map((t) => ({
      to: t.token,
      title: payload.title,
      body: payload.message,
      data: { notificationId: payload.id, link: payload.link || null },
    }));

    const client = deps.expoClient || (await getExpoClient());
    const chunks = client.chunkPushNotifications
      ? client.chunkPushNotifications(messages)
      : [messages];

    const invalidTokens = [];
    for (const chunk of chunks) {
      let tickets;
      try {
        tickets = await client.sendPushNotificationsAsync(chunk);
      } catch (err) {
        console.error('[push] expo_send_failed', { message: err.message });
        continue;
      }
      tickets.forEach((ticket, i) => {
        if (ticket.status === 'error' && ticket.details && ticket.details.error === 'DeviceNotRegistered') {
          invalidTokens.push(chunk[i].to);
        }
      });
    }

    if (invalidTokens.length > 0) {
      await prisma.deviceToken.deleteMany({ where: { token: { in: invalidTokens } } });
    }
  } catch (err) {
    console.error('[push] dispatch_failed', { message: err.message });
  }
}

module.exports = { dispatchPush, getExpoClient };
