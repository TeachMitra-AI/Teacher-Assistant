// Google ID token verification. The browser sends the ID token; this checks the signature and audience
// server-side and returns only claims Google vouched for. A client-asserted email, name or subject is never
// trusted, or anyone could sign in as anyone.
// Separate from routes/auth.js so the route stays about policy. identityFromPayload (pure) holds the claim rules
// and verifyGoogleIdToken makes the network call, so the rules can be tested without Google.
const { OAuth2Client } = require('google-auth-library');

// Constructed lazily and reused: OAuth2Client caches Google's signing
// certificates internally, so one instance avoids re-fetching them per login.
let client = null;
function getClient() {
  if (!client) client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  return client;
}

// Google sign-in is optional. With no client ID there's no audience to verify against, so the feature is off
// rather than accepting unverifiable tokens.
function isGoogleAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID);
}

/**
 * Applies our requirements to an already signature-verified payload; throws if anything we depend on is missing or untrustworthy.
 * @param {object|undefined} payload the result of ticket.getPayload()
 * @returns {{sub: string, email: string, name: string|null}}
 */
function identityFromPayload(payload) {
  if (!payload) throw new Error('Google ID token carried no payload.');
  if (!payload.sub) throw new Error('Google ID token carried no subject.');
  if (!payload.email) throw new Error('Google ID token carried no email address.');
  // Google sets this false for unconfirmed addresses. Trusting one would let someone claim an email they don't
  // control, and the email is the account identity.
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
 * Verifies a Google ID token and returns the identity it proves. Throws if the token is invalid, expired,
 * for a different audience, or missing anything we require.
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
