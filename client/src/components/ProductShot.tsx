// A real SarasTech screen capture (client/public/product/<name>-light.png and -dark.png, taken from the running product with a
// real Gemini answer, never a mock-up), framed for the marketing page. CSS swaps light/dark with the site theme
// (.product-shot-img in index.css); the hidden one is display:none, so it's neither painted nor fetched (loading="lazy") and
// only the visible one reaches assistive tech. `width`/`height` are the CSS size (captures are 2x) and reserve space so nothing
// shifts. `fade` clamps the frame to `maxHeight` and fades the bottom edge so a long screen isn't cut mid-line.

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
