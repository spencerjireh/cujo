import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The Open Graph card is a copy of a brand asset, byte for byte, for the same
// reason the favicons are (decision 22): the file must live where Next can
// trace it, while the one source of truth stays in brand/, where
// `pnpm --filter @cujo/brand og` regenerates it. These checks fail the moment
// the copy drifts from brand, is edited in place, or is regenerated at a size
// the card convention does not promise.
const appImage = readFileSync(
  fileURLToPath(new URL("../../src/app/opengraph-image.png", import.meta.url)),
);
const brandImage = readFileSync(
  fileURLToPath(new URL("../../../../brand/logo/og-1200x630.png", import.meta.url)),
);

// PNG dims sit in the IHDR chunk at a fixed offset: eight-byte signature,
// four-byte length, four-byte type, then width and height, each big-endian.
function pngSize(buffer: Buffer) {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

describe("Open Graph card", () => {
  it("opengraph-image.png is byte-identical to brand/logo/og-1200x630.png", () => {
    expect(Buffer.compare(appImage, brandImage)).toBe(0);
  });

  it("is 1200 x 630, the size the metadata promises platforms", () => {
    expect(pngSize(brandImage)).toEqual({ width: 1200, height: 630 });
  });
});
