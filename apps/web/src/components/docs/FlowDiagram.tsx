/**
 * One drawing, of the one thing worth drawing: where the trust boundary falls.
 *
 * Every other fact on these pages is a sentence or a table, and a picture of a
 * six-step list would be a list with rectangles round it. This earns its place
 * because the claim it makes is spatial — the pull request's code executes on
 * the far side of a line that no secret crosses — and that is precisely the
 * claim a reader cannot check by reading the steps in order.
 *
 * Hand-drawn SVG, like `SpecimenDiagram`. No dependency, and every colour is a
 * token off the document, so it follows the reader's theme rather than being a
 * light-mode image sitting in a dark page.
 *
 * `role="img"` with a label, and the paragraph under it in `HowItWorks` carries
 * the same content in prose — a diagram that is the only place a fact appears is
 * a fact a screen reader does not get.
 *
 * Geometry is written out as named constants rather than inlined, because the
 * arrows have to meet box edges exactly: an elbow computed from the wrong
 * corner draws a diagonal through whatever is in the way, and at this size that
 * reads as a connection nobody drew.
 */

const BOX_H = 48;
/** The row every trusted component sits on, and its vertical centre. */
const ROW_Y = 60;
const ROW_MID = ROW_Y + BOX_H / 2;
/** The return path's row, below the first, where the review travels back. */
const BACK_Y = 190;
const BACK_MID = BACK_Y + BOX_H / 2;
/** The boundary, and the two edges that face each other across it. */
const LINE_X = 486;
const TRUSTED_EDGE = 434;
const SANDBOX_X = 534;

const GITHUB = { x: 8, w: 110 };
const CUJO = { x: 158, w: 118 };
const FORGE = { x: 316, w: 118 };

const CHECKS = ["tests", "probes", "smoke", "detonation"];

export function FlowDiagram() {
  return (
    <div className="max-w-full overflow-x-auto rounded-md border border-line bg-bg-raised p-4">
      <svg
        viewBox="0 0 760 262"
        className="h-auto w-full min-w-[620px]"
        role="img"
        aria-label="GitHub sends a webhook to the Cujo service, which starts a turn on the TrueForge harness. The harness runs the pull request inside a disposable Daytona sandbox, where the tests, probes, smoke and detonation checks execute. Only pull request code and dependency names cross into the sandbox, and only JSON reports come back. The review returns through the github-mcp server, which holds the credentials and stays on the trusted side, and is posted to GitHub."
      >
        <title>Where the trust boundary falls</title>
        <defs>
          <marker
            id="cujo-doc-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--fg-muted)" />
          </marker>
        </defs>

        {/* The line, and the names of the two rooms it separates. Drawn first,
            so a box always sits on top of it rather than under it. */}
        <line
          x1={LINE_X}
          y1="14"
          x2={LINE_X}
          y2="248"
          stroke="var(--accent-fill)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <Label x={LINE_X - 12} y={26} anchor="end">
          Trusted
        </Label>
        <Label x={LINE_X + 12} y={26}>
          Disposable
        </Label>

        <Box x={GITHUB.x} y={ROW_Y} w={GITHUB.w} label="GitHub" sub="pull request" />
        <Box x={CUJO.x} y={ROW_Y} w={CUJO.w} label="apps/cujo" sub="verifies, folds" />
        <Box x={FORGE.x} y={ROW_Y} w={FORGE.w} label="TrueForge" sub="runs the agent" />
        <Box
          x={SANDBOX_X}
          y={48}
          w={200}
          h={140}
          label="Daytona sandbox"
          sub="the PR executes here"
        />
        {CHECKS.map((name, i) => (
          <text
            key={name}
            x={SANDBOX_X + 16}
            y={116 + i * 16}
            className="fill-[var(--fg-muted)] font-mono text-[10px]"
          >
            {name}
          </text>
        ))}
        <Box x={CUJO.x} y={BACK_Y} w={CUJO.w} label="github-mcp" sub="holds the key" />

        <Arrow from={[GITHUB.x + GITHUB.w, ROW_MID]} to={[CUJO.x, ROW_MID]} />
        <Arrow from={[CUJO.x + CUJO.w, ROW_MID]} to={[FORGE.x, ROW_MID]} />

        {/* Across the line, both ways. The labels are one word each because the
            gap is a hundred pixels wide and a phrase would sit on a box; the
            paragraph beside the drawing says the rest. */}
        <Arrow from={[TRUSTED_EDGE, 72]} to={[SANDBOX_X, 72]} label="code" labelAt={[LINE_X, 64]} />
        <Arrow
          from={[SANDBOX_X, 104]}
          to={[TRUSTED_EDGE, 104]}
          label="reports"
          labelAt={[LINE_X, 118]}
        />

        {/* The review's way back, entirely on the trusted side — which is the
            point of drawing it at all. */}
        <Arrow
          from={[FORGE.x + FORGE.w / 2, ROW_Y + BOX_H]}
          corner={[FORGE.x + FORGE.w / 2, BACK_MID]}
          to={[CUJO.x + CUJO.w, BACK_MID]}
        />
        <Arrow
          from={[CUJO.x, BACK_MID]}
          corner={[GITHUB.x + GITHUB.w / 2, BACK_MID]}
          to={[GITHUB.x + GITHUB.w / 2, ROW_Y + BOX_H]}
          label="one review"
          labelAt={[GITHUB.x + GITHUB.w / 2 + 34, BACK_MID - 10]}
        />
      </svg>
    </div>
  );
}

function Label({
  x,
  y,
  anchor,
  children,
}: {
  x: number;
  y: number;
  anchor?: "end";
  children: string;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      letterSpacing="1.6"
      className="fill-[var(--fg-muted)] font-mono text-[10px] uppercase"
    >
      {children}
    </text>
  );
}

function Box({
  x,
  y,
  w,
  h = BOX_H,
  label,
  sub,
}: {
  x: number;
  y: number;
  w: number;
  h?: number;
  label: string;
  sub: string;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="3"
        fill="var(--bg)"
        stroke="var(--line)"
        strokeWidth="1"
      />
      <text x={x + 12} y={y + 21} className="fill-[var(--fg)] font-mono text-[11px]">
        {label}
      </text>
      <text x={x + 12} y={y + 36} className="fill-[var(--fg-muted)] font-mono text-[10px]">
        {sub}
      </text>
    </g>
  );
}

/**
 * A straight arrow, or one elbow when `corner` is given — the path runs
 * `from` to `corner` to `to`, so the corner is the turn and not the
 * destination. Two segments is as complicated as this drawing gets: a
 * connection needing three has a layout problem rather than a rendering one.
 */
function Arrow({
  from,
  to,
  corner,
  label,
  labelAt,
}: {
  from: [number, number];
  to: [number, number];
  corner?: [number, number];
  label?: string;
  /** Where to put the label, when the segment's own midpoint is not free. */
  labelAt?: [number, number];
}) {
  const d = corner
    ? `M ${from[0]} ${from[1]} L ${corner[0]} ${corner[1]} L ${to[0]} ${to[1]}`
    : `M ${from[0]} ${from[1]} L ${to[0]} ${to[1]}`;
  const [lx, ly] = labelAt ?? [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 - 6];
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke="var(--fg-muted)"
        strokeWidth="1"
        markerEnd="url(#cujo-doc-arrow)"
      />
      {label ? (
        <text
          x={lx}
          y={ly}
          textAnchor="middle"
          className="fill-[var(--fg-muted)] font-mono text-[9px]"
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}
