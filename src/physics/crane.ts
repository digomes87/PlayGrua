/** Crane state and actuator dynamics: slew (torque-limited), trolley and hoist (ramped drives). */
import type { CraneSpec } from '../craneSpec';
import { approachSpeed, clamp, rampToward } from './actuators';
import { GRAVITY } from './units';
import { type Vec3, vec3 } from './vec3';

export interface SlewState {
  /** Jib heading, radians from +X towards +Z. */
  readonly angle: number;
  readonly rate: number;
  /** Ramped speed reference followed by the slew drive. */
  readonly reference: number;
  /** Angle of the slew drive ahead of the jib: the elastic wind-up of tower and jib. */
  readonly twist: number;
  readonly driveRate: number;
}

export interface TrolleyState {
  readonly radius: number;
  readonly speed: number;
  /** Ramped speed reference followed by the trolley drive. */
  readonly reference: number;
}

export interface HoistState {
  /** Unstretched rope between trolley and hook. */
  readonly length: number;
  /** Positive pays rope out (hook goes down). */
  readonly rate: number;
  /** Ramped speed reference followed by the hoist drive. */
  readonly reference: number;
}

export interface CraneState {
  readonly slew: SlewState;
  readonly trolley: TrolleyState;
  readonly hoist: HoistState;
}

/** Operator demand, each axis in [-1, 1]: slew towards +angle, trolley outwards, hoist upwards. */
export interface CraneCommand {
  readonly slew: number;
  readonly trolley: number;
  readonly hoist: number;
  readonly fine: boolean;
  readonly emergencyStop: boolean;
  /** Slew brake released and drive off: the jib is free to align with the wind. */
  readonly weathervane: boolean;
}

/** What the rest of the world does to the crane during a step. */
export interface CraneLoads {
  /** Wind on the slewing part plus the tangential pull of the rope on the trolley. */
  readonly slewTorque: number;
  readonly suspendedMass: number;
  readonly payloadMass: number;
  readonly cableTension: number;
  /** Component of the rope pull on the trolley along the jib, positive outwards. */
  readonly trolleyForce: number;
}

export const IDLE_COMMAND: CraneCommand = {
  slew: 0,
  trolley: 0,
  hoist: 0,
  fine: false,
  emergencyStop: false,
  weathervane: false,
};

export const createCrane = (spec: CraneSpec, radius: number, hookHeight: number): CraneState => ({
  slew: { angle: 0, rate: 0, reference: 0, twist: 0, driveRate: 0 },
  trolley: { radius, speed: 0, reference: 0 },
  hoist: { length: spec.geometry.trolleyHeight - hookHeight, rate: 0, reference: 0 },
});

export const jibDirection = (angle: number): Vec3 => vec3(Math.cos(angle), 0, Math.sin(angle));

export const jibTangent = (angle: number): Vec3 => vec3(-Math.sin(angle), 0, Math.cos(angle));

/** Rope suspension point in the world. */
export function trolleyPosition(crane: CraneState, spec: CraneSpec): Vec3 {
  const radius = crane.trolley.radius;
  return vec3(radius * Math.cos(crane.slew.angle), spec.geometry.trolleyHeight, radius * Math.sin(crane.slew.angle));
}

/** Rotational inertia of the slewing structure and trolley about the tower axis. */
export function structureInertia(spec: CraneSpec, radius: number): number {
  const jib = (spec.masses.jib * spec.geometry.jibLength ** 2) / 3;
  const counterJib = (spec.masses.counterJib * spec.geometry.counterJibLength ** 2) / 3;
  const counterweight = spec.masses.counterweight * spec.masses.counterweightRadius ** 2;
  return jib + counterJib + counterweight + spec.masses.trolley * radius ** 2;
}

/** Structure plus the suspended mass taken at the trolley radius. */
export const totalSlewInertia = (spec: CraneSpec, radius: number, suspendedMass: number): number =>
  structureInertia(spec, radius) + suspendedMass * radius ** 2;

/** Heavy loads run in the slow hoist gear. */
export const hoistSpeedLimit = (spec: CraneSpec, payloadMass: number): number =>
  payloadMass > spec.hoist.heavyLoadThreshold ? spec.hoist.heavySpeed : spec.hoist.lightSpeed;

const demandScale = (command: CraneCommand, spec: CraneSpec): number => {
  if (command.emergencyStop) return 0;
  return command.fine ? spec.fineControlFactor : 1;
};

/** Ramps and force (or torque) capacity of one drive. */
interface AxisDrive {
  readonly acceleration: number;
  readonly deceleration: number;
  readonly driveLimit: number;
  readonly brakeLimit: number;
  readonly bandwidth: number;
}

interface AxisState {
  readonly rate: number;
  readonly reference: number;
}

/** What the mechanics present to the drive during a step. */
interface AxisLoad {
  /** Inertia actually accelerated. */
  readonly inertia: number;
  /** Inertia the speed controller is tuned for. */
  readonly controlInertia: number;
  /** Everything but the drive acting on the axis. */
  readonly external: number;
  /** Part of `external` the drive measures and cancels (load cell feed-forward). */
  readonly compensated: number;
  readonly step: number;
}

const advanceAxis = (state: AxisState, reference: number, effort: number, load: AxisLoad): AxisState => ({
  rate: state.rate + ((effort + load.external) / load.inertia) * load.step,
  reference,
});

/** Brake: supplies whatever stops the axis within this step, up to its capacity. */
function brakeEffort(state: AxisState, drive: AxisDrive, load: AxisLoad): number {
  const stopping = -(load.inertia * state.rate) / load.step - load.external;
  return clamp(stopping, -drive.brakeLimit, drive.brakeLimit);
}

/** Speed loop with feed-forward, saturated at what the motor can deliver. */
function motorEffort(state: AxisState, reference: number, drive: AxisDrive, load: AxisLoad): number {
  const feedForward = (load.controlInertia * (reference - state.reference)) / load.step;
  const correction = load.controlInertia * drive.bandwidth * (reference - state.rate);
  return clamp(feedForward + correction - load.compensated, -drive.driveLimit, drive.driveLimit);
}

/**
 * One drive for one step. The joystick moves a ramped speed reference; the motor follows it as far
 * as its force allows, so a load beyond that capacity drags the axis. With the joystick released
 * and the reference at zero the brake closes; an emergency stop closes it at once.
 */
function driveAxis(
  state: AxisState,
  target: number,
  isEmergency: boolean,
  drive: AxisDrive,
  load: AxisLoad,
): AxisState {
  if (isEmergency) {
    const braked = advanceAxis(state, 0, brakeEffort(state, drive, load), load);
    return { ...braked, reference: braked.rate };
  }
  const reference = rampToward(state.reference, target, drive.acceleration, drive.deceleration, load.step);
  const isHolding = target === 0 && reference === 0;
  const effort = isHolding ? brakeEffort(state, drive, load) : motorEffort(state, reference, drive, load);
  return advanceAxis(state, reference, effort, load);
}

function stepTrolley(crane: CraneState, command: CraneCommand, loads: CraneLoads, spec: CraneSpec, step: number): TrolleyState {
  const { trolley } = crane;
  const drive = spec.trolley;
  const inwardLimit = -approachSpeed(trolley.radius - spec.geometry.minRadius, drive.deceleration);
  const outwardLimit = approachSpeed(spec.geometry.maxRadius - trolley.radius, drive.deceleration);
  const demand = clamp(command.trolley, -1, 1) * drive.maxSpeed * demandScale(command, spec);
  const centrifugal = spec.masses.trolley * trolley.radius * crane.slew.rate ** 2;
  const external = loads.trolleyForce + centrifugal;
  const moved = driveAxis(
    { rate: trolley.speed, reference: trolley.reference },
    clamp(demand, inwardLimit, outwardLimit),
    command.emergencyStop,
    { ...drive, driveLimit: drive.driveForce, brakeLimit: drive.brakeForce, bandwidth: drive.controlBandwidth },
    { inertia: drive.effectiveMass, controlInertia: drive.effectiveMass, external, compensated: external, step },
  );
  const radius = clamp(trolley.radius + moved.rate * step, spec.geometry.minRadius, spec.geometry.maxRadius);
  return { radius, speed: (radius - trolley.radius) / step, reference: moved.reference };
}

/** Slack-rope switch: no more paying out once the rope carries less than part of the hook block. */
const isRopeSlack = (spec: CraneSpec, loads: CraneLoads): boolean =>
  loads.cableTension < spec.hoist.slackTensionFraction * spec.masses.hookBlock * GRAVITY;

const isHeavyGear = (spec: CraneSpec, payloadMass: number): boolean => payloadMass > spec.hoist.heavyLoadThreshold;

function stepHoist(
  hoist: HoistState,
  command: CraneCommand,
  loads: CraneLoads,
  spec: CraneSpec,
  step: number,
): HoistState {
  const drive = spec.hoist;
  const shortest = spec.geometry.trolleyHeight - spec.geometry.maxHookHeight;
  const gear = isHeavyGear(spec, loads.payloadMass) ? drive.heavyGear : drive.lightGear;
  const raiseLimit = -approachSpeed(hoist.length - shortest, drive.deceleration);
  const payOutLimit = isRopeSlack(spec, loads) ? 0 : approachSpeed(drive.maxCableLength - hoist.length, drive.deceleration);
  const demand = -clamp(command.hoist, -1, 1) * hoistSpeedLimit(spec, loads.payloadMass) * demandScale(command, spec);
  const moved = driveAxis(
    hoist,
    clamp(demand, raiseLimit, payOutLimit),
    command.emergencyStop,
    { ...drive, driveLimit: gear.force, brakeLimit: drive.brakeForce, bandwidth: drive.controlBandwidth },
    {
      inertia: gear.reflectedMass,
      controlInertia: gear.reflectedMass,
      external: loads.cableTension,
      compensated: loads.cableTension,
      step,
    },
  );
  const length = clamp(hoist.length + moved.rate * step, shortest, drive.maxCableLength);
  return { length, rate: (length - hoist.length) / step, reference: moved.reference };
}

const slewDrive = (spec: CraneSpec): AxisDrive => ({
  acceleration: spec.slew.acceleration,
  deceleration: spec.slew.brakeDeceleration,
  driveLimit: spec.slew.motorTorque,
  brakeLimit: spec.slew.brakeTorque,
  bandwidth: spec.slew.controlBandwidth,
});

/** Free slewing: only bearing friction acts and the reference tracks the actual speed. */
function weathervane(drive: AxisState, spec: CraneSpec, load: AxisLoad): AxisState {
  const free = advanceAxis(drive, drive.rate, -spec.slew.freeFriction * drive.rate, load);
  return { ...free, reference: free.rate };
}

/** Torque the wound-up tower and jib put on the slewing structure; the drive feels its reaction. */
function windUpTorque(slew: SlewState, spec: CraneSpec, inertia: number): number {
  const stiffness = spec.slew.torsionalStiffness;
  const damping = 2 * spec.slew.torsionalDampingRatio * Math.sqrt(stiffness * inertia);
  return stiffness * slew.twist + damping * (slew.driveRate - slew.rate);
}

/**
 * Slew axis as two inertias joined by the torsional flexibility of tower and jib: the drive (motor,
 * gear, brake) on one side, the jib with trolley on the other. Motor and brake act on the drive;
 * wind and rope act on the jib, which lags the drive when it starts and rings when it stops.
 */
function stepSlew(crane: CraneState, command: CraneCommand, loads: CraneLoads, spec: CraneSpec, step: number): SlewState {
  const { slew } = crane;
  const radius = crane.trolley.radius;
  const inertia = structureInertia(spec, radius);
  const windUp = windUpTorque(slew, spec, inertia);
  const coriolis = -2 * spec.masses.trolley * radius * crane.trolley.speed * slew.rate;
  const load: AxisLoad = {
    inertia: spec.slew.driveInertia,
    controlInertia: spec.slew.driveInertia + totalSlewInertia(spec, radius, loads.suspendedMass),
    external: -windUp,
    compensated: 0,
    step,
  };
  const driveState: AxisState = { rate: slew.driveRate, reference: slew.reference };
  const target = clamp(command.slew, -1, 1) * spec.slew.maxRate * demandScale(command, spec);
  const drive =
    command.weathervane && !command.emergencyStop
      ? weathervane(driveState, spec, load)
      : driveAxis(driveState, target, command.emergencyStop, slewDrive(spec), load);
  const rate = slew.rate + ((windUp + loads.slewTorque + coriolis) / inertia) * step;
  return {
    angle: slew.angle + rate * step,
    rate,
    reference: drive.reference,
    twist: slew.twist + (drive.rate - rate) * step,
    driveRate: drive.rate,
  };
}

/** Advances the three drives one fixed step (semi-implicit Euler). */
export function stepCrane(
  crane: CraneState,
  command: CraneCommand,
  loads: CraneLoads,
  spec: CraneSpec,
  step: number,
): CraneState {
  return {
    slew: stepSlew(crane, command, loads, spec, step),
    trolley: stepTrolley(crane, command, loads, spec, step),
    hoist: stepHoist(crane.hoist, command, loads, spec, step),
  };
}
