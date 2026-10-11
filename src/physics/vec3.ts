/** Immutable 3D vector. World frame: Y up, tower axis on the Y axis. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);

export const subtract = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);

export const scale = (a: Vec3, factor: number): Vec3 => vec3(a.x * factor, a.y * factor, a.z * factor);

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const magnitude = (a: Vec3): number => Math.sqrt(dot(a, a));

export const horizontalMagnitude = (a: Vec3): number => Math.hypot(a.x, a.z);

export const lerp = (a: Vec3, b: Vec3, fraction: number): Vec3 => add(a, scale(subtract(b, a), fraction));

export function normalize(a: Vec3): Vec3 {
  const size = magnitude(a);
  if (size === 0) return ZERO;
  return scale(a, 1 / size);
}

/** Component of `a` perpendicular to the unit vector `axis`. */
export const reject = (a: Vec3, axis: Vec3): Vec3 => subtract(a, scale(axis, dot(a, axis)));
