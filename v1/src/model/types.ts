/**
 * The animation model (design guide §4): Lottie-shaped, because Lottie is
 * strictly more expressive than CSS. Time is seconds (§4.2). Easing belongs to
 * segments, as the left keyframe's easeOut (P1) and the right one's easeIn (P2)
 * (§4.3). Handles may be per-dimension, exactly as Lottie's i/o arrays.
 */
import type { EasingFunctionName } from "../easing/presets.js";

export type Color = [number, number, number, number]; // sRGB 0–1, with alpha
export type Value = number | number[];

export type ChannelType = "number" | "vector2" | "angle" | "color";

export interface BezierHandle {
  /** One entry = shared across dimensions; N entries = per-dimension. */
  x: number[];
  y: number[];
}

export interface Keyframe {
  time: number;
  value: Value;
  easeOut: BezierHandle;
  easeIn: BezierHandle;
  /** Easing function for the segment leaving this keyframe (bounce, spring…). Overrides easeOut/next easeIn. */
  easeFn?: EasingFunctionName;
  /** Spatial tangents (position only), offsets from this keyframe's value. */
  spatialOut?: [number, number];
  spatialIn?: [number, number];
  hold?: boolean;
}

/** Animatable properties. Units: px, degrees (accumulating), percent, 0–100 opacity, sRGB colour. */
export type PropertyName = "anchor" | "position" | "scale" | "rotation" | "opacity" | "fill";

export const PROPERTY_TYPES: Record<PropertyName, ChannelType> = {
  anchor: "vector2",
  position: "vector2",
  scale: "vector2",
  rotation: "angle",
  opacity: "number",
  fill: "color",
};

export interface Channel {
  property: PropertyName;
  type: ChannelType;
  keyframes: Keyframe[];
  /** Spatial tangents apply (vector2 position channels). */
  spatial: boolean;
  /**
   * Colour channels: "oklab" (default; perceptual, baked on export) or "srgb"
   * (what Lottie players and CSS do; exports exactly). Imported Lottie colour
   * is "srgb" so it keeps the meaning the file had.
   */
  colorSpace?: "oklab" | "srgb";
}

export type LayerContent =
  | { kind: "rect"; width: number; height: number; radius?: number }
  | { kind: "ellipse"; width: number; height: number }
  | { kind: "path"; d: string; width: number; height: number }
  /** Null layer: transforms only (parenting, orbits). Not drawn. */
  | { kind: "null"; width: 0; height: 0 };

export interface Layer {
  id: string;
  name: string;
  content: LayerContent;
  parent?: string;
  /** "TRS" (default; matches Lottie and CSS individual properties) or "RTS": rotate about `orbitCenter`, then translate (§9.2). */
  transformOrder?: "TRS" | "RTS";
  orbitCenter?: [number, number];
  channels: Partial<Record<PropertyName, Channel>>;
  /** Drivers (stretch goal §17): a property computed from another layer's property. Exported by baking. */
  drivers?: Driver[];
  inPoint: number;
  outPoint: number;
}

export interface Driver {
  property: PropertyName;
  /** Dimension of the driven property (omit for scalars or to drive every dimension). */
  dim?: number;
  source: { layerId: string; property: PropertyName; dim?: number };
  /** value = source × multiply + add, optionally delayed (seconds). */
  multiply: number;
  add: number;
  delay?: number;
}

export interface Animation {
  name: string;
  width: number;
  height: number;
  duration: number;
  frameRate: number;
  background?: Color;
  layers: Layer[];
}

export const LINEAR_OUT: BezierHandle = { x: [0], y: [0] };
export const LINEAR_IN: BezierHandle = { x: [1], y: [1] };
/** After Effects' default "easy ease". */
export const EASY_OUT: BezierHandle = { x: [0.333], y: [0] };
export const EASY_IN: BezierHandle = { x: [0.667], y: [1] };

export const STATIC_DEFAULTS: Record<PropertyName, Value> = {
  anchor: [0, 0],
  position: [0, 0],
  scale: [100, 100],
  rotation: 0,
  opacity: 100,
  fill: [0, 0, 0, 1],
};

export function keyframe(time: number, value: Value, opts: Partial<Keyframe> = {}): Keyframe {
  return { time, value, easeOut: EASY_OUT, easeIn: EASY_IN, ...opts };
}

export function channel(property: PropertyName, keyframes: Keyframe[]): Channel {
  return { property, type: PROPERTY_TYPES[property], keyframes: [...keyframes].sort((a, b) => a.time - b.time), spatial: property === "position" };
}
