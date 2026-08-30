/**
 * The disclosure glyph, drawn rather than installed, on the same 64-unit grid
 * as `ThemeIcons.tsx` and the mark: one filled triangle, `currentColor`, no
 * stroke and no round cap, so it reads as the mark's family and not as a
 * borrowed icon set (brand/brand.md).
 *
 * It replaced the words `expand` and `collapse`. Those said what a click would
 * do, in a face and a size that made them look like a fifth column of data on a
 * row that already had four — and a row whose control is a word at its right
 * edge reads as though only that word is the control, which was never true:
 * the whole row has always been the trigger.
 */
export function Chevron({ open, className = "" }: { open: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      // The rotation is the state, so it is the thing that moves. Suppressed
      // under reduced motion by the global rule in `globals.css`, which turns
      // every transition off.
      className={`h-3 w-3 shrink-0 transition-transform duration-150 ${
        open ? "rotate-180" : ""
      } ${className}`}
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <polygon fill="currentColor" points="12,24 52,24 32,46" />
    </svg>
  );
}
