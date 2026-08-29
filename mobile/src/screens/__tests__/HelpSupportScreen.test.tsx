// Component tests for HelpSupportScreen.tsx — mirrors client/src/
// components/HelpSupport.tsx's menu -> bug/feedback/contact/contact-message
// -> success flow. api/support.ts is mocked here; its own request shape is
// covered by api/__tests__/support.test.ts. The back arrow (headerLeft) and
// per-view title live in the navigator's `header`/`title` options (set via
// navigation.setOptions, not rendered as this screen's child) — same
// mocked-navigation pattern CoachScreen.test.tsx established for its own
// dynamic header.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import { HelpSupportScreen } from '../HelpSupportScreen';

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Asha Verma', displayName: null, email: 'asha@example.com', role: 'teacher', preferences: {}, school: { id: 's1', name: 'Rampur Primary', code: 'RAMPUR01' } } }),
}));

jest.mock('../../api/support', () => ({
  createSupportTicket: jest.fn(),
  captureAutoContext: jest.fn(() => ({ buildId: 'mobile', theme: 'light', language: undefined })),
}));
const { createSupportTicket } = jest.requireMock('../../api/support') as { createSupportTicket: jest.Mock };

function makeNavigation() {
  return { setOptions: jest.fn(), goBack: jest.fn() };
}

async function renderScreen(navigation = makeNavigation()) {
  await render(
    <SafeAreaProvider>
      <ThemeProvider>
        <HelpSupportScreen
          navigation={navigation as never}
          route={{ key: 'h', name: 'HelpSupport', params: undefined } as never}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
  return navigation;
}

function latestHeaderOptions(navigation: ReturnType<typeof makeNavigation>) {
  const calls = navigation.setOptions.mock.calls;
  return calls[calls.length - 1][0];
}

describe('HelpSupportScreen', () => {
  beforeEach(() => {
    createSupportTicket.mockReset();
  });

  it('shows the three menu options', async () => {
    await renderScreen();
    expect(screen.getByText('Report a Bug')).toBeTruthy();
    expect(screen.getByText('Contact Support')).toBeTruthy();
    expect(screen.getByText('Send Feedback')).toBeTruthy();
  });

  it('reports a bug: picking a category and describing it submits and shows the reference on success', async () => {
    createSupportTicket.mockResolvedValueOnce({ id: 'abcd12345678', status: 'open' });
    const navigation = await renderScreen();

    await fireEvent.press(screen.getByText('Report a Bug'));
    expect(latestHeaderOptions(navigation).title).toBe('Report a Bug');

    await fireEvent.press(screen.getByText('App crashed'));
    await fireEvent.changeText(screen.getByLabelText('Describe what happened'), 'It closed when I tapped Generate.');
    await fireEvent.press(screen.getByText('Send report'));

    await waitFor(() => expect(createSupportTicket).toHaveBeenCalledWith(expect.objectContaining({
      type: 'bug', category: 'crash', description: 'It closed when I tapped Generate.',
    })));
    await waitFor(() => expect(screen.getByText(/we.ve got it/i)).toBeTruthy());
    expect(screen.getByText('Reference: #12345678')).toBeTruthy();
  });

  it('does not submit a bug report while category or description is missing', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByText('Report a Bug'));

    // Neither set yet — pressing Send does nothing.
    await fireEvent.press(screen.getByText('Send report'));
    expect(createSupportTicket).not.toHaveBeenCalled();

    // Category only — still nothing.
    await fireEvent.press(screen.getByText('Connection / network issue'));
    await fireEvent.press(screen.getByText('Send report'));
    expect(createSupportTicket).not.toHaveBeenCalled();

    // Both set — now it submits.
    createSupportTicket.mockResolvedValueOnce({ id: 'b2', status: 'open' });
    await fireEvent.changeText(screen.getByLabelText('Describe what happened'), 'Could not load Coach.');
    await fireEvent.press(screen.getByText('Send report'));

    await waitFor(() => expect(createSupportTicket).toHaveBeenCalledWith(expect.objectContaining({ category: 'connection_issue' })));
  });

  it('sends feedback with an optional message', async () => {
    createSupportTicket.mockResolvedValueOnce({ id: 'f1', status: 'open' });
    await renderScreen();

    await fireEvent.press(screen.getByText('Send Feedback'));
    await fireEvent.press(screen.getByText('Feature request'));
    await fireEvent.press(screen.getByText('Send feedback'));

    await waitFor(() => expect(createSupportTicket).toHaveBeenCalledWith(expect.objectContaining({
      type: 'feedback', category: 'feature_request', description: '',
    })));
    await waitFor(() => expect(screen.getByText('Thanks for letting us know!')).toBeTruthy());
  });

  it('Contact Support with no WhatsApp number configured only offers the in-app message form', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByText('Contact Support'));

    expect(screen.queryByText('Message us on WhatsApp')).toBeNull();
    expect(screen.getByText('Send us a message')).toBeTruthy();

    await fireEvent.press(screen.getByText('Send us a message'));
    await fireEvent.changeText(screen.getByLabelText("What's on your mind?"), 'Please call me back.');

    createSupportTicket.mockResolvedValueOnce({ id: 'm1', status: 'open' });
    await fireEvent.press(screen.getByText('Send message'));

    await waitFor(() => expect(createSupportTicket).toHaveBeenCalledWith(expect.objectContaining({
      type: 'feedback', category: 'other', description: 'Please call me back.',
    })));
  });

  it('the back arrow returns from a sub-view to the menu', async () => {
    const navigation = await renderScreen();
    await fireEvent.press(screen.getByText('Report a Bug'));
    expect(screen.queryByText('Report a Bug')).toBeNull(); // now the title, not a menu button

    // headerLeft is rendered by the navigator, not this screen's own tree
    // (see CoachScreen.test.tsx's identical openSidebar/openContextMenu
    // helpers) — its onPress is invoked directly off the element's props,
    // no second render tree needed.
    const headerLeftElement = latestHeaderOptions(navigation).headerLeft();
    await act(async () => headerLeftElement.props.onPress());

    expect(screen.getByText('Report a Bug')).toBeTruthy(); // the menu button again
  });
});
