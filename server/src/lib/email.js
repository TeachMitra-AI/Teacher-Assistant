// Transactional email, used only for password resets today.
//
// Brevo is the provider: one authenticated POST, no SMTP configuration. It was
// chosen over Resend because Brevo verifies a single sender ADDRESS, while
// Resend can only send to arbitrary recipients from a verified DOMAIN — which
// would have meant buying one. The wrapper is deliberately thin — the same
// shape as the other single-purpose modules in this folder — so swapping
// providers again means changing one fetch call, not every caller.
//
// Privacy: this module NEVER logs an email body, a reset URL, or a reset
// token, matching the metadata-only discipline logAiEvent follows in
// index.js. Recipient addresses are logged only as a domain (see redactEmail),
// so an operator can still tell "all our @gmail.com sends are bouncing"
// without the logs becoming a list of teachers' addresses.
//
// Unlike GEMINI_API_KEY and JWT_SECRET, a missing BREVO_API_KEY is NOT fatal
// at boot: password reset is one feature, and the rest of the app must keep
// running without it. Sends degrade to a logged no-op instead.

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const SEND_TIMEOUT_MS = 10000;

function config() {
  return {
    apiKey: process.env.BREVO_API_KEY,
    from: process.env.EMAIL_FROM || 'Teacher Assistant <no-reply@example.com>',
    appUrl: (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, ''),
  };
}

// EMAIL_FROM stays in the familiar `Name <address>` form, but Brevo wants the
// two parts separately. A bare address (no angle brackets) is accepted too.
function parseSender(from) {
  const match = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(from);
  if (match) return { name: match[1] || 'Teacher Assistant', email: match[2] };
  return { name: 'Teacher Assistant', email: String(from).trim() };
}

function isEmailConfigured() {
  return Boolean(config().apiKey);
}

// Keeps the domain (useful for diagnosing provider/deliverability problems)
// and drops the local part (the part that identifies a person).
function redactEmail(address) {
  const at = String(address || '').lastIndexOf('@');
  return at === -1 ? 'unknown' : `***@${String(address).slice(at + 1)}`;
}

function logEmailEvent(level, event, meta = {}) {
  const fn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
  fn(`[email] ${event}`, meta);
}

/**
 * Sends one transactional email. Never throws: a provider outage must not turn
 * into a 500 on an endpoint whose response is deliberately generic anyway.
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function sendEmail({ to, subject, html, text }) {
  const { apiKey, from } = config();
  if (!apiKey) {
    logEmailEvent('warn', 'send_skipped_not_configured', { to: redactEmail(to) });
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        // Brevo authenticates with a plain `api-key` header, not Bearer.
        'api-key': apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: parseSender(from),
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Status only — the provider's error body can echo the payload back.
      logEmailEvent('error', 'send_failed', { to: redactEmail(to), status: response.status });
      return { sent: false, reason: `provider_${response.status}` };
    }

    logEmailEvent('info', 'send_succeeded', { to: redactEmail(to) });
    return { sent: true };
  } catch (error) {
    logEmailEvent('error', 'send_error', { to: redactEmail(to), name: error.name });
    return { sent: false, reason: 'network_error' };
  }
}

/**
 * The password-reset email. `token` is the raw (unhashed) token — only ever
 * embedded in the link, never logged or persisted in the clear.
 * @param {{to: string, token: string, name?: string, schoolName?: string, expiresInMinutes: number}} params
 */
async function sendPasswordResetEmail({ to, token, name, schoolName, expiresInMinutes }) {
  const { appUrl } = config();
  const resetUrl = `${appUrl}/reset-password/${encodeURIComponent(token)}`;
  const greeting = name ? `Hello ${name},` : 'Hello,';
  // Named only when the address holds accounts at more than one school, so the
  // teacher can tell the two reset emails apart.
  const which = schoolName ? ` for your account at ${schoolName}` : '';

  const text = [
    greeting,
    '',
    `We received a request to reset your SarasTech password${which}.`,
    '',
    `Open this link to choose a new password (it expires in ${expiresInMinutes} minutes):`,
    resetUrl,
    '',
    "If you didn't ask for this, you can safely ignore this email — your password stays unchanged.",
  ].join('\n');

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; font-size: 16px; line-height: 1.5; color: #1f2937;">
      <p>${greeting}</p>
      <p>We received a request to reset your <strong>SarasTech</strong> password${which}.</p>
      <p>
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 20px; background: #2563eb; color: #ffffff; border-radius: 8px; text-decoration: none;">
          Choose a new password
        </a>
      </p>
      <p style="color: #6b7280; font-size: 14px;">This link expires in ${expiresInMinutes} minutes.</p>
      <p style="color: #6b7280; font-size: 14px;">
        If you didn't ask for this, you can safely ignore this email — your password stays unchanged.
      </p>
    </div>
  `.trim();

  return sendEmail({
    to,
    subject: 'Reset your SarasTech password',
    html,
    text,
  });
}

module.exports = { sendEmail, sendPasswordResetEmail, isEmailConfigured, redactEmail };
