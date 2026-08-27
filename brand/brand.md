# Cujo brand

Cujo is a guard dog on a chain. It reviews pull requests by running them in a
disposable sandbox, and it only bites (blocks a merge) after a human says so.
Everything below serves three ideas: execution, containment, restraint.

## Name

`Cujo`, lowercase `cujo` in the wordmark and in handles (`cujo-guard[bot]`).
The reference is the Stephen King dog; the brand reads it as loyal and
watchful, never rabid. No snarling, no teeth, no blood, no horror typography.

## Mark

A geometric dog head in profile facing right, ear folded back, one flat fill,
one amber eye. Eight straight cuts, no curves except the eye (candidate
`c5-minimal`; the others stay in `logo/candidates/`).

- Fill is `currentColor`, so the mark takes the text color of its context:
  bone on dark, near-black on light. The eye is always amber
  (`#f2a900` on dark, `#b57600` on light when it can be themed).
- Clear space: one ear height (roughly a quarter of the mark's height) on
  every side.
- Minimum size 16 px. Below 24 px use `favicon.svg`, which has a larger eye.
- Do not rotate, mirror, outline, add a gradient, or put the mark in a circle.
- `mark-mono.svg` is for single-color contexts only (print, engraving,
  monochrome badges).

## Wordmark and lockup

`cujo`, Bricolage Grotesque 700, converted to outlines. In the horizontal
lockup the wordmark is 44/64 of the mark height, gap of a quarter mark. The
mark alone is fine anywhere the name is already visible (GitHub avatar, tab
icon, UI corner).

## Color

Warm neutrals, one amber accent, one red reserved for `critical`.

| Token | Light | Dark |
| --- | --- | --- |
| `--bg` | `#f5f1ea` | `#0f0e0c` |
| `--bg-raised` | `#fcfaf6` | `#1a1815` |
| `--fg` | `#1c1917` | `#ede6da` |
| `--fg-muted` | `#6a6259` | `#a39b90` |
| `--line` | `#d9d2c6` | `#2c2924` |
| `--accent` (text) | `#8f5d00` | `#f2a900` |
| `--accent-fill` (shapes) | `#b57600` | `#f2a900` |
| `--accent-fg` (on accent fill) | `#f5f1ea` | `#0f0e0c` |

Amber is the brand. Use it for the eye, the active state, the approve button,
and `high`. Use it sparingly: a calm review has almost no amber on the page.

### Severity ramp

Fixed everywhere: UI badges, README tables, video lower thirds.

| Level | Light fg / bg | Dark fg / bg |
| --- | --- | --- |
| critical | `#b8321c` / `#f6dcd6` | `#ff5c45` / `#3a1a15` |
| high | `#8f5d00` / `#f3e3c2` | `#f2a900` / `#3a2c0a` |
| medium | `#6f5a00` / `#efe8bf` | `#e6cf4a` / `#35300f` |
| low | `#6a6259` / `#e6e0d6` | `#8f877c` / `#26231f` |
| info | `#1d62a3` / `#d6e4f3` | `#66b0f0` / `#14283a` |

Critical is red so it is never confused with the brand amber; high is amber.

### Contrast (WCAG, text on `--bg`)

Light: fg 15.5, muted 5.3, accent 5.0, critical 5.3, high 5.0, medium 5.9,
low 5.3, info 5.6. `--accent-fill` on light is 3.4, so it is for shapes and
large text only. Dark: fg 15.6, muted 7.0, accent 9.6, critical 6.3, high 9.6,
medium 12.3, low 5.4, info 8.3. All text pairs clear AA (4.5:1); ratios on
`--bg-raised` are within 0.5 of these.

## Type

- Display: Bricolage Grotesque 700 for headings, the wordmark, and run titles.
- Mono: JetBrains Mono 500 for everything that is evidence: commands, test
  names, paths, counts, severity labels, timestamps.
- Body text in the UI is the mono face at `--text-md`; the UI is a log of what
  ran, and it should look like one.
- Do not use Inter, Roboto, or a system UI stack in brand surfaces.

## Voice

Terse and evidential. State what ran and what happened; let the numbers do the
arguing.

- "Ran 212 tests on base and head. 3 failed on head only."
- "Install script for `left-pad-utils` opened a socket to 185.220.101.4."
- "Smoke boot returned 500 on `GET /orders`."

No exclamation marks. No mascot voice, no first person, no praise. The bot
never says "great work". Severity words are lowercase and appear exactly as in
the ramp.

## Where each asset goes

| Surface | Assets |
| --- | --- |
| GitHub App avatar | `logo/mark.svg` rendered at 512 on `--bg` dark |
| UI | `tokens.css`; `favicon.svg` and `favicon-32.png`; `lockup-h.svg` in the header |
| README | `readme/banner-dark.svg` and `banner-light.svg` via `<picture>` |
| Video | `video/title-card.svg`, `video/lower-third.svg`, `video/severity-badges.svg` |

The tagline is not decided; placeholders read "Tagline TBD" in `--fg-muted`.
