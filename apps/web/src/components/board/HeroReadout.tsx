import { RelativeTime } from "@/components/RelativeTime";
import type { BoardMetrics } from "@/lib/board/metrics";

/**
 * What the chamber is showing, in words.
 *
 * The headline is a live count and not a slogan, because brand/brand.md asks
 * for evidence over claims: "state what ran and what happened; let the numbers
 * do the arguing". The one sentence that is a claim comes after the number and
 * says the thing no other review bot can say.
 *
 * Set inside the chamber, so it takes the viewport's own colours rather than
 * the page's.
 */

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function HeroReadout({ metrics }: { metrics: BoardMetrics }) {
  return (
    <div className="pointer-events-none max-w-2xl">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--chamber-fg-muted)]">
        Containment record
      </p>
      {/* `total` is runs, not pull requests: a new head on the same pull
          request is a new run, so the two numbers differ and the headline has
          to name the one it is counting. The pull request count is a stat
          below. */}
      <h1 className="mt-4 text-balance font-display text-4xl leading-[1.05] tracking-[-0.03em] text-[var(--chamber-fg)] sm:text-5xl lg:text-6xl">
        {metrics.total === 0 ? (
          <>Nothing has been executed here yet.</>
        ) : (
          <>
            {metrics.total} {plural(metrics.total, "run", "runs")}, executed in a sealed sandbox.
          </>
        )}
      </h1>
      <p className="mt-5 max-w-md font-mono text-sm leading-relaxed text-[var(--chamber-fg-muted)]">
        Every verdict below came from running the code, not reading it. Each specimen is one run:
        four arms, one per check, as long as the check watched.
      </p>
      {metrics.total > 0 ? (
        <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-3 font-mono text-xs text-[var(--chamber-fg-muted)]">
          <Stat label="pull requests" value={String(metrics.pullRequests)} />
          <Stat
            label={plural(metrics.repos, "repository", "repositories")}
            value={String(metrics.repos)}
          />
          <Stat label="live now" value={String(metrics.live)} />
          {metrics.newestAt ? (
            <Stat label="last run" value={<RelativeTime iso={metrics.newestAt} />} />
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="uppercase tracking-[0.16em]">{label}</dt>
      <dd className="mt-1 text-base text-[var(--chamber-fg)]">{value}</dd>
    </div>
  );
}
