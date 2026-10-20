import { RUN_STATUSES, SEVERITIES } from "@/lib/api/types";
import {
  SEVERITY_TONE,
  STATUS_LEGEND,
  TONE_FILL,
  TONE_TEXT,
  isVerdict,
  statusTone,
} from "@/lib/board/tone";
import { SpecimenDiagram } from "./SpecimenDiagram";

/**
 * The key to the chamber.
 *
 * The hero draws every run as a star system and then says, in one sentence,
 * that colour is the verdict, rings are checks and dots are findings. That is
 * enough to make it look deliberate and not enough to read it. This is the
 * rest: one specimen at a size where its parts are legible, each part named
 * in one line, and then the two vocabularies the whole board is written in —
 * the eight verdicts and the three severities. One line per part and not a
 * paragraph (decision 83): a key is read while looking at the thing, and a
 * reader who wants the reasoning has the run page.
 *
 * The lists come from `RUN_STATUSES`, `SEVERITIES` and the tone maps rather
 * than from prose, so a status added in `apps/cujo` appears here without anyone
 * remembering to add it, and its colour is the colour the record and the
 * chamber already give it.
 *
 * The drawing keeps the chamber's pinned dark palette because it is a picture
 * of the chamber; the legends beside it take the page's, because that is where
 * a reader meets those words — on a badge and in a row.
 */

/**
 * Named as the hero's caption names them, so the two read as one sentence.
 * Shared with `SpecimenKey`, the compact key the hero shows while a specimen is
 * hovered, so the two keys cannot drift apart.
 */
export const PARTS = [
  {
    label: "result",
    text: "The core. Bigger means worse.",
  },
  {
    label: "checks",
    // The bright arc is the part of the check that was the sandbox executing
    // the pull request; the rest was the agent deciding what to do next.
    text: "One ring per check. Length is time. Bright: code running. Faint: model thinking.",
  },
  {
    label: "findings",
    // The cap is part of the contract: a key that promises one satellite per
    // finding is wrong on every run that found more than six.
    text: "One dot per finding, worst first, six at most.",
  },
  {
    label: "depth",
    // Depth is a measurement and the other two axes are not (decisions 81, 82).
    text: "Newest in front.",
  },
];

export function Legend() {
  return (
    <section aria-label="How to read the board" className="border-line border-t px-4 py-10 md:px-6">
      <h2 className="mb-6 font-mono text-xs uppercase tracking-[0.18em] text-fg">
        How to read a star
      </h2>
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,22rem)_1fr_1fr]">
        <div>
          <div className="border border-line bg-[var(--chamber)] p-4">
            <SpecimenDiagram />
          </div>
          <dl className="mt-5 flex flex-col gap-3 font-mono text-xs leading-relaxed">
            {PARTS.map((part) => (
              <div key={part.label} className="flex flex-col gap-0.5">
                <dt className="text-fg">{part.label}</dt>
                <dd className="text-fg-muted">{part.text}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h3 className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-fg-muted">
            Results
          </h3>
          <ul className="flex flex-col gap-2 font-mono text-xs">
            {RUN_STATUSES.map((status) => {
              const tone = statusTone(status);
              return (
                <li key={status} className="flex items-baseline gap-2">
                  {/* Reduced strength for a status that reached no conclusion,
                      which is how the rack draws the same distinction: `clean`
                      and `error` are both info blue by brand rule, and only
                      one of them is a result. `running` is exempt: it has its
                      own hue, and it is the one swatch that should not be
                      faint. */}
                  <span
                    className={`h-2 w-2 shrink-0 translate-y-px ${TONE_FILL[tone]} ${
                      isVerdict(status) || status === "running" ? "" : "opacity-45"
                    }`}
                    aria-hidden="true"
                  />
                  <span className={TONE_TEXT[tone]}>{STATUS_LEGEND[status]}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 max-w-[46ch] font-mono text-xs leading-relaxed text-fg-muted">
            Red means a risky pull request, not a Cujo failure.
          </p>
        </div>

        <div>
          <h3 className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-fg-muted">
            Severities
          </h3>
          <ul className="flex flex-col gap-2 font-mono text-xs">
            {SEVERITIES.map((severity) => (
              <li key={severity} className="flex items-baseline gap-2">
                <span
                  className={`h-2 w-2 shrink-0 translate-y-px ${TONE_FILL[SEVERITY_TONE[severity]]}`}
                  aria-hidden="true"
                />
                <span className={TONE_TEXT[SEVERITY_TONE[severity]]}>{severity}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 max-w-[46ch] font-mono text-xs leading-relaxed text-fg-muted">
            The amber light shows the board refreshing.
          </p>
        </div>
      </div>
    </section>
  );
}
