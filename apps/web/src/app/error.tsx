"use client";

/**
 * The last resort. An operator who reaches this needs to know whether to retry
 * or to go and look at the stack, so it says which, and offers the way back to
 * the run list rather than leaving a dead end.
 */
// Named rather than `Error` so it does not shadow the global; Next only
// requires the default export.
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div>
      <h1 className="mb-2 text-2xl">Something went wrong</h1>
      <p className="mb-4 max-w-[60ch] text-sm text-fg-muted">
        This page could not be built. The Cujo API may be unreachable; the stack logs will say which
        service is down.
      </p>
      {error.digest ? (
        <p className="mb-4 font-mono text-xs text-fg-muted">digest {error.digest}</p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-line px-4 py-1.5 text-sm transition-colors hover:border-fg-muted"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-md border border-line px-4 py-1.5 text-sm no-underline transition-colors hover:border-fg-muted"
        >
          All runs
        </a>
      </div>
    </div>
  );
}
