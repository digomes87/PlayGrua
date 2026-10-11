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
}

export interface TrolleyState {
  readonly radius: number;
  readonly speed: number;
}

export interface HoistState {
  /** Unstretched rope between trolley and hook. */
  readonly length: number;
  /** Positive pays rope out (hook goes down). */
  readonly rate: number;
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
  slew: { angle: 0, rate: 0, reference: 0 },
  trolley: { radius, speed: 0 },
  hoist: { length: spec.geometry.trolleyHeight - hookHeight, rate: 0 },
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

function stepTrolley(trolley: TrolleyState, command: CraneCommand, spec: CraneSpec, step: number): TrolleyState {
  const drive = spec.trolley;
  const deceleration = command.emergencyStop ? drive.emergencyDeceleration : drive.deceleration;
  const inwardLimit = -approachSpeed(trolley.radius - spec.geometry.minRadius, drive.deceleration);
  const outwardLimit = approachSpeed(spec.geometry.maxRadius - trolley.radius, drive.deceleration);
  const demand = clamp(command.trolley, -1, 1) * drive.maxSpeed * demandScale(command, spec);
  const target = clamp(demand, inwardLimit, outwardLimit);
  const speed = rampToward(trolley.speed, target, drive.acceleration, deceleration, step);
  const radius = clamp(trolley.radius + speed * step, spec.geometry.minRadius, spec.geometry.maxRadius);
  return { radius, speed: (radius - trolley.radius) / step };
}

/** Slack-rope switch: no more paying out once the rope carries less than part of the hook block. */
const isRopeSlack = (spec: CraneSpec, loads: CraneLoads): boolean =>
  loads.cableTension < spec.hoist.slackTensionFraction * spec.masses.hookBlock * GRAVITY;

function stepHoist(
  hoist: HoistState,
  command: CraneCommand,
  loads: CraneLoads,
  spec: CraneSpec,
  step: number,
): HoistState {
  const drive = spec.hoist;
  const shortest = spec.geometry.trolleyHeight - spec.geometry.maxHookHeight;
  const deceleration = command.emergencyStop ? drive.emergencyDeceleration : drive.deceleration;
  const raiseLimit = -approachSpeed(hoist.length - shortest, drive.deceleration);
  const payOutLimit = isRopeSlack(spec, loads) ? 0 : approachSpeed(drive.maxCableLength - hoist.length, drive.deceleration);
  const demand = -clamp(command.hoist, -1, 1) * hoistSpeedLimit(spec, loads.payloadMass) * demandScale(command, spec);
  const target = clamp(demand, raiseLimit, payOutLimit);
  const rate = rampToward(hoist.rate, target, drive.acceleration, deceleration, step);
  const length = clamp(hoist.length + rate * step, shortest, drive.maxCableLength);
  return { length, rate: (length - hoist.length) / step };
}

interface SlewContext {
  readonly inertia: number;
  readonly totalInertia: number;
  /** Everything but the drive: wind, rope pull and the Coriolis reaction of the travelling trolley. */
  readonly externalTorque: number;
  readonly step: number;
}

function integrateSlew(slew: SlewState, reference: number, driveTorque: number, context: SlewContext): SlewState {
  const rate = slew.rate + ((driveTorque + context.externalTorque) / context.inertia) * context.step;
  return { angle: slew.angle + rate * context.step, rate, reference };
}

/** Free slewing: only bearing friction acts and the reference tracks the actual speed. */
function weathervane(slew: SlewState, spec: CraneSpec, context: SlewContext): SlewState {
  const free = integrateSlew(slew, slew.rate, -spec.slew.freeFriction * slew.rate, context);
  return { ...free, reference: free.rate };
}

/** Holding brake: supplies whatever torque stops the jib within this step, up to its capacity. */
function brakeTorque(slew: SlewState, spec: CraneSpec, context: SlewContext): number {
  const stopping = -(context.inertia * slew.rate) / context.step - context.externalTorque;
  return clamp(stopping, -spec.slew.brakeTorque, spec.slew.brakeTorque);
}

/** Speed loop with feed-forward, saturated at the motor torque. */
function motorTorque(slew: SlewState, reference: number, spec: CraneSpec, context: SlewContext): number {
  const feedForward = (context.totalInertia * (reference - slew.reference)) / context.step;
  const correction = context.totalInertia * spec.slew.controlBandwidth * (reference - slew.rate);
  return clamp(feedForward + correction, -spec.slew.motorTorque, spec.slew.motorTorque);
}

function driveSlew(slew: SlewState, command: CraneCommand, spec: CraneSpec, context: SlewContext): SlewState {
  const drive = spec.slew;
  const target = clamp(command.slew, -1, 1) * drive.maxRate * demandScale(command, spec);
  const reference = rampToward(slew.reference, target, drive.acceleration, drive.brakeDeceleration, context.step);
  const isHolding = target === 0 && reference === 0;
  const torque = isHolding ? brakeTorque(slew, spec, context) : motorTorque(slew, reference, spec, context);
  return integrateSlew(slew, reference, torque, context);
}

/** Emergency stop cuts the drive and closes the brake at full capacity. */
function emergencySlew(slew: SlewState, spec: CraneSpec, context: SlewContext): SlewState {
  const braked = integrateSlew(slew, 0, brakeTorque(slew, spec, context), context);
  return { ...braked, reference: braked.rate };
}

function stepSlew(crane: CraneState, command: CraneCommand, loads: CraneLoads, spec: CraneSpec, step: number): SlewState {
  const radius = crane.trolley.radius;
  const coriolis = -2 * spec.masses.trolley * radius * crane.trolley.speed * crane.slew.rate;
  const context: SlewContext = {
    inertia: structureInertia(spec, radius),
    totalInertia: totalSlewInertia(spec, radius, loads.suspendedMass),
    externalTorque: loads.slewTorque + coriolis,
    step,
  };
  if (command.emergencyStop) return emergencySlew(crane.slew, spec, context);
  if (command.weathervane) return weathervane(crane.slew, spec, context);
  return driveSlew(crane.slew, command, spec, context);
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
    trolley: stepTrolley(crane.trolley, command, spec, step),
    hoist: stepHoist(crane.hoist, command, loads, spec, step),
  };
}
