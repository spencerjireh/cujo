/**
 * Where the camera stands, and how it moves when nobody is touching it.
 *
 * Two jobs, both of which used to be arithmetic inline in the render loop.
 * Pulling them here is what lets the framing be asserted rather than eyeballed:
 * the hero is a full viewport now, so its aspect ratio varies far more than a
 * fixed 40rem band ever did, and "the record still fits on a tall screen" is a
 * claim a test can hold.
 */

import { CHAMBER_BOX, RECORD_X } from "./chamber-layout";
import { clamp } from "./ease";

/**
 * Where the camera stands with a full record, before any swing.
 *
 * **Inside the mouth of the chamber.** `MOUTH_Z` is the volume's near face at
 * 4.5 and this stands at 3.4, so the near edges of the box are behind the
 * camera and run off the top and sides of the frame toward the vanishing point.
 * That is what turns the chamber from a box seen from outside into a space the
 * reader is standing in — and it is what fills the top of a full-height frame,
 * which a 2.3-unit-tall box viewed from beyond it never could.
 *
 * The nearest specimen sits at `FRONT_Z`, which leaves nearly four units
 * between the camera and it: far enough that the newest run is an object rather
 * than a wall, close enough that it is plainly the nearest thing in the room.
 */
const HOME = { x: -0.95, y: 0.4, z: 4.0 } as const;
/**
 * Where it points: down the record rather than at the middle of the box, and
 * far enough down it that the recession stays in the right half of the frame
 * rather than climbing into the headline.
 */
const AIM = { x: RECORD_X + 0.15, y: 0.0, z: -5.4 } as const;

/** How far the camera may be swung by a drag. A peek, not an orbit. */
export const YAW_LIMIT = 0.26;
export const PITCH_LIMIT = 0.14;

/** One ambient orbit. Slow enough to be parallax and not motion. */
const DRIFT_SECONDS = 44;
const DRIFT_YAW = 0.045;
/**
 * A second, shorter oscillation under the first.
 *
 * One sine at forty-four seconds is, at any moment a reader is actually
 * looking, indistinguishable from a still frame — which is most of why a board
 * with no live run felt switched off. Two periods that do not divide each other
 * never repeat the same pose, so the volume is never quite still without ever
 * being in motion. It carries no data and makes no claim: it is the camera
 * breathing, which decision 69 admits by name.
 */
const BREATH_SECONDS = 9.3;
const BREATH_YAW = 0.012;
const BREATH_PITCH = 0.008;

/** The aspect below which the frame is taller than the record is wide. */
const REFERENCE_ASPECT = 16 / 9;

export interface Drift {
  yaw: number;
  pitch: number;
}

/**
 * The ambient swing at a moment. Exactly zero under reduced motion, which is
 * what lets `renderOnce()` produce one correct frame rather than a pose part
 * way through a cycle.
 */
export function cameraDrift(elapsed: number, reducedMotion: boolean): Drift {
  if (reducedMotion) return { yaw: 0, pitch: 0 };
  const primary = Math.sin((elapsed / DRIFT_SECONDS) * Math.PI * 2) * DRIFT_YAW;
  const breathYaw = Math.sin((elapsed / BREATH_SECONDS) * Math.PI * 2) * BREATH_YAW;
  const breathPitch = Math.cos((elapsed / BREATH_SECONDS) * Math.PI * 2) * BREATH_PITCH;
  return { yaw: primary + breathYaw, pitch: breathPitch };
}

/** The largest swing `cameraDrift` can return, for the test that bounds it. */
export const DRIFT_MAX_YAW = DRIFT_YAW + BREATH_YAW;
export const DRIFT_MAX_PITCH = BREATH_PITCH;

export interface Placement {
  x: number;
  y: number;
  z: number;
  aimX: number;
  aimY: number;
  aimZ: number;
}

/**
 * Where to stand and what to look at.
 *
 * Two corrections ride on top of the home position. `sparse` pulls the camera
 * in when the record is nearly empty, and brings the aim with it so the near
 * end of a three-run chain does not slide out of shot. `aspect` pulls it back
 * when the frame is narrow: a perspective camera's vertical field is fixed, so
 * a tall viewport crops the horizontal — and the record runs across the frame,
 * which is exactly the axis that would be lost. At 100svh on a portrait `md`
 * screen that is the difference between a record and a row of two specimens.
 */
export function cameraPlacement(input: {
  sparse: number;
  yaw: number;
  pitch: number;
  aspect: number;
}): Placement {
  const { sparse, yaw, pitch } = input;
  // Never closer than the reference framing, however wide the window gets: the
  // scene is composed for this distance and pushing in past it crops the record
  // at the other end.
  const aspect = Math.max(0.2, Math.min(input.aspect, REFERENCE_ASPECT));
  const narrowness = REFERENCE_ASPECT / aspect;

  const standZ = (HOME.z - sparse * 2.1) * narrowness;
  const aimZ = AIM.z + sparse * 2.4;
  const swing = 0.55;

  return {
    x: HOME.x + Math.sin(yaw) * standZ * swing,
    y: HOME.y + pitch * 1.6,
    z: standZ * Math.cos(yaw * swing),
    aimX: AIM.x,
    aimY: AIM.y,
    aimZ,
  };
}

/**
 * The inline scene's framing, on the run page.
 *
 * A single specimen with no room around it, so the camera is placed from the
 * shape's own extent rather than from the volume's. The radius is a constant
 * and not measured off the specimen: two runs drawn at two sizes because one
 * had longer arms would make the drawing a comparison of itself rather than of
 * the runs, and the arms already carry that.
 */
export const INLINE_RADIUS = 0.42;

/** How far back a camera of this field of view must stand to frame a radius. */
export function inlineDistance(fovDeg: number, radius: number, margin: number): number {
  const fov = (clamp(fovDeg, 1, 179) * Math.PI) / 180;
  return (radius * margin) / Math.tan(fov / 2);
}

/** The volume's own extent, for anything that has to enclose it. */
export const CHAMBER_RADIUS = Math.hypot(
  CHAMBER_BOX.width / 2,
  CHAMBER_BOX.height / 2,
  CHAMBER_BOX.depth / 2,
);
