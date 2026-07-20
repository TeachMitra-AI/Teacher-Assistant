// Logs in as a fixture user via the real HTTP endpoint (not by importing
// internal signing functions) so tests exercise the actual auth path.
const request = require('supertest');

async function loginAs(app, school, user, pin) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ schoolCode: school.code, name: user.name, pin });
  if (res.status !== 200) {
    throw new Error(`loginAs(${user.name}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

module.exports = { loginAs };
