// Google ID token verification.
//
// The browser sends us the ID token it got from Google; this module checks the
// signature and the audience server-side and returns only claims Google
// vouched for. A client-asserted email, name or subject is never trusted —
// that would let anyone sign in as anyone by posting a hand-written JSON body.
//
// Kept in its own module (rather than inline in routes/auth.js) so the route
// stays about auth policy and this stays about token validation, matching how
// the other lib/ modules are scoped.
//
// The split between identityFromPayload (pure) and verifyGoogleIdToken (does
// the network call) is deliberate: all the claim rules live in a function that
// needs no Google account and no network to exercise.
const { OAuth2Client } = require('google-auth-library');

// Constructed lazily and reused: OAuth2Client caches Google's signing
// certificates internally, so one instance avoids re-fetching them per login.
let client = null;
function getClient() {
  if (!client) client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  return client;
}

// Google sign-in is optional. Without a client ID there is no audience to
// verify against, so the feature is simply switched off rather than being
// allowed to accept unverifiable tokens.
function isGoogleAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID);
}

/**
 * Applies our own requirements to an already-signature-verified token payload.
 * Throws if anything we depend on is missing or untrustworthy.
 * @param {object|undefined} payload the result of ticket.getPayload()
 * @returns {{sub: string, email: string, name: string|null}}
 */
function identityFromPayload(payload) {
  if (!payload) throw new Error('Google ID token carried no payload.');
  if (!payload.sub) throw new Error('Google ID token carried no subject.');
  if (!payload.email) throw new Error('Google ID token carried no email address.');
  // Google sets this false for addresses it hasn't confirmed. Treating such a
  // token as proof of the address would let someone claim an email they don't
  // control — and here the email IS the account identity.
  if (payload.email_verified === false) {
    throw new Error('Google has not verified this email address.');
  }

  return {
    // Stable per Google account and never reassigned — unlike the email
    // address, which a Workspace admin can move to a different person.
    sub: String(payload.sub),
    email: String(payload.email).trim().toLowerCase(),
    name: payload.name ? String(payload.name).trim().slice(0, 60) : null,
  };
}

/**
 * Verifies a Google ID token and returns the identity it proves.
 * Throws if the token is invalid, expired, minted for a different audience, or
 * missing anything we require.
 * @param {string} idToken
 * @returns {Promise<{sub: string, email: string, name: string|null}>}
 */
async function verifyGoogleIdToken(idToken) {
  // `audience` is what stops a token issued for some other Google app from
  // being replayed here.
  const ticket = await getClient().verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  return identityFromPayload(ticket.getPayload());
}

module.exports = { verifyGoogleIdToken, identityFromPayload, isGoogleAuthConfigured };
