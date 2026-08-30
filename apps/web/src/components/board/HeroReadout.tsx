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

/**
 * How a run gets here, shown only when none has.
 *
 * Numbered markers are the one structural device this page could reach for and
 * usually should not: nothing else on the board is a sequence. This is. The
 * steps happen in this order and the reader has to do them in this order, so
 * the numbers carry information rather than decorating three paragraphs.
 */
const ONBOARDING = [
  "Install Cujo on a repository.",
  "Open a pull request, or push to one that is open.",
  "Cujo clones the head into a disposable sandbox and runs it. The verdict lands here.",
];

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function HeroReadout({
  metrics,
  interactive = false,
}: {
  metrics: BoardMetrics;
  /** True once the scene is up, which is the only state where a click works. */
  interactive?: boolean;
}) {
  const empty = metrics.total === 0;
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
        {empty ? (
          <>Nothing has been executed here yet.</>
        ) : (
          <>
            {metrics.total} {plural(metrics.total, "run", "runs")}, executed in a sealed sandbox.
          </>
        )}
      </h1>
      <p className="mt-5 max-w-md font-mono text-sm leading-relaxed text-[var(--chamber-fg-muted)]">
        {empty
          ? "The chamber is empty and the instrument is on. Every verdict it draws comes from running the code, not reading it."
          : "Every verdict below came from running the code, not reading it. Each specimen is one run: four arms, one per check, as long as the check watched."}
      </p>

      {empty ? (
        <ol className="mt-8 flex max-w-md flex-col gap-3 font-mono text-xs leading-relaxed text-[var(--chamber-fg-muted)]">
          {ONBOARDING.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="shrink-0 tabular-nums text-[var(--chamber-amber)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      ) : (
        <>
          {/* A grid and not a wrapping row: five readings on one line put the
              last alone on a second, which reads as an afterthought rather than
              as the fifth of five. Three columns and not five, because a
              five-column measure here breaks `pull requests` across two lines
              and the row stops sharing a baseline. */}
          <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5 font-mono text-xs text-[var(--chamber-fg-muted)] sm:grid-cols-3">
            <Stat label="pull requests" value={String(metrics.pullRequests)} />
            <Stat
              label={plural(metrics.repos, "repository", "repositories")}
              value={String(metrics.repos)}
            />
            <Stat label="live now" value={String(metrics.live)} />
            {/* What the checks found, not how many runs went badly — the
                verdict count says that. Critical is called out in its own
                colour because it is the one number on this line that means
                somebody has to look. */}
            <Stat
              label="findings"
              value={metrics.findings.total}
              note={
                metrics.findings.bySeverity.critical > 0 ? (
                  <span className="text-[var(--chamber-critical)]">
                    {metrics.findings.bySeverity.critical} critical
                  </span>
                ) : null
              }
            />
            {metrics.newestAt ? (
              <Stat label="last run" value={<RelativeTime iso={metrics.newestAt} />} />
            ) : null}
          </dl>
          {interactive ? (
            <p className="mt-6 font-mono text-xs text-[var(--chamber-fg-muted)]">
              Click a specimen to find its run in the record below.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  /** A second line under the reading, for the part of it that is a warning. */
  note?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="uppercase tracking-[0.16em]">{label}</dt>
      <dd className="mt-1 text-base text-[var(--chamber-fg)]">
        {value}
        {note ? <span className="mt-0.5 block text-xs">{note}</span> : null}
      </dd>
    </div>
  );
}
