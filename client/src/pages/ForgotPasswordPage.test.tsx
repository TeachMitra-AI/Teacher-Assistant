import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ForgotPasswordPage from './ForgotPasswordPage';

const forgotPasswordMock = vi.fn();

vi.mock('../auth', () => ({
  useAuth: () => ({ forgotPassword: forgotPasswordMock }),
}));

const preferences = { theme: 'light', toggleTheme: () => {} } as never;

function renderPage() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage preferences={preferences} />
    </MemoryRouter>
  );
}

describe('ForgotPasswordPage email validation', () => {
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });

  beforeEach(() => {
    forgotPasswordMock.mockReset();
    forgotPasswordMock.mockResolvedValue(undefined);
  });

  it('shows the same inline message as sign-in when the email is malformed, announced as an alert', async () => {
    renderPage();
    const email = screen.getByPlaceholderText('you@example.com');
    await userEvent.type(email, 'nope');
    await userEvent.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAttribute('aria-describedby', 'email-error');
  });

  it('does not send a malformed address to the server', async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(forgotPasswordMock).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.');
  });

  it('a valid address is sent, and the confirmation does not say whether the account exists', async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'teacher@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(forgotPasswordMock).toHaveBeenCalledWith('teacher@example.com'));
    expect(await screen.findByText(/If an account exists for/)).toBeInTheDocument();
  });
});
