import { Mark } from "@/components/brand/Mark";
import Link from "next/link";

/**
 * The way back to the board, and the only chrome left at the top of a page.
 *
 * There used to be a bar holding this and a theme control. The bar cost the
 * chamber the top of the window and gave back a wordmark and a second copy of a
 * control the footer already carries, so it is gone and this is what remains:
 * the mark and the name, in the corner, scrolling away with the page like
 * anything else on it. The name came back after the bar went: a mark alone
 * reads as an icon, and a reader arriving from a GitHub review has not yet
 * met the icon.
 *
 * Placed by each page rather than by the layout, and that is deliberate. The
 * mark's fill is `currentColor` (brand/brand.md), so what it needs from a page
 * is a text colour, and the two pages sit on different grounds — the board's
 * chamber is dark and never themed, while a run page is on `--bg` and follows
 * the reader's theme. A layout would have to know which page it was rendering
 * to answer that, and a server layout cannot know without being told. Being
 * told by the page is simpler than being told by a hook.
 *
 * It is a `header` so the landmark survives the bar, and it keeps the label the
 * bar's link had: a mark alone is fine where the name is already visible, and
 * on a run page it is not.
 */
export function HomeMark({
  tone = "page",
  className = "",
}: {
  /**
   * Which ground it sits on. `chamber` is the instrument viewport, which is
   * dark in a lit room too and so takes the pinned chamber tokens rather than
   * the page's.
   */
  tone?: "page" | "chamber";
  className?: string;
}) {
  return (
    <header className={`absolute top-4 left-4 z-10 md:top-6 md:left-6 ${className}`}>
      <Link
        href="/"
        aria-label="cujo, all runs"
        // The clear space brand.md asks for — one ear height, about a quarter
        // of the mark — as padding, so the hit target carries it too.
        className={`-m-2 block p-2 no-underline ${
          tone === "chamber" ? "text-[var(--chamber-fg)]" : "text-fg"
        }`}
      >
        <span className="flex items-center gap-2.5">
          <Mark className="h-7 w-7" />
          <span className="font-display text-xl font-bold lowercase tracking-tight">cujo</span>
        </span>
      </Link>
    </header>
  );
}
