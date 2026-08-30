/**
 * A run, as geometry. The one part of the scene two scenes share.
 *
 * The chamber draws the record as a galaxy; the run page draws exactly one
 * specimen, beside the pull request's title, with no room around it. They have
 * to be the same drawing — a specimen that means one thing on the board and
 * another on the run page would make the shape decorative — so the builder is
 * here and both callers use it.
 *
 * A run is a star system (decision 82). The core is the star: the verdict, in
 * its colour, sized by the worst thing the run found, with an additive glow
 * behind it that is what blooms. Each check is a ring around it, on a tilt
 * seeded off the run's id (decision 83): its radius is how long the check
 * watched, the bright arc of it is the share of that spent executing in the
 * sandbox and the faint remainder is the agent deciding what to do next, and
 * its colour is how the check ended. Findings are satellites on an orbit
 * outside the rings, worst first.
 *
 * A live run is the one thing here that moves on its own: its rings turn in
 * their planes so the bright arcs circulate, its satellites go round faster,
 * the whole system precesses, and it emits a slow pulse. A finished run only
 * turns its satellites. Nothing here breathes: a scale that pulsed on its own
 * was jitter, and the sweep already lifts a star when it reads it.
 *
 * What separates the two callers is a rig, not a flag named after the caller:
 * the board asks for the live pulse and the glow, the run page for the pulse
 * alone. `build()` returns a detached `Group`, and whoever asked for it decides
 * what to add it to.
 *
 * Every rule about what a specimen *means* lives in `@/lib/board/specimen` and
 * `@/lib/board/orbit`, which are pure and tested. This module only turns that
 * into meshes — and it imports nothing from `three/examples`, because the run
 * page's chunk must not carry the composer.
 */

import { RING_MAX, RING_MIN, RING_TUBE } from "@/lib/board/chamber-layout";
import {
  SATELLITE_ORBIT,
  type Vec3,
  ringBasis,
  ringNormals,
  satelliteRing,
} from "@/lib/board/orbit";
import type { Specimen } from "@/lib/board/specimen";
import {
  AdditiveBlending,
  type Camera,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Texture,
  TorusGeometry,
  Vector3,
} from "three";
import type { ChamberPalette } from "./palette";
import { radialTexture } from "./textures";

/** How much of its colour a specimen keeps while another one is lit. */
export const DIMMED = 0.45;

/**
 * The core, sized against the rings rather than in absolute units, so the
 * relationship survives the rings being resized.
 */
const CORE_RADIUS = RING_MAX * 0.14;
/** The glow behind it: wide enough to read as a star, not a dot with a halo. */
const GLOW_SCALE = CORE_RADIUS * 3.2;
const GLOW_OPACITY = 0.55;

/** The faint arc of a ring: thinner and fainter, never a second hue. */
const FAINT_TUBE = RING_TUBE * 0.55;
const FAINT_OPACITY = 0.34;
/** Segments round a ring, and round its tube. */
const RING_SEGMENTS = 64;
const TUBE_SEGMENTS = 6;

/** One finding, as a small sphere on the outer orbit. */
const SATELLITE_RADIUS = RING_MAX * 0.045;
/**
 * How long the satellites take to go round once, at rest and on a live run.
 * Decoration; carries nothing.
 */
const SATELLITE_TURN_SECONDS = 40;
const SATELLITE_TURN_LIVE_SECONDS = 10;
/** How long a live run's rings take to precess once. Decoration; carries nothing. */
const PRECESS_SECONDS = 8;
/** How long a live run's ring takes to turn once in its own plane. */
const RING_SPIN_SECONDS = 6;
/** How often a live run emits a pulse. */
const PULSE_SECONDS = 4;

/**
 * What a pointer lands on. The core is a tenth of a unit across, and a hover
 * that had to find it would find nothing; the system is picked as a whole.
 */
const PICK_RADIUS = RING_MAX * 0.7;

/**
 * What the specimen is drawn with beyond its own shape, which is the only
 * thing the two scenes differ by.
 */
export interface SpecimenRig {
  /** The expanding pulse a live run emits. */
  ring: boolean;
  /** The additive glow behind the core. The board has bloom; the run page does not. */
  glow: boolean;
}

interface SpecimenOrbit {
  /** Oriented onto the ring's plane. */
  holder: Group;
  /**
   * Inside the holder, and what a live run turns. A rotation written to the
   * holder itself would replace the orientation it was given.
   */
  spin: Group;
  /** The sandbox's share, always drawn. */
  bright: Mesh;
  /** What was left, drawn only when the check measured a share to leave. */
  faint: Mesh | null;
}

/**
 * A material and the opacity it returns to when nothing is dimmed.
 *
 * Carried rather than inferred, because the specimens are not all opaque: the
 * faint arc of a ring sits at 0.34 and the glow at 0.55, and resetting either
 * to 1 would turn it into something it is not.
 */
interface ToneMaterial {
  material: MeshBasicMaterial | SpriteMaterial;
  base: number;
}

export interface SpecimenNode {
  /** At its place in the volume. Never scaled, so the pulse stays where it is. */
  group: Group;
  /** What focus, the wash and arrival scale: the core, the rings, the glow. */
  body: Group;
  core: Mesh;
  /** Invisible, and what the raycaster is given. */
  pick: Mesh;
  glow: Sprite | null;
  /** The four ring planes, together, so a live run can precess them as one. */
  rings: Group;
  orbits: SpecimenOrbit[];
  /** One per finding, on the outer orbit. Turned as a group. */
  satellites: Group;
  /** Only on a live run. Its opacity is written every frame. */
  ring: Mesh | null;
  materials: ToneMaterial[];
  /**
   * Eased, not switched. These are the *current* values; the scene pushes
   * targets and `applySpecimenFrame` walks them.
   */
  focusAmount: number;
  dimAmount: number;
  /** Where the slot is now, and where it is going. Equal at rest. */
  slotFrom: number;
  slotTo: number;
  /** When the current slide began, in scene seconds. Negative means at rest. */
  slideFrom: number;
  /**
   * Where the current slide started, when it started somewhere other than at
   * a slot: a poll that lands mid-slide begins the next one from wherever the
   * run is, so nothing jumps. Null for a slide from a slot.
   */
  slideOrigin: { x: number; y: number; z: number } | null;
  /** When this run arrived. Negative means it was always here. */
  arriveFrom: number;
  spec: Specimen;
}

export interface SpecimenKit {
  /** A detached group. The caller adds it to whatever it is drawing into. */
  build(spec: Specimen): SpecimenNode;
  /** Free one node's own materials and geometries. */
  release(node: SpecimenNode): void;
  /** Free everything shared between nodes. */
  dispose(): void;
}

/** A ring's radius for a check's measured length, 0–1 of the longest. */
export function ringRadius(length: number): number {
  return RING_MIN + Math.min(1, Math.max(0, length)) * (RING_MAX - RING_MIN);
}

/**
 * Turn a holder so its local plane is the ring's plane and its local x is
 * where the bright arc begins. `TorusGeometry` lies in local xy starting on
 * +x, so this is all the orientation a ring needs.
 */
function orient(holder: Group, normal: Vec3): void {
  const { u, v } = ringBasis(normal);
  const basis = new Matrix4().makeBasis(
    new Vector3(u.x, u.y, u.z),
    new Vector3(v.x, v.y, v.z),
    new Vector3(normal.x, normal.y, normal.z),
  );
  holder.quaternion.setFromRotationMatrix(basis);
}

export function createSpecimenKit(palette: ChamberPalette, rig: SpecimenRig): SpecimenKit {
  const coreGeometry = new SphereGeometry(CORE_RADIUS, 20, 14);
  const satelliteGeometry = new SphereGeometry(SATELLITE_RADIUS, 10, 8);
  const pickGeometry = new SphereGeometry(PICK_RADIUS, 8, 6);
  // Draws nothing and takes no depth, and is still there for the raycaster,
  // which does not consult `visible`.
  const pickMaterial = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  // Thin, and sized against the rings: a hairline that expands and fades reads
  // as something the run is emitting rather than a reticle drawn round it.
  const pulseGeometry = new RingGeometry(RING_MAX * 0.3, RING_MAX * 0.315, 40);
  // Built lazily and only where it is wanted: the texture needs a canvas, and a
  // rig that draws no glow should not touch the DOM to make one.
  let glow: Texture | null = null;

  function build(spec: Specimen): SpecimenNode {
    const group = new Group();
    const materials: ToneMaterial[] = [];
    const toneColor = palette.tone(spec.tone);

    const body = new Group();
    group.add(body);

    // Behind the core, and additive, so it adds light rather than paint. The
    // colour is the verdict's own — this makes a specimen luminous without
    // spending a hue the palette has not already spent.
    let glowSprite: Sprite | null = null;
    if (rig.glow) {
      if (!glow) glow = radialTexture();
      const material = new SpriteMaterial({
        map: glow,
        color: toneColor,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        opacity: GLOW_OPACITY,
        fog: true,
      });
      glowSprite = new Sprite(material);
      glowSprite.scale.setScalar(GLOW_SCALE * spec.coreScale);
      body.add(glowSprite);
      materials.push({ material, base: GLOW_OPACITY });
    }

    const coreMaterial = new MeshBasicMaterial({
      color: toneColor,
      fog: true,
      transparent: true,
      opacity: 1,
    });
    const core = new Mesh(coreGeometry, coreMaterial);
    // The worst thing the run found, as size. Fog takes the colour out of a
    // distant specimen long before it takes the silhouette, so a dangerous run
    // at the back of the volume still reads as one.
    core.scale.setScalar(spec.coreScale);
    body.add(core);
    materials.push({ material: coreMaterial, base: 1 });

    const pick = new Mesh(pickGeometry, pickMaterial);
    body.add(pick);

    const rings = new Group();
    body.add(rings);
    const orbits: SpecimenOrbit[] = [];
    // The run's own four planes, from its id. Computed and not stored: one
    // hash per ring is cheaper than remembering thirty runs' tilts.
    const normals = ringNormals(spec.id);
    spec.bars.forEach((bar, i) => {
      // Length zero is a check that never appeared. Drawing a ring would claim
      // it ran briefly, so nothing is drawn at all and the gap is the fact.
      if (bar.length <= 0) return;
      const normal = normals[i];
      if (!normal) return;
      const color = palette.tone(bar.tone);
      const radius = ringRadius(bar.length);
      const share = bar.solid === null ? 1 : Math.min(1, Math.max(0, bar.solid));

      const holder = new Group();
      orient(holder, normal);
      rings.add(holder);
      const spin = new Group();
      holder.add(spin);

      const brightMaterial = new MeshBasicMaterial({
        color,
        fog: true,
        transparent: true,
        opacity: 1,
      });
      const bright = new Mesh(
        new TorusGeometry(radius, RING_TUBE, TUBE_SEGMENTS, RING_SEGMENTS, 2 * Math.PI * share),
        brightMaterial,
      );
      spin.add(bright);
      materials.push({ material: brightMaterial, base: 1 });

      // Only where there is a share to leave. A ring the check measured no
      // split for is one whole piece.
      let faint: Mesh | null = null;
      if (share < 1) {
        // Same hue, less of it. Decision 68 rejected a second colour for the
        // sandbox share by name; strength is what it asked for instead.
        const faintMaterial = new MeshBasicMaterial({
          color,
          fog: true,
          transparent: true,
          opacity: FAINT_OPACITY,
        });
        faint = new Mesh(
          new TorusGeometry(
            radius,
            FAINT_TUBE,
            TUBE_SEGMENTS,
            RING_SEGMENTS,
            2 * Math.PI * (1 - share),
          ),
          faintMaterial,
        );
        // Picks up where the bright arc stopped.
        faint.rotation.z = 2 * Math.PI * share;
        spin.add(faint);
        materials.push({ material: faintMaterial, base: FAINT_OPACITY });
      }

      orbits.push({ holder, spin, bright, faint });
    });

    // One satellite per finding, on the orbit outside the rings, facing the
    // reader: what the run produced, circling the verdict it produced.
    const satellites = new Group();
    body.add(satellites);
    const orbit = RING_MAX * SATELLITE_ORBIT;
    satelliteRing(spec.marks.length).forEach((angle, i) => {
      const mark = spec.marks[i];
      if (!mark) return;
      const material = new MeshBasicMaterial({
        color: palette.tone(mark.tone),
        fog: true,
        transparent: true,
        opacity: 1,
      });
      const mesh = new Mesh(satelliteGeometry, material);
      mesh.position.set(Math.cos(angle) * orbit, Math.sin(angle) * orbit, 0);
      satellites.add(mesh);
      materials.push({ material, base: 1 });
    });

    // A live run gets a pulse that expands and fades. Amber, which brand.md
    // allows on exactly the things that are waiting — and a run still in the
    // sandbox is the board's other one.
    let ring: Mesh | null = null;
    if (rig.ring && spec.live) {
      const ringMaterial = new MeshBasicMaterial({
        color: palette.amber,
        fog: true,
        transparent: true,
        opacity: 0,
      });
      ring = new Mesh(pulseGeometry, ringMaterial);
      group.add(ring);
    }

    return {
      group,
      body,
      core,
      pick,
      glow: glowSprite,
      rings,
      orbits,
      satellites,
      ring,
      materials,
      focusAmount: 0,
      dimAmount: 0,
      slotFrom: spec.index,
      slotTo: spec.index,
      slideFrom: -1,
      slideOrigin: null,
      arriveFrom: -1,
      spec,
    };
  }

  function release(node: SpecimenNode): void {
    node.group.removeFromParent();
    for (const entry of node.materials) entry.material.dispose();
    if (node.ring) (node.ring.material as MeshBasicMaterial).dispose();
    // The tori are per node: their radius and arc are this run's own numbers.
    for (const orbit of node.orbits) {
      orbit.bright.geometry.dispose();
      orbit.faint?.geometry.dispose();
    }
  }

  function dispose(): void {
    coreGeometry.dispose();
    satelliteGeometry.dispose();
    pickGeometry.dispose();
    pickMaterial.dispose();
    pulseGeometry.dispose();
    glow?.dispose();
    glow = null;
  }

  return { build, release, dispose };
}

export interface SpecimenFrame {
  elapsed: number;
  reducedMotion: boolean;
  camera: Camera;
  /** Focus and dim, already eased by the scene. */
  focus: number;
  dim: number;
  /** How hard the wash is reading this specimen, 0–1. */
  read: number;
  /**
   * Arrival, as two numbers rather than one. They are not the same curve on
   * purpose: a new run is fully opaque before it has finished moving, so the
   * shape is solid by the time it lands instead of still fading while it
   * settles. Both are 1 for a specimen that was always here.
   */
  arrivalScale: number;
  arrivalOpacity: number;
}

/** How much brighter a star's glow is while the light is on it, as a factor. */
const READ_GLOW = 0.6;

/**
 * Draw one node's frame.
 *
 * Scale has one contributor beyond arrival, so nothing ever pulses out of
 * phase with the instrument that is supposed to be driving it: focus is the
 * reader. The wash is not a scale either — a star that grew as the light
 * passed was the strobe decision 83 removed — it is the glow swelling. A live
 * run is not a scale: it turns.
 */
export function applySpecimenFrame(node: SpecimenNode, frame: SpecimenFrame): void {
  const { elapsed, reducedMotion, camera } = frame;

  node.body.scale.setScalar((1 + frame.focus * 0.55) * frame.arrivalScale);

  // Opacity is the dim state and the arrival fade at once. Both are multipliers
  // on the material's own resting value, which is not always 1.
  const strength = (1 - frame.dim * (1 - DIMMED)) * frame.arrivalOpacity;
  for (const { material, base } of node.materials) {
    material.opacity = base * strength;
  }
  // The light arriving: more of the glow's own colour, and nothing else moves.
  if (node.glow)
    node.glow.material.opacity = GLOW_OPACITY * strength * (1 + frame.read * READ_GLOW);

  if (!reducedMotion) {
    const live = node.spec.live;
    // The satellites go round, and a live run's rings turn in their planes and
    // precess as a group. None of it carries anything: all of it is decoration
    // by the rule that admits the haze and the glow, and what it shows is the
    // shape, which is entirely measurement. A live run is the only star that
    // turns its rings, which is what makes it the one star a reader can find.
    const turn = live ? SATELLITE_TURN_LIVE_SECONDS : SATELLITE_TURN_SECONDS;
    node.satellites.rotation.z = (elapsed / turn) * 2 * Math.PI;
    node.rings.rotation.y = live ? (elapsed / PRECESS_SECONDS) * 2 * Math.PI : 0;
    node.orbits.forEach((orbit, i) => {
      // Alternate directions, so the system is rings and not a wheel.
      const direction = i % 2 === 0 ? 1 : -1;
      orbit.spin.rotation.z = live ? direction * (elapsed / RING_SPIN_SECONDS) * 2 * Math.PI : 0;
    });

    // Expansion and fade, restarting: a pulse leaving a run that is still
    // executing. Slow, so it reads as a breath and not a beacon.
    if (node.ring) {
      const phase = (elapsed % PULSE_SECONDS) / PULSE_SECONDS;
      node.ring.scale.setScalar(0.55 + phase * 1.35);
      const material = node.ring.material as MeshBasicMaterial;
      material.opacity = 0.3 * (1 - phase) * strength;
      node.ring.lookAt(camera.position);
    }
  } else {
    // Defined resting values rather than whatever the last frame left: this is
    // the frame reduced motion actually sees.
    node.satellites.rotation.z = 0;
    node.rings.rotation.y = 0;
    for (const orbit of node.orbits) orbit.spin.rotation.z = 0;
    if (node.ring) {
      node.ring.scale.setScalar(1);
      (node.ring.material as MeshBasicMaterial).opacity = 0.18 * strength;
    }
  }
}

/** Land on the targets without easing, for reduced motion and for a rebuild. */
export function snapSpecimen(node: SpecimenNode, focus: number, dim: number): void {
  node.focusAmount = focus;
  node.dimAmount = dim;
}
