// Regression: an oversized JSON body (over express.json()'s limit — 16kb normally, 64kb for /resources and the
// classroom-artifacts route, see src/index.js) throws body-parser's own PayloadTooLargeError, not a SyntaxError.
// Before this fix the global error middleware didn't recognize it and flattened it to a generic 500 "Something went
// wrong on our end", which misleads whoever sent the oversized request into thinking it's a server bug.
const request = require('supertest');

const { app } = require('./helpers/testApp');

describe('oversized request body', () => {
  test('over the 16kb limit gets 413 with a clear message, not a generic 500', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'a@b.com', password: 'x', padding: 'a'.repeat(20 * 1024) });

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Your request is too large. Please shorten it and try again.' });
  });
});
