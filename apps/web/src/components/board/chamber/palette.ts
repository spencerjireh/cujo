/**
 * The chamber's colours, read off the document once per scene.
 *
 * No hex literal lives in a scene file — every value comes from
 * `brand/tokens.css` through `getComputedStyle`, so the drawing and the badge
 * for the same run cannot disagree. The fallbacks exist for one case only: a
 * renderer built before the stylesheet applied, where a missing token would
 * otherwise become black on black.
 *
 * It is its own module because four of them need it — the room, the specimens,
 * the atmosphere and the run page's inline scene — and the inline scene must
 * reach it without importing a room it does not draw.
 */

import type { Tone } from "@/lib/board/tone";
import { TONE_CHAMBER_VAR } from "@/lib/board/tone";
import { Color } from "three";

export interface ChamberPalette {
  chamber: Color;
  line: Color;
  amber: Color;
  fg: Color;
  fgMuted: Color;
  /** A verdict's colour. Cloned, so a caller may brighten without side effects. */
  tone(tone: Tone): Color;
}

function tokenColor(name: string, fallback: string): Color {
  const raw =
    typeof document === "undefined"
      ? ""
      : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new Color(raw || fallback);
}

export function readPalette(): ChamberPalette {
  const line = tokenColor("--chamber-line", "#24211c");
  const tones = new Map<string, Color>(
    Object.entries(TONE_CHAMBER_VAR).map(([tone, variable]) => [
      tone,
      tokenColor(variable, "#958d82"),
    ]),
  );

  return {
    chamber: tokenColor("--chamber", "#0a0908"),
    line,
    amber: tokenColor("--chamber-amber", "#f2a900"),
    fg: tokenColor("--chamber-fg", "#ede6da"),
    fgMuted: tokenColor("--chamber-fg-muted", "#a39b90"),
    tone: (tone: Tone) => (tones.get(tone) ?? line).clone(),
  };
}
