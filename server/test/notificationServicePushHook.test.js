// Phase 7b — the push-dispatch hook createNotification()/createBroadcast()
// added inside notificationService.js. Spies on pushService.dispatchPush
// (accessed as `pushService.dispatchPush(...)`, never destructured, in
// notificationService.js — see that file's require() comment) rather than
// mocking the 'expo-server-sdk' module: this matches the DI-flavored style
// the rest of this file's tests already use for socketServer, and needs no
// module-mocking machinery for an ESM-only dependency.
const { prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { createNotification, createBroadcast } = require('../src/lib/notificationService');
const pushService = require('../src/lib/pushService');

describe('notificationService push-dispatch hook', () => {
  let fx;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'notifpush');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('createNotification() calls dispatchPush with the recipient and the created row, and the write still succeeds even if dispatchPush rejects', async () => {
    const spy = vi.spyOn(pushService, 'dispatchPush').mockRejectedValue(new Error('boom'));

    // Belt-and-suspenders: pushService.dispatchPush() already contracts to
    // never reject (pushService.test.js covers that), but createNotification()
    // wraps the call in its own try/catch anyway, same as it already does for
    // the socketServer emit — so even a broken contract can never turn into a
    // lost write here.
    const row = await createNotification({
      recipientId: fx.teacherA.id,
      type: 'reminder',
      title: 'Push hook check',
      message: 'hello',
      link: '/library/xyz',
    });

    expect(row.id).toBeTruthy();
    const persisted = await prisma.notification.findUnique({ where: { id: row.id } });
    expect(persisted).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(1);
    const [recipientIds, payload] = spy.mock.calls[0];
    expect(recipientIds).toEqual([fx.teacherA.id]);
    expect(payload).toMatchObject({ title: 'Push hook check', message: 'hello', link: '/library/xyz' });
  });

  test('createBroadcast() calls dispatchPush once with every resolved recipient and the shared title/message/link', async () => {
    const spy = vi.spyOn(pushService, 'dispatchPush').mockResolvedValue(undefined);

    const { recipientCount } = await createBroadcast({
      sender: { id: fx.schoolAdminA.id, role: 'school_admin', schoolId: fx.schoolA.id },
      senderName: 'School Admin A',
      senderRole: 'school_admin',
      target: { scope: 'users', userIds: [fx.teacherA.id, fx.teacherA2.id] },
      type: 'announcement',
      title: 'Broadcast push check',
      message: 'hi all',
      link: null,
    });

    expect(recipientCount).toBe(2);
    expect(spy).toHaveBeenCalledTimes(1);
    const [recipientIds, payload] = spy.mock.calls[0];
    expect(new Set(recipientIds)).toEqual(new Set([fx.teacherA.id, fx.teacherA2.id]));
    expect(payload).toMatchObject({ title: 'Broadcast push check', message: 'hi all', link: null });
  });

  test('createBroadcast() with zero resolved recipients never calls dispatchPush', async () => {
    const spy = vi.spyOn(pushService, 'dispatchPush').mockResolvedValue(undefined);

    const { recipientCount } = await createBroadcast({
      sender: { id: fx.schoolAdminA.id, role: 'school_admin', schoolId: fx.schoolA.id },
      senderName: 'School Admin A',
      senderRole: 'school_admin',
      target: { scope: 'users', userIds: [] },
      type: 'announcement',
      title: 'Nobody',
      message: 'x',
      link: null,
    });

    expect(recipientCount).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
