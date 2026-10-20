import Link from "next/link";

/** A documentation path that is not a page. The sidebar beside it is the index. */
export default function NotFound() {
  return (
    <div>
      <h1 className="mb-2 text-2xl">No such page</h1>
      <p className="mb-6 max-w-[60ch] font-mono text-sm text-fg-muted">
        This page does not exist. The list beside this shows every page.
      </p>
      <Link href="/docs" className="font-mono text-sm text-accent underline underline-offset-4">
        Start of the docs
      </Link>
    </div>
  );
}
