// Component tests for the Phase 4 Coach chat screen (docs/mobile-app-plan.md
// §23, §26 Phase 4's acceptance criteria: ask a question, see a rendered
// answer including the loading state; error/retry; feedback). The API layer
// (api/coach.ts) is mocked here — its own request-shaping is covered by
// api/__tests__/coach.test.ts — and useAuth is mocked directly rather than
// going through a real AuthProvider, since this suite is about the screen's
// own behavior, not auth (that's RootNavigator.test.tsx's job, which also
// covers Coach being unreachable while signed out / reachable once signed in).
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { ApiError } from '../../../api/client';
import { CoachScreen } from '../CoachScreen';

jest.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Asha Verma', email: 'asha@example.com', role: 'teacher', preferences: {} } }),
}));

jest.mock('../../../api/coach', () => ({
  askCoach: jest.fn(),
  sendCoachFeedback: jest.fn(),
}));
const { askCoach, sendCoachFeedback } = jest.requireMock('../../../api/coach') as {
  askCoach: jest.Mock;
  sendCoachFeedback: jest.Mock;
};

function renderScreen() {
  return render(
    <SafeAreaProvider>
      <ThemeProvider>
        <CoachScreen />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

describe('CoachScreen', () => {
  beforeEach(() => {
    askCoach.mockReset();
    sendCoachFeedback.mockReset();
  });

  it('renders the empty state with a personalized greeting and quick-action prompts', async () => {
    await act(async () => {
      renderScreen();
    });
    expect(screen.getByText('Hi Asha Verma 👋')).toBeTruthy();
    expect(screen.getByTestId('quick-action-Lesson Plan')).toBeTruthy();
  });

  it('tapping a quick-action prompt prefills the composer without sending', async () => {
    await act(async () => {
      renderScreen();
    });
    await fireEvent.press(screen.getByTestId('quick-action-Explain a Concept'));
    expect(screen.getByTestId('coach-composer-input').props.value).toBe('Explain this concept simply: ');
    expect(askCoach).not.toHaveBeenCalled();
  });

  it('the send button is disabled until there is non-whitespace text', async () => {
    await act(async () => {
      renderScreen();
    });
    const input = screen.getByTestId('coach-composer-input');
    const send = screen.getByTestId('coach-composer-send');
    expect(send.props.accessibilityState?.disabled).toBe(true);

    await fireEvent.changeText(input, '   ');
    expect(send.props.accessibilityState?.disabled).toBe(true);

    await fireEvent.changeText(input, 'How do I teach fractions?');
    expect(send.props.accessibilityState?.disabled).toBe(false);
  });

  it('shows a loading state, then the rendered answer, on a successful round trip', async () => {
    let resolveAsk: (v: unknown) => void = () => {};
    askCoach.mockReturnValueOnce(new Promise((resolve) => { resolveAsk = resolve; }));

    await act(async () => {
      renderScreen();
    });
    await fireEvent.changeText(screen.getByTestId('coach-composer-input'), 'How do I teach fractions?');
    await fireEvent.press(screen.getByTestId('coach-composer-send'));

    // Sent message renders immediately; the answer is still pending.
    expect(screen.getByText('How do I teach fractions?')).toBeTruthy();
    expect(screen.getByText('Preparing practical advice for you…')).toBeTruthy();
    // The composer clears once a turn is submitted.
    expect(screen.getByTestId('coach-composer-input').props.value).toBe('');

    await act(async () => {
      resolveAsk({
        success: true,
        text: 'Start with **physical objects** like fruit slices.',
        language: 'en',
        context: {},
        queryId: 'q1',
      });
    });

    await waitFor(() => expect(screen.getByText(/physical objects/)).toBeTruthy());
    expect(screen.queryByText('Preparing practical advice for you…')).toBeNull();
  });

  it('shows an inline error with a working retry on API failure', async () => {
    askCoach.mockRejectedValueOnce(new ApiError('Network error. Please check your connection.', 0));

    await act(async () => {
      renderScreen();
    });
    await fireEvent.changeText(screen.getByTestId('coach-composer-input'), 'A question');
    await fireEvent.press(screen.getByTestId('coach-composer-send'));

    await waitFor(() => expect(screen.getByText(/Network error/)).toBeTruthy());
    expect(screen.getByText('Try again')).toBeTruthy();

    askCoach.mockResolvedValueOnce({
      success: true,
      text: 'Here is a retried answer.',
      language: 'en',
      context: {},
      queryId: 'q2',
    });
    await fireEvent.press(screen.getByText('Try again'));

    await waitFor(() => expect(screen.getByText('Here is a retried answer.')).toBeTruthy());
    expect(askCoach).toHaveBeenCalledTimes(2);
  });

  it('sends thumbs-up feedback for the answered turn', async () => {
    askCoach.mockResolvedValueOnce({
      success: true,
      text: 'A good answer.',
      language: 'en',
      context: {},
      queryId: 'q3',
    });
    sendCoachFeedback.mockResolvedValueOnce(undefined);

    await act(async () => {
      renderScreen();
    });
    await fireEvent.changeText(screen.getByTestId('coach-composer-input'), 'A question');
    await fireEvent.press(screen.getByTestId('coach-composer-send'));
    await waitFor(() => expect(screen.getByText('A good answer.')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Helpful'));
    await waitFor(() => expect(sendCoachFeedback).toHaveBeenCalledWith('q3', 'helpful'));
  });
});
