/** Hooking loads on and off: the only way mass enters or leaves the rope. */
import type { CraneSpec } from '../craneSpec';
import type { LoadBody } from '../physics/pendulum';
import { GRAVITY } from '../physics/units';
import { type Vec3, ZERO, vec3 } from '../physics/vec3';
import { type Payload, footprintOf } from './payloads';
import type { Obstacle } from './site';

/** A payload standing on the ground or on a slab; `position` is the centre of its underside. */
export interface GroundLoad {
  readonly payload: Payload;
  readonly position: Vec3;
  readonly yaw: number;
}

export interface Rigged {
  readonly payload: Payload;
  /** Hook point to payload underside: slings plus payload height. */
  readonly slingDepth: number;
}

/**
 * Distance from the hook point down to the combined centre of gravity of hook block and payload.
 * Hook, slings and payload are taken as one rigid link in line with the rope, so this is what
 * lengthens the pendulum beyond the rope itself.
 */
export function centreOffset(rigged: Rigged | null, hookMass: number): number {
  if (rigged === null) return 0;
  const payloadCentre = rigged.slingDepth - rigged.payload.size.y / 2;
  return (rigged.payload.mass * payloadCentre) / (rigged.payload.mass + hookMass);
}

export interface RiggingState {
  readonly body: LoadBody;
  readonly rigged: Rigged | null;
  readonly groundLoads: readonly GroundLoad[];
}

const REACH_RADIUS = 1.2;
const MAX_SLING = 3;
const MIN_SLING = 0.5;
const HOOK_OVERLAP = 0.1;
/** The rope must carry no more than this multiple of the hook block weight to unhook. */
const UNHOOK_TENSION_FACTOR = 1.5;

export const asObstacle = (load: GroundLoad, index: number): Obstacle => {
  const halfWidth = footprintOf(load.payload);
  return {
    id: `load-${index}`,
    kind: 'stack',
    minX: load.position.x - halfWidth,
    maxX: load.position.x + halfWidth,
    minZ: load.position.z - halfWidth,
    maxZ: load.position.z + halfWidth,
    height: load.position.y + load.payload.size.y,
  };
};

function isWithinReach(hook: Vec3, load: GroundLoad): boolean {
  const clearance = hook.y - (load.position.y + load.payload.size.y);
  const offset = Math.hypot(hook.x - load.position.x, hook.z - load.position.z);
  return offset <= REACH_RADIUS && clearance >= -HOOK_OVERLAP && clearance <= MAX_SLING;
}

export const reachableLoad = (state: RiggingState): GroundLoad | undefined => {
  if (state.rigged !== null) return undefined;
  return state.groundLoads.find((load) => isWithinReach(state.body.position, load));
};

/** Slings the reachable load: the hook snaps over its centre and the load starts on the ground. */
export function rig(state: RiggingState, hookMass: number): RiggingState {
  const load = reachableLoad(state);
  if (load === undefined) return state;
  const slingDepth = Math.max(state.body.position.y - load.position.y, load.payload.size.y + MIN_SLING);
  const rigged = { payload: load.payload, slingDepth };
  const centreHeight = load.position.y + slingDepth - centreOffset(rigged, hookMass);
  return {
    body: { position: vec3(load.position.x, centreHeight, load.position.z), velocity: ZERO, grounded: true },
    rigged,
    groundLoads: state.groundLoads.filter((candidate) => candidate !== load),
  };
}

export const canUnrig = (state: RiggingState, tension: number, spec: CraneSpec): boolean =>
  state.rigged !== null &&
  state.body.grounded &&
  tension <= UNHOOK_TENSION_FACTOR * spec.masses.hookBlock * GRAVITY;

/** Leaves the load where it stands; the hook block is free again, at the top of the slack slings. */
export function unrig(state: RiggingState, hookMass: number, yaw: number): RiggingState {
  if (state.rigged === null) return state;
  const offset = centreOffset(state.rigged, hookMass);
  const { x, y, z } = state.body.position;
  const underside = vec3(x, y + offset - state.rigged.slingDepth, z);
  return {
    body: { position: vec3(x, y + offset, z), velocity: ZERO, grounded: false },
    rigged: null,
    groundLoads: [...state.groundLoads, { payload: state.rigged.payload, position: underside, yaw }],
  };
}
