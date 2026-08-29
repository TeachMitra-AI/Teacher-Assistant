// Coverage for useProfilePicture.ts — mobile port of client/src/hooks/
// useProfilePicture.ts. expo-image-picker and api/client.ts are mocked
// here; the picker's own native behavior and the API's request/refresh
// machinery are out of scope for this file.
import { renderHook, act } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { useProfilePicture } from '../useProfilePicture';
import type { User } from '../../types';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
const mockedPicker = ImagePicker as jest.Mocked<typeof ImagePicker>;

// expo-file-system's `File` wraps a native module unavailable under Jest —
// stubbed to a real Blob (Node's FormData.append's 3-arg overload validates
// the value is Blob-like, same as the Blob-like contract useProfilePicture.ts
// relies on `File` for at runtime).
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => new Blob([uri])),
}));

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, api: jest.fn() };
});
const { api } = jest.requireMock('../../api/client') as { api: jest.Mock };

const USER = { id: 'u1', avatarUrl: '/users/u1/avatar?v=2' } as unknown as User;

function grantedPermission() {
  return { granted: true, status: 'granted', expires: 'never', canAskAgain: true } as never;
}

function pickedAsset(overrides: Partial<{ uri: string; fileSize: number; mimeType: string }> = {}) {
  return {
    canceled: false,
    assets: [{ uri: 'file:///tmp/photo.jpg', width: 512, height: 512, fileSize: 1024, mimeType: 'image/jpeg', ...overrides }],
  } as never;
}

describe('useProfilePicture', () => {
  beforeEach(() => {
    mockedPicker.requestMediaLibraryPermissionsAsync.mockReset();
    mockedPicker.launchImageLibraryAsync.mockReset();
    api.mockReset();
  });

  it('returns null (no error) when library access is denied', async () => {
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied', expires: 'never', canAskAgain: true } as never);
    const { result } = await renderHook(() => useProfilePicture());

    let outcome;
    await act(async () => {
      outcome = await result.current.pickAndUpload();
    });

    expect(outcome).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it('returns null when the teacher cancels the picker', async () => {
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce(grantedPermission());
    mockedPicker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: null } as never);
    const { result } = await renderHook(() => useProfilePicture());

    let outcome;
    await act(async () => {
      outcome = await result.current.pickAndUpload();
    });

    expect(outcome).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it('rejects a photo larger than the size cap without calling the API', async () => {
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce(grantedPermission());
    mockedPicker.launchImageLibraryAsync.mockResolvedValueOnce(pickedAsset({ fileSize: 6 * 1024 * 1024 }));
    const { result } = await renderHook(() => useProfilePicture());

    let outcome;
    await act(async () => {
      outcome = await result.current.pickAndUpload();
    });

    expect(outcome).toEqual({ error: 'The photo is too large. Maximum size is 5MB.' });
    expect(api).not.toHaveBeenCalled();
  });

  it('rejects an unsupported file type without calling the API', async () => {
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce(grantedPermission());
    mockedPicker.launchImageLibraryAsync.mockResolvedValueOnce(pickedAsset({ mimeType: 'image/gif' }));
    const { result } = await renderHook(() => useProfilePicture());

    let outcome;
    await act(async () => {
      outcome = await result.current.pickAndUpload();
    });

    expect(outcome).toEqual({ error: 'Unsupported file type. Please choose a JPEG, PNG, or WEBP image.' });
    expect(api).not.toHaveBeenCalled();
  });

  it('uploads a valid picked photo as multipart form data and returns the updated user', async () => {
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce(grantedPermission());
    mockedPicker.launchImageLibraryAsync.mockResolvedValueOnce(pickedAsset());
    api.mockResolvedValueOnce({ user: USER });
    const { result } = await renderHook(() => useProfilePicture());

    let outcome;
    await act(async () => {
      outcome = await result.current.pickAndUpload();
    });

    expect(outcome).toEqual({ user: USER });
    expect(api).toHaveBeenCalledTimes(1);
    const [path, options] = api.mock.calls[0];
    expect(path).toBe('/auth/me/avatar');
    expect(options.method).toBe('POST');
    expect(options.body).toBeInstanceOf(FormData);
  });

  it('surfaces an ApiError message when the upload request fails', async () => {
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce(grantedPermission());
    mockedPicker.launchImageLibraryAsync.mockResolvedValueOnce(pickedAsset());
    const { ApiError } = jest.requireActual('../../api/client');
    api.mockRejectedValueOnce(new ApiError('The photo is too large. Maximum size is 5MB.', 400));
    const { result } = await renderHook(() => useProfilePicture());

    let outcome;
    await act(async () => {
      outcome = await result.current.pickAndUpload();
    });

    expect(outcome).toEqual({ error: 'The photo is too large. Maximum size is 5MB.' });
  });

  it('removes the photo via DELETE and returns the updated user', async () => {
    api.mockResolvedValueOnce({ user: { ...USER, avatarUrl: null } });
    const { result } = await renderHook(() => useProfilePicture());

    let outcome;
    await act(async () => {
      outcome = await result.current.remove();
    });

    expect(api).toHaveBeenCalledWith('/auth/me/avatar', { method: 'DELETE' });
    expect(outcome).toEqual({ user: { ...USER, avatarUrl: null } });
  });

  it('surfaces a fallback error message when removal fails without an ApiError', async () => {
    api.mockRejectedValueOnce(new Error('network down'));
    const { result } = await renderHook(() => useProfilePicture());

    let outcome;
    await act(async () => {
      outcome = await result.current.remove();
    });

    expect(outcome).toEqual({ error: 'Could not remove photo. Please try again.' });
  });
});
