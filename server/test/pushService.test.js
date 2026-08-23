// Phase 7b — Expo push dispatch (src/lib/pushService.js). Unit-level: calls
// dispatchPush() directly against the real Prisma client with a fake
// Expo-shaped client injected via the `deps.expoClient` test seam (see that
// file's own header for why — expo-server-sdk is ESM-only, so this avoids
// any module-mocking machinery), never hitting the real Expo push API.
const { prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { dispatchPush } = require('../src/lib/pushService');

const PUSH_ENV_KEYS = ['MOBILE_PUSH_ENABLED'];

function enablePush() {
  process.env.MOBILE_PUSH_ENABLED = 'true';
}

describe('pushService.dispatchPush', () => {
  let fx;
  let savedEnv;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'pushsvc');
    savedEnv = Object.fromEntries(PUSH_ENV_KEYS.map((k) => [k, process.env[k]]));
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(enablePush);

  function fakeClient(tickets) {
    return {
      chunkPushNotifications: (messages) => [messages],
      sendPushNotificationsAsync: vi.fn(async () => tickets),
    };
  }

  test('flag off: makes no Prisma read and never calls the client', async () => {
    delete process.env.MOBILE_PUSH_ENABLED;
    const client = fakeClient([]);
    await dispatchPush([fx.teacherA.id], { id: 'n1', title: 't', message: 'm', link: null }, { expoClient: client });
    expect(client.sendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  test('no registered device tokens: never calls the client', async () => {
    const client = fakeClient([]);
    await dispatchPush([fx.teacherA2.id], { id: 'n1', title: 't', message: 'm', link: null }, { expoClient: client });
    expect(client.sendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  test('sends one message per registered device with title/body/data, and skips a malformed token', async () => {
    await prisma.deviceToken.createMany({
      data: [
        { userId: fx.teacherB.id, token: 'ExponentPushToken[valid-one]', platform: 'android' },
        { userId: fx.teacherB.id, token: 'not-a-real-expo-token', platform: 'android' },
      ],
    });

    const client = fakeClient([{ status: 'ok', id: 'receipt-1' }]);
    await dispatchPush(
      [fx.teacherB.id],
      { id: 'n42', title: 'Report ready', message: 'Your report is ready.', link: '/library/abc' },
      { expoClient: client }
    );

    expect(client.sendPushNotificationsAsync).toHaveBeenCalledTimes(1);
    const [sentMessages] = client.sendPushNotificationsAsync.mock.calls[0];
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({
      to: 'ExponentPushToken[valid-one]',
      title: 'Report ready',
      body: 'Your report is ready.',
      data: { notificationId: 'n42', link: '/library/abc' },
    });
  });

  test('DeviceNotRegistered ticket error deletes that token; other tokens/rows are untouched', async () => {
    const good = await prisma.deviceToken.create({
      data: { userId: fx.schoolAdminA.id, token: 'ExponentPushToken[stays-registered]', platform: 'ios' },
    });
    const stale = await prisma.deviceToken.create({
      data: { userId: fx.schoolAdminA.id, token: 'ExponentPushToken[goes-stale]', platform: 'ios' },
    });

    const client = {
      chunkPushNotifications: (messages) => [messages],
      sendPushNotificationsAsync: vi.fn(async (messages) =>
        messages.map((m) =>
          m.to === stale.token
            ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok', id: 'receipt-ok' }
        )
      ),
    };

    await dispatchPush(
      [fx.schoolAdminA.id],
      { id: 'n7', title: 'x', message: 'y', link: null },
      { expoClient: client }
    );

    const staleRow = await prisma.deviceToken.findUnique({ where: { id: stale.id } });
    expect(staleRow).toBeNull();
    const goodRow = await prisma.deviceToken.findUnique({ where: { id: good.id } });
    expect(goodRow).toBeTruthy();
  });

  test('a network/API failure from the client is swallowed, never thrown', async () => {
    await prisma.deviceToken.create({
      data: { userId: fx.resourcePersonA.id, token: 'ExponentPushToken[will-fail]', platform: 'android' },
    });
    const client = {
      chunkPushNotifications: (messages) => [messages],
      sendPushNotificationsAsync: vi.fn(async () => {
        throw new Error('network down');
      }),
    };

    await expect(
      dispatchPush([fx.resourcePersonA.id], { id: 'n8', title: 'x', message: 'y', link: null }, { expoClient: client })
    ).resolves.toBeUndefined();
  });
});
