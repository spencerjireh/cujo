import { RUN_STATUSES, SEVERITIES } from "@/lib/api/types";
import {
  SEVERITY_TONE,
  STATUS_LEGEND,
  TONE_FILL,
  TONE_TEXT,
  isVerdict,
  statusTone,
} from "@/lib/board/tone";

/**
 * The key to the chamber.
 *
 * The hero draws every run as a shape and then says, in one sentence, that the
 * arms are checks. That is enough to make it look deliberate and not enough to
 * read it. This is the rest: one specimen at a size where its parts are
 * legible, each part named, and then the two vocabularies the whole board is
 * written in — the eight verdicts and the three severities.
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

/** Named for what the reader is looking at, not for the field behind it. */
const PARTS = [
  {
    label: "core",
    text: "The verdict. Bigger when the run found something worse.",
  },
  {
    label: "arms",
    text: "One per check — tests, probes, smoke, detonation — as long as the check watched. A missing arm is a check that never appeared.",
  },
  {
    label: "marks",
    text: "One per finding, strung on the drop line, worst nearest the core.",
  },
  {
    label: "the chain",
    text: "Every run hangs off it, newest at the open face. Depth is time.",
  },
];

export function Legend() {
  return (
    <section
      aria-label="How to read the chamber"
      className="border-line border-t px-4 py-10 md:px-6"
    >
      <h2 className="mb-6 font-mono text-xs uppercase tracking-[0.18em] text-fg">
        Reading a specimen
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
            Verdicts
          </h3>
          <ul className="flex flex-col gap-2 font-mono text-xs">
            {RUN_STATUSES.map((status) => {
              const tone = statusTone(status);
              return (
                <li key={status} className="flex items-baseline gap-2">
                  {/* Reduced strength for a status that reached no conclusion,
                      which is how the rack draws the same distinction: `clean`
                      and `error` are both info blue by brand rule, and only
                      one of them is a result. */}
                  <span
                    className={`h-2 w-2 shrink-0 translate-y-px ${TONE_FILL[tone]} ${
                      isVerdict(status) ? "" : "opacity-45"
                    }`}
                    aria-hidden="true"
                  />
                  <span className={TONE_TEXT[tone]}>{STATUS_LEGEND[status]}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 max-w-[46ch] font-mono text-xs leading-relaxed text-fg-muted">
            Red means the pull request is dangerous, never that Cujo fell over. Amber lands on the
            one verdict waiting on a person.
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
          {/* Which critical is which decides who answers, and the two answers
              are opposite. A broken test is mechanical, so it blocks at once
              and nobody is asked; an accusation of bad faith is held until a
              maintainer confirms it, which is what the gate exists for
              (agent/SKILL.md, "Which tool"). Saying a maintainer confirms
              every critical described the wrong product. */}
          <p className="mt-4 max-w-[46ch] font-mono text-xs leading-relaxed text-fg-muted">
            A critical defect — a test that passes on the base and fails on the head — blocks the
            merge at once. A critical <em>accusation</em>, that code or a dependency acted in bad
            faith, is held until a maintainer confirms it on the pull request.
          </p>
          <p className="mt-3 max-w-[46ch] font-mono text-xs leading-relaxed text-fg-muted">
            The amber plane crossing the chamber is the board re-reading the API: every five seconds
            while a run is live, every thirty when it is quiet.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * One specimen, drawn large, with its parts led out to labels.
 *
 * Deliberately not one of the real ones: this is a diagram of the vocabulary,
 * and picking a run to be the example would make it a claim about that run.
 * The arms are four different lengths and one of them errored, so every case
 * the key names is visible in the same picture.
 */
function SpecimenDiagram() {
  const cx = 104;
  const cy = 118;
  const chainY = 30;
  /** Where every leader ends and every label begins. */
  const gutter = 196;
  const axis = Math.SQRT1_2;
  const arms: [dx: number, dy: number, reach: number, stroke: string][] = [
    [-1, -1, 54, "var(--chamber-fg-muted)"],
    [1, -1, 34, "var(--chamber-fg-muted)"],
    [1, 1, 52, "var(--chamber-critical)"],
    [-1, 1, 20, "var(--chamber-fg-muted)"],
  ];
  /** The bottom-right arm's tip, which is what the `arms` leader points at. */
  const armX = cx + 52 * axis;
  const armY = cy + 52 * axis;
  /** Three marks, worst nearest the core, walking back up the drop line. */
  const marks: [y: number, fill: string][] = [
    [54, "var(--chamber-info)"],
    [70, "var(--chamber-amber)"],
    [86, "var(--chamber-critical)"],
  ];

  return (
    <svg viewBox="0 0 300 190" className="h-auto w-full" aria-hidden="true" focusable="false">
      <title>A specimen with its parts named</title>
      {/* The chain, and the drop line that hangs the specimen off it. It stops
          before the labels rather than running the width of the frame: every
          leader would otherwise have to cross it. */}
      <line
        x1="18"
        y1={chainY}
        x2="158"
        y2={chainY}
        stroke="var(--chamber-fg-muted)"
        strokeOpacity="0.4"
      />
      <line x1={cx} y1={chainY} x2={cx} y2={cy} stroke="var(--chamber-line)" strokeWidth="1.5" />
      {marks.map(([y, fill]) => (
        <rect key={fill} x={cx - 3.5} y={y} width="7" height="7" fill={fill} />
      ))}
      {arms.map(([dx, dy, reach, stroke]) => (
        <line
          key={`${dx},${dy}`}
          x1={cx}
          y1={cy}
          x2={cx + dx * reach * axis}
          y2={cy + dy * reach * axis}
          stroke={stroke}
          strokeWidth="3"
          strokeLinecap="round"
        />
      ))}
      <circle cx={cx} cy={cy} r="8.5" fill="var(--chamber-critical)" />

      {/* Leaders. Hairlines in the wireframe colour, so they read as callouts
          on a drawing and not as more of the specimen. */}
      <g stroke="var(--chamber-line)" strokeWidth="1">
        <line x1="162" y1={chainY} x2={gutter} y2={chainY} />
        <line x1={cx + 9} y1="74" x2={gutter} y2="74" />
        <line x1={cx + 14} y1={cy} x2={gutter} y2={cy} />
        <line x1={armX + 5} y1={armY} x2={gutter} y2={armY} />
      </g>
      <g fill="var(--chamber-fg-muted)" fontFamily="var(--font-mono)" fontSize="11">
        <text x="202" y={chainY + 4}>
          chain
        </text>
        <text x="202" y="78">
          marks
        </text>
        <text x="202" y={cy + 4}>
          core
        </text>
        <text x="202" y={armY + 4}>
          arms
        </text>
      </g>
    </svg>
  );
}
