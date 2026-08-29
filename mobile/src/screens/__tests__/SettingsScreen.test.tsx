// Component tests for SettingsScreen.tsx + useSettingsScreen.ts — mirrors
// client/src/pages/SettingsPage.tsx's three independent forms (profile +
// teaching defaults, exam-paper letterhead defaults, password) plus the
// existing Signed-in devices/Admin/Sign out rows. api/client.ts's api() is
// mocked here — its own request/refresh/auth machinery is covered by
// api/__tests__/client.test.ts. HELP_SUPPORT_ENABLED is mocked true for
// this whole file (Jest doesn't run Metro's EXPO_PUBLIC_* inlining, so it
// would otherwise read false regardless of mobile/.env — same reasoning
// RootNavigator.test.tsx documents for NOTIFICATIONS_ENABLED) so the "Need
// Help?" row's presence and navigation can be verified.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeContext';
import { SettingsScreen } from '../SettingsScreen';
import type { Role } from '../../types';

jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  HELP_SUPPORT_ENABLED: true,
}));

jest.mock('../../api/client', () => ({
  api: jest.fn(),
  ApiError: jest.requireActual('../../api/client').ApiError,
}));
const { api } = jest.requireMock('../../api/client') as { api: jest.Mock };

// useProfilePicture.ts's own logic (validation, expo-image-picker wiring,
// the upload/remove API calls) is covered directly by
// lib/__tests__/useProfilePicture.test.ts — mocked here as a black box so
// this file only has to verify SettingsScreen wires its result to the UI.
const mockPickAndUpload = jest.fn();
const mockRemovePhoto = jest.fn();
jest.mock('../../lib/useProfilePicture', () => ({
  useProfilePicture: () => ({ uploading: false, pickAndUpload: mockPickAndUpload, remove: mockRemovePhoto }),
}));

const mockUpdateUser = jest.fn();
const mockLogout = jest.fn();
let mockUser: {
  id: string; name: string; displayName: string | null; email: string; role: Role;
  preferences: Record<string, unknown>; school: { id: string; name: string; code: string }; avatarUrl: string | null;
};

function resetUser(role: Role = 'teacher') {
  mockUser = {
    id: 'u1', name: 'Asha Verma', displayName: null, email: 'asha@example.com', role,
    preferences: {}, school: { id: 's1', name: 'Rampur Primary', code: 'RAMPUR01' }, avatarUrl: null,
  };
}

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, updateUser: mockUpdateUser, logout: mockLogout }),
}));

function makeNavigation() {
  return { navigate: jest.fn() };
}

async function renderScreen(navigation = makeNavigation()) {
  await render(
    <SafeAreaProvider>
      <ThemeProvider>
        <SettingsScreen
          navigation={navigation as never}
          route={{ key: 's', name: 'Settings', params: undefined } as never}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
  return navigation;
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    resetUser();
    api.mockReset();
    mockUpdateUser.mockReset();
    mockLogout.mockReset();
    mockPickAndUpload.mockReset();
    mockRemovePhoto.mockReset();
  });

  it('shows the signed-in teacher’s identity', async () => {
    await renderScreen();
    expect(screen.getByText('Asha Verma')).toBeTruthy();
    expect(screen.getByText('Teacher')).toBeTruthy();
    expect(screen.getByText('asha@example.com')).toBeTruthy();
    expect(screen.getByText('Rampur Primary')).toBeTruthy();
  });

  it('shows the Admin row for an admin role but not for a teacher', async () => {
    await renderScreen();
    expect(screen.queryByText('Admin')).toBeNull();

    resetUser('school_admin');
    await renderScreen();
    expect(screen.getByText('Admin')).toBeTruthy();
  });

  it('the remove-photo button only shows once a photo is set', async () => {
    await renderScreen();
    expect(screen.queryByLabelText('Remove photo')).toBeNull();

    mockUser.avatarUrl = '/users/u1/avatar?v=1';
    await renderScreen();
    expect(screen.getByLabelText('Remove photo')).toBeTruthy();
  });

  it('tapping the camera icon uploads a photo and updates the user on success', async () => {
    mockPickAndUpload.mockResolvedValueOnce({ user: { ...mockUser, avatarUrl: '/users/u1/avatar?v=2' } });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('settings-upload-photo'));

    await waitFor(() => expect(mockPickAndUpload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ ...mockUser, avatarUrl: '/users/u1/avatar?v=2' }));
  });

  it('shows an inline error when the photo upload fails, without updating the user', async () => {
    mockPickAndUpload.mockResolvedValueOnce({ error: 'The photo is too large. Maximum size is 5MB.' });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('settings-upload-photo'));

    await waitFor(() => expect(screen.getByText('The photo is too large. Maximum size is 5MB.')).toBeTruthy());
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('does nothing when the photo picker is cancelled (null result)', async () => {
    mockPickAndUpload.mockResolvedValueOnce(null);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('settings-upload-photo'));

    await waitFor(() => expect(mockPickAndUpload).toHaveBeenCalledTimes(1));
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('removes the photo on tap and updates the user', async () => {
    mockUser.avatarUrl = '/users/u1/avatar?v=1';
    mockRemovePhoto.mockResolvedValueOnce({ user: { ...mockUser, avatarUrl: null } });
    await renderScreen();

    await fireEvent.press(screen.getByLabelText('Remove photo'));

    await waitFor(() => expect(mockRemovePhoto).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ ...mockUser, avatarUrl: null }));
  });

  it('saves the profile form with the edited display name, avatar, teaching defaults and response style', async () => {
    api.mockResolvedValueOnce({ user: { ...mockUser, displayName: 'Ms. Verma' } });
    await renderScreen();

    await fireEvent.changeText(screen.getByLabelText('Display name'), 'Ms. Verma');
    await fireEvent.press(screen.getByLabelText('No avatar'));
    await fireEvent.press(screen.getByLabelText('Default grade'));
    await fireEvent.press(screen.getByText('Class 3-5'));
    await fireEvent.press(screen.getByText('Concise'));
    await fireEvent.press(screen.getByTestId('settings-save-profile'));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/auth/me', {
      method: 'PATCH',
      body: expect.objectContaining({
        displayName: 'Ms. Verma',
        preferences: expect.objectContaining({ defaultGrade: 'Class 3-5', responseStyle: 'concise' }),
      }),
    }));
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ ...mockUser, displayName: 'Ms. Verma' }));
    expect(screen.getByText('Settings saved')).toBeTruthy();
  });

  it('shows an inline error and does not update the user when saving the profile fails', async () => {
    api.mockRejectedValueOnce(new Error('boom'));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('settings-save-profile'));

    await waitFor(() => expect(screen.getByText('Could not save settings.')).toBeTruthy());
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('saves the exam paper letterhead defaults, including both toggles', async () => {
    api.mockResolvedValueOnce({ user: mockUser });
    await renderScreen();

    await fireEvent.changeText(screen.getByLabelText('School name'), 'Rampur Primary School');
    await fireEvent.changeText(screen.getByLabelText('Default custom instructions'), 'No calculators.');
    await fireEvent(screen.getByTestId('exam-show-date-switch'), 'valueChange', true);
    await fireEvent(screen.getByTestId('exam-show-time-switch'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('settings-save-exam-defaults'));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/auth/me', {
      method: 'PATCH',
      body: {
        preferences: expect.objectContaining({
          examPaperDefaults: {
            schoolName: 'Rampur Primary School',
            teacherName: 'Asha Verma',
            defaultInstructions: 'No calculators.',
            showDate: true,
            showTime: true,
          },
        }),
      },
    }));
    expect(screen.getByText('Paper defaults saved')).toBeTruthy();
  });

  it('rejects a password change when the confirmation does not match, without calling the API', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Current password'), 'oldpass123');
    await fireEvent.changeText(screen.getByLabelText('New password'), 'newpass123');
    await fireEvent.changeText(screen.getByLabelText('Confirm new password'), 'different123');
    await fireEvent.press(screen.getByTestId('settings-save-password'));

    expect(screen.getByText('New password and confirmation do not match.')).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });

  it('rejects a new password shorter than 8 characters, without calling the API', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Current password'), 'oldpass123');
    await fireEvent.changeText(screen.getByLabelText('New password'), 'short');
    await fireEvent.changeText(screen.getByLabelText('Confirm new password'), 'short');
    await fireEvent.press(screen.getByTestId('settings-save-password'));

    expect(screen.getByText('New password must be at least 8 characters.')).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });

  it('updates the password and clears the fields on success', async () => {
    api.mockResolvedValueOnce({ success: true });
    await renderScreen();

    await fireEvent.changeText(screen.getByLabelText('Current password'), 'oldpass123');
    await fireEvent.changeText(screen.getByLabelText('New password'), 'newpass123');
    await fireEvent.changeText(screen.getByLabelText('Confirm new password'), 'newpass123');
    await fireEvent.press(screen.getByTestId('settings-save-password'));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/auth/me/password', {
      method: 'PATCH',
      body: { currentPassword: 'oldpass123', newPassword: 'newpass123' },
    }));
    await waitFor(() => expect(screen.getByText('Password updated')).toBeTruthy());
    expect(screen.getByLabelText('Current password').props.value).toBe('');
  });

  it('navigates to Signed-in devices and to Need Help?', async () => {
    const navigation = await renderScreen();
    await fireEvent.press(screen.getByText('Signed-in devices'));
    expect(navigation.navigate).toHaveBeenCalledWith('Sessions');

    await fireEvent.press(screen.getByText('Need Help?'));
    expect(navigation.navigate).toHaveBeenCalledWith('HelpSupport');
  });

  it('signs out when Sign out is pressed', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByText('Sign out'));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
