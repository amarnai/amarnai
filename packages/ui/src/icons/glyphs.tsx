import type { SVGAttributes } from "react";
import { navIconDefs, type NavIconName, type IconShape } from "@aziru/tokens";

// Shared inline SVG glyphs used across folder/taxonomy views so the same
// folder appears with the same icon everywhere. Paths are stroked with
// `currentColor`; callers set the color via CSS so these stay token-driven.

/** Regular folder — rounded body and tab. Shared by the emails folder tree
 *  and the taxonomy canvas. */
export const FOLDER_GLYPH = `<path d="M1.6 3.8a1 1 0 0 1 1-1h2l1 1.2h3.8a1 1 0 0 1 1 1v3.8a1 1 0 0 1-1 1h-6.8a1 1 0 0 1-1-1z" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Muted/ignored folder. */
export const MUTE_GLYPH = `<path d="M4 5.5v3h2L9 11V3L6 5.5H4z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`;

export interface GlyphProps {
  /** One of the *_GLYPH path strings from this module. */
  svg: string;
  /** Rendered box in px; the viewBox is always 0 0 12 12. */
  size?: number;
}

/** Renders a shared glyph at the given size, inheriting color from `currentColor`. */
export function Glyph({ svg, size = 12 }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function renderShape(shape: IconShape, i: number) {
  if ("fill" in shape && shape.fill) {
    return <path key={i} d={shape.d} fill={shape.fill} fillRule={shape.fillRule} />;
  }
  const s = shape as Extract<IconShape, { stroke: string }>;
  if (s.kind === "rect") {
    return (
      <rect
        key={i}
        x={s.x}
        y={s.y}
        width={s.w}
        height={s.h}
        rx={s.rx}
        stroke={s.stroke}
        strokeWidth={s.strokeWidth}
        fill="none"
      />
    );
  }
  return (
    <path
      key={i}
      d={s.d}
      stroke={s.stroke}
      strokeWidth={s.strokeWidth}
      strokeLinecap={s.strokeLinecap as SVGAttributes<SVGPathElement>["strokeLinecap"]}
      strokeLinejoin={s.strokeLinejoin as SVGAttributes<SVGPathElement>["strokeLinejoin"]}
      fill="none"
    />
  );
}

export interface NavGlyphProps {
  /** Icon name from the shared token icon set. */
  name: NavIconName;
  /** Rendered box in px. */
  size?: number;
  className?: string;
}

/** Renders a shared nav icon from the token icon set (single source used by
 *  the sidebar and the taxonomy inbox root), inheriting `currentColor`. */
export function NavGlyph({ name, size = 16, className }: NavGlyphProps) {
  const def = navIconDefs[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox={def.viewBox}
      fill="none"
      aria-hidden
      className={className}
    >
      {def.shapes.map((shape, i) => renderShape(shape, i))}
    </svg>
  );
}
