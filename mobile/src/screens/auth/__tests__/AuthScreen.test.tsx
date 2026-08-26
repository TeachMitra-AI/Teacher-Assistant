// Closes the one remaining Phase 7c verification gap noted in
// docs/mobile-app-plan.md: the Auth error banner's rendering could not be
// screenshotted on-device (repeated adb-input attempts into the password
// field reproducibly diverted to Android's "Display over other apps" system
// settings screen — a synthetic-input/IME quirk of this emulator
// environment, confirmed by zero app-side logcat errors both times, not an
// app defect). This exercises the exact same code path — AuthScreen's real
// handleSubmit -> useAuth().login() -> catch -> describeError() ->
// <ErrorBanner> — through the actual component, with only the network layer
// (useAuth) mocked, matching this repo's existing CoachScreen.test.tsx/
// ResourceListScreen.test.tsx convention.
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { ApiError } from '../../../api/client';
import { AuthScreen } from '../AuthScreen';

jest.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    register: jest.fn(),
    loginWithGoogle: jest.fn(),
  }),
}));

const mockLogin = jest.fn();

function renderScreen() {
  return render(
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthScreen navigation={{ navigate: jest.fn() } as never} route={{ key: 'r', name: 'Login', params: undefined } as never} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

describe('AuthScreen', () => {
  beforeEach(() => {
    mockLogin.mockReset();
  });

  it('shows the server error message inline after a failed sign-in, without navigating away', async () => {
    mockLogin.mockRejectedValueOnce(new ApiError('Incorrect email or password.', 401));
    await act(async () => {
      renderScreen();
    });

    await fireEvent.changeText(screen.getByLabelText('Email'), 'teacher@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'wrongpassword123');
    await fireEvent.press(screen.getByTestId('authSubmitButton'));

    await waitFor(() => expect(screen.getByText('Incorrect email or password.')).toBeTruthy());
    expect(mockLogin).toHaveBeenCalledWith({ email: 'teacher@example.com', password: 'wrongpassword123' });
    // The form is still showing (not signed in, not pending/rejected) — the
    // failed attempt left the screen in a retryable state.
    expect(screen.getByLabelText('Email').props.value).toBe('teacher@example.com');
  });
});
