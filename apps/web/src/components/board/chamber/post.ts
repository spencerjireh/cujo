/**
 * The composed pass: bloom, grain, and the sRGB conversion at the end.
 *
 * The second half of decision 78's named exception. Everything here is
 * decorative, nothing here reads a run, and nothing outside this file and
 * `atmosphere.ts` is.
 *
 * The threshold is the load-bearing number. `LuminosityHighPassShader`
 * thresholds in linear space, where `--chamber-fg` — the colour of a check that
 * passed — sits around 0.72 and `--chamber-amber` around 0.47. A threshold low
 * enough to bloom the amber sweep would also bloom four bone arms and wash them
 * toward white, which is a decorative pass repainting a colour that means
 * something. So the threshold sits above bone: what glows is the additive
 * sprite behind each core, the amber sweep, and `blocked_pending`. The light in
 * the room comes from things drawn to emit it, and never from a verdict.
 */

import { Vector2, type WebGLRenderer } from "three";
import { HalfFloatType, type PerspectiveCamera, type Scene, WebGLRenderTarget } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { FilmPass } from "three/examples/jsm/postprocessing/FilmPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/** Above bone. See the note above — this is the number that protects the palette. */
const BLOOM_THRESHOLD = 0.78;
const BLOOM_STRENGTH = 0.45;
const BLOOM_RADIUS = 0.4;
/** Faint. Grain on a near-black ground reads as sensor noise long before this. */
const GRAIN = 0.18;
/**
 * Bloom runs at half resolution. It is a blur; nobody can see the difference,
 * and it is the single largest cost in the frame at a full-viewport canvas.
 */
const BLOOM_SCALE = 0.5;
/** Multisampling on the composer's own target, since `antialias` is bypassed. */
const SAMPLES = 4;

export interface Post {
  /** One composed frame. `0` is legal and deterministic: reduced motion uses it. */
  render(deltaSeconds: number): void;
  /** CSS pixels plus the ratio, in that order — the composer applies the ratio. */
  setSize(width: number, height: number, pixelRatio: number): void;
  dispose(): void;
}

export function createPost(args: {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
}): Post {
  const { renderer, scene, camera } = args;
  const size = renderer.getDrawingBufferSize(new Vector2());

  // An explicit target, because with a composer the renderer's own `antialias`
  // is dead: the scene is rendered into an offscreen buffer, and without
  // `samples` every line in the room comes out jagged. `renderTarget2` is
  // cloned from this one, so it inherits the setting, and `setSize` keeps it.
  const target = new WebGLRenderTarget(size.width, size.height, {
    type: HalfFloatType,
    samples: SAMPLES,
  });

  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new Vector2(size.width * BLOOM_SCALE, size.height * BLOOM_SCALE),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  );
  composer.addPass(bloom);

  // `false` is greyscale-off: the grain must not tint anything, only disturb it.
  composer.addPass(new FilmPass(GRAIN, false));
  // Last, always: it is what converts the linear working space to sRGB.
  composer.addPass(new OutputPass());

  function setSize(width: number, height: number, pixelRatio: number): void {
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    // After the composer, not before: `composer.setSize` calls `setSize` on
    // every pass, which resets the bloom's internal mip chain to full
    // resolution and quietly doubles the most expensive pass in the frame.
    bloom.setSize(width * pixelRatio * BLOOM_SCALE, height * pixelRatio * BLOOM_SCALE);
  }

  function dispose(): void {
    // The composer frees its two render targets and its copy pass, and nothing
    // else — the passes are not its to free. `UnrealBloomPass` alone holds
    // eleven render targets and five materials, and `Chamber` unmounts on every
    // client navigation away from the board.
    for (const pass of composer.passes) pass.dispose?.();
    composer.dispose();
    target.dispose();
  }

  return { render: (deltaSeconds: number) => composer.render(deltaSeconds), setSize, dispose };
}
