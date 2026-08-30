import { RelativeTime } from "@/components/RelativeTime";
import type { BoardMetrics } from "@/lib/board/metrics";

/**
 * What the chamber is showing, in words — in two pieces, top and bottom of the
 * frame, with the volume between them.
 *
 * One block anchored to the bottom left left the top of a full-height hero with
 * nothing in it at all, and gave the eye no reason to travel the frame. Split,
 * the readout uses the height it is standing in: the panel label and the claim
 * where a reader starts, the readings where they finish.
 *
 * **The order of the claim changed too.** It used to read "containment record",
 * "executed in a sealed sandbox", "running the code, not reading it" — three
 * statements about the mechanism and none about the job, so a first-time reader
 * never learned that this reviews pull requests. The count is still a count and
 * not a slogan, which is what brand.md asks for; it just counts the noun the
 * product is about, and the sandbox comes second, where a mechanism belongs.
 *
 * Set inside the chamber, so both halves take the viewport's own colours rather
 * than the page's.
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

/** The top of the frame: what this is, and how many of them there have been. */
export function HeroLead({ metrics }: { metrics: BoardMetrics }) {
  const empty = metrics.total === 0;
  return (
    <div className="pointer-events-none max-w-2xl">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--chamber-fg-muted)]">
        Pull request review
      </p>
      {/* Pull requests, not runs: a new head on the same pull request is a new
          run, so the two numbers differ and this is the one a reader is here
          for. The run count moves to the readings below, beside the drawing
          that is made of runs. */}
      <h1 className="mt-4 text-balance font-display text-4xl leading-[1.05] tracking-[-0.03em] text-[var(--chamber-fg)] sm:text-5xl lg:text-6xl">
        {empty ? (
          <>Nothing has been executed here yet.</>
        ) : (
          <>
            {metrics.pullRequests} {plural(metrics.pullRequests, "pull request", "pull requests")},
            reviewed by running them.
          </>
        )}
      </h1>
      {/* One line, and only while there is nothing to read. With a record on
          screen the headline says what this is and the drawing says the rest;
          a paragraph beside a galaxy was read by nobody (decision 83). */}
      {empty ? (
        <p className="mt-5 max-w-md font-mono text-sm leading-relaxed text-[var(--chamber-fg-muted)]">
          The chamber is empty and the instrument is on. Every verdict it draws comes from running
          the code, not reading it.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The bottom of the frame: the readings, and how to read the drawing.
 *
 * The specimen sentence lives here rather than under the headline because it is
 * a legend and not a pitch — it belongs beside the thing it is a legend to.
 */
export function HeroStats({
  metrics,
  interactive = false,
}: {
  metrics: BoardMetrics;
  /** True once the scene is up, which is the only state where a click works. */
  interactive?: boolean;
}) {
  if (metrics.total === 0) {
    return (
      <ol className="pointer-events-none flex max-w-md flex-col gap-3 font-mono text-xs leading-relaxed text-[var(--chamber-fg-muted)]">
        {ONBOARDING.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="shrink-0 tabular-nums text-[var(--chamber-amber)]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="pointer-events-none max-w-2xl">
      {/* A grid and not a wrapping row: five readings on one line put the last
          alone on a second, which reads as an afterthought rather than as the
          fifth of five. Three columns and not five, because a five-column
          measure here breaks a label across two lines and the row stops
          sharing a baseline. */}
      {/* Ordered by what a reader came to learn. What the checks found comes
          first, with critical called out in its own colour because it is the
          one number here that means somebody has to look; then what is
          running now; and only then the size of the record, which is context
          and not a reading. The counts used to lead, and a page with four
          criticals on it opened with "1 repository". */}
      <dl className="grid grid-cols-2 gap-x-8 gap-y-5 font-mono text-xs text-[var(--chamber-fg-muted)] sm:grid-cols-3">
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
        <Stat label="live now" value={String(metrics.live)} />
        {metrics.newestAt ? (
          <Stat label="last run" value={<RelativeTime iso={metrics.newestAt} />} />
        ) : null}
        <Stat label={plural(metrics.total, "run", "runs")} value={String(metrics.total)} />
        <Stat
          label={plural(metrics.repos, "repository", "repositories")}
          value={String(metrics.repos)}
        />
      </dl>
      {/* One sentence, which is all a reader needs to decode the drawing; the
          key below the record carries the rest (decision 83). */}
      <p className="mt-6 max-w-md font-mono text-xs leading-relaxed text-[var(--chamber-fg-muted)]">
        Each star is one run. Colour is the verdict, rings are checks, dots are findings.
        {interactive ? " Click one to find its run below." : null}
      </p>
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
