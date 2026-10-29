/** Demo and test scenes. Each one exercises a row of the capability matrix. */
import { channel, keyframe, LINEAR_IN, LINEAR_OUT, type Animation, type Layer } from "./model/types.js";

const STAR = "M50 0L61.8 35.4H100L69.1 57.3L80.9 92.7L50 70.8L19.1 92.7L30.9 57.3L0 35.4H38.2Z";

/** The showcase: curved motion, bounce, accumulating spin, per-dimension squash, OKLab colour, hold, orbit, parenting. */
export function bounceAndSpin(): Animation {
  const ball: Layer = {
    id: "ball", name: "Ball", content: { kind: "ellipse", width: 80, height: 80 }, inPoint: 0, outPoint: 3,
    channels: {
      anchor: channel("anchor", [keyframe(0, [40, 40])]),
      position: channel("position", [
        keyframe(0, [100, 380], { spatialOut: [120, -320] }),
        keyframe(1.2, [520, 380], { spatialIn: [-120, -320], easeFn: "bounce-out" }),
        keyframe(2.2, [700, 380]),
      ]),
      scale: channel("scale", [
        // X and Y eased differently: squash and stretch (per-dimension, §4.1).
        keyframe(1.1, [100, 100], { easeOut: { x: [0.2, 0.6], y: [0, 0] } }),
        keyframe(1.2, [125, 75], { easeIn: { x: [0.4, 0.8], y: [1, 1] } }),
        keyframe(1.4, [100, 100]),
      ]),
      fill: channel("fill", [keyframe(0, [0.91, 0.2, 0.24, 1]), keyframe(2.2, [0.15, 0.55, 0.95, 1])]),
    },
  };
  const star: Layer = {
    id: "star", name: "Star", content: { kind: "path", d: STAR, width: 100, height: 93 }, inPoint: 0, outPoint: 3,
    channels: {
      anchor: channel("anchor", [keyframe(0, [50, 50])]),
      position: channel("position", [keyframe(0, [600, 140])]),
      rotation: channel("rotation", [keyframe(0, 0), keyframe(3, 720)]), // two full turns, never shortest-path
      fill: channel("fill", [keyframe(0, [0.98, 0.74, 0.18, 1])]),
      opacity: channel("opacity", [keyframe(0, 100, { hold: true }), keyframe(1.5, 40, { hold: true }), keyframe(2.25, 100)]),
    },
  };
  const moon: Layer = {
    id: "moon", name: "Moon", content: { kind: "ellipse", width: 24, height: 24 }, inPoint: 0, outPoint: 3, parent: "star",
    transformOrder: "RTS", orbitCenter: [50, 50],
    channels: {
      anchor: channel("anchor", [keyframe(0, [12, 12])]),
      position: channel("position", [keyframe(0, [50, -30])]),
      rotation: channel("rotation", [keyframe(0, 0, { easeOut: LINEAR_OUT }), keyframe(3, -1080, { easeIn: LINEAR_IN })]),
      fill: channel("fill", [keyframe(0, [0.4, 0.85, 0.6, 1])]),
    },
  };
  const bar: Layer = {
    id: "bar", name: "Bar", content: { kind: "rect", width: 200, height: 24, radius: 12 }, inPoint: 0.3, outPoint: 3,
    channels: {
      anchor: channel("anchor", [keyframe(0, [0, 12])]),
      position: channel("position", [keyframe(0, [60, 520])]),
      scale: channel("scale", [keyframe(0.3, [0, 100], { easeOut: { x: [0.34], y: [1.56] } }), keyframe(1.3, [340, 100], { easeIn: { x: [0.64], y: [1] } })]), // back-out overshoot
      fill: channel("fill", [keyframe(0, [0.55, 0.3, 0.85, 1])]),
    },
  };
  return { name: "Bounce and spin", width: 800, height: 600, duration: 3, frameRate: 60, background: [0.97, 0.96, 0.94, 1], layers: [bar, ball, star, moon] };
}

/** N identical-ish layers for the performance budget (§16.5). */
export function manyLayers(n = 20): Animation {
  const layers: Layer[] = Array.from({ length: n }, (_, i) => ({
    id: `l${i}`, name: `Layer ${i + 1}`, content: i % 2 ? { kind: "ellipse", width: 40, height: 40 } : { kind: "rect", width: 40, height: 40, radius: 6 }, inPoint: 0, outPoint: 4,
    channels: {
      anchor: channel("anchor", [keyframe(0, [20, 20])]),
      position: channel("position", [keyframe(0, [40 + (i % 10) * 70, 80 + Math.floor(i / 10) * 200], { spatialOut: [100, -80] }), keyframe(2, [120 + (i % 10) * 70, 200 + Math.floor(i / 10) * 200], { spatialIn: [-60, 40] }), keyframe(4, [40 + (i % 10) * 70, 80 + Math.floor(i / 10) * 200])]),
      rotation: channel("rotation", [keyframe(0, 0), keyframe(4, 360 * ((i % 3) + 1))]),
      scale: channel("scale", [keyframe(0, [100, 100]), keyframe(2, [150, 60]), keyframe(4, [100, 100])]),
      fill: channel("fill", [keyframe(0, [(i * 37 % 100) / 100, 0.4, 0.7, 1])]),
    },
  }));
  return { name: `${n} layers`, width: 800, height: 600, duration: 4, frameRate: 60, background: [1, 1, 1, 1], layers };
}
