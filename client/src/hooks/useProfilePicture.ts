import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { AVATAR_ACCEPTED_MIME_TYPES, AVATAR_MAX_RAW_SIZE_MB, AVATAR_TARGET_DIMENSION_PX } from '../config';
import type { User } from '../types';

export type ProfilePictureResult = { user: User } | { error: string };

// Client-side checks are a courtesy, not the real gate — same split as
// lib/attachmentValidation.ts. The server re-validates by magic bytes
// (server/src/routes/avatar.js) regardless of what's checked here.
function validatePickedFile(file: File): string | null {
  if (file.size === 0) return 'This file is empty.';
  if (file.size > AVATAR_MAX_RAW_SIZE_MB * 1024 * 1024) {
    return `The photo is too large. Maximum size is ${AVATAR_MAX_RAW_SIZE_MB}MB.`;
  }
  if (!AVATAR_ACCEPTED_MIME_TYPES.includes(file.type)) {
    return 'Unsupported file type. Please choose a JPEG, PNG, or WEBP image.';
  }
  return null;
}

/**
 * Center-crops to a square and downsizes to AVATAR_TARGET_DIMENSION_PX before
 * upload — every avatar render site (TopBar, Settings preview) shows a
 * circle, so this keeps every uploaded photo visually consistent and keeps
 * stored bytes small regardless of the original photo's size/aspect ratio.
 * Re-encoding through canvas also strips EXIF metadata (e.g. GPS tags some
 * phone cameras embed) as a side effect.
 */
async function resizeToSquareJpeg(file: File, targetPx: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = targetPx;
    canvas.height = targetPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process the image on this device.');
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, targetPx, targetPx);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not process the image.'))),
        'image/jpeg',
        0.9
      );
    });
  } finally {
    bitmap.close();
  }
}

export interface UseProfilePictureResult {
  /** True while a pick-to-upload round trip is in flight (resize + POST, or the DELETE call). */
  uploading: boolean;
  /** Local object-URL preview of the file being uploaded right now; null once the request settles. */
  previewUrl: string | null;
  /**
   * Validates, center-crops/resizes, and uploads a picked file.
   * Returns a discriminated result rather than throwing or relying on a
   * separate error-state field, so the caller can toast the message
   * immediately without a stale-closure read of hook state.
   */
  upload: (file: File) => Promise<ProfilePictureResult>;
  /** Removes the caller's custom photo. Same result contract as upload(). */
  remove: () => Promise<ProfilePictureResult>;
}

export function useProfilePicture(): UseProfilePictureResult {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    []
  );

  const clearPreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }, []);

  const upload = useCallback(
    async (file: File): Promise<ProfilePictureResult> => {
      const validationError = validatePickedFile(file);
      if (validationError) return { error: validationError };

      const localUrl = URL.createObjectURL(file);
      previewUrlRef.current = localUrl;
      setPreviewUrl(localUrl);
      setUploading(true);
      try {
        const resized = await resizeToSquareJpeg(file, AVATAR_TARGET_DIMENSION_PX);
        const form = new FormData();
        form.append('photo', resized, 'avatar.jpg');
        const res = await api<{ user: User }>('/auth/me/avatar', { method: 'POST', body: form });
        return { user: res.user };
      } catch (err) {
        return { error: err instanceof ApiError ? err.message : 'Could not upload photo. Please try again.' };
      } finally {
        setUploading(false);
        clearPreview();
      }
    },
    [clearPreview]
  );

  const remove = useCallback(async (): Promise<ProfilePictureResult> => {
    setUploading(true);
    try {
      const res = await api<{ user: User }>('/auth/me/avatar', { method: 'DELETE' });
      return { user: res.user };
    } catch (err) {
      return { error: err instanceof ApiError ? err.message : 'Could not remove photo. Please try again.' };
    } finally {
      setUploading(false);
    }
  }, []);

  return { uploading, previewUrl, upload, remove };
}
