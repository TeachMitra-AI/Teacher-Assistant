import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import { AdminNotificationsScreen } from '../AdminNotificationsScreen';
import type { Role } from '../../../../types';

jest.mock('../../../../api/notifications', () => ({
  sendNotification: jest.fn(),
}));
const { sendNotification } = jest.requireMock('../../../../api/notifications') as { sendNotification: jest.Mock };

let mockUser: { role: Role } | null = { role: 'school_admin' };
jest.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

async function renderScreen() {
  await render(
    <SafeAreaProvider>
      <ThemeProvider>
        <AdminNotificationsScreen />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

describe('AdminNotificationsScreen', () => {
  beforeEach(() => {
    sendNotification.mockReset();
    mockUser = { role: 'school_admin' };
  });

  it('disables Send until title and message are filled in', async () => {
    await renderScreen();
    const sendButton = screen.getByTestId('notifications-send');
    expect(sendButton.props.accessibilityState?.disabled).toBe(true);
  });

  it('sends to everyone the caller can reach by default', async () => {
    sendNotification.mockResolvedValue({ recipientCount: 12 });
    await renderScreen();

    await fireEvent.changeText(screen.getByLabelText('Title'), 'Term 2 timetable is live');
    await fireEvent.changeText(screen.getByLabelText('Message'), 'Check the updated schedule.');
    await fireEvent.press(screen.getByTestId('notifications-send'));

    await waitFor(() => expect(sendNotification).toHaveBeenCalledWith({
      title: 'Term 2 timetable is live',
      message: 'Check the updated schedule.',
      type: 'announcement',
      link: undefined,
      target: { scope: 'all' },
    }));
    expect(await screen.findByText('Last send reached 12 recipients.')).toBeTruthy();
  });

  it('requires at least one role when targeting specific roles', async () => {
    await renderScreen();

    await fireEvent.changeText(screen.getByLabelText('Title'), 'Reminder');
    await fireEvent.changeText(screen.getByLabelText('Message'), 'Please submit your reports.');
    await fireEvent.press(screen.getByText('Specific role(s)'));

    const sendButton = screen.getByTestId('notifications-send');
    expect(sendButton.props.accessibilityState?.disabled).toBe(true);

    await fireEvent.press(screen.getByLabelText('Teacher'));
    expect(screen.getByTestId('notifications-send').props.accessibilityState?.disabled).toBe(false);
  });

  it('rejects a link that is not a relative path', async () => {
    await renderScreen();

    await fireEvent.changeText(screen.getByLabelText('Title'), 'Reminder');
    await fireEvent.changeText(screen.getByLabelText('Message'), 'Please submit your reports.');
    await fireEvent.changeText(screen.getByLabelText('Link'), 'https://evil.example.com');
    await fireEvent.press(screen.getByTestId('notifications-send'));

    expect(await screen.findByText('Link must be a relative path starting with "/" (e.g. /library/abc123).')).toBeTruthy();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
