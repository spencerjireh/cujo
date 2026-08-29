import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The favicons are copies of brand assets (the SVG with a provenance header,
// the PNG byte for byte), because a favicon has to be a file Next can trace,
// while the one source of truth stays in brand/ (decision 22). These checks
// fail the moment either copy drifts from brand or is edited in place instead.
const iconSvg = readFileSync(
  fileURLToPath(new URL("../../src/app/icon.svg", import.meta.url)),
  "utf8",
);
const brandSvg = readFileSync(
  fileURLToPath(new URL("../../../../brand/logo/favicon.svg", import.meta.url)),
  "utf8",
);
const iconPng = readFileSync(fileURLToPath(new URL("../../src/app/icon.png", import.meta.url)));
const brandPng = readFileSync(
  fileURLToPath(new URL("../../../../brand/logo/favicon-32.png", import.meta.url)),
);

describe("favicon copies", () => {
  it("icon.svg is brand/logo/favicon.svg plus only the provenance comment", () => {
    const stripped = iconSvg.replace(/<!--[\s\S]*?-->/g, "").trim();
    expect(stripped).toBe(brandSvg.trim());
  });

  it("icon.png is byte-identical to brand/logo/favicon-32.png", () => {
    expect(Buffer.compare(iconPng, brandPng)).toBe(0);
  });
});
