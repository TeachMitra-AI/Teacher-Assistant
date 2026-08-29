// Mobile port of client/src/hooks/useProfilePicture.ts — same POST/DELETE
// /auth/me/avatar contract and result shape. Picking differs by necessity:
// web reads a <input type="file"> File and center-crops/resizes it via a
// canvas (no canvas API on RN); here expo-image-picker's own allowsEditing
// + aspect:[1,1] does the "square" part natively (the OS's own crop UI,
// letting the teacher choose what to keep rather than a silent center-crop)
// and its `quality` option does the size-reduction part — so no
// expo-image-manipulator dependency is needed on top of expo-image-picker.
import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { api, ApiError } from '../api/client';
import { AVATAR_ACCEPTED_MIME_TYPES, AVATAR_MAX_RAW_SIZE_MB } from '../config';
import type { User } from '../types';

export type ProfilePictureResult = { user: User } | { error: string };

function mimeTypeFor(uri: string, declared?: string | null): string {
  if (declared) return declared;
  const ext = uri.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

export interface UseProfilePictureResult {
  /** True while a pick-to-upload round trip is in flight (upload, or the DELETE call). */
  uploading: boolean;
  /**
   * Opens the device photo library, and on a successful pick, validates and
   * uploads it. Returns null if the teacher cancelled the picker or denied
   * library access (nothing to show — not an error the teacher caused).
   */
  pickAndUpload: () => Promise<ProfilePictureResult | null>;
  /** Removes the caller's custom photo. Same result contract as pickAndUpload(). */
  remove: () => Promise<ProfilePictureResult>;
}

export function useProfilePicture(): UseProfilePictureResult {
  const [uploading, setUploading] = useState(false);

  async function pickAndUpload(): Promise<ProfilePictureResult | null> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return null;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return null;

    const asset = result.assets[0];
    // Client-side checks are a courtesy, not the real gate — same split as
    // the web version. The server re-validates by magic bytes regardless.
    if (typeof asset.fileSize === 'number' && asset.fileSize > AVATAR_MAX_RAW_SIZE_MB * 1024 * 1024) {
      return { error: `The photo is too large. Maximum size is ${AVATAR_MAX_RAW_SIZE_MB}MB.` };
    }
    const mimeType = mimeTypeFor(asset.uri, asset.mimeType);
    if (!AVATAR_ACCEPTED_MIME_TYPES.includes(mimeType)) {
      return { error: 'Unsupported file type. Please choose a JPEG, PNG, or WEBP image.' };
    }

    setUploading(true);
    try {
      const form = new FormData();
      // Expo SDK 57's global `fetch` is its own WinterCG-compliant
      // implementation (see expo/src/winter/fetch), not React Native's old
      // XHR-based one — its FormData→multipart conversion only accepts a
      // real Blob-like part (something with `.bytes()`), not RN's classic
      // `{uri, name, type}` file shape. expo-file-system's `File` wraps a
      // local URI and implements that interface, so it works as the
      // multipart part directly.
      const file = new File(asset.uri);
      form.append('photo', file as unknown as Blob, `avatar.${extensionFor(mimeType)}`);
      const res = await api<{ user: User }>('/auth/me/avatar', { method: 'POST', body: form });
      return { user: res.user };
    } catch (err) {
      return { error: err instanceof ApiError ? err.message : 'Could not upload photo. Please try again.' };
    } finally {
      setUploading(false);
    }
  }

  async function remove(): Promise<ProfilePictureResult> {
    setUploading(true);
    try {
      const res = await api<{ user: User }>('/auth/me/avatar', { method: 'DELETE' });
      return { user: res.user };
    } catch (err) {
      return { error: err instanceof ApiError ? err.message : 'Could not remove photo. Please try again.' };
    } finally {
      setUploading(false);
    }
  }

  return { uploading, pickAndUpload, remove };
}
