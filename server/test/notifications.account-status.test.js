// Suspending a teacher ends their realtime connections as well as their REST access: an open socket is disconnected, and a
// new handshake with the old token is refused. Same in-process setup as notifications.realtime.test.js.
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

describe('suspension and realtime connections', () => {
  let fx;
  let adminToken;
  let httpServer;
  let port;
  let originalSocketServer;
  const openSockets = [];

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'notifsus');
    adminToken = await loginAs(app, fx.schoolA, fx.schoolAdminA, fx.PASSWORD);

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
    for (const s of openSockets) s.disconnect();
    openSockets.length = 0;
  });

  afterAll(async () => {
    delete process.env.NOTIFICATIONS_ENABLED;
    app.locals.socketServer = originalSocketServer;
    await new Promise((resolve) => httpServer.close(resolve));
  });

  function connect(token) {
    const socket = ioClient(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'], forceNew: true });
    openSockets.push(socket);
    return socket;
  }

  test('suspending a teacher disconnects their open socket', async () => {
    const teacher = fx.teacherA;
    const token = await loginAs(app, fx.schoolA, teacher, fx.PASSWORD);
    const socket = connect(token);
    await waitForEvent(socket, 'connect');

    const disconnected = waitForEvent(socket, 'disconnect');
    const res = await request(app)
      .patch(`/api/admin/users/${teacher.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    await disconnected;
    expect(socket.connected).toBe(false);
  });

  test('a suspended teacher cannot open a new realtime connection with the token they already had', async () => {
    const teacher = await prisma.user.findFirst({ where: { email: fx.teacherA2.email, schoolId: fx.schoolA.id } });
    const token = await loginAs(app, fx.schoolA, teacher, fx.PASSWORD);
    await request(app).patch(`/api/admin/users/${teacher.id}/suspend`).set('Authorization', `Bearer ${adminToken}`);

    const socket = connect(token);
    const error = await waitForEvent(socket, 'connect_error');
    expect(error.message).toMatch(/no longer active/i);
  });
});
