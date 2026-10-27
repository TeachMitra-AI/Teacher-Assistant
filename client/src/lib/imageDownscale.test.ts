import { afterEach, describe, expect, test, vi } from 'vitest';
import { downscaleImage } from './imageDownscale';

function fakeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('downscaleImage', () => {
  test('passes a PDF through untouched', async () => {
    const pdf = new File(['%PDF-1.4'], 'chapter.pdf', { type: 'application/pdf' });
    expect(await downscaleImage(pdf)).toBe(pdf);
  });

  test('returns the original when the browser cannot decode the image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));
    const photo = new File(['bytes'], 'page.jpg', { type: 'image/jpeg' });
    expect(await downscaleImage(photo)).toBe(photo);
  });

  test('leaves an image already within 1600px alone', async () => {
    const bitmap = fakeBitmap(1200, 900);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const photo = new File(['bytes'], 'page.jpg', { type: 'image/jpeg' });
    expect(await downscaleImage(photo)).toBe(photo);
    expect(bitmap.close).toHaveBeenCalled();
  });

  test('shrinks a large photo to a 1600px long edge as a JPEG', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(fakeBitmap(4000, 3000)));
    // Records the fill colour at each fill and the call order: JPEG has no alpha, so a transparent PNG would encode black
    // unless the canvas is filled white before the image is drawn.
    const calls: string[] = [];
    const ctx = {
      fillStyle: '',
      fillRect: vi.fn((x: number, y: number, w: number, h: number) => calls.push(`fill ${ctx.fillStyle} ${x},${y},${w},${h}`)),
      drawImage: vi.fn(() => calls.push('draw')),
    };
    const drawImage = ctx.drawImage;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    let size: { width: number; height: number } | null = null;
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb) {
      size = { width: this.width, height: this.height };
      cb(new Blob(['small'], { type: 'image/jpeg' }));
    });
    const photo = new File(['x'.repeat(10_000)], 'page.png', { type: 'image/png' });

    const result = await downscaleImage(photo);

    expect(size).toEqual({ width: 1600, height: 1200 });
    expect(drawImage).toHaveBeenCalled();
    expect(calls).toEqual(['fill #fff 0,0,1600,1200', 'draw']);
    expect(result).not.toBe(photo);
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('page.jpg');
    expect(result.size).toBeLessThan(photo.size);
  });

  test('keeps the original when re-encoding would not make it smaller', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(fakeBitmap(4000, 3000)));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
      cb(new Blob(['x'.repeat(100)], { type: 'image/jpeg' }));
    });
    const photo = new File(['tiny'], 'page.jpg', { type: 'image/jpeg' });
    expect(await downscaleImage(photo)).toBe(photo);
  });
});
