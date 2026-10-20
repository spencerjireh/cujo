import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-2 text-2xl">No such run</h1>
      <p className="mb-6 max-w-[60ch] text-sm text-fg-muted">
        This run does not exist or was deleted.
      </p>
      <Link href="/galaxy" className="text-sm text-accent underline underline-offset-4">
        All runs
      </Link>
    </div>
  );
}
