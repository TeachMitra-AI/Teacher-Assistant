// Notification System — realtime delivery over Socket.IO.
//
// Supertest drives every OTHER test file in-process (no real listening
// socket — see src/index.js's own comment on this), but Socket.IO needs an
// actual TCP connection to test. This file wraps the SAME shared `app` in
// its own http.Server + Socket.IO instance, listens on an ephemeral port,
// and overwrites app.locals.socketServer for its duration — restored
// afterAll. Vitest gives each test file its own module registry (see
// vitest.config.js), so this never leaks into another file's run.
const http = require('http');
const { io: ioClient } = require('socket.io-client');
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { initSocketServer } = require('../src/lib/socketServer');

function waitForEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('Notification System — realtime delivery', () => {
  let fx;
  let teacherAToken;
  let schoolAdminAToken;
  let httpServer;
  let port;
  let originalSocketServer;
  let clientSockets = [];

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'notifrt');
    teacherAToken = await loginAs(app, fx.schoolA, fx.teacherA, fx.PASSWORD);
    schoolAdminAToken = await loginAs(app, fx.schoolA, fx.schoolAdminA, fx.PASSWORD);

    process.env.NOTIFICATIONS_ENABLED = 'true';

    originalSocketServer = app.locals.socketServer;
    httpServer = http.createServer(app);
    app.locals.socketServer = initSocketServer(httpServer, {
      isOriginAllowed: () => true,
      isEnabled: () => process.env.NOTIFICATIONS_ENABLED === 'true',
    });

    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  });

  afterEach(() => {
    for (const s of clientSockets) s.disconnect();
    clientSockets = [];
  });

  afterAll(async () => {
    delete process.env.NOTIFICATIONS_ENABLED;
    app.locals.socketServer = originalSocketServer;
    await new Promise((resolve) => httpServer.close(resolve));
  });

  function connect(token) {
    const socket = ioClient(`http://localhost:${port}`, {
      path: '/socket.io',
      auth: { token },
      reconnection: false,
      forceNew: true,
    });
    clientSockets.push(socket);
    return socket;
  }

  test('a valid token is accepted', async () => {
    const socket = connect(teacherAToken);
    await waitForEvent(socket, 'connect');
    expect(socket.connected).toBe(true);
  });

  test('a missing/invalid token is rejected', async () => {
    const socket = connect('not-a-real-token');
    const err = await waitForEvent(socket, 'connect_error');
    expect(err.message).toBeTruthy();
    expect(socket.connected).toBe(false);
  });

  test('a targeted send delivers notification:new exactly once to the recipient, with no delivery to a bystander', async () => {
    const recipientSocket = connect(teacherAToken);
    await waitForEvent(recipientSocket, 'connect');

    const bystanderSocket = connect(await loginAs(app, fx.schoolA, fx.teacherA2, fx.PASSWORD));
    await waitForEvent(bystanderSocket, 'connect');

    let bystanderReceived = false;
    bystanderSocket.on('notification:new', () => { bystanderReceived = true; });

    const eventPromise = waitForEvent(recipientSocket, 'notification:new');

    const res = await request(app)
      .post('/api/notifications')
      .set('Authorization', `Bearer ${schoolAdminAToken}`)
      .send({
        title: 'Realtime check',
        message: 'should arrive instantly',
        type: 'announcement',
        target: { scope: 'users', userIds: [fx.teacherA.id] },
      });
    expect(res.status).toBe(201);

    const payload = await eventPromise;
    expect(payload.title).toBe('Realtime check');
    expect(typeof payload.id).toBe('string');
    expect(payload.read).toBe(false);

    // Give the bystander a beat to (not) receive anything before asserting.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(bystanderReceived).toBe(false);
  });

  test('disabling NOTIFICATIONS_ENABLED rejects new handshakes without a restart', async () => {
    process.env.NOTIFICATIONS_ENABLED = 'false';
    try {
      const socket = connect(teacherAToken);
      const err = await waitForEvent(socket, 'connect_error');
      expect(err.message).toBeTruthy();
    } finally {
      process.env.NOTIFICATIONS_ENABLED = 'true';
    }
  });
});
