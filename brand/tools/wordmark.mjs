// Convert the wordmark text to SVG outlines so no asset depends on the font
// being installed. The font file is not committed; fetch Bricolage Grotesque
// 700 from Google Fonts (see tokens.json) and pass its path.
// Usage: pnpm --filter @cujo/brand wordmark <font.ttf> [text] [size]
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";

const [fontPath, text = "cujo", sizeArg = "96"] = process.argv.slice(2);
if (!fontPath) {
  console.error("usage: wordmark.mjs <font.ttf> [text] [size]");
  process.exit(1);
}
const size = Number(sizeArg);
const buffer = await readFile(resolve(fontPath));
const font = opentype.parse(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
);
// Lay out glyph by glyph: font.getPath() runs GSUB shaping, which opentype.js
// does not fully support for this font. Kerning is applied from the GPOS/kern
// tables, which is all a four-letter wordmark needs.
const scale = size / font.unitsPerEm;
const path = new opentype.Path();
let x = 0;
let previous = null;
for (const char of text) {
  const glyph = font.charToGlyph(char);
  if (previous) x += font.getKerningValue(previous, glyph) * scale;
  path.extend(glyph.getPath(x, 0, size));
  x += glyph.advanceWidth * scale;
  previous = glyph;
}
const box = path.getBoundingBox();
const pad = size * 0.1;
const width = (box.x2 - box.x1 + pad * 2).toFixed(1);
const height = (box.y2 - box.y1 + pad * 2).toFixed(1);
const d = path.toPathData(2);
const label = text.replace(
  /[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${(box.x1 - pad).toFixed(1)} ${(box.y1 - pad).toFixed(1)} ${width} ${height}" role="img" aria-label="${label}">
  <path fill="currentColor" d="${d}"/>
</svg>
`;
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "logo", "wordmark.svg");
await writeFile(out, svg);
console.log(`wrote ${out} (${width} x ${height})`);
