/** One deterministic world step: wind, interlocks, drives, hook block and payload, collisions, LMI. */
import type { CraneSpec } from '../craneSpec';
import {
  type CraneCommand,
  type CraneLoads,
  type CraneState,
  createCrane,
  jibDirection,
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
  swingAngle,
} from '../physics/pendulum';
import { type HeldTagLine, stepTandem } from '../physics/tandem';
import { GRAVITY } from '../physics/units';
import { type Vec3, ZERO, dot, normalize, scale, subtract, vec3 } from '../physics/vec3';
import {
  type WindConfig,
  type WindState,
  createWind,
  slewWindTorque,
  stepWind,
  windVelocityAt,
} from '../physics/wind';
import { type Footprint, isRopeFouled, resolveSideHits, supportHeightBelow } from './collisions';
import { footprintOf } from './payloads';
import { type GroundLoad, type Slung, asObstacle, cargoObstacle, cargoProps } from './rigging';
import type { Obstacle, Site } from './site';
import { zonePermits } from './zoning';

export interface SimulationConfig {
  readonly spec: CraneSpec;
  readonly wind: WindConfig;
  readonly site: Site;
}

export interface SimulationState {
  readonly time: number;
  readonly crane: CraneState;
  /** The hook block. */
  readonly body: LoadBody;
  /** The payload on the slings, if any. */
  readonly cargo: Slung | null;
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
  /** The rope runs through a building. */
  readonly ropeFouled: boolean;
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

interface Moved {
  readonly body: LoadBody;
  readonly cargo: Slung | null;
  readonly tension: number;
  readonly events: Omit<StepEvents, 'ropeFouled'>;
}

const HOOK_DRAG_AREA = 0.3;
const HOOK_HALF_WIDTH = 0.3;

const hookMass = (spec: CraneSpec): HangingMass => ({
  mass: spec.masses.hookBlock,
  dragArea: HOOK_DRAG_AREA,
  hangDepth: spec.geometry.hookBlockHeight,
});

const hookFootprint = (spec: CraneSpec): Footprint => ({
  halfWidth: HOOK_HALF_WIDTH,
  hangDepth: spec.geometry.hookBlockHeight,
});

const cargoFootprint = (cargo: Slung): Footprint => ({
  halfWidth: footprintOf(cargo.payload),
  hangDepth: cargo.payload.size.y / 2,
});

export const isCarrying = (state: SimulationState): boolean => state.cargo !== null && !state.cargo.body.grounded;

/** Mass hanging from the rope right now: the hook block plus a payload that has left the ground. */
export const suspendedMass = (state: SimulationState, spec: CraneSpec): number =>
  spec.masses.hookBlock + (isCarrying(state) ? state.cargo!.payload.mass : 0);

export const hookPoint = (state: SimulationState): Vec3 => state.body.position;

/** Angle from the vertical of the line from the trolley to the payload, or to the empty hook. */
export const loadSwing = (state: SimulationState, spec: CraneSpec): number =>
  swingAngle(state.cargo?.body ?? state.body, trolleyPosition(state.crane, spec));

export function createSimulation(config: SimulationConfig, start: StartPose): SimulationState {
  const upright = createCrane(config.spec, start.radius, start.hookHeight);
  const crane = { ...upright, slew: { ...upright.slew, angle: start.slewAngle } };
  const pivot = trolleyPosition(crane, config.spec);
  const mass = config.spec.masses.hookBlock;
  const drop = stretchedLength(config.spec.cable, mass, crane.hoist.length);
  return {
    time: 0,
    crane,
    body: { position: vec3(pivot.x, pivot.y - drop, pivot.z), velocity: ZERO, grounded: false },
    cargo: null,
    groundLoads: start.groundLoads,
    wind: createWind(config.wind),
    lmi: createLmi(mass),
    tension: mass * GRAVITY,
  };
}

/** Unit vector from the trolley down the rope to the hook block. */
const ropeDirection = (state: SimulationState, spec: CraneSpec): Vec3 =>
  normalize(subtract(state.body.position, trolleyPosition(state.crane, spec)));

/** Generalised slew torque of the rope pulling on the trolley. */
function ropeSlewTorque(state: SimulationState, spec: CraneSpec): number {
  const across = dot(ropeDirection(state, spec), jibTangent(state.crane.slew.angle));
  return state.crane.trolley.radius * state.tension * across;
}

/** Rope pull on the trolley along the jib. */
const ropeTrolleyForce = (state: SimulationState, spec: CraneSpec): number =>
  state.tension * dot(ropeDirection(state, spec), jibDirection(state.crane.slew.angle));

function craneLoads(state: SimulationState, config: SimulationConfig, wind: WindState): CraneLoads {
  const jibWind = windVelocityAt(wind, config.wind, config.spec.geometry.trolleyHeight);
  const windTorque = slewWindTorque(config.spec.aero, jibWind, state.crane.slew.angle, state.crane.slew.rate);
  return {
    slewTorque: windTorque + ropeSlewTorque(state, config.spec),
    suspendedMass: state.body.grounded ? 0 : suspendedMass(state, config.spec),
    payloadMass: state.cargo?.payload.mass ?? 0,
    cableTension: state.tension,
    trolleyForce: ropeTrolleyForce(state, config.spec),
  };
}

/** Linear motion of the suspension point and rope length that joins the two crane states exactly. */
function cableMotion(before: CraneState, after: CraneState, spec: CraneSpec, step: number): CableMotion {
  const pivot = trolleyPosition(before, spec);
  return {
    pivot,
    pivotVelocity: scale(subtract(trolleyPosition(after, spec), pivot), 1 / step),
    length: before.hoist.length,
    lengthRate: (after.hoist.length - before.hoist.length) / step,
    link: 0,
  };
}

export const obstaclesIn = (state: SimulationState, site: Site): readonly Obstacle[] => [
  ...site.obstacles,
  ...state.groundLoads.map(asObstacle),
];

/** The limits key on the average the anemometer measures, so a gust alone cannot lock the crane. */
export const isWindLocked = (state: SimulationState, config: SimulationConfig): boolean =>
  state.wind.averageSpeed >= config.spec.windLimits.lockout;

function moveHookAlone(
  state: SimulationState,
  config: SimulationConfig,
  wind: WindState,
  motion: CableMotion,
  step: number,
): Moved {
  const { spec } = config;
  const obstacles = obstaclesIn(state, config.site);
  const surroundings = {
    windVelocity: windVelocityAt(wind, config.wind, state.body.position.y),
    supportHeight: supportHeightBelow(obstacles, state.body, hookFootprint(spec)),
    friction: spec.groundFriction,
  };
  const moved = stepLoad(state.body, hookMass(spec), spec.cable, motion, surroundings, step);
  const bump = resolveSideHits(obstacles, moved.body, hookFootprint(spec));
  return {
    body: bump.body,
    cargo: null,
    tension: moved.tension,
    events: { touchdownSpeed: moved.impactSpeed, bumpSpeed: bump.speed },
  };
}

/** The tag lines act only while they reach from the payload down to the riggers below it. */
export function heldTagLine(cargo: Slung, surface: number, spec: CraneSpec): HeldTagLine | null {
  const isInReach = cargo.body.position.y - surface <= spec.tagLine.reach;
  if (cargo.tagHeading === null || !isInReach) return null;
  return { spec: spec.tagLine, heading: cargo.tagHeading };
}

/** A payload standing on something also holds up a slack hook block that comes down on it. */
const hookSupports = (obstacles: readonly Obstacle[], cargo: Slung): readonly Obstacle[] =>
  cargo.body.grounded ? [...obstacles, cargoObstacle(cargo)] : obstacles;

function moveTandem(
  state: SimulationState,
  cargo: Slung,
  config: SimulationConfig,
  wind: WindState,
  motion: CableMotion,
  step: number,
): Moved {
  const { spec } = config;
  const obstacles = obstaclesIn(state, config.site);
  const cargoSupport = supportHeightBelow(obstacles, cargo.body, cargoFootprint(cargo));
  const surroundings = {
    hookWind: windVelocityAt(wind, config.wind, state.body.position.y),
    cargoWind: windVelocityAt(wind, config.wind, cargo.body.position.y),
    hookSupport: supportHeightBelow(hookSupports(obstacles, cargo), state.body, hookFootprint(spec)),
    cargoSupport,
    friction: spec.groundFriction,
    jibHeading: state.crane.slew.angle,
    tagLine: heldTagLine(cargo, cargoSupport, spec),
  };
  const moved = stepTandem(state.body, cargo, hookMass(spec), cargoProps(cargo), spec.cable, motion, surroundings, step);
  const hookBump = resolveSideHits(obstacles, moved.hook, hookFootprint(spec));
  const cargoBump = resolveSideHits(obstacles, moved.cargo.body, cargoFootprint(cargo));
  return {
    body: hookBump.body,
    cargo: { ...cargo, ...moved.cargo, body: cargoBump.body },
    tension: moved.tension,
    events: { touchdownSpeed: moved.impactSpeed, bumpSpeed: Math.max(hookBump.speed, cargoBump.speed) },
  };
}

export function stepSimulation(
  state: SimulationState,
  command: CraneCommand,
  config: SimulationConfig,
  step: number,
): SimulationStep {
  const { spec } = config;
  const wind = stepWind(state.wind, config.wind, step);
  const gated = applyInterlocks(command, {
    lmi: permitsFor(state.lmi.status, spec.lmi),
    windLocked: isWindLocked(state, config),
    zones: zonePermits(state.crane, config.site.zones, spec),
  });
  const crane = stepCrane(state.crane, gated, craneLoads(state, config, wind), spec, step);
  const motion = cableMotion(state.crane, crane, spec, step);
  const moved =
    state.cargo === null
      ? moveHookAlone(state, config, wind, motion, step)
      : moveTandem(state, state.cargo, config, wind, motion, step);
  const lmi = updateLmi(state.lmi, { tension: moved.tension, radius: crane.trolley.radius }, spec, step);
  return {
    state: {
      ...state,
      time: state.time + step,
      crane,
      body: moved.body,
      cargo: moved.cargo,
      wind,
      lmi,
      tension: moved.tension,
    },
    events: {
      ...moved.events,
      ropeFouled: isRopeFouled(config.site.obstacles, trolleyPosition(crane, spec), moved.body.position),
    },
  };
}
