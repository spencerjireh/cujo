/**
 * A soft radial dot, as a texture, and the only one the chamber draws with.
 *
 * Greyscale on purpose. Everything that uses it tints it — the glow behind a
 * core takes the verdict's colour, the sweep takes amber — so no light in the
 * room can introduce a hue the palette has not already spent (decision 69).
 *
 * Its own module because two files want it and neither should own it: the
 * specimen builder is shared with the run page's scene, and the room is not, so
 * either importing the other would drag a file across a seam that exists.
 */

import { CanvasTexture, type Texture } from "three";

export function radialTexture(): Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.34)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
