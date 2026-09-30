// Supertest wrapper that makes each request come from a different client IP. src/index.js rate-limits /api/auth to 30
// requests per 15 minutes per IP (req.ip, read from X-Forwarded-For because of `trust proxy: 1`), and the auth suites
// run well past 30 calls per file, so one shared IP would fail them with 429s unrelated to the behaviour under test.
// A synthetic address per request takes the per-IP limiter out of the picture, on purpose: these suites test what
// the endpoints do, not how often they may be called. A test of the limiter itself should pass a `fixedIp` so its requests share one bucket.
const request = require('supertest');

// Private-range (10.0.0.0/8) addresses, so they can never collide with
// anything real. Module-level, so two clients in one file don't overlap.
let counter = 0;
function nextIp() {
  counter += 1;
  return `10.${(counter >> 16) & 255}.${(counter >> 8) & 255}.${counter & 255}`;
}

/**
 * @param {import('express').Express} app
 * @param {string} [fixedIp] pin every request to one IP (share a rate-limit bucket) instead of one IP per request
 */
function makeClient(app, fixedIp) {
  const method = (verb) => (path) =>
    request(app)[verb](path).set('X-Forwarded-For', fixedIp || nextIp());
  return {
    get: method('get'),
    post: method('post'),
    patch: method('patch'),
    delete: method('delete'),
  };
}

module.exports = { makeClient };
