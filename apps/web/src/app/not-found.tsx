import Link from "next/link";

/**
 * The answer for a path the board does not serve, which since decision 57 is
 * every path but two. The link below is the whole point of the page: a reader
 * who followed a stale link gets a way back rather than the framework's own
 * bare 404 — and it carries its own, because the header that used to hold one
 * is gone and the mark that replaced it is placed by pages that have a ground
 * for it.
 */
export default function NotFound() {
  return (
    // The column the layout used to impose on every page. It stayed with the
    // pages that want it when the board took the full window.
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-2 text-2xl">No such page</h1>
      <p className="mb-6 max-w-[60ch] text-sm text-fg-muted">
        The board has two kinds of page — the list of runs, and one page per run — plus the
        documentation. Nothing else is served here.
      </p>
      <div className="flex gap-6">
        <Link href="/" className="text-sm text-accent underline underline-offset-4">
          All runs
        </Link>
        <Link href="/docs" className="text-sm text-accent underline underline-offset-4">
          Docs
        </Link>
      </div>
    </div>
  );
}
