/**
 * The Cujo mark, inlined so it inherits `currentColor` and needs no network
 * request. Geometry is copied from brand/logo/mark.svg; the amber eye is fixed
 * because it is the one part that never takes the text colour (brand/brand.md).
 */
export function Mark({
  className,
  title,
  style,
}: {
  className?: string;
  title?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      style={style}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <polygon
        fill="currentColor"
        points="10,60 10,22 16,4 26,20 40,20 58,32 56,42 42,42 38,52 26,60"
      />
      <circle fill="var(--accent-fill)" cx="40" cy="30" r="3.5" />
    </svg>
  );
}
