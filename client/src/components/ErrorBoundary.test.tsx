// Finding #7: the shared ErrorBoundary must support a custom `fallback` (for
// isolating one card/section instead of crashing the whole page) and a
// `resetKey` that clears a caught error once new data arrives — verified
// directly here, independent of any one call site.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

// CrashFallback (the default fallback) calls useHelpSupport(), which needs a
// full auth-backed provider chain in the real app — irrelevant to what this
// file tests (the boundary's own catch/fallback/reset contract), so stubbed.
vi.mock('./HelpSupport', () => ({ useHelpSupport: () => ({ openBugReport: vi.fn() }) }));

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('boom: malformed AI payload');
  return <p>Safe content</p>;
}

describe('ErrorBoundary', () => {
  test('with no custom fallback, still renders the default full-page crash screen (App.tsx root usage is unaffected)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    vi.mocked(console.error).mockRestore();
  });

  test('a custom fallback is shown instead of the default crash screen, and the raw error is never rendered', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<p className="lr-note">Could not display this content.</p>}>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Could not display this content.')).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    vi.mocked(console.error).mockRestore();
  });

  test('componentDidCatch logs only the error message, never the full error/stack', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<p>fallback</p>}>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    const appLog = errorSpy.mock.calls.find((call) => call[0] === '[app] uncaught_render_error');
    expect(appLog).toBeTruthy();
    expect(appLog?.[1]).toBe('boom: malformed AI payload');
    expect(typeof appLog?.[1]).toBe('string'); // never the Error object or its stack
    errorSpy.mockRestore();
  });

  test('a sibling boundary elsewhere on the page is unaffected by one that caught an error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <>
        <ErrorBoundary fallback={<p>card A failed</p>}>
          <Bomb shouldThrow />
        </ErrorBoundary>
        <ErrorBoundary fallback={<p>card B failed</p>}>
          <Bomb shouldThrow={false} />
        </ErrorBoundary>
      </>
    );
    expect(screen.getByText('card A failed')).toBeInTheDocument();
    expect(screen.getByText('Safe content')).toBeInTheDocument();
    expect(screen.queryByText('card B failed')).not.toBeInTheDocument();
    vi.mocked(console.error).mockRestore();
  });

  test('changing resetKey after a caught error clears it, letting new children render', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const dataV1 = { id: 1 };
    const dataV2 = { id: 2 };

    const { rerender } = render(
      <ErrorBoundary fallback={<p>Could not display this content.</p>} resetKey={dataV1}>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Could not display this content.')).toBeInTheDocument();

    // Same resetKey, still throwing — must NOT reset (proves it isn't reset
    // on every re-render, only on an actual identity change).
    rerender(
      <ErrorBoundary fallback={<p>Could not display this content.</p>} resetKey={dataV1}>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText('Could not display this content.')).toBeInTheDocument();

    // New data (new resetKey) + no longer throwing — the old error must not
    // permanently block this new, valid content.
    rerender(
      <ErrorBoundary fallback={<p>Could not display this content.</p>} resetKey={dataV2}>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Safe content')).toBeInTheDocument();
    expect(screen.queryByText('Could not display this content.')).not.toBeInTheDocument();
    vi.mocked(console.error).mockRestore();
  });
});
