// Stubs the global `fetch` that lib/email.js calls, so the password-reset
// flow can be driven end-to-end without sending real mail. Same approach as
// helpers/geminiMock.js, and for the same reason: no change to the module
// under test is needed for it to work.
//
// Because the mock captures the actual request payload, a test can pull the
// raw reset token straight out of the link in the email body — which is the
// only place it ever exists in the clear (the database stores just its hash).
//
// `vi` is used as a real global here rather than require()'d — see the note in
// geminiMock.js for why.

/**
 * @param {{failWith?: number, reject?: Error}} [options]
 *   `failWith` makes the provider answer with that HTTP status; `reject` makes
 *   the fetch itself throw (network error / timeout).
 * @returns {{ mock: import('vitest').Mock, sent: Array<{to: string, subject: string, html: string, text: string}> }}
 */
function mockEmailFetch(options = {}) {
  const sent = [];
  const mock = vi.fn(async (url, opts) => {
    // Brevo's payload shape (sender/to[].email/htmlContent/textContent) is
    // flattened here to the provider-neutral fields the tests assert on, so
    // swapping providers again only touches this helper, not every test.
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
