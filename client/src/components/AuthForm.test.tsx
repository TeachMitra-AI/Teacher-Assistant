import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AuthForm from './AuthForm';

const loginMock = vi.fn();

vi.mock('../auth', () => ({
  useAuth: () => ({
    login: loginMock,
    register: vi.fn(),
    loginWithGoogle: vi.fn(),
  }),
}));

// Google's button is not under test here, and it isn't rendered without a client ID anyway.
vi.mock('@react-oauth/google', () => ({ GoogleLogin: () => null }));

// The tab switch and the submit button share the name 'Sign in', so the submit control is found by its type.
function submitButton() {
  return document.querySelector('button[type="submit"]') as HTMLElement;
}

function renderForm() {
  return render(
    <MemoryRouter>
      <AuthForm theme="light" initialMode="login" />
    </MemoryRouter>
  );
}

describe('AuthForm sign-in submission', () => {
  beforeAll(() => {
    // jsdom has no ResizeObserver; AuthForm uses one to size the Google button.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });

  beforeEach(() => {
    loginMock.mockReset();
  });

  it('a rapid double-click sends exactly one sign-in request', async () => {
    // A slow response keeps the first request in flight while the second click lands.
    let finish!: () => void;
    loginMock.mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve({ kind: 'signed_in' });
    }));
    renderForm();

    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'teacher@example.com');
    await userEvent.type(screen.getByPlaceholderText('Your password'), 'correct-horse-battery');

    // Two clicks in the same task, before React re-renders the button as disabled. That is the window a fast double-click or a
    // duplicated event falls into, and it's where the guard earns its keep.
    const button = submitButton();
    act(() => {
      button.click();
      button.click();
    });

    expect(loginMock).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(1));
  });

  it('a second submit is accepted again once the first has finished', async () => {
    loginMock.mockResolvedValue({ kind: 'signed_in' });
    renderForm();

    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'teacher@example.com');
    await userEvent.type(screen.getByPlaceholderText('Your password'), 'correct-horse-battery');
    await userEvent.click(submitButton());
    await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(1));

    await userEvent.click(submitButton());
    await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(2));
  });
});
