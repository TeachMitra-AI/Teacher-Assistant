// Logs in as a fixture user via the real HTTP endpoint (not by importing
// internal signing functions) so tests exercise the actual auth path.
//
// Sign-in itself needs only an email + password — no school code. The
// fixture's schoolId is still sent as the explicit disambiguator so this
// helper stays deterministic even if a future fixture reuses one email across
// two schools (the case that otherwise returns needsSchoolSelection).
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
