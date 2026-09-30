// Logs in as a fixture user through the real HTTP endpoint (not internal signing functions), so tests exercise the
// actual auth path. Sign-in needs only email and password; the fixture's schoolId is still sent as the explicit
// disambiguator so this stays deterministic if a fixture reuses one email across two schools.
const request = require('supertest');

async function loginAs(app, school, user, password) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password, schoolId: school.id });
  if (res.status !== 200) {
    throw new Error(`loginAs(${user.email}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token;
}

module.exports = { loginAs };
