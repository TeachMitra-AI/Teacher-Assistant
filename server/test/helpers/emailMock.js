// Stubs the global `fetch` that lib/email.js calls, so the password-reset flow can be driven end to end without
// sending mail. Same approach as helpers/geminiMock.js. Because the mock captures the payload, a test can pull the raw
// reset token from the email link, the only place it exists in the clear (the database stores its hash).
// `vi` is a real global here, not require()'d; see geminiMock.js.

/**
 * @param {{failWith?: number, reject?: Error}} [options]
 *   `failWith` makes the provider answer with that HTTP status; `reject` makes the fetch itself throw (network error / timeout).
 * @returns {{ mock: import('vitest').Mock, sent: Array<{to: string, subject: string, html: string, text: string}> }}
 */
function mockEmailFetch(options = {}) {
  const sent = [];
  const mock = vi.fn(async (url, opts) => {
    // Brevo's payload shape is flattened to provider-neutral fields, so swapping providers only touches this helper.
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    const recipient = Array.isArray(body.to) ? body.to[0] : body.to;
    sent.push({
      url,
      to: recipient && typeof recipient === 'object' ? recipient.email : recipient,
      from: body.sender ? body.sender.email : body.from,
      subject: body.subject,
      html: body.htmlContent || body.html || '',
      text: body.textContent || body.text || '',
      apiKey: opts?.headers?.['api-key'],
    });

    if (options.reject) throw options.reject;
    const status = options.failWith || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ id: 'test-email-id' }),
      text: async () => 'ok',
    };
  });
  vi.stubGlobal('fetch', mock);
  return { mock, sent };
}

/**
 * Pulls the raw reset token out of a sent email's reset link.
 * @param {{text: string, html: string}} email an entry from `sent`
 * @returns {string} the raw token
 */
function extractResetToken(email) {
  const match = `${email.text}\n${email.html}`.match(/\/reset-password\/([A-Za-z0-9_%-]+)/);
  if (!match) {
    throw new Error('No reset-password link found in the sent email.');
  }
  return decodeURIComponent(match[1]);
}

module.exports = { mockEmailFetch, extractResetToken };
