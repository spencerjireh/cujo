/**
 * The three theme glyphs, drawn rather than installed. They are one disc under
 * three light conditions — filled, half, bitten — built from flat polygons and
 * arcs on the same 64-unit grid as brand/logo/mark.svg, with no hairline
 * strokes and no round caps, so they read as the mark's family and not as a
 * borrowed icon set. Everything is `currentColor`, so the parent's text colour
 * is what turns the selected one amber (brand/brand.md, "Colour").
 *
 * Inlined for the reason Mark.tsx gives: no network request, and the glyph
 * inherits the theme it is switching.
 */
import type { CSSProperties, ReactNode } from "react";

type IconProps = {
  className?: string;
  title?: string;
  style?: CSSProperties;
};

function Glyph({ className, title, style, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      style={style}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {children}
    </svg>
  );
}

/** A full disc: four square rays on the axes, none on the diagonals. */
export function LightIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle fill="currentColor" cx="32" cy="32" r="15" />
      <rect fill="currentColor" x="29" y="3" width="6" height="10" />
      <rect fill="currentColor" x="29" y="51" width="6" height="10" />
      <rect fill="currentColor" x="3" y="29" width="10" height="6" />
      <rect fill="currentColor" x="51" y="29" width="10" height="6" />
    </Glyph>
  );
}

/** The same disc, half lit: which half wins is the room's call, not the page's. */
export function SystemIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path fill="currentColor" d="M32,14 A18,18 0 0 0 32,50 Z" />
      <circle fill="none" stroke="currentColor" strokeWidth="6" cx="32" cy="32" r="15" />
    </Glyph>
  );
}

/** The disc with a bite out of it, as one filled path of two arcs. */
export function DarkIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path fill="currentColor" d="M50,39 A19,19 0 1 1 25,14 A19,19 0 0 0 50,39 Z" />
    </Glyph>
  );
}
