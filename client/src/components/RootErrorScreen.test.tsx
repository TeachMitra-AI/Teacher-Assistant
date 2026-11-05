// The data router's errorElement must show a safe crash card (no stack, no error text) and must not need any provider, since it
// exists for errors thrown by the providers themselves.
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import RootErrorScreen from './RootErrorScreen';

// A data router builds a fetch `Request` on creation; under jsdom its AbortSignal is rejected by Node's Request. Test-only shim,
// same as ResourceWorkspace.test.tsx.
const NativeRequest = globalThis.Request;
beforeAll(() => {
  globalThis.Request = class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const { signal, ...rest } = init ?? {};
      super(input, rest);
      if (signal) Object.defineProperty(this, 'signal', { value: signal });
    }
  } as typeof Request;
});
afterAll(() => {
  globalThis.Request = NativeRequest;
});

function Bomb(): never {
  throw new Error('boom-secret-marker');
}

function renderBroken() {
  const router = createMemoryRouter([{ path: '*', element: <Bomb />, errorElement: <RootErrorScreen /> }], {
    initialEntries: ['/'],
  });
  return render(<RouterProvider router={router} />);
}

describe('RootErrorScreen', () => {
  test('a render error shows the crash card, never the error text, a stack, or react-router default screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = renderBroken();

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(container.textContent).not.toContain('boom-secret-marker');
    expect(container.textContent).not.toMatch(/\bat \S+ \(/);
    expect(screen.queryByText(/Unexpected Application Error/i)).not.toBeInTheDocument();
  });

  test('works with no provider at all, and logs only the error message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderBroken();

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith('[app] uncaught_render_error', 'boom-secret-marker');
    const ours = spy.mock.calls.filter((c) => c[0] === '[app] uncaught_render_error');
    expect(ours.every((c) => c.length === 2 && typeof c[1] === 'string')).toBe(true);
  });
});
