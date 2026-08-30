import { neighbours } from "@/lib/docs/nav";
import Link from "next/link";

/**
 * Where to go next, at the point a reader has finished a page.
 *
 * The sidebar already lists everything; this exists because a reader at the
 * bottom of a page has just answered one question and the useful thing to offer
 * is the next question, not the whole list again. `neighbours` does not wrap,
 * so the last page offers nothing forward — a manual that loops from its end to
 * its beginning is telling the reader they missed something.
 */
export function DocsFooterNav({ href }: { href: string }) {
  const { prev, next } = neighbours(href);
  if (!prev && !next) return null;
  return (
    <nav
      aria-label="Previous and next"
      className="mt-16 flex flex-wrap justify-between gap-6 border-line border-t pt-6"
    >
      {prev ? (
        <Link href={prev.href} className="group max-w-[24ch] no-underline" rel="prev">
          <span className="block font-mono text-xs uppercase tracking-[0.16em] text-fg-muted">
            Previous
          </span>
          <span className="mt-1 block font-mono text-sm text-fg group-hover:text-accent">
            {prev.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next.href} className="group max-w-[24ch] text-right no-underline" rel="next">
          <span className="block font-mono text-xs uppercase tracking-[0.16em] text-fg-muted">
            Next
          </span>
          <span className="mt-1 block font-mono text-sm text-fg group-hover:text-accent">
            {next.title}
          </span>
        </Link>
      ) : null}
    </nav>
  );
}
