/**
 * Where the camera stands, and how it moves when nobody is touching it.
 *
 * Two jobs, both of which used to be arithmetic inline in the render loop.
 * Pulling them here is what lets the framing be asserted rather than eyeballed:
 * the hero is a full viewport now, so its aspect ratio varies far more than a
 * fixed 40rem band ever did, and "the record still fits on a tall screen" is a
 * claim a test can hold.
 */

import { RECORD_X, RING_MAX } from "./chamber-layout";
import { clamp } from "./ease";
import { SATELLITE_ORBIT } from "./orbit";

/**
 * Where the camera stands with a full record, before any swing.
 *
 * Four units in front of the newest layer, which leaves the three stars in it
 * large and plainly the nearest things in the room without any of them being
 * a wall, and left of the record, so the five layers recede diagonally across
 * the right of the frame rather than piling onto the vanishing point.
 */
const HOME = { x: -0.9, y: 0.35, z: 4.2 } as const;
/**
 * Where it points: down the record rather than at the middle of it, and far
 * enough down that the recession stays in the right half of the frame rather
 * than climbing into the headline.
 */
const AIM = { x: RECORD_X + 0.5, y: 0.0, z: -2.6 } as const;

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
 * breathing, which decision 79 admits by name.
 */
const BREATH_SECONDS = 9.3;
const BREATH_YAW = 0.012;
const BREATH_PITCH = 0.008;

/** The aspect below which the frame is taller than the record is wide. */
const REFERENCE_ASPECT = 16 / 9;
/** How far left the aim moves per unit of narrowness past the reference. */
const NARROW_AIM_LEFT = 1.2;

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
 * in when the record is nearly empty, and brings the aim with it so a record
 * of one or two stars in the front layer fills the frame it is given. `aspect`
 * pulls it back when the frame is narrow: a perspective camera's vertical
 * field is fixed, so a tall viewport crops the horizontal — and the record
 * recedes across the frame, which is exactly the axis that would be lost.
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

  const standZ = (HOME.z - sparse * 1.6) * narrowness;
  const aimZ = AIM.z + sparse * 2.6;
  const swing = 0.55;
  // Standing further back widens the frame on both sides, and the left side
  // is the readout's. Aiming a little left as the frame narrows keeps the
  // galaxy on the right of it rather than letting the back layers drift in
  // under the paragraph.
  const aimX = AIM.x - (narrowness - 1) * NARROW_AIM_LEFT;

  return {
    x: HOME.x + Math.sin(yaw) * standZ * swing,
    y: HOME.y + pitch * 1.6,
    z: standZ * Math.cos(yaw * swing),
    aimX,
    aimY: AIM.y,
    aimZ,
  };
}

/**
 * The inline scene's framing, on the run page.
 *
 * A single specimen with no room around it, so the camera is placed from the
 * shape's own extent rather than from the volume's. The radius is the outer
 * orbit the chamber draws and not something measured off this specimen: two
 * runs drawn at two sizes because one had wider rings would make the drawing a
 * comparison of itself rather than of the runs, and the rings already carry
 * that. Derived rather than stated so it follows the shape when the rings are
 * resized — it was once a bare 0.42 against arms that had grown past it.
 */
export const INLINE_RADIUS = RING_MAX * SATELLITE_ORBIT;

/** How far back a camera of this field of view must stand to frame a radius. */
export function inlineDistance(fovDeg: number, radius: number, margin: number): number {
  const fov = (clamp(fovDeg, 1, 179) * Math.PI) / 180;
  return (radius * margin) / Math.tan(fov / 2);
}
