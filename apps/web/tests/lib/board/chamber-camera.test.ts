import {
  DRIFT_MAX_PITCH,
  DRIFT_MAX_YAW,
  INLINE_RADIUS,
  cameraDrift,
  cameraPlacement,
  inlineDistance,
} from "@/lib/board/chamber-camera";
import { describe, expect, it } from "vitest";

describe("cameraDrift", () => {
  it("does not move at all under reduced motion", () => {
    // What lets renderOnce() draw one correct frame rather than a pose part
    // way through a cycle.
    expect(cameraDrift(0, true)).toEqual({ yaw: 0, pitch: 0 });
    expect(cameraDrift(123.4, true)).toEqual({ yaw: 0, pitch: 0 });
  });

  it("stays inside its stated bounds at every moment", () => {
    for (let t = 0; t < 400; t += 0.37) {
      const { yaw, pitch } = cameraDrift(t, false);
      expect(Math.abs(yaw)).toBeLessThanOrEqual(DRIFT_MAX_YAW + 1e-9);
      expect(Math.abs(pitch)).toBeLessThanOrEqual(DRIFT_MAX_PITCH + 1e-9);
    }
  });

  /**
   * One sine at forty-four seconds is, over the seconds a reader actually
   * looks, indistinguishable from a still frame. Two periods that do not divide
   * each other never repeat a pose.
   */
  it("is never still, over any short window", () => {
    for (const start of [0, 5, 22, 100]) {
      const a = cameraDrift(start, false);
      const b = cameraDrift(start + 1.5, false);
      expect(Math.abs(a.yaw - b.yaw) + Math.abs(a.pitch - b.pitch)).toBeGreaterThan(1e-4);
    }
  });
});

describe("cameraPlacement", () => {
  const base = { sparse: 0, yaw: 0, pitch: 0, aspect: 16 / 9 };

  it("stands back from the record and looks down it", () => {
    const placement = cameraPlacement(base);
    expect(placement.z).toBeGreaterThan(0);
    expect(placement.aimZ).toBeLessThan(0);
  });

  /**
   * The full-viewport requirement, asserted rather than eyeballed. A
   * perspective camera's vertical field is fixed, so a tall frame crops the
   * horizontal — which is the axis the record runs along.
   */
  it("pulls back as the frame narrows, so the record stays framed", () => {
    const wide = cameraPlacement({ ...base, aspect: 16 / 9 });
    const tall = cameraPlacement({ ...base, aspect: 3 / 4 });
    expect(tall.z).toBeGreaterThan(wide.z);
  });

  it("never pushes in past the framing it was composed for", () => {
    // A very wide window would otherwise crop the record at the other end.
    const ultrawide = cameraPlacement({ ...base, aspect: 32 / 9 });
    const reference = cameraPlacement({ ...base, aspect: 16 / 9 });
    expect(ultrawide.z).toBeCloseTo(reference.z, 6);
  });

  it("comes in when the record is nearly empty, and brings its aim", () => {
    const full = cameraPlacement({ ...base, sparse: 0 });
    const sparse = cameraPlacement({ ...base, sparse: 1 });
    expect(sparse.z).toBeLessThan(full.z);
    expect(sparse.aimZ).toBeGreaterThan(full.aimZ);
  });

  it("swings the stand point when the camera is yawed", () => {
    const straight = cameraPlacement(base);
    const swung = cameraPlacement({ ...base, yaw: 0.26 });
    expect(swung.x).not.toBeCloseTo(straight.x, 3);
  });
});

describe("inlineDistance", () => {
  it("stands far enough back to frame the radius with room to spare", () => {
    const distance = inlineDistance(40, INLINE_RADIUS, 1.3);
    const halfHeight = Math.tan((40 * Math.PI) / 180 / 2) * distance;
    expect(halfHeight).toBeGreaterThan(INLINE_RADIUS);
  });

  it("stands further back for a longer lens", () => {
    expect(inlineDistance(20, INLINE_RADIUS, 1.2)).toBeGreaterThan(
      inlineDistance(60, INLINE_RADIUS, 1.2),
    );
  });
});
