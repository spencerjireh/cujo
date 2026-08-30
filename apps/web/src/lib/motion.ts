/**
 * Does this reader want motion?
 *
 * One place, because it was three: `Chamber` and `RunSpecimen` each carried a
 * byte-identical copy of the same guarded `matchMedia` call. A preference this
 * page answers in four different files is one somebody will eventually answer
 * differently in a fifth.
 *
 * Read at mount rather than subscribed to. Both scenes are built around the
 * answer — one of them renders a single frame and never starts a loop — so a
 * change mid-session needs a rebuild, not a re-read.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
