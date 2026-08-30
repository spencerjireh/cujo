import { RUN_STATUSES, SEVERITIES } from "@/lib/api/types";
import { SATELLITE_ORBIT, projectRing, satelliteRing } from "@/lib/board/orbit";
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
 * The hero draws every run as a star system and then says, in one sentence,
 * that the orbits are checks. That is enough to make it look deliberate and not
 * enough to read it. This is the rest: one specimen at a size where its parts
 * are legible, each part named, and then the two vocabularies the whole board
 * is written in — the eight verdicts and the three severities.
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
    label: "orbits",
    // Two numbers, not one. The bright arc is the part of the check that was
    // the sandbox executing the pull request; the rest was the agent deciding
    // what to do next, which is the same split the run page draws as a lane.
    text: "One ring per check — tests, probes, smoke, detonation — each on its own tilt, as wide as the check took, bright for the part that was the sandbox running the code. A missing ring is a check that never appeared.",
  },
  {
    label: "satellites",
    // The cap is part of the contract, not an implementation detail to leave
    // out: a key that promises one satellite per finding is wrong on every run
    // that found more than six, which is exactly the runs worth reading.
    text: "One per finding, on the orbit outside the rings, worst first — six slots, past which they stop being countable. The record below carries the number.",
  },
  {
    label: "layers",
    // Depth is a measurement and the other two axes are not, which a reader
    // will assume otherwise — a star sitting high looks like it means
    // something. Saying so is the whole reason this line is longer than the
    // others (decisions 70, 71).
    text: "Depth is time, in five layers, newest in front: the three newest runs, then the next five, and so on back. Where a run sits within its layer is not a measurement of anything.",
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
              are opposite. Anything mechanical blocks at once and nobody is
              asked; an accusation of bad faith is held until a maintainer
              confirms it, which is what the gate exists for (agent/SKILL.md,
              "Which tool"). Named as a category rather than by one example:
              `tests.base_pass_head_fail` is the familiar case and not the only
              one — a contradicted probe and an endpoint that stopped answering
              take the same path. */}
          <p className="mt-4 max-w-[46ch] font-mono text-xs leading-relaxed text-fg-muted">
            A critical <em>defect</em> — anything the run demonstrated mechanically, from a test
            that fails only on the head to an endpoint that stopped answering — blocks the merge at
            once. A critical <em>accusation</em>, that code or a dependency acted in bad faith, is
            held until a maintainer confirms it on the pull request.
          </p>
          <p className="mt-3 max-w-[46ch] font-mono text-xs leading-relaxed text-fg-muted">
            The amber light passing through the layers is the board re-reading the API: every five
            seconds while a run is live, every thirty when it is quiet. It reads one layer at a
            time, oldest first.
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
 * The four rings are four different sizes and one of them errored, so every
 * case the key names is visible in the same picture.
 */
function SpecimenDiagram() {
  const cx = 104;
  const cy = 100;
  /** Where every leader ends and every label begins. */
  const gutter = 200;
  const core = 8;
  const ringMax = 58;
  const ringMin = ringMax * 0.29;
  /**
   * Four lengths and four sandbox shares, chosen so every case the key names
   * is visible in one picture: a long check that was almost all execution, a
   * short one that was mostly the agent thinking, one that errored, and one
   * that measured no share at all and is therefore drawn whole.
   */
  const rings: [length: number, share: number | null, stroke: string][] = [
    [1, 0.8, "var(--chamber-fg-muted)"],
    [0.45, 0.25, "var(--chamber-fg-muted)"],
    [0.85, 0.65, "var(--chamber-critical)"],
    [0.2, null, "var(--chamber-fg-muted)"],
  ];
  /** Three findings, worst first around the orbit. */
  const marks = ["var(--chamber-critical)", "var(--chamber-amber)", "var(--chamber-info)"];
  const orbit = ringMax * SATELLITE_ORBIT;
  const slots = satelliteRing(marks.length);
  /** Where the `satellites` leader points: the first slot on the orbit. */
  const satX = cx + Math.cos(slots[0] ?? 0) * orbit;
  const satY = cy - Math.sin(slots[0] ?? 0) * orbit;
  /** Where the `orbits` leader points: the widest ring's rightmost point. */
  const widest = projectRing(0, ringMax, null, 180).bright;
  let tip = widest[0] ?? { x: 0, y: 0 };
  for (const p of widest) if (p.x > tip.x) tip = p;
  const ringX = cx + tip.x;
  const ringY = cy + tip.y;
  const points = (list: { x: number; y: number }[]) =>
    list.map((p) => `${(cx + p.x).toFixed(2)},${(cy + p.y).toFixed(2)}`).join(" ");

  return (
    <svg viewBox="0 0 300 200" className="h-auto w-full" aria-hidden="true" focusable="false">
      <title>A specimen with its parts named</title>
      {/* Projected from the scene's own four ring planes rather than laid out
          again here, so the diagram cannot drift from the object it is a key
          to. */}
      {rings.map(([length, share, stroke], i) => {
        const ring = projectRing(i, ringMin + length * (ringMax - ringMin), share);
        return (
          <g key={stroke + String(length)} fill="none" strokeLinecap="round">
            {/* Bright: the sandbox executing the pull request. */}
            <polyline points={points(ring.bright)} stroke={stroke} strokeWidth="2.6" />
            {/* Faint: what was left, which was the agent deciding what to do
                next. Same hue, less of it — never a second colour. */}
            {ring.faint.length > 0 ? (
              <polyline
                points={points(ring.faint)}
                stroke={stroke}
                strokeWidth="1.2"
                strokeOpacity="0.34"
              />
            ) : null}
          </g>
        );
      })}
      {marks.map((fill, i) => {
        const angle = slots[i] ?? 0;
        return (
          <circle
            key={fill}
            cx={cx + Math.cos(angle) * orbit}
            cy={cy - Math.sin(angle) * orbit}
            r="3"
            fill={fill}
          />
        );
      })}
      <circle cx={cx} cy={cy} r={core} fill="var(--chamber-critical)" />

      {/* Leaders. Hairlines in the wireframe colour, so they read as callouts
          on a drawing and not as more of the specimen. */}
      <g stroke="var(--chamber-line)" strokeWidth="1">
        <line x1={satX + 5} y1={satY} x2={gutter} y2={satY} />
        <line x1={ringX + 4} y1={ringY} x2={gutter} y2={ringY} />
        <line x1={cx + core + 6} y1={cy + 40} x2={gutter} y2={cy + 40} />
      </g>
      <g fill="var(--chamber-fg-muted)" fontFamily="var(--font-mono)" fontSize="11">
        <text x="206" y={satY + 4}>
          satellites
        </text>
        <text x="206" y={ringY + 4}>
          orbits
        </text>
        <text x="206" y={cy + 44}>
          core
        </text>
      </g>
    </svg>
  );
}
