import { SATELLITE_ORBIT, projectRing, satelliteRing } from "@/lib/board/orbit";
import type { Specimen } from "@/lib/board/specimen";
import { TONE_CHAMBER_VAR } from "@/lib/board/tone";

/**
 * One specimen, and nothing else: the shape a run has, at a size that fits
 * beside a title.
 *
 * It is the same rig the inline WebGL scene uses (`chamber/inline.ts`), and
 * everything about the shape is the same object, projected — `projectRing` is
 * the scene's own four ring planes seen down the view axis, so this is a
 * drawing *of* the system rather than a second drawing that resembles it.
 *
 * It is what a reader sees first on every run page, and all a reader sees when
 * there is no WebGL.
 */

/** The widest ring, in viewBox units. The satellites orbit just outside it. */
const RING_MAX_PX = 46;
const RING_MIN_PX = RING_MAX_PX * 0.29;

function points(list: { x: number; y: number }[], centre: number): string {
  return list.map((p) => `${(centre + p.x).toFixed(2)},${(centre + p.y).toFixed(2)}`).join(" ");
}

export function SpecimenGlyph({ specimen }: { specimen: Specimen }) {
  const size = 120;
  const centre = size / 2;
  const core = 6.4 * specimen.coreScale;
  const satellite = 2.5;
  const orbit = RING_MAX_PX * SATELLITE_ORBIT;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <title>This run, drawn as a specimen</title>
      {specimen.bars.map((bar, i) => {
        if (bar.length <= 0) return null;
        const radius = RING_MIN_PX + bar.length * (RING_MAX_PX - RING_MIN_PX);
        const ring = projectRing(i, radius, bar.solid);
        const stroke = `var(${TONE_CHAMBER_VAR[bar.tone]})`;
        return (
          <g key={bar.name} fill="none" strokeLinecap="round" strokeLinejoin="round">
            {/* The bright arc is the share of the check that was the sandbox
                executing; the rest is thinner and fainter, never a second
                hue. A ring the check measured no share for is drawn whole. */}
            <polyline points={points(ring.bright, centre)} stroke={stroke} strokeWidth="2.4" />
            {ring.faint.length > 0 ? (
              <polyline
                points={points(ring.faint, centre)}
                stroke={stroke}
                strokeWidth="1.2"
                strokeOpacity="0.34"
              />
            ) : null}
          </g>
        );
      })}
      {/* One satellite per finding, in the same six slots the scene fills. */}
      {satelliteRing(specimen.marks.length).map((angle, i) => {
        const mark = specimen.marks[i];
        if (!mark) return null;
        return (
          // Keyed by the slot's own angle, which is a fixed value from the
          // orbit rather than a position in this list: the slots never reorder.
          <circle
            key={angle}
            cx={centre + Math.cos(angle) * orbit}
            cy={centre - Math.sin(angle) * orbit}
            r={satellite}
            fill={`var(${TONE_CHAMBER_VAR[mark.tone]})`}
          />
        );
      })}
      <circle cx={centre} cy={centre} r={core} fill={`var(${TONE_CHAMBER_VAR[specimen.tone]})`} />
    </svg>
  );
}
