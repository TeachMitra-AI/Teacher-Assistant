// Component tests for the Phase 4 Coach chat screen (docs/mobile-app-plan.md
// §23, §26 Phase 4's acceptance criteria: ask a question, see a rendered
// answer including the loading state; error/retry; feedback), plus the
// chat-history sidebar ported afterward (HistorySidebar.tsx, opened via
// Header's hamburger icon). The API layer (api/coach.ts) is mocked here —
// its own request-shaping is covered by api/__tests__/coach.test.ts — and
// useAuth is mocked directly rather than going through a real AuthProvider,
// since this suite is about the screen's own behavior, not auth (that's
// RootNavigator.test.tsx's job, which also covers Coach being unreachable
// while signed out / reachable once signed in).
//
// The sidebar toggle lives in the navigator's `header` option (set via
// navigation.setOptions, not rendered as this screen's child — see
// CoachScreen.tsx's useLayoutEffect) — following StudentsScreen.test.tsx's
// established pattern, it's driven with a mocked `navigation` object and
// invoked directly off the most recent setOptions call, rather than mounting
// a second render tree for Header. The sidebar's own content (once open) IS
// part of the main render tree (an inline Modal, per HistorySidebar.tsx —
// same "driven with normal fireEvent.press" precedent as StudentsScreen's
// Add/Edit sheet).
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { ApiError } from '../../../api/client';
import { CoachScreen } from '../CoachScreen';
import {
  shouldClaimSidebarSwipe, isSidebarCloseSwipe, isSidebarOpenSwipe, shouldClaimEdgeOpenSwipe,
} from '../HistorySidebar';
import type { HistoryItem } from '../../../types';

jest.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Asha Verma', email: 'asha@example.com', role: 'teacher', preferences: {} } }),
}));

jest.mock('../../../api/coach', () => ({
  askCoach: jest.fn(),
  sendCoachFeedback: jest.fn(),
  listHistory: jest.fn(),
  deleteHistoryItem: jest.fn(),
  clearHistory: jest.fn(),
  updateHistoryItem: jest.fn(),
}));
const {
  askCoach, sendCoachFeedback, listHistory, deleteHistoryItem, clearHistory, updateHistoryItem,
} = jest.requireMock('../../../api/coach') as {
  askCoach: jest.Mock;
  sendCoachFeedback: jest.Mock;
  listHistory: jest.Mock;
  deleteHistoryItem: jest.Mock;
  clearHistory: jest.Mock;
  updateHistoryItem: jest.Mock;
};

const HIST_1: HistoryItem = {
  id: 'q1', query: 'How do I teach fractions?', language: 'en',
  context: { grade: 'Class 5', subject: 'Mathematics' },
  text: 'Start with physical objects like fruit slices.', responseTime: 900,
  createdAt: '2026-08-28T10:00:00.000Z', rating: null, title: null, pinned: false,
};
const HIST_2: HistoryItem = {
  id: 'q2', query: 'Explain photosynthesis simply', language: 'en',
  context: {}, text: 'Plants convert light into energy.', responseTime: 700,
  createdAt: '2026-08-28T09:00:00.000Z', rating: null, title: null, pinned: false,
};

function makeNavigation() {
  return { setOptions: jest.fn() };
}

function renderScreen(navigation = makeNavigation()) {
  render(
    <SafeAreaProvider>
      <ThemeProvider>
        <CoachScreen
          navigation={navigation as never}
          route={{ key: 'c', name: 'Chat', params: undefined } as never}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
  return navigation;
}

async function openSidebar(navigation: ReturnType<typeof makeNavigation>) {
  const calls = navigation.setOptions.mock.calls;
  const last = calls[calls.length - 1][0];
  const headerElement = last.header();
  await act(async () => headerElement.props.onMenuPress());
}

async function openContextMenu(navigation: ReturnType<typeof makeNavigation>) {
  const calls = navigation.setOptions.mock.calls;
  const last = calls[calls.length - 1][0];
  const headerElement = last.header();
  await act(async () => headerElement.props.onContextPress());
}

function headerProps(navigation: ReturnType<typeof makeNavigation>) {
  const calls = navigation.setOptions.mock.calls;
  const last = calls[calls.length - 1][0];
  return last.header().props;
}

describe('CoachScreen', () => {
  beforeEach(() => {
    askCoach.mockReset();
    sendCoachFeedback.mockReset();
    listHistory.mockReset().mockResolvedValue([]);
    deleteHistoryItem.mockReset();
    clearHistory.mockReset();
    updateHistoryItem.mockReset().mockResolvedValue(undefined);
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

  it('editing a sent question resubmits the edited text in place, replacing the old answer', async () => {
    askCoach.mockResolvedValueOnce({
      success: true, text: 'First answer.', language: 'en', context: {}, queryId: 'q1',
    });
    await act(async () => { renderScreen(); });
    await fireEvent.changeText(screen.getByTestId('coach-composer-input'), 'Original question');
    await fireEvent.press(screen.getByTestId('coach-composer-send'));
    await waitFor(() => expect(screen.getByText('First answer.')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Edit message'));
    expect(screen.getByLabelText('Edit your question')).toBeTruthy();

    askCoach.mockResolvedValueOnce({
      success: true, text: 'Edited answer.', language: 'en', context: {}, queryId: 'q2',
    });
    await fireEvent.changeText(screen.getByLabelText('Edit your question'), 'Edited question');
    await fireEvent.press(screen.getByText('Save'));

    // Same turn updated in place — one message, new question text, old
    // answer replaced by the new one (not appended as a second turn).
    await waitFor(() => expect(screen.getByText('Edited answer.')).toBeTruthy());
    expect(screen.getByText('Edited question')).toBeTruthy();
    expect(screen.queryByText('Original question')).toBeNull();
    expect(screen.queryByText('First answer.')).toBeNull();
    expect(askCoach).toHaveBeenCalledTimes(2);
    expect(askCoach).toHaveBeenLastCalledWith('Edited question', 'en', expect.anything());
  });

  it('Cancel on an in-progress edit discards the draft and keeps the original question', async () => {
    askCoach.mockResolvedValueOnce({
      success: true, text: 'An answer.', language: 'en', context: {}, queryId: 'q1',
    });
    await act(async () => { renderScreen(); });
    await fireEvent.changeText(screen.getByTestId('coach-composer-input'), 'Original question');
    await fireEvent.press(screen.getByTestId('coach-composer-send'));
    await waitFor(() => expect(screen.getByText('An answer.')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Edit message'));
    await fireEvent.changeText(screen.getByLabelText('Edit your question'), 'Changed my mind');
    await fireEvent.press(screen.getByText('Cancel'));

    expect(screen.getByText('Original question')).toBeTruthy();
    expect(screen.queryByText('Changed my mind')).toBeNull();
    expect(askCoach).toHaveBeenCalledTimes(1);
  });

  it('does not offer Edit while a turn is still pending', async () => {
    let resolveAsk: (v: unknown) => void = () => {};
    askCoach.mockReturnValueOnce(new Promise((resolve) => { resolveAsk = resolve; }));
    await act(async () => { renderScreen(); });
    await fireEvent.changeText(screen.getByTestId('coach-composer-input'), 'A question');
    await fireEvent.press(screen.getByTestId('coach-composer-send'));

    expect(screen.queryByLabelText('Edit message')).toBeNull();

    await act(async () => {
      resolveAsk({ success: true, text: 'An answer.', language: 'en', context: {}, queryId: 'q1' });
    });
    await waitFor(() => expect(screen.getByLabelText('Edit message')).toBeTruthy());
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

  it('opening the sidebar shows the loaded chat history', async () => {
    listHistory.mockResolvedValueOnce([HIST_1, HIST_2]);
    const navigation = renderScreen();
    await waitFor(() => expect(listHistory).toHaveBeenCalledWith(20));

    await openSidebar(navigation);

    expect(screen.getByLabelText('How do I teach fractions?')).toBeTruthy();
    expect(screen.getByLabelText('Explain photosynthesis simply')).toBeTruthy();
  });

  it('selecting a history item restores it as the active turn without calling the API', async () => {
    listHistory.mockResolvedValueOnce([HIST_1]);
    const navigation = renderScreen();
    await waitFor(() => expect(listHistory).toHaveBeenCalled());
    await openSidebar(navigation);

    await fireEvent.press(screen.getByLabelText('How do I teach fractions?'));

    await waitFor(() => expect(screen.getByText('Start with physical objects like fruit slices.')).toBeTruthy());
    expect(askCoach).not.toHaveBeenCalled();
  });

  it('opening the sidebar renders the swipe-to-close gesture area', async () => {
    // The gesture DECISION logic (shouldClaimSidebarSwipe/isSidebarCloseSwipe,
    // exported from HistorySidebar.tsx) is unit-tested directly, below —
    // PanResponder only exposes the raw native responder props on
    // `panHandlers` (computing gesture state internally from real touch
    // history), so a fake event/gestureState pair passed to those wouldn't
    // actually exercise the config callbacks. This just confirms the wiring
    // is present: the swipe area renders with panHandlers attached.
    listHistory.mockResolvedValueOnce([]);
    const navigation = renderScreen();
    await waitFor(() => expect(listHistory).toHaveBeenCalled());
    await openSidebar(navigation);

    const swipeArea = screen.getByTestId('sidebar-swipe-area');
    expect(typeof swipeArea.props.onMoveShouldSetResponder).toBe('function');
    expect(typeof swipeArea.props.onResponderRelease).toBe('function');
  });

  it('the left-edge swipe-to-open area is always present, closed or open', async () => {
    // Mirrors the swipe-to-close wiring check above, for the opening
    // gesture: it has to be reachable before the sidebar opens (that's the
    // whole point), so it renders unconditionally rather than only once
    // `sidebarOpen` is true.
    await act(async () => {
      renderScreen();
    });

    const edgeArea = screen.getByTestId('sidebar-edge-swipe-area');
    expect(typeof edgeArea.props.onMoveShouldSetResponder).toBe('function');
    expect(typeof edgeArea.props.onResponderRelease).toBe('function');
  });

  it('New chat clears an active thread back to the empty state', async () => {
    listHistory.mockResolvedValueOnce([HIST_1]);
    askCoach.mockResolvedValueOnce({ success: true, text: 'An answer.', language: 'en', context: {}, queryId: 'q9' });
    const navigation = renderScreen();
    await waitFor(() => expect(listHistory).toHaveBeenCalled());

    await fireEvent.changeText(screen.getByTestId('coach-composer-input'), 'A question');
    await fireEvent.press(screen.getByTestId('coach-composer-send'));
    await waitFor(() => expect(screen.getByText('An answer.')).toBeTruthy());

    await openSidebar(navigation);
    await fireEvent.press(screen.getByTestId('sidebar-new-chat'));

    expect(screen.getByTestId('coach-empty-state')).toBeTruthy();
  });

  it('deleting a history item, after confirming, removes it from the sidebar', async () => {
    listHistory.mockResolvedValueOnce([HIST_1]);
    deleteHistoryItem.mockResolvedValueOnce(undefined);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    const navigation = renderScreen();
    await waitFor(() => expect(listHistory).toHaveBeenCalled());
    await openSidebar(navigation);

    await fireEvent.press(screen.getByTestId('sidebar-actions-q1'));
    await fireEvent.press(screen.getByText('Delete chat'));

    await waitFor(() => expect(deleteHistoryItem).toHaveBeenCalledWith('q1'));
    await waitFor(() => expect(screen.queryByLabelText('How do I teach fractions?')).toBeNull());
  });

  it('renaming a chat updates its sidebar title', async () => {
    listHistory.mockResolvedValueOnce([HIST_1]);
    const navigation = renderScreen();
    await waitFor(() => expect(listHistory).toHaveBeenCalled());
    await openSidebar(navigation);

    await fireEvent.press(screen.getByTestId('sidebar-actions-q1'));
    await fireEvent.press(screen.getByText('Rename chat'));
    await fireEvent.changeText(screen.getByTestId('rename-chat-input'), 'Fractions lesson');
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(updateHistoryItem).toHaveBeenCalledWith('q1', { title: 'Fractions lesson' }));
    expect(screen.getByLabelText('Fractions lesson')).toBeTruthy();
  });

  it('the teaching-context icon shows no badge until a field is set', async () => {
    const navigation = renderScreen();
    await waitFor(() => expect(listHistory).toHaveBeenCalled());
    expect(headerProps(navigation).contextActiveCount).toBe(0);
  });

  it('setting grade and subject via the teaching-context menu updates the header badge and the next question', async () => {
    askCoach.mockResolvedValueOnce({ success: true, text: 'An answer.', language: 'en', context: {}, queryId: 'q9' });
    const navigation = renderScreen();
    await waitFor(() => expect(listHistory).toHaveBeenCalled());

    await openContextMenu(navigation);
    await fireEvent.press(screen.getByLabelText('Grade'));
    await fireEvent.press(screen.getByText('Class 3-5'));
    await fireEvent.press(screen.getByLabelText('Subject'));
    await fireEvent.press(screen.getByText('Mathematics'));

    await waitFor(() => expect(headerProps(navigation).contextActiveCount).toBe(2));

    await fireEvent.changeText(screen.getByTestId('coach-composer-input'), 'How do fractions work?');
    await fireEvent.press(screen.getByTestId('coach-composer-send'));

    await waitFor(() => expect(askCoach).toHaveBeenCalledWith(
      'How do fractions work?',
      'en',
      expect.objectContaining({ grade: 'Class 3-5', subject: 'Mathematics' })
    ));
  });

  it('New chat resets the teaching context (but not the language) back to defaults', async () => {
    askCoach.mockResolvedValueOnce({ success: true, text: 'An answer.', language: 'en', context: {}, queryId: 'q9' });
    const navigation = renderScreen();
    await waitFor(() => expect(listHistory).toHaveBeenCalled());

    await openContextMenu(navigation);
    await fireEvent.press(screen.getByLabelText('Language'));
    await fireEvent.press(screen.getByText('हिंदी'));
    await fireEvent.press(screen.getByLabelText('Grade'));
    await fireEvent.press(screen.getByText('Class 3-5'));
    await waitFor(() => expect(headerProps(navigation).contextActiveCount).toBe(1));

    await fireEvent.changeText(screen.getByTestId('coach-composer-input'), 'A question');
    await fireEvent.press(screen.getByTestId('coach-composer-send'));
    await waitFor(() => expect(screen.getByText('An answer.')).toBeTruthy());

    await openSidebar(navigation);
    await fireEvent.press(screen.getByTestId('sidebar-new-chat'));

    expect(headerProps(navigation).contextActiveCount).toBe(0);

    askCoach.mockResolvedValueOnce({ success: true, text: 'Another answer.', language: 'hi', context: {}, queryId: 'q10' });
    await fireEvent.changeText(screen.getByTestId('coach-composer-input'), 'Another question');
    await fireEvent.press(screen.getByTestId('coach-composer-send'));

    // Grade was cleared, but the language choice survives New chat, same as the web.
    await waitFor(() => expect(askCoach).toHaveBeenCalledWith(
      'Another question',
      'hi',
      expect.objectContaining({ grade: '' })
    ));
  });

  it('selecting a history item restores its language/context for the next question', async () => {
    const HIST_HINDI: HistoryItem = {
      ...HIST_1,
      language: 'hi',
      context: { grade: 'Class 3-5', subject: 'Mathematics' },
    };
    listHistory.mockResolvedValueOnce([HIST_HINDI]);
    askCoach.mockResolvedValueOnce({ success: true, text: 'A follow-up answer.', language: 'hi', context: {}, queryId: 'q11' });
    const navigation = renderScreen();
    await waitFor(() => expect(listHistory).toHaveBeenCalled());

    await openSidebar(navigation);
    await fireEvent.press(screen.getByLabelText('How do I teach fractions?'));

    await fireEvent.changeText(screen.getByTestId('coach-composer-input'), 'A follow-up question');
    await fireEvent.press(screen.getByTestId('coach-composer-send'));

    await waitFor(() => expect(askCoach).toHaveBeenCalledWith(
      'A follow-up question',
      'hi',
      expect.objectContaining({ grade: 'Class 3-5', subject: 'Mathematics' })
    ));
  });
});

describe('HistorySidebar swipe-to-close gesture logic', () => {
  describe('shouldClaimSidebarSwipe', () => {
    it('claims a mostly-horizontal drag past the minimum distance', () => {
      expect(shouldClaimSidebarSwipe(-80, 5)).toBe(true);
    });

    it('does not claim a mostly-vertical drag (list scrolling)', () => {
      expect(shouldClaimSidebarSwipe(-10, 60)).toBe(false);
    });

    it('does not claim a drag that has barely moved yet', () => {
      expect(shouldClaimSidebarSwipe(-5, 0)).toBe(false);
    });

    it('does not claim a leftward drag that is not clearly more horizontal than vertical', () => {
      expect(shouldClaimSidebarSwipe(-20, -18)).toBe(false);
    });
  });

  describe('isSidebarCloseSwipe', () => {
    it('closes once dx passes the right-to-left threshold', () => {
      expect(isSidebarCloseSwipe(-61)).toBe(true);
      expect(isSidebarCloseSwipe(-200)).toBe(true);
    });

    it('does not close on a short drag below the threshold', () => {
      expect(isSidebarCloseSwipe(-20)).toBe(false);
      expect(isSidebarCloseSwipe(0)).toBe(false);
    });

    it('does not close on a left-to-right drag (opening direction, not closing)', () => {
      expect(isSidebarCloseSwipe(80)).toBe(false);
    });

    it('closes on a fast leftward fling even below the distance threshold', () => {
      expect(isSidebarCloseSwipe(-20, -0.6)).toBe(true);
    });

    it('does not close on a slow drag below the threshold', () => {
      expect(isSidebarCloseSwipe(-20, -0.1)).toBe(false);
    });
  });

  describe('isSidebarOpenSwipe', () => {
    it('opens once dx passes the left-to-right threshold', () => {
      expect(isSidebarOpenSwipe(61)).toBe(true);
      expect(isSidebarOpenSwipe(200)).toBe(true);
    });

    it('does not open on a short drag below the threshold', () => {
      expect(isSidebarOpenSwipe(20)).toBe(false);
      expect(isSidebarOpenSwipe(0)).toBe(false);
    });

    it('does not open on a right-to-left drag (closing direction, not opening)', () => {
      expect(isSidebarOpenSwipe(-80)).toBe(false);
    });

    it('opens on a fast rightward fling even below the distance threshold', () => {
      expect(isSidebarOpenSwipe(20, 0.6)).toBe(true);
    });

    it('does not open on a slow drag below the threshold', () => {
      expect(isSidebarOpenSwipe(20, 0.1)).toBe(false);
    });
  });

  describe('shouldClaimEdgeOpenSwipe', () => {
    it('claims a mostly-horizontal rightward drag past the minimum distance', () => {
      expect(shouldClaimEdgeOpenSwipe(80, 5)).toBe(true);
    });

    it('does not claim a mostly-vertical drag (list scrolling)', () => {
      expect(shouldClaimEdgeOpenSwipe(10, 60)).toBe(false);
    });

    it('does not claim a drag that has barely moved yet', () => {
      expect(shouldClaimEdgeOpenSwipe(5, 0)).toBe(false);
    });

    it('does not claim a leftward drag (that closes, it does not open)', () => {
      expect(shouldClaimEdgeOpenSwipe(-80, 5)).toBe(false);
    });
  });
});
