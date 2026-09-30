// Transactional email (password resets and demo bookings) through Brevo: one authenticated POST, no SMTP setup.
// Brevo verifies a single sender address, whereas Resend needs a verified domain. The wrapper is thin so swapping
// providers means changing one fetch call.
// Never logs an email body, reset URL or token; recipients are logged only as a domain (see redactEmail).
// A missing BREVO_API_KEY isn't fatal at boot: sends degrade to a logged no-op so the rest of the app keeps running.

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
 * Sends one transactional email. Never throws, so a provider outage can't become a 500.
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
 * The password-reset email. `token` is the raw token, only ever embedded in the link, never logged or stored.
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

/**
 * Confirmation sent to the visitor who booked a Schedule a Call slot.
 * @param {{to: string, name: string, dateLabel: string, timeLabel: string, durationMinutes: number, manageUrl: string, icsUrl: string}} params
 */
async function sendDemoBookingConfirmation({ to, name, dateLabel, timeLabel, durationMinutes, manageUrl, icsUrl }) {
  const greeting = name ? `Hi ${name},` : 'Hi,';

  const text = [
    greeting,
    '',
    `You're booked for a ${durationMinutes}-minute call with the SarasTech team.`,
    '',
    `Date: ${dateLabel}`,
    `Time: ${timeLabel}`,
    '',
    `Add it to your calendar: ${icsUrl}`,
    `Need to reschedule or cancel? ${manageUrl}`,
  ].join('\n');

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; font-size: 16px; line-height: 1.5; color: #1f2937;">
      <p>${greeting}</p>
      <p>You're booked for a <strong>${durationMinutes}-minute call</strong> with the SarasTech team.</p>
      <p><strong>Date:</strong> ${dateLabel}<br /><strong>Time:</strong> ${timeLabel}</p>
      <p>
        <a href="${icsUrl}" style="display: inline-block; padding: 12px 20px; background: #ff6b35; color: #ffffff; border-radius: 8px; text-decoration: none;">
          Add to calendar
        </a>
      </p>
      <p style="color: #6b7280; font-size: 14px;">
        Need to make a change? <a href="${manageUrl}">Reschedule or cancel</a>.
      </p>
    </div>
  `.trim();

  return sendEmail({ to, subject: "You're booked: a call with SarasTech", html, text });
}

/**
 * Internal notification to the team about a new demo booking. A no-op if DEMO_BOOKING_ADMIN_EMAIL isn't set.
 * @param {{adminEmail: string|null, name: string, email: string, organization: string, role: string, phone?: string, notes?: string, dateLabel: string, timeLabel: string}} params
 */
async function sendDemoBookingAdminAlert({ adminEmail, name, email, organization, role, phone, notes, dateLabel, timeLabel }) {
  if (!adminEmail) {
    logEmailEvent('warn', 'demo_booking_alert_skipped_not_configured', {});
    return { sent: false, reason: 'not_configured' };
  }

  const lines = [
    `New demo call booked for ${dateLabel} at ${timeLabel}.`,
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    `Organization: ${organization}`,
    `Role: ${role}`,
  ];
  if (phone) lines.push(`Phone: ${phone}`);
  if (notes) lines.push('', `What they're looking to solve: ${notes}`);

  return sendEmail({
    to: adminEmail,
    subject: `New Schedule a Call booking — ${dateLabel} ${timeLabel}`,
    html: `<pre style="font-family: system-ui, sans-serif; white-space: pre-wrap;">${lines.join('\n')}</pre>`,
    text: lines.join('\n'),
  });
}

module.exports = {
  sendEmail,
  sendPasswordResetEmail,
  sendDemoBookingConfirmation,
  sendDemoBookingAdminAlert,
  isEmailConfigured,
  redactEmail,
};
