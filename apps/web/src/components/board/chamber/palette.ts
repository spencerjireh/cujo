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
 *
 * Two grounds. The board's chamber is pinned dark in both themes (brand.md,
 * "The instrument viewport"), so it reads the `--chamber-*` ramp, which does
 * not move when the reader's theme does. The run page's specimen sits on the
 * page itself (decision 93), so it reads the page's own tokens — the severity
 * ramp, `--bg`, `--fg` — which are what the badge beside it is drawn in, and
 * which invert with the theme. A palette read on the page ground is stale the
 * moment the theme changes; the caller reads it again.
 */

import type { Tone } from "@/lib/board/tone";
import { TONE_CHAMBER_VAR, TONE_PAGE_VAR } from "@/lib/board/tone";
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

/** Where a specimen is drawn, which decides which tokens colour it. */
export type PaletteGround = "chamber" | "page";

function tokenColor(name: string, fallback: string): Color {
  const raw =
    typeof document === "undefined"
      ? ""
      : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new Color(raw || fallback);
}

/**
 * The page fallbacks are the light values, because that is the theme a page
 * shows when nothing has chosen otherwise; the chamber fallbacks are its one
 * dark ramp.
 */
const TOKENS: Record<
  PaletteGround,
  {
    chamber: [string, string];
    line: [string, string];
    amber: [string, string];
    fg: [string, string];
    fgMuted: [string, string];
    tones: Record<Tone, string>;
    toneFallback: string;
  }
> = {
  chamber: {
    chamber: ["--chamber", "#0a0908"],
    line: ["--chamber-line", "#24211c"],
    amber: ["--chamber-amber", "#f2a900"],
    fg: ["--chamber-fg", "#ede6da"],
    fgMuted: ["--chamber-fg-muted", "#a39b90"],
    tones: TONE_CHAMBER_VAR,
    toneFallback: "#958d82",
  },
  page: {
    chamber: ["--bg", "#f5f1ea"],
    line: ["--line", "#d9d2c6"],
    amber: ["--sev-high", "#8f5d00"],
    fg: ["--fg", "#1c1917"],
    fgMuted: ["--fg-muted", "#6a6259"],
    tones: TONE_PAGE_VAR,
    toneFallback: "#6a6259",
  },
};

export function readPalette(ground: PaletteGround = "chamber"): ChamberPalette {
  const tokens = TOKENS[ground];
  const line = tokenColor(...tokens.line);
  const tones = new Map<string, Color>(
    Object.entries(tokens.tones).map(([tone, variable]) => [
      tone,
      tokenColor(variable, tokens.toneFallback),
    ]),
  );

  return {
    chamber: tokenColor(...tokens.chamber),
    line,
    amber: tokenColor(...tokens.amber),
    fg: tokenColor(...tokens.fg),
    fgMuted: tokenColor(...tokens.fgMuted),
    tone: (tone: Tone) => (tones.get(tone) ?? line).clone(),
  };
}
