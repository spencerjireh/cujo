import type { Specimen } from "@/lib/board/specimen";
import { TONE_CHAMBER_VAR } from "@/lib/board/tone";

/**
 * The chamber in elevation, as flat SVG.
 *
 * Rendered on the server, and kept on screen for anyone the WebGL scene will
 * not serve: no context, a driver that refused one, or a viewport too small to
 * be worth a renderer. It draws the same facts in the same colours — the chain,
 * one specimen per run, arms sized by check duration, the core sized by the
 * worst thing the run found, and a mark on the drop line for each finding — so
 * the page never degrades to an empty rectangle where the hero was, and never
 * to a *different drawing* of the same runs.
 *
 * Two orientations, because the record is a long thin thing and a viewport is
 * not always wide. `horizontal` stands in for the scene under the hero;
 * `vertical` hangs the chain down the side of a narrow screen, where the
 * horizontal one scaled to a sliver of dots.
 *
 * Decorative for assistive technology: every run in it is a real link in the
 * record below, which is the keyboard and screen-reader path.
 */

type Orientation = "horizontal" | "vertical";

/** Longest arm, in user units at `length: 1`. */
const ARM = 34;

/**
 * `chain` is where the chain runs, `base` where the specimens sit, `rail` the
 * wall of the volume. Wide enough on the vertical form that a full-length arm
 * clears both edges — arms clipped by the viewBox would read as checks that
 * ran shorter than they did.
 */
const BOXES = {
  horizontal: { width: 1200, height: 250, chain: 58, base: 196, rail: 196 },
  vertical: { width: 160, height: 900, chain: 34, base: 96, rail: 152 },
} as const;

export function ChamberFallback({
  specimens,
  orientation = "horizontal",
}: {
  specimens: Specimen[];
  orientation?: Orientation;
}) {
  const box = BOXES[orientation];
  const vertical = orientation === "vertical";
  const count = Math.max(specimens.length, 1);
  // Newest first, the way the record below reads, and the way the scene puts
  // the newest nearest.
  const along = vertical ? box.height : box.width;
  const step = along / (count + 1);

  return (
    <svg
      viewBox={`0 0 ${box.width} ${box.height}`}
      className="h-full w-full"
      // `meet`, not `slice`: this is a diagram of the whole record, and
      // cropping it to fill a band would silently drop the oldest runs — the
      // exact thing the drawing exists to show.
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <title>The run record, drawn as specimens on a chain</title>
      <g stroke="var(--chamber-line)" strokeWidth="1" fill="none">
        {vertical ? (
          <line x1={box.rail} y1="8" x2={box.rail} y2={box.height - 8} />
        ) : (
          <>
            <rect x="18" y="18" width={box.width - 36} height={box.height - 36} />
            <line x1="18" y1={box.rail} x2={box.width - 18} y2={box.rail} />
          </>
        )}
      </g>
      {/* The chain. Cujo is a guard dog on one, and it is what makes a row of
          specimens a record rather than a scatter. */}
      <line
        x1={vertical ? box.chain : 40}
        y1={vertical ? 12 : box.chain}
        x2={vertical ? box.chain : box.width - 40}
        y2={vertical ? box.height - 12 : box.chain}
        stroke="var(--chamber-fg-muted)"
        strokeOpacity="0.35"
        strokeWidth="1"
      />
      {specimens.map((spec, index) => {
        // The oldest fade, standing in for the fog the scene uses for the same
        // job: the record continues past what is drawn.
        const scale = 1 - Math.min(index / (count + 3), 0.45);
        const at = step * (index + 1);
        const cx = vertical ? box.base : at;
        const cy = vertical ? at : box.base - 52;
        // Where the drop line starts, which is also where the finding marks
        // are strung: on the chain end, worst nearest the core.
        const fromX = vertical ? box.chain : cx;
        const fromY = vertical ? cy : box.chain;
        return (
          <g key={spec.id} opacity={scale}>
            <line
              x1={fromX}
              y1={fromY}
              x2={cx}
              y2={cy}
              stroke="var(--chamber-line)"
              strokeWidth="1"
            />
            {/* One mark per finding, walking down the drop line from the core.
                The scene strings them on the same line for the same reason:
                what a run produced hangs off what produced it. */}
            {spec.marks.map((mark, i) => {
              const step = (i + 1) / (spec.marks.length + 1);
              const size = 2.6 * scale;
              return (
                <rect
                  key={`${spec.id}-mark-${i}`}
                  x={cx + (fromX - cx) * step - size}
                  y={cy + (fromY - cy) * step - size}
                  width={size * 2}
                  height={size * 2}
                  fill={`var(${TONE_CHAMBER_VAR[mark.tone]})`}
                />
              );
            })}
            {spec.bars.map((bar, i) => {
              // Length zero is a check that never appeared: no arm, and the
              // gap is the fact.
              if (bar.length <= 0) return null;
              const dx = i === 1 || i === 2 ? 1 : -1;
              const dy = i === 0 || i === 1 ? -1 : 1;
              const reach = bar.length * ARM * scale * Math.SQRT1_2;
              return (
                <line
                  key={bar.name}
                  x1={cx}
                  y1={cy}
                  x2={cx + dx * reach}
                  y2={cy + dy * reach}
                  stroke={`var(${TONE_CHAMBER_VAR[bar.tone]})`}
                  strokeWidth={2 * scale}
                  strokeLinecap="round"
                />
              );
            })}
            {/* The core, at the size the worst finding gives it. The scene
                scales its octahedron by the same factor. */}
            <circle
              cx={cx}
              cy={cy}
              r={4.5 * scale * spec.coreScale}
              fill={`var(${TONE_CHAMBER_VAR[spec.tone]})`}
            />
          </g>
        );
      })}
    </svg>
  );
}
