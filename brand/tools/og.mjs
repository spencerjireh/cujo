// Compose and render the Open Graph card: the 1200x630 image a messaging
// platform shows when a board or run link is pasted. The ground, the mark and
// the wordmark come from the dark-theme tokens; the tagline is the site
// metadata's one-line description, verbatim.
//
// The tagline is live text, so this script needs a JetBrains Mono TTF at
// render time (fetch JetBrains Mono 400 from Google Fonts, see tokens.json,
// and pass its path). The font is not committed — same rule as the Bricolage
// file `wordmark.mjs` asks for — because the committed artifact is the PNG,
// and a PNG owes no runtime a font.
//
// Usage: pnpm --filter @cujo/brand og <jetbrains-mono.ttf>
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const [fontPath] = process.argv.slice(2);
if (!fontPath) {
  console.error("usage: og.mjs <jetbrains-mono.ttf>");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const logo = join(here, "..", "logo");

// The mark's geometry is read out of `avatar.svg` rather than `mark.svg`
// because the card and the avatar sit on the same dark ground: `avatar.svg`
// already carries the dark-theme fills (`#ede6da` body, `#f2a900` eye) that
// `mark.svg` leaves to `currentColor`. Reading it keeps one source of
// geometry — a mark change in `avatar.svg` reaches this card on the next run.
const avatar = await readFile(join(logo, "avatar.svg"), "utf8");
const markInner = avatar.match(/<g transform="[^"]*">([\s\S]*)<\/g>/)?.[1];
if (!markInner) throw new Error("avatar.svg: no inner group to read the mark from");

// The wordmark is outlines (see `wordmark.mjs`), so it needs no font and no
// colour from this script's ground: the fill is restated per use, the way
// `lockup-h.svg` restates it.
const wordmark = await readFile(join(logo, "wordmark.svg"), "utf8");
const wordmarkPath = wordmark.match(/<path fill="currentColor" d="([^"]+)"/)?.[1];
if (!wordmarkPath) throw new Error("wordmark.svg: no outlined path to read");

// The lockup's internal geometry is `lockup-h.svg`'s: a 64-unit mark box, the
// wordmark at 0.4 scale hung from (82.4, 42.4). Those numbers are copied, not
// recomputed, so this card and the horizontal lockup stay one lockup.
const LOCKUP_SCALE = 3.6; // 165 x 64 units -> 594 x 230 px
const TAGLINE = "Execution-backed pull request review.";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0f0e0c"/>
  <g transform="translate(120 150) scale(${LOCKUP_SCALE})">
    <g>${markInner}</g>
    <g transform="translate(82.4 42.4) scale(0.4)"><path fill="#ede6da" d="${wordmarkPath}"/></g>
  </g>
  <text x="120" y="470" font-family="JetBrains Mono" font-size="40" fill="#a39b90">${TAGLINE}</text>
</svg>
`;

// `loadSystemFonts: false` so a font installed on whatever machine runs this
// can never stand in for the named one — the card must render the same
// everywhere it is regenerated, or the byte-identical copy in apps/web (and
// its test) is comparing against weather.
const resvg = new Resvg(svg, {
  font: {
    fontFiles: [resolve(fontPath)],
    loadSystemFonts: false,
    defaultFontFamily: "JetBrains Mono",
  },
});
const png = resvg.render().asPng();

const out = join(logo, "og-1200x630.png");
await writeFile(out, png);
console.log(`wrote ${out} (1200 x 630)`);
