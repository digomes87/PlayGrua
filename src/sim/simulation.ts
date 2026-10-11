/** One deterministic world step: wind, interlocks, drives, load, collisions, LMI. */
import type { CraneSpec } from '../craneSpec';
import {
  type CraneCommand,
  type CraneLoads,
  type CraneState,
  createCrane,
  jibTangent,
  stepCrane,
  trolleyPosition,
} from '../physics/crane';
import { applyInterlocks } from '../physics/interlocks';
import { type LmiState, createLmi, permitsFor, updateLmi } from '../physics/loadChart';
import {
  type CableMotion,
  type HangingMass,
  type LoadBody,
  stepLoad,
  stretchedLength,
} from '../physics/pendulum';
import { GRAVITY } from '../physics/units';
import { type Vec3, ZERO, add, dot, normalize, scale, subtract, vec3 } from '../physics/vec3';
import {
  type WindConfig,
  type WindState,
  createWind,
  slewWindTorque,
  stepWind,
  windSpeed,
  windVelocityAt,
} from '../physics/wind';
import { type Footprint, resolveSideHits, supportHeightBelow } from './collisions';
import { footprintOf } from './payloads';
import { type GroundLoad, type Rigged, asObstacle, centreOffset } from './rigging';
import type { Obstacle, Site } from './site';

export interface SimulationConfig {
  readonly spec: CraneSpec;
  readonly wind: WindConfig;
  readonly site: Site;
}

export interface SimulationState {
  readonly time: number;
  readonly crane: CraneState;
  readonly body: LoadBody;
  readonly rigged: Rigged | null;
  readonly groundLoads: readonly GroundLoad[];
  readonly wind: WindState;
  readonly lmi: LmiState;
  readonly tension: number;
}

export interface StepEvents {
  /** Vertical speed at touchdown, zero when nothing landed. */
  readonly touchdownSpeed: number;
  /** Speed of the hardest side hit against the site, zero when none. */
  readonly bumpSpeed: number;
}

export interface SimulationStep {
  readonly state: SimulationState;
  readonly events: StepEvents;
}

export interface StartPose {
  readonly radius: number;
  readonly hookHeight: number;
  readonly slewAngle: number;
  readonly groundLoads: readonly GroundLoad[];
}

const HOOK_DRAG_AREA = 0.3;
const HOOK_HALF_WIDTH = 0.3;

const offsetIn = (state: SimulationState, spec: CraneSpec): number => centreOffset(state.rigged, spec.masses.hookBlock);

/** Centre of gravity down to the underside of the hook block or of the slung payload. */
const hangDepthIn = (state: SimulationState, spec: CraneSpec): number =>
  state.rigged === null ? spec.geometry.hookBlockHeight : state.rigged.slingDepth - offsetIn(state, spec);

export const hangingMass = (state: SimulationState, spec: CraneSpec): HangingMass => ({
  mass: spec.masses.hookBlock + (state.rigged?.payload.mass ?? 0),
  dragArea: HOOK_DRAG_AREA + (state.rigged?.payload.dragArea ?? 0),
  hangDepth: hangDepthIn(state, spec),
});

const footprintIn = (state: SimulationState, spec: CraneSpec): Footprint => ({
  halfWidth: state.rigged === null ? HOOK_HALF_WIDTH : footprintOf(state.rigged.payload),
  hangDepth: hangDepthIn(state, spec),
});

/** Hook point given the centre of gravity: up the rope while hanging, straight up while standing. */
export function hookPointAt(centre: Vec3, pivot: Vec3, state: SimulationState, spec: CraneSpec): Vec3 {
  const offset = offsetIn(state, spec);
  if (state.body.grounded) return vec3(centre.x, centre.y + offset, centre.z);
  return add(centre, scale(normalize(subtract(pivot, centre)), offset));
}

export const hookPoint = (state: SimulationState, spec: CraneSpec): Vec3 =>
  hookPointAt(state.body.position, trolleyPosition(state.crane, spec), state, spec);

export function createSimulation(config: SimulationConfig, start: StartPose): SimulationState {
  const upright = createCrane(config.spec, start.radius, start.hookHeight);
  const crane = { ...upright, slew: { ...upright.slew, angle: start.slewAngle } };
  const pivot = trolleyPosition(crane, config.spec);
  const hookMass = config.spec.masses.hookBlock;
  const drop = stretchedLength(config.spec.cable, hookMass, crane.hoist.length);
  return {
    time: 0,
    crane,
    body: { position: vec3(pivot.x, pivot.y - drop, pivot.z), velocity: ZERO, grounded: false },
    rigged: null,
    groundLoads: start.groundLoads,
    wind: createWind(config.wind),
    lmi: createLmi(hookMass),
    tension: hookMass * GRAVITY,
  };
}

/** Generalised slew torque of the rope pulling on the trolley. */
function ropeSlewTorque(state: SimulationState, spec: CraneSpec): number {
  const toLoad = normalize(subtract(state.body.position, trolleyPosition(state.crane, spec)));
  return state.crane.trolley.radius * state.tension * dot(toLoad, jibTangent(state.crane.slew.angle));
}

function craneLoads(state: SimulationState, config: SimulationConfig, wind: WindState): CraneLoads {
  const jibWind = windVelocityAt(wind, config.wind, config.spec.geometry.trolleyHeight);
  const windTorque = slewWindTorque(config.spec.aero, jibWind, state.crane.slew.angle, state.crane.slew.rate);
  return {
    slewTorque: windTorque + ropeSlewTorque(state, config.spec),
    suspendedMass: state.body.grounded ? 0 : hangingMass(state, config.spec).mass,
    payloadMass: state.rigged?.payload.mass ?? 0,
    cableTension: state.tension,
  };
}

/**
 * Linear motion of the suspension point and pendulum length that joins the two crane states
 * exactly. `link` is the rigid hook-to-centre-of-gravity distance added to the rope.
 */
function cableMotion(before: CraneState, after: CraneState, link: number, spec: CraneSpec, step: number): CableMotion {
  const pivot = trolleyPosition(before, spec);
  return {
    pivot,
    pivotVelocity: scale(subtract(trolleyPosition(after, spec), pivot), 1 / step),
    length: before.hoist.length + link,
    lengthRate: (after.hoist.length - before.hoist.length) / step,
  };
}

export const obstaclesIn = (state: SimulationState, site: Site): readonly Obstacle[] => [
  ...site.obstacles,
  ...state.groundLoads.map(asObstacle),
];

export const isWindLocked = (state: SimulationState, config: SimulationConfig): boolean =>
  windSpeed(state.wind, config.wind) >= config.spec.windLimits.lockout;

export function stepSimulation(
  state: SimulationState,
  command: CraneCommand,
  config: SimulationConfig,
  step: number,
): SimulationStep {
  const { spec } = config;
  const wind = stepWind(state.wind, config.wind, step);
  const gated = applyInterlocks(command, permitsFor(state.lmi.status), isWindLocked(state, config));
  const crane = stepCrane(state.crane, gated, craneLoads(state, config, wind), spec, step);
  const obstacles = obstaclesIn(state, config.site);
  const footprint = footprintIn(state, spec);
  const surroundings = {
    windVelocity: windVelocityAt(wind, config.wind, state.body.position.y),
    supportHeight: supportHeightBelow(obstacles, state.body, footprint),
    friction: spec.groundFriction,
  };
  const motion = cableMotion(state.crane, crane, offsetIn(state, spec), spec, step);
  const moved = stepLoad(state.body, hangingMass(state, spec), spec.cable, motion, surroundings, step);
  const bump = resolveSideHits(obstacles, moved.body, footprint);
  const lmi = updateLmi(state.lmi, { tension: moved.tension, radius: crane.trolley.radius }, spec, step);
  return {
    state: { ...state, time: state.time + step, crane, body: bump.body, wind, lmi, tension: moved.tension },
    events: { touchdownSpeed: moved.impactSpeed, bumpSpeed: bump.speed },
  };
}
