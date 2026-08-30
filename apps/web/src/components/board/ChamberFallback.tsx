import { markRing, projectArms } from "@/lib/board/caltrop";
import type { Specimen } from "@/lib/board/specimen";
import { TONE_CHAMBER_VAR } from "@/lib/board/tone";

/**
 * The chamber in elevation, as flat SVG.
 *
 * Rendered on the server, and kept on screen for anyone the WebGL scene will
 * not serve: no context, a driver that refused one, or a viewport too small to
 * be worth a renderer. It draws the same facts in the same colours — the chain,
 * one specimen per run, arms sized by check duration, the core sized by the
 * worst thing the run found, and a mark on the ring around it per finding — so
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
            {/* One mark per finding, on the ring around the core — the same
                six slots the scene fills, so a run with two findings is drawn
                the same way in both. */}
            {markRing(spec.marks.length).map((angle, i) => {
              const mark = spec.marks[i];
              if (!mark) return null;
              const size = 2.6 * scale;
              const radius = 4.5 * scale * spec.coreScale + size * 1.4;
              return (
                <rect
                  key={`${spec.id}-mark-${i}`}
                  x={cx + Math.cos(angle) * radius - size}
                  y={cy - Math.sin(angle) * radius - size}
                  width={size * 2}
                  height={size * 2}
                  fill={`var(${TONE_CHAMBER_VAR[mark.tone]})`}
                />
              );
            })}
            {/* The arms, projected from the solid the scene builds rather than
                laid out again here: same directions, same foreshortening. */}
            {projectArms(ARM * scale).map((arm, i) => {
              const bar = spec.bars[i];
              // Length zero is a check that never appeared: no arm, and the
              // gap is the fact.
              if (!bar || bar.length <= 0) return null;
              return (
                <line
                  key={bar.name}
                  x1={cx}
                  y1={cy}
                  x2={cx + arm.x * bar.length}
                  y2={cy + arm.y * bar.length}
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

/**
 * One specimen, and nothing else: the shape a run has, at a size that fits
 * beside a title.
 *
 * A third entry in `BOXES` above would have been the obvious way to do this and
 * is the wrong one — that drawing always renders a chain and a rail, and the
 * run page's specimen hangs on neither. It is the same rig the inline WebGL
 * scene uses (`chamber/inline.ts`): no floor to land on, so no tether and no
 * shadow. Everything else about the shape is the same object, projected —
 * `projectArms` is the scene's own four directions seen down the view axis, so
 * this is a drawing *of* the solid rather than a second drawing that resembles
 * it.
 *
 * It is what a reader sees first on every run page, and all a reader sees when
 * there is no WebGL.
 */
export function SpecimenGlyph({ specimen }: { specimen: Specimen }) {
  const size = 120;
  const centre = size / 2;
  const arm = 34;
  const core = 7 * specimen.coreScale;
  const markSize = 3.4;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <title>This run, drawn as a specimen</title>
      {projectArms(arm).map((projected, i) => {
        const bar = specimen.bars[i];
        if (!bar || bar.length <= 0) return null;
        const reach = bar.length;
        // The solid part is the share of the check that was the sandbox
        // executing; the rest is thinner and fainter, never a second hue. An
        // arm the check measured no share for is drawn whole.
        const split = bar.solid ?? 1;
        const stroke = `var(${TONE_CHAMBER_VAR[bar.tone]})`;
        return (
          <g key={bar.name}>
            <line
              x1={centre}
              y1={centre}
              x2={centre + projected.x * reach * split}
              y2={centre + projected.y * reach * split}
              stroke={stroke}
              strokeWidth="2.6"
              strokeLinecap="round"
            />
            {split < 1 ? (
              <line
                x1={centre + projected.x * reach * split}
                y1={centre + projected.y * reach * split}
                x2={centre + projected.x * reach}
                y2={centre + projected.y * reach}
                stroke={stroke}
                strokeWidth="1.3"
                strokeOpacity="0.34"
                strokeLinecap="round"
              />
            ) : null}
          </g>
        );
      })}
      {/* One mark per finding, in the same six slots the scene fills. */}
      {markRing(specimen.marks.length).map((angle, i) => {
        const mark = specimen.marks[i];
        if (!mark) return null;
        const radius = core + markSize * 1.4;
        return (
          // Keyed by the slot's own angle, which is a fixed value from the ring
          // rather than a position in this list: the six slots never reorder.
          <rect
            key={angle}
            x={centre + Math.cos(angle) * radius - markSize}
            y={centre - Math.sin(angle) * radius - markSize}
            width={markSize * 2}
            height={markSize * 2}
            fill={`var(${TONE_CHAMBER_VAR[mark.tone]})`}
          />
        );
      })}
      <circle cx={centre} cy={centre} r={core} fill={`var(${TONE_CHAMBER_VAR[specimen.tone]})`} />
    </svg>
  );
}
