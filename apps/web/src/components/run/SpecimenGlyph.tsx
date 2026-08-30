import { markRing, projectArms } from "@/lib/board/caltrop";
import type { Specimen } from "@/lib/board/specimen";
import { TONE_CHAMBER_VAR } from "@/lib/board/tone";

/**
 * One specimen, and nothing else: the shape a run has, at a size that fits
 * beside a title.
 *
 * It is the same rig the inline WebGL scene uses (`chamber/inline.ts`): no
 * floor to land on, so no tether and no shadow. Everything else about the shape
 * is the same object, projected — `projectArms` is the scene's own four
 * directions seen down the view axis, so this is a drawing *of* the solid
 * rather than a second drawing that resembles it.
 *
 * It is what a reader sees first on every run page, and all a reader sees when
 * there is no WebGL. It used to live beside the board's flat elevation, which
 * is gone: nothing that cannot draw the chamber is served a picture of it any
 * more, and one specimen beside a title is a different job from a whole record
 * in a strip.
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
