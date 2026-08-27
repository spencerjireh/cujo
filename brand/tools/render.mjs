// Render every SVG under brand/logo (candidates included) to PNG at the sizes a
// mark must survive: 16 (favicon), 32, 64 (GitHub avatar in a comment), 512.
// Usage: pnpm --filter @cujo/brand render [--out <dir>] [file.svg ...]
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const sizes = [16, 32, 64, 512];

const argv = process.argv.slice(2);
const outIndex = argv.indexOf("--out");
const out = outIndex >= 0 ? resolve(argv[outIndex + 1]) : join(root, "logo", "png");
const files = argv.filter((a, i) => a !== "--out" && i !== outIndex + 1);

async function listSvgs() {
  if (files.length > 0) return files.map((f) => resolve(f));
  const found = [];
  for (const dir of [join(root, "logo"), join(root, "logo", "candidates")]) {
    for (const name of await readdir(dir)) {
      if (name.endsWith(".svg")) found.push(join(dir, name));
    }
  }
  return found;
}

await mkdir(out, { recursive: true });
for (const file of await listSvgs()) {
  const svg = await readFile(file, "utf8");
  const stem = basename(file, ".svg");
  for (const size of sizes) {
    const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
    await writeFile(join(out, `${stem}-${size}.png`), png);
  }
  console.log(`${stem}: ${sizes.join(", ")} px`);
}
