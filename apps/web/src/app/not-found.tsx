import Link from "next/link";

/**
 * The answer for a path the board does not serve, which since decision 57 is
 * every path but two. Next renders this inside the root layout, so a link left
 * over from the deleted operator plane keeps the header and a way back rather
 * than dropping the reader on the framework's own bare 404.
 */
export default function NotFound() {
  return (
    <div>
      <h1 className="mb-2 text-2xl">No such page</h1>
      <p className="mb-6 max-w-[60ch] text-sm text-fg-muted">
        The board has two kinds of page: the list of runs, and one page per run. Nothing else is
        served here.
      </p>
      <Link href="/" className="text-sm text-accent underline underline-offset-4">
        All runs
      </Link>
    </div>
  );
}
