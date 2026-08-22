// Shared PDF export/share helper for Library (docs/mobile-app-plan.md §19,
// §26 Phase 5 — the window.print() replacement), used by both
// ResourceViewScreen and ResourceEditScreen.
//
// Real on-device bugs found and fixed here, confirmed via a physical-device
// run (not guessed), all variants of the same underlying problem — reading
// back printToFileAsync's own output file, from anywhere other than
// expo-print's own internal code, fails under Expo Go on this device/SDK
// combination:
// 1. Sharing printToFileAsync's URI directly: expo-sharing's shareAsync()
//    rejects with "Not allowed to read file under given URL".
// 2. Copying it with expo-file-system's SDK 54+ object-oriented API
//    (`File`/`Paths`): rejects with "Missing 'READ' permission for accessing
//    the file".
// 3. Copying it with expo-file-system's `/legacy` functional API
//    (`copyAsync`): rejects with "... isn't readable" (an IOException), even
//    though the path is inside the app's own cache directory.
// The fix that actually works end-to-end on-device: ask printToFileAsync for
// `base64: true` instead of reading its file back at all, and write those
// bytes ourselves into the cache directory — this never touches print's own
// output file a second time, so none of the three read-back failures above
// can occur.
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

export class SharingUnavailableError extends Error {
  constructor() {
    super('Sharing is not available on this device.');
    this.name = 'SharingUnavailableError';
  }
}

function safeFileName(base: string): string {
  const cleaned = base.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (cleaned || 'resource').slice(0, 60);
}

/** Renders `html` to a PDF and hands it to the native share sheet. */
export async function exportAndSharePdf(html: string, titleForFileName: string): Promise<void> {
  const { base64 } = await Print.printToFileAsync({ html, base64: true });
  if (!base64) throw new Error('Print did not return PDF data.');

  const dest = `${FileSystem.cacheDirectory}${safeFileName(titleForFileName)}.pdf`;
  await FileSystem.writeAsStringAsync(dest, base64, { encoding: 'base64' });

  if (!(await Sharing.isAvailableAsync())) {
    throw new SharingUnavailableError();
  }
  await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: titleForFileName });
}
