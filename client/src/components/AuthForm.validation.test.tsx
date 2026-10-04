import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AuthForm from './AuthForm';

const loginMock = vi.fn();
const registerMock = vi.fn();

vi.mock('../auth', () => ({
  useAuth: () => ({
    login: loginMock,
    register: registerMock,
    loginWithGoogle: vi.fn(),
  }),
}));

vi.mock('@react-oauth/google', () => ({ GoogleLogin: () => null }));

function renderForm(initialMode: 'login' | 'register') {
  return render(
    <MemoryRouter>
      <AuthForm theme="light" initialMode={initialMode} />
    </MemoryRouter>
  );
}

function submitButton() {
  return document.querySelector('button[type="submit"]') as HTMLElement;
}

describe('AuthForm validation and outcomes', () => {
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });

  beforeEach(() => {
    loginMock.mockReset();
    registerMock.mockReset();
  });

  it('sign-in accepts a password shorter than today\'s 8-character minimum, because it may predate the rule', async () => {
    loginMock.mockResolvedValue({ kind: 'signed_in' });
    renderForm('login');

    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'teacher@example.com');
    await userEvent.type(screen.getByPlaceholderText('Your password'), 'abc123');
    await userEvent.click(submitButton());

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith({ email: 'teacher@example.com', password: 'abc123' }));
    expect(screen.queryByText(/at least 8 characters/i)).not.toBeInTheDocument();
  });

  it('sign-in still refuses a password longer than 72 characters, with a plain message', async () => {
    renderForm('login');

    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'teacher@example.com');
    await userEvent.type(screen.getByPlaceholderText('Your password'), 'x'.repeat(73));
    await userEvent.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent('Password must be at most 72 characters.');
    await userEvent.click(submitButton());
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('register requires at least 8 characters for a new password', async () => {
    renderForm('register');

    await userEvent.type(screen.getByPlaceholderText('Full name'), 'New Teacher');
    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'new@example.com');
    await userEvent.type(screen.getByPlaceholderText('At least 8 characters'), 'short77');
    await userEvent.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent('Password must be at least 8 characters.');
    await userEvent.click(submitButton());
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('an invalid email is announced as an alert, and the field is marked invalid and linked to the message', async () => {
    renderForm('login');

    const email = screen.getByPlaceholderText('you@example.com');
    await userEvent.type(email, 'not-an-email');
    await userEvent.tab();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Enter a valid email address.');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute('aria-describedby', 'email-error');
  });

  it('a suspended account is told so, without a retry loop', async () => {
    loginMock.mockResolvedValue({ kind: 'suspended' });
    renderForm('login');

    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'teacher@example.com');
    await userEvent.type(screen.getByPlaceholderText('Your password'), 'correct-horse-battery');
    await userEvent.click(submitButton());

    expect(await screen.findByText('This account is suspended.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to sign in' })).toBeInTheDocument();
  });
});
