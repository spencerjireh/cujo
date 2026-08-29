import type { RunStatus } from "@/lib/api/types";
import type { BoardMetrics, SensorRow } from "@/lib/board/metrics";
import { STATUS_LEGEND, TONE_FILL, TONE_TEXT, isVerdict } from "@/lib/board/tone";
import { duration } from "@/lib/format";

/**
 * Four instrument strips under the chamber, on one hairline grid.
 *
 * Not stat cards. A card with a large number and a caption tells you the number
 * and nothing about its shape; each strip here draws the distribution it is
 * summarising, and puts the number beside it rather than instead of it.
 *
 * Every panel that reports an average also reports how many runs it measured,
 * because the list caps at a hundred and several runs carry no digest at all. A
 * median over four runs and a median over twenty-six are different claims.
 */

export function ReadoutRack({ metrics }: { metrics: BoardMetrics }) {
  if (metrics.total === 0) return null;
  return (
    <section aria-label="Summary of the record" className="border-line border-t">
      <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0 lg:grid-cols-4">
        <Panel title="verdicts" note={`${metrics.total} runs`}>
          <VerdictRibbon metrics={metrics} />
        </Panel>
        <Panel
          title="checks"
          note={metrics.unmeasured > 0 ? `${metrics.unmeasured} unmeasured` : "all measured"}
        >
          <Sensors rows={metrics.sensors} />
        </Panel>
        <Panel title="activity" note={activityNote(metrics)}>
          <Activity metrics={metrics} />
        </Panel>
        <Panel title="time to verdict" note={`${metrics.duration.measured} measured`}>
          <Durations metrics={metrics} />
        </Panel>
      </div>
    </section>
  );
}

/**
 * The window the strip covers, in the units it actually bucketed by. Read back
 * off the buckets rather than recomputed, so the caption cannot claim hours
 * while the axis is drawing days.
 */
function activityNote(metrics: BoardMetrics): string {
  const [first, second] = metrics.activity;
  if (!first) return "no runs";
  if (!second) return "one bucket";
  const stepMs = Date.parse(second.startsAt) - Date.parse(first.startsAt);
  const spanMs = stepMs * metrics.activity.length;
  const hours = Math.round(spanMs / 3_600_000);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-6 md:px-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg">{title}</h2>
        <span className="font-mono text-xs text-fg-muted">{note}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * A run that reached no conclusion is drawn at reduced strength in its own hue.
 * `clean` and `error` are both info blue by brand rule, which made two legend
 * rows identical; this keeps the rule and tells them apart.
 */
function swatchStrength(status: RunStatus): string {
  return isVerdict(status) ? "" : "opacity-45";
}

function VerdictRibbon({ metrics }: { metrics: BoardMetrics }) {
  return (
    <div>
      {/* Solid fills with a hairline gap between them. A one-run slice at this
          width is two pixels, so the legend below carries the counts and the
          ribbon carries only the proportion. */}
      <div className="flex h-2 w-full gap-px" aria-hidden="true">
        {metrics.verdicts.map((slice) => (
          <span
            key={slice.status}
            className={`min-w-0.5 ${TONE_FILL[slice.tone]} ${swatchStrength(slice.status)}`}
            style={{ width: `${slice.share * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-4 flex flex-col gap-1.5 font-mono text-xs">
        {metrics.verdicts.map((slice) => (
          <li key={slice.status} className="flex items-baseline gap-2">
            <span
              className={`h-2 w-2 shrink-0 translate-y-px ${TONE_FILL[slice.tone]} ${swatchStrength(slice.status)}`}
              aria-hidden="true"
            />
            <span className={TONE_TEXT[slice.tone]}>{STATUS_LEGEND[slice.status]}</span>
            <span className="ml-auto text-fg-muted">{slice.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Sensors({ rows }: { rows: SensorRow[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const total = Math.max(row.observed, 1);
        return (
          <li key={row.name}>
            <div className="flex items-baseline justify-between gap-3 font-mono text-xs">
              <span className="text-fg">{row.name}</span>
              {/* The sample size travels with the median, because the panel
                  note above cannot carry it: that counts runs with no digest
                  at all, and a check can also be present with no duration. A
                  median over one run and one over twenty-six are different
                  claims, and only this says which. */}
              <span className="text-fg-muted">
                {row.medianMs === null ? (
                  "not timed"
                ) : (
                  <>
                    {duration(new Date(0).toISOString(), new Date(row.medianMs).toISOString()) ??
                      "not timed"}
                    <span className="ml-2 opacity-70">n={row.measured}</span>
                  </>
                )}
              </span>
            </div>
            <div className="mt-1.5 flex h-1.5 w-full gap-px overflow-hidden">
              <Segment share={row.done / total} className="bg-fg" />
              <Segment share={row.error / total} className="bg-sev-critical" />
              <Segment share={row.running / total} className="bg-sev-info" />
              {/* A check that never appeared reads as a gap, the way it does on
                  a specimen: `check_missing` is not the same fact as a failure. */}
              <Segment share={row.absent / total} className="bg-line" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Segment({ share, className }: { share: number; className: string }) {
  if (share <= 0) return null;
  return <span className={className} style={{ width: `${share * 100}%` }} />;
}

function Activity({ metrics }: { metrics: BoardMetrics }) {
  const peak = Math.max(1, ...metrics.activity.map((bucket) => bucket.count));
  return (
    <div>
      <div className="flex h-16 items-end gap-px" aria-hidden="true">
        {metrics.activity.map((bucket) => (
          <span
            key={bucket.startsAt}
            className={`min-w-px flex-1 ${bucket.count === 0 ? "bg-line" : "bg-fg-muted"}`}
            // Empty buckets are kept and drawn as a floor tick: dropping them
            // would render a busy night and a quiet week identically.
            style={{ height: `${Math.max(bucket.count / peak, 0.04) * 100}%` }}
          />
        ))}
      </div>
      <p className="mt-3 font-mono text-xs text-fg-muted">
        peak {peak} {peak === 1 ? "run" : "runs"}
      </p>
    </div>
  );
}

function Durations({ metrics }: { metrics: BoardMetrics }) {
  const { p50, p95, fastest, slowest } = metrics.duration;
  if (p50 === null || fastest === null || slowest === null) {
    return (
      <p className="font-mono text-xs text-fg-muted">
        No run has reported a duration yet. A run is timed from the first check that starts to the
        last one that ends.
      </p>
    );
  }
  const span = Math.max(slowest - fastest, 1);
  const at = (ms: number) => ((ms - fastest) / span) * 100;
  return (
    <div>
      <div className="relative h-3" aria-hidden="true">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
        <span
          className="absolute top-1/2 h-1.5 -translate-y-1/2 bg-fg-muted opacity-40"
          style={{ left: `${at(p50)}%`, width: `${Math.max(at(p95 ?? p50) - at(p50), 1)}%` }}
        />
        <span
          className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-accent-fill"
          style={{ left: `${at(p50)}%` }}
        />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-y-2 font-mono text-xs">
        <Reading label="median" ms={p50} />
        <Reading label="p95" ms={p95} />
        <Reading label="fastest" ms={fastest} />
        <Reading label="slowest" ms={slowest} />
      </dl>
    </div>
  );
}

function Reading({ label, ms }: { label: string; ms: number | null }) {
  return (
    <div>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-fg">
        {ms === null
          ? "—"
          : (duration(new Date(0).toISOString(), new Date(ms).toISOString()) ?? "—")}
      </dd>
    </div>
  );
}
