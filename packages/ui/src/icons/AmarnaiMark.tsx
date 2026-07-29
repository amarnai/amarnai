export interface AmarnaiMarkProps {
  size?: number;
  className?: string;
}

/**
 * The Amarnai mark, filled with `currentColor`.
 *
 * The shipped app icon (public/icons/*.png, public/logo.png) is a raster on an
 * opaque warm-white plate, so it cannot sit on a tinted surface and goes soft
 * above its source size. This is the same three-shape mark as flat geometry:
 * use it wherever the mark needs to take the surrounding colour (inside the
 * accent CTA) or scale freely. The plated icon stays the right choice where the
 * browser itself shows it — toolbar, extensions list, store listing.
 *
 * The viewBox is squared around the mark's own bounds, so `size` is the drawn
 * height and there is no built-in padding to compensate for.
 */
export function AmarnaiMark({ size = 16, className }: AmarnaiMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="17 17 94 94"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M64 17 82 30 87 29 103 17 93 59 84 111Z" />
      <path d="M26 42 69 56 25 69 35 56Z" />
      <path d="M25 75 69 89 25 103 35 90Z" />
    </svg>
  );
}
