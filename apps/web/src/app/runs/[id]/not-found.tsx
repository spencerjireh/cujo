import Link from "next/link";

export default function NotFound() {
  return (
    <div>
      <h1 className="mb-2 text-2xl">No such run</h1>
      <p className="mb-6 max-w-[60ch] text-sm text-fg-muted">
        This run is not in the store. A run is recorded per pull request head, so an old link stops
        resolving once its database is reset.
      </p>
      <Link href="/" className="text-sm text-accent underline underline-offset-4">
        All runs
      </Link>
    </div>
  );
}
