// A real SarasTech screen capture (client/public/product/<name>-light.png and
// -dark.png) framed for the marketing page. Each capture is taken from the
// running product with a real Gemini-generated answer — never a mock-up — in a
// light and a dark version; CSS swaps them with the site theme (see
// .product-shot-img in index.css). The hidden one is display:none, so it is
// neither painted nor fetched (loading="lazy"), and only the visible one is
// exposed to assistive tech. `width`/`height` are the image's CSS size
// (captures are 2x) and reserve its space so nothing shifts as it loads.
// `fade` clamps the frame to `maxHeight` and fades the bottom edge into the page
// so a long screen ends gracefully instead of being cut mid-line.

interface ProductShotProps {
  name: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
  fade?: boolean;
  maxHeight?: number;
}

export function ProductShot({ name, alt, width, height, caption, fade = false, maxHeight }: ProductShotProps) {
  return (
    <figure className="product-shot-figure">
      <div
        className={`product-shot${fade ? ' product-shot--fade' : ''}`}
        style={fade && maxHeight ? { maxHeight } : undefined}
      >
        {(['light', 'dark'] as const).map((theme) => (
          <img
            key={theme}
            className={`product-shot-img product-shot-img--${theme}`}
            src={`/product/${name}-${theme}.png`}
            alt={alt}
            width={width}
            height={height}
            loading="lazy"
            decoding="async"
          />
        ))}
      </div>
      {caption && <figcaption className="product-shot-caption">{caption}</figcaption>}
    </figure>
  );
}
