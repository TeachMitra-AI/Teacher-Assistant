// Expo push dispatch (docs/mobile-app-plan.md), reached only from notificationService.js's createNotification and
// createBroadcast, alongside the Socket.IO emit and never instead of it or the REST list. With MOBILE_PUSH_ENABLED
// off (lib/flags.js) it makes no network calls and reads no table.
// expo-server-sdk is ESM-only and this server is CommonJS, so a plain `require` throws ERR_REQUIRE_ESM on Node before
// ~22.12, and package.json allows Node >=18. A cached dynamic import() works on every Node 18+.
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
    // EXPO_ACCESS_TOKEN enables Expo's Enhanced Push Security. Optional, like the other optional credentials in .env.example.
    cachedClient = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN || undefined });
  }
  return cachedClient;
}

/**
 * Sends one push message to every device the recipients have registered, best-effort. Never throws, so a
 * delivery failure can't affect the Notification write or the realtime emit.
 * Tokens Expo reports as `DeviceNotRegistered` (uninstalled app, revoked permission) are deleted from
 * DeviceToken; temporarily stale ones are left, since Expo retries on its side.
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
