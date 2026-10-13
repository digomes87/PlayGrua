/** Hooking loads on and off: the only way mass enters or leaves the rope. */
import type { CraneSpec } from '../craneSpec';
import type { LoadBody } from '../physics/pendulum';
import type { Cargo, CargoProps } from '../physics/tandem';
import { GRAVITY } from '../physics/units';
import { type Vec3, ZERO, magnitude, subtract, vec3 } from '../physics/vec3';
import { type Payload, footprintOf } from './payloads';
import type { Obstacle } from './site';

/** A payload standing on the ground or on a slab; `position` is the centre of its underside. */
export interface GroundLoad {
  readonly payload: Payload;
  readonly position: Vec3;
  readonly yaw: number;
}

/** A payload on the slings: its own body, heading and the sling length it was rigged with. */
export interface Slung extends Cargo {
  readonly payload: Payload;
  /** Hook point to payload centre of gravity with the slings taut. */
  readonly slingLength: number;
  /** Heading the riggers hold with the tag lines, or null when nobody is on them. */
  readonly tagHeading: number | null;
}

export interface RiggingState {
  /** The hook block. */
  readonly body: LoadBody;
  readonly cargo: Slung | null;
  readonly groundLoads: readonly GroundLoad[];
}

const REACH_RADIUS = 1.2;
const MAX_SLING = 3;
const HOOK_OVERLAP = 0.1;
/** Clearance kept between the hook block and the top of the payload it is slung to. */
const SLING_CLEARANCE = 0.1;
/** The rope must carry no more than this multiple of the hook block weight to unhook. */
const UNHOOK_TENSION_FACTOR = 1.5;

const boxAround = (id: string, centre: Vec3, payload: Payload): Obstacle => {
  const halfWidth = footprintOf(payload);
  return {
    id,
    kind: 'stack',
    minX: centre.x - halfWidth,
    maxX: centre.x + halfWidth,
    minZ: centre.z - halfWidth,
    maxZ: centre.z + halfWidth,
    height: centre.y + payload.size.y / 2,
  };
};

const centreOf = (load: GroundLoad): Vec3 =>
  vec3(load.position.x, load.position.y + load.payload.size.y / 2, load.position.z);

export const asObstacle = (load: GroundLoad, index: number): Obstacle =>
  boxAround(`load-${index}`, centreOf(load), load.payload);

/** A slung payload standing on something is a surface the slack hook block can come to rest on. */
export const cargoObstacle = (cargo: Slung): Obstacle => boxAround('cargo', cargo.body.position, cargo.payload);

export const cargoProps = (cargo: Slung): CargoProps => ({
  mass: cargo.payload.mass,
  size: cargo.payload.size,
  dragCoefficient: cargo.payload.dragCoefficient,
  slingLength: cargo.slingLength,
});

function isWithinReach(hook: Vec3, load: GroundLoad): boolean {
  const clearance = hook.y - (load.position.y + load.payload.size.y);
  const offset = Math.hypot(hook.x - load.position.x, hook.z - load.position.z);
  return offset <= REACH_RADIUS && clearance >= -HOOK_OVERLAP && clearance <= MAX_SLING;
}

export const reachableLoad = (state: RiggingState): GroundLoad | undefined => {
  if (state.cargo !== null) return undefined;
  return state.groundLoads.find((load) => isWithinReach(state.body.position, load));
};

/**
 * Slings the reachable load. Nothing moves: the slings are cut to the distance between the hook
 * and the payload as they stand, so an off-centre pick starts with a slanted sling and swings.
 */
export function rig(state: RiggingState, spec: CraneSpec): RiggingState {
  const load = reachableLoad(state);
  if (load === undefined) return state;
  const centre = centreOf(load);
  const shortest = load.payload.size.y / 2 + spec.geometry.hookBlockHeight + SLING_CLEARANCE;
  const slingLength = Math.max(magnitude(subtract(state.body.position, centre)), shortest);
  return {
    body: state.body,
    cargo: {
      payload: load.payload,
      slingLength,
      body: { position: centre, velocity: ZERO, grounded: true },
      yaw: load.yaw,
      yawRate: 0,
      tagHeading: null,
    },
    groundLoads: state.groundLoads.filter((candidate) => candidate !== load),
  };
}

export const canUnrig = (state: RiggingState, tension: number, spec: CraneSpec): boolean =>
  state.cargo !== null &&
  state.cargo.body.grounded &&
  tension <= UNHOOK_TENSION_FACTOR * spec.masses.hookBlock * GRAVITY;

/** Leaves the payload where it stands; the hook block stays where it is. */
export function unrig(state: RiggingState): RiggingState {
  const cargo = state.cargo;
  if (cargo === null) return state;
  const { x, y, z } = cargo.body.position;
  const underside = vec3(x, y - cargo.payload.size.y / 2, z);
  return {
    body: state.body,
    cargo: null,
    groundLoads: [...state.groundLoads, { payload: cargo.payload, position: underside, yaw: cargo.yaw }],
  };
}

/** Riggers take up the tag lines at the payload's present heading, or let them go. */
export function toggleTagLine(state: RiggingState): RiggingState {
  const cargo = state.cargo;
  if (cargo === null) return state;
  return { ...state, cargo: { ...cargo, tagHeading: cargo.tagHeading === null ? cargo.yaw : null } };
}
