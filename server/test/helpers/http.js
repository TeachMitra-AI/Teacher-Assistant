// Supertest wrapper that makes each request look like it comes from a
// different client IP.
//
// src/index.js rate-limits /api/auth to 30 requests per 15 minutes PER IP,
// keyed off req.ip — which, because the app sets `trust proxy: 1` for Railway,
// is read from X-Forwarded-For. The auth suites exercise five endpoints
// (register, login, forgot/reset password, google) and run well past 30 calls
// per file, so sharing one IP would fail them with 429s that say nothing about
// the behaviour under test.
//
// Handing every request its own synthetic address takes the per-IP limiter out
// of the picture entirely. That's deliberate: these suites test what the auth
// endpoints DO, not how often they may be called. A test that wants to assert
// on the limiter itself should pass an explicit `fixedIp` so its requests
// share one bucket.
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
 * @param {string} [fixedIp] pin every request to one IP (share a rate-limit
 *   bucket) instead of the default one-IP-per-request behaviour
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
