// Ported from client/src/lib/runStatus.test.ts (Vitest -> Jest syntax only;
// the assertions are identical since the logic under test is a byte-for-byte
// port — see ../runStatus.ts's header comment).
import { formatElapsed, waitingMessage } from '../runStatus';

describe('formatElapsed', () => {
  it('counts seconds, zero-padded', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(7_000)).toBe('0:07');
    expect(formatElapsed(59_000)).toBe('0:59');
  });

  it('rolls over into minutes', () => {
    expect(formatElapsed(60_000)).toBe('1:00');
    expect(formatElapsed(63_400)).toBe('1:03');
    expect(formatElapsed(605_000)).toBe('10:05');
  });

  it('floors part-seconds rather than rounding up', () => {
    expect(formatElapsed(999)).toBe('0:00');
  });

  it('never renders a negative time', () => {
    expect(formatElapsed(-5_000)).toBe('0:00');
  });
});

describe('waitingMessage', () => {
  it('opens with the line this app has always shown', () => {
    expect(waitingMessage(0)).toBe('Preparing practical advice for you…');
    expect(waitingMessage(9_999)).toBe('Preparing practical advice for you…');
  });

  it('acknowledges the wait at ten seconds', () => {
    expect(waitingMessage(10_000)).toContain('Still working');
  });

  it('says so plainly once it is genuinely slow', () => {
    expect(waitingMessage(25_000)).toContain('longer than usual');
    expect(waitingMessage(120_000)).toContain('longer than usual');
  });

  it('changes at most twice, so the live region is not noisy', () => {
    const seen = new Set<string>();
    for (let ms = 0; ms <= 120_000; ms += 500) seen.add(waitingMessage(ms));
    expect(seen.size).toBe(3);
  });
});
