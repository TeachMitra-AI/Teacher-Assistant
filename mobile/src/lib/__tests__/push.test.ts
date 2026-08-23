// registerForPushAsync()/getCachedPushToken() (Phase 7b, mobile/src/lib/push.ts).
// jest.setup.ts's default expo-notifications/expo-constants mocks return
// "not granted, no projectId" — each test here overrides just the pieces it
// needs directly on those shared mocks, matching the pattern
// api/__tests__/*.test.ts already use for mocking ../client.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { registerForPushAsync, getCachedPushToken } from '../push';

describe('registerForPushAsync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Constants as { expoConfig?: object; easConfig?: object }).expoConfig = {};
    (Constants as { expoConfig?: object; easConfig?: object }).easConfig = undefined;
  });

  it('returns null when permission is denied and never requests a token', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });

    const token = await registerForPushAsync();

    expect(token).toBeNull();
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('returns null when permission is granted but no EAS projectId is configured', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });

    const token = await registerForPushAsync();

    expect(token).toBeNull();
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('requests permission when not already granted, then returns the Expo push token', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Constants as { expoConfig?: object }).expoConfig = { extra: { eas: { projectId: 'proj-123' } } };
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[real]', type: 'expo' });

    const token = await registerForPushAsync();

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-123' });
    expect(token).toBe('ExponentPushToken[real]');
    expect(getCachedPushToken()).toBe('ExponentPushToken[real]');
  });

  it('sets up the Android notification channel only on Android', async () => {
    const originalOS = Platform.OS;
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Constants as { expoConfig?: object }).expoConfig = { extra: { eas: { projectId: 'proj-123' } } };

    (Platform as { OS: string }).OS = 'android';
    await registerForPushAsync();
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('default', expect.objectContaining({ name: 'Default' }));

    jest.clearAllMocks();
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Constants as { expoConfig?: object }).expoConfig = { extra: { eas: { projectId: 'proj-123' } } };
    (Platform as { OS: string }).OS = 'ios';
    await registerForPushAsync();
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();

    (Platform as { OS: string }).OS = originalOS;
  });

  it('falls back to Constants.easConfig.projectId when expoConfig has none', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Constants as { easConfig?: object }).easConfig = { projectId: 'proj-from-eas-config' };
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[via-eas-config]', type: 'expo' });

    const token = await registerForPushAsync();

    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-from-eas-config' });
    expect(token).toBe('ExponentPushToken[via-eas-config]');
  });

  it('does not re-request permission when already granted', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Constants as { expoConfig?: object }).expoConfig = { extra: { eas: { projectId: 'proj-123' } } };
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[real]', type: 'expo' });

    await registerForPushAsync();

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns null instead of throwing when the OS call rejects', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockRejectedValue(new Error('native module unavailable'));

    await expect(registerForPushAsync()).resolves.toBeNull();
  });
});
