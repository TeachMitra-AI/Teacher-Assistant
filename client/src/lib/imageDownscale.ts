// Shrinks a textbook-page photo before upload (Snap-to-Lesson). A phone camera photo is often 3-8MB; at a 1600px long
// edge a page stays legible to Gemini while the upload drops to a few hundred KB, which matters on a slow school
// connection and lowers image tokens. Best-effort only: any failure sends the original file, which the server's own
// size and type checks still govern.

const MAX_LONG_EDGE_PX = 1600;
const JPEG_QUALITY = 0.8;

/**
 * Returns a downscaled JPEG copy of an image larger than MAX_LONG_EDGE_PX, or the original file when it is not an image,
 * is already small enough, re-encoding wouldn't make it smaller, or the browser can't decode or encode it.
 */
export async function downscaleImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    // createImageBitmap applies the photo's EXIF orientation, so a portrait page isn't sent sideways.
    const bitmap = await createImageBitmap(file);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge <= MAX_LONG_EDGE_PX) {
      bitmap.close();
      return file;
    }
    const scale = MAX_LONG_EDGE_PX / longEdge;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    // JPEG has no alpha: transparent areas would encode black and hide dark text, so start from a white page.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]*$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
