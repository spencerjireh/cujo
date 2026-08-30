import { SATELLITE_ORBIT, projectRing, ringNormals, satelliteRing } from "@/lib/board/orbit";

/**
 * One specimen, drawn large, with its parts led out to labels: the drawing
 * the key below the record is built around.
 *
 * Deliberately not one of the real ones: this is a diagram of the vocabulary,
 * and picking a run to be the example would make it a claim about that run.
 * The four rings are four different sizes and one of them errored, so every
 * case the caption names is visible in the same picture.
 */

/**
 * The tilts are a run's own since decision 72, so the diagram has to be seeded
 * like a run. A fixed id, chosen for a set of four that opens well at this
 * size.
 */
const KEY_ID = "guard";

export function SpecimenDiagram() {
  const cx = 104;
  const cy = 100;
  /** Where every leader ends and every label begins. */
  const gutter = 200;
  const core = 8;
  const ringMax = 58;
  const ringMin = ringMax * 0.29;
  const normals = ringNormals(KEY_ID);
  /**
   * Four lengths and four sandbox shares, chosen so every case the caption names
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
  const widest = projectRing(0, ringMax, null, 180, normals).bright;
  let tip = widest[0] ?? { x: 0, y: 0 };
  for (const p of widest) if (p.x > tip.x) tip = p;
  const ringX = cx + tip.x;
  const ringY = cy + tip.y;
  const points = (list: { x: number; y: number }[]) =>
    list.map((p) => `${(cx + p.x).toFixed(2)},${(cy + p.y).toFixed(2)}`).join(" ");

  return (
    <svg viewBox="0 0 300 200" className="h-auto w-full" aria-hidden="true" focusable="false">
      <title>A specimen with its parts named</title>
      {/* Projected from the same ring planes the scene orients by rather than
          laid out again here, so the diagram cannot drift from the object it
          is a key to. */}
      {rings.map(([length, share, stroke], i) => {
        const ring = projectRing(
          i,
          ringMin + length * (ringMax - ringMin),
          share,
          undefined,
          normals,
        );
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
          findings
        </text>
        <text x="206" y={ringY + 4}>
          checks
        </text>
        <text x="206" y={cy + 44}>
          verdict
        </text>
      </g>
    </svg>
  );
}
