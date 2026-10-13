/** v1 collisions: the load is an upright square prism against axis-aligned site blocks. */
import type { LoadBody } from '../physics/pendulum';
import { type Vec3, vec3 } from '../physics/vec3';
import { GROUND_HEIGHT, type Obstacle } from './site';

/** A load whose underside is at most this far below a top surface is treated as standing on it. */
const STEP_TOLERANCE = 0.05;
const RESTITUTION = 0.2;

export interface Footprint {
  readonly halfWidth: number;
  /** Distance from the centre of gravity down to the underside. */
  readonly hangDepth: number;
}

export interface Bump {
  readonly body: LoadBody;
  /** Speed into the obstacle face, zero when nothing was hit. */
  readonly speed: number;
}

interface Penetration {
  readonly depth: number;
  readonly normal: Vec3;
}

const overlapsInPlan = (obstacle: Obstacle, position: Vec3, halfWidth: number): boolean =>
  position.x + halfWidth > obstacle.minX &&
  position.x - halfWidth < obstacle.maxX &&
  position.z + halfWidth > obstacle.minZ &&
  position.z - halfWidth < obstacle.maxZ;

/**
 * Height of the highest surface under the load's centre of gravity that its underside has not gone
 * below. A load whose centre overhangs an edge is not supported, however much of it still overlaps.
 */
export function supportHeightBelow(obstacles: readonly Obstacle[], body: LoadBody, footprint: Footprint): number {
  const underside = body.position.y - footprint.hangDepth;
  return obstacles
    .filter((obstacle) => overlapsInPlan(obstacle, body.position, 0))
    .filter((obstacle) => obstacle.height <= underside + STEP_TOLERANCE)
    .reduce((highest, obstacle) => Math.max(highest, obstacle.height), GROUND_HEIGHT);
}

function shallowestExit(obstacle: Obstacle, position: Vec3, halfWidth: number): Penetration {
  const exits: readonly Penetration[] = [
    { depth: position.x + halfWidth - obstacle.minX, normal: vec3(-1, 0, 0) },
    { depth: obstacle.maxX - (position.x - halfWidth), normal: vec3(1, 0, 0) },
    { depth: position.z + halfWidth - obstacle.minZ, normal: vec3(0, 0, -1) },
    { depth: obstacle.maxZ - (position.z - halfWidth), normal: vec3(0, 0, 1) },
  ];
  return exits.reduce((best, exit) => (exit.depth < best.depth ? exit : best));
}

function pushOut(body: LoadBody, exit: Penetration): Bump {
  const { normal, depth } = exit;
  const approach = -(body.velocity.x * normal.x + body.velocity.z * normal.z);
  const rebound = approach > 0 ? (1 + RESTITUTION) * approach : 0;
  return {
    body: {
      ...body,
      position: vec3(body.position.x + normal.x * depth, body.position.y, body.position.z + normal.z * depth),
      velocity: vec3(body.velocity.x + normal.x * rebound, body.velocity.y, body.velocity.z + normal.z * rebound),
    },
    speed: Math.max(approach, 0),
  };
}

const isInside = (obstacle: Obstacle, body: LoadBody, footprint: Footprint): boolean =>
  overlapsInPlan(obstacle, body.position, footprint.halfWidth) &&
  body.position.y - footprint.hangDepth < obstacle.height - STEP_TOLERANCE;

/** Pushes a load out of any block it swung or was dragged into and reports the hardest hit. */
export function resolveSideHits(obstacles: readonly Obstacle[], body: LoadBody, footprint: Footprint): Bump {
  return obstacles.reduce<Bump>(
    (bump, obstacle) => {
      if (!isInside(obstacle, bump.body, footprint)) return bump;
      const hit = pushOut(bump.body, shallowestExit(obstacle, bump.body.position, footprint.halfWidth));
      return { body: hit.body, speed: Math.max(bump.speed, hit.speed) };
    },
    { body, speed: 0 },
  );
}

/** Entry and exit of a segment through one pair of parallel faces, as fractions of its length. */
function slab(from: number, to: number, low: number, high: number): readonly [number, number] {
  if (from === to) return from > low && from < high ? [0, 1] : [1, 0];
  const first = (low - from) / (to - from);
  const second = (high - from) / (to - from);
  return [Math.min(first, second), Math.max(first, second)];
}

/** True when the straight rope from `top` to `bottom` passes through the block. */
function crosses(obstacle: Obstacle, top: Vec3, bottom: Vec3): boolean {
  const spans = [
    slab(top.x, bottom.x, obstacle.minX, obstacle.maxX),
    slab(top.z, bottom.z, obstacle.minZ, obstacle.maxZ),
    slab(top.y, bottom.y, GROUND_HEIGHT, obstacle.height - STEP_TOLERANCE),
  ];
  const entry = Math.max(0, ...spans.map((span) => span[0]));
  const exit = Math.min(1, ...spans.map((span) => span[1]));
  return entry < exit;
}

/** The rope is fouled when the line from the trolley to the hook runs through a building. */
export const isRopeFouled = (obstacles: readonly Obstacle[], trolley: Vec3, hook: Vec3): boolean =>
  obstacles.some((obstacle) => crosses(obstacle, trolley, hook));
