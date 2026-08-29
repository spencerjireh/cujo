import { RelativeTime } from "@/components/RelativeTime";
import { StatusBadge } from "@/components/StatusBadge";
import type { Run } from "@/lib/api/types";
import { prUrl, shortSha } from "@/lib/format";

export function RunHeader({ run }: { run: Run }) {
  return (
    <header className="mb-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="wrap-anywhere text-2xl">
          <a
            href={prUrl(run.repo, run.pr_number)}
            target="_blank"
            rel="noreferrer"
            className="text-fg underline decoration-line underline-offset-4 hover:decoration-accent"
          >
            {run.repo} #{run.pr_number}
          </a>
        </h1>
        <StatusBadge status={run.status} />
      </div>
      <p className="mt-2 font-mono text-xs text-fg-muted">
        {shortSha(run.head_sha)} · started <RelativeTime iso={run.created_at} />
      </p>
      {run.summary ? <p className="mt-4 max-w-[68ch] text-sm">{run.summary}</p> : null}
      {run.error ? (
        <p className="mt-3 rounded-md bg-sev-critical-bg px-3 py-2 font-mono text-xs text-sev-critical">
          {run.error}
        </p>
      ) : null}
    </header>
  );
}
