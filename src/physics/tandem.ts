/**
 * Hook block and slung payload as two masses: a double spherical pendulum.
 *
 * The rope joins trolley and hook block, the slings join hook block and payload; both only pull.
 * The payload also turns about the vertical axis under the wind and the weak heading given by the
 * two rope falls. Everything is integrated together with RK4 in the inertial frame.
 */
import type { TagLineSpec } from '../craneSpec';
import { type BoxShape, boxAero, headingVector, yawInertia } from './aero';
import { type StateVector, rk4Step } from './integrator';
import {
  type CableMotion,
  type CableProperties,
  type Friction,
  type HangingMass,
  type LoadBody,
  cableAfter,
  isSupported,
  pullOf,
  seat,
  slideUnder,
  swingDamping,
} from './pendulum';
import { GRAVITY } from './units';
import { type Vec3, add, dot, magnitude, scale, subtract, vec3 } from './vec3';
import { dragForce } from './wind';

export interface Cargo {
  /** Centre of gravity of the payload. */
  readonly body: LoadBody;
  /** Heading of the payload's local x axis, radians from +X towards +Z. */
  readonly yaw: number;
  readonly yawRate: number;
}

export interface CargoProps extends BoxShape {
  readonly mass: number;
  /** Hook point to payload centre of gravity with the slings taut. */
  readonly slingLength: number;
}

export interface TandemSurroundings {
  readonly hookWind: Vec3;
  readonly cargoWind: Vec3;
  readonly hookSupport: number;
  readonly cargoSupport: number;
  readonly friction: Friction;
  /** Heading of the jib, towards which the two rope falls turn the hook block. */
  readonly jibHeading: number;
  /** Tag lines held by riggers, or null when the payload turns freely. */
  readonly tagLine: HeldTagLine | null;
}

export interface HeldTagLine {
  readonly spec: TagLineSpec;
  /** Heading the riggers are holding the payload at. */
  readonly heading: number;
}

interface TagPull {
  readonly force: Vec3;
  readonly yawTorque: number;
}

const NO_PULL: TagPull = { force: vec3(0, 0, 0), yawTorque: 0 };
/** Tag lines run down to the riggers at about this slope, so a pull also loads the slings. */
const LINE_SLOPE = 1;

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Pull of the riggers on the tag lines. A rope only pulls, so the torque comes from one rigger
 * hauling on the line at one end of the payload: it is limited by what a person can pull on half
 * the payload length, and the same pull drags the payload sideways and downwards.
 */
function tagPull(held: HeldTagLine | null, props: CargoProps, cargo: Cargo): TagPull {
  if (held === null) return NO_PULL;
  const arm = Math.max(props.size.x, props.size.z) / 2;
  const wanted = -(held.spec.stiffness * wrapAngle(cargo.yaw - held.heading) + held.spec.damping * cargo.yawRate);
  const limit = held.spec.maxForce * arm;
  const yawTorque = Math.min(Math.max(wanted, -limit), limit);
  const pull = yawTorque / arm;
  const sideways = scale(headingVector(cargo.yaw), -pull);
  return { force: vec3(sideways.x, -Math.abs(pull) * LINE_SLOPE, sideways.z), yawTorque };
}

export interface TandemStep {
  readonly hook: LoadBody;
  readonly cargo: Cargo;
  /** Rope tension, what the load cell reads. */
  readonly tension: number;
  readonly slingTension: number;
  /** Downward speed of the payload at touchdown, zero when it did not land in this step. */
  readonly impactSpeed: number;
}

interface Forces {
  /** Everything but weight and ground reaction. */
  readonly onHook: Vec3;
  readonly onCargo: Vec3;
  readonly yawTorque: number;
  readonly tension: number;
  readonly slingTension: number;
}

interface Tandem {
  readonly hook: LoadBody;
  readonly cargo: Cargo;
}

interface Rig {
  readonly hookProps: HangingMass;
  readonly cargoProps: CargoProps;
  readonly cable: CableProperties;
  readonly surroundings: TandemSurroundings;
}

const cargoSeat = (props: CargoProps): HangingMass => ({ mass: props.mass, dragArea: 0, hangDepth: props.size.y / 2 });

/** Tension-only spring-damper of the slings; returns the pull on the payload's end. */
function slingPull(rig: Rig, state: Tandem): { readonly tension: number; readonly direction: Vec3 } {
  const offset = subtract(state.cargo.body.position, state.hook.position);
  const distance = magnitude(offset);
  const stretch = distance - rig.cargoProps.slingLength;
  if (stretch <= 0) return { tension: 0, direction: vec3(0, -1, 0) };
  const direction = scale(offset, 1 / distance);
  const reduced = (rig.hookProps.mass * rig.cargoProps.mass) / (rig.hookProps.mass + rig.cargoProps.mass);
  const damping = 2 * rig.cable.slingDampingRatio * Math.sqrt(rig.cable.slingStiffness * reduced);
  const rate = dot(direction, subtract(state.cargo.body.velocity, state.hook.velocity));
  return { tension: Math.max(0, rig.cable.slingStiffness * stretch + damping * rate), direction };
}

/** Restoring torque of the two rope falls plus swivel friction, relative to the jib heading. */
function swivelTorque(rig: Rig, motion: CableMotion, tension: number, cargo: Cargo): number {
  const stiffness = (tension * rig.cable.fallSpacing ** 2) / (4 * Math.max(motion.length, 1));
  const twist = cargo.yaw - rig.surroundings.jibHeading;
  return -stiffness * Math.sin(twist) * Math.cos(twist) - rig.cable.swivelDamping * cargo.yawRate;
}

function forcesOn(rig: Rig, motion: CableMotion, state: Tandem): Forces {
  const { hookProps, cargoProps, cable, surroundings } = rig;
  const suspended = hookProps.mass + cargoProps.mass;
  const rope = pullOf(cable, suspended, motion, state.hook.position, state.hook.velocity);
  const sling = slingPull(rig, state);
  const slingForce = scale(sling.direction, sling.tension);
  const hookAir = dragForce(subtract(surroundings.hookWind, state.hook.velocity), hookProps.dragArea);
  const sway = scale(swingDamping(cable, rope), hookProps.mass);
  const aero = boxAero(
    cargoProps,
    subtract(surroundings.cargoWind, state.cargo.body.velocity),
    state.cargo.yaw,
    state.cargo.yawRate,
  );
  const tag = tagPull(surroundings.tagLine, cargoProps, state.cargo);
  return {
    onHook: add(add(scale(rope.direction, -rope.tension), slingForce), add(hookAir, sway)),
    onCargo: add(subtract(aero.force, slingForce), tag.force),
    yawTorque: aero.yawTorque + tag.yawTorque + swivelTorque(rig, motion, rope.tension, state.cargo),
    tension: rope.tension,
    slingTension: sling.tension,
  };
}

const pack = (state: Tandem): StateVector => [
  state.hook.position.x,
  state.hook.position.y,
  state.hook.position.z,
  state.hook.velocity.x,
  state.hook.velocity.y,
  state.hook.velocity.z,
  state.cargo.body.position.x,
  state.cargo.body.position.y,
  state.cargo.body.position.z,
  state.cargo.body.velocity.x,
  state.cargo.body.velocity.y,
  state.cargo.body.velocity.z,
  state.cargo.yaw,
  state.cargo.yawRate,
];

const unpack = (vector: StateVector, template: Tandem): Tandem => ({
  hook: {
    position: vec3(vector[0]!, vector[1]!, vector[2]!),
    velocity: vec3(vector[3]!, vector[4]!, vector[5]!),
    grounded: template.hook.grounded,
  },
  cargo: {
    body: {
      position: vec3(vector[6]!, vector[7]!, vector[8]!),
      velocity: vec3(vector[9]!, vector[10]!, vector[11]!),
      grounded: template.cargo.body.grounded,
    },
    yaw: vector[12]!,
    yawRate: vector[13]!,
  },
});

/** Six state derivatives of a body: free bodies fall and are pulled, resting bodies are held. */
function bodyRates(isFree: boolean, body: LoadBody, force: Vec3, mass: number): readonly number[] {
  if (!isFree) return [0, 0, 0, 0, 0, 0];
  const acceleration = add(scale(force, 1 / mass), vec3(0, -GRAVITY, 0));
  return [body.velocity.x, body.velocity.y, body.velocity.z, acceleration.x, acceleration.y, acceleration.z];
}

interface Freedom {
  readonly hook: boolean;
  readonly cargo: boolean;
}

/** A resting body stays put while it is supported and nothing lifts it off. */
function freedomOf(rig: Rig, state: Tandem, forces: Forces): Freedom {
  const { hookProps, cargoProps, surroundings } = rig;
  const hookRests =
    state.hook.grounded &&
    isSupported(state.hook, hookProps, surroundings.hookSupport) &&
    forces.onHook.y <= hookProps.mass * GRAVITY;
  const cargoRests =
    state.cargo.body.grounded &&
    isSupported(state.cargo.body, cargoSeat(cargoProps), surroundings.cargoSupport) &&
    forces.onCargo.y <= cargoProps.mass * GRAVITY;
  return { hook: !hookRests, cargo: !cargoRests };
}

function integrate(rig: Rig, motion: CableMotion, state: Tandem, freedom: Freedom, step: number): Tandem {
  const inertia = yawInertia(rig.cargoProps.mass, rig.cargoProps.size);
  const derivative = (elapsed: number, vector: StateVector): StateVector => {
    const current = unpack(vector, state);
    const forces = forcesOn(rig, cableAfter(motion, elapsed), current);
    const turning = freedom.cargo ? [current.cargo.yawRate, forces.yawTorque / inertia] : [0, 0];
    return [
      ...bodyRates(freedom.hook, current.hook, forces.onHook, rig.hookProps.mass),
      ...bodyRates(freedom.cargo, current.cargo.body, forces.onCargo, rig.cargoProps.mass),
      ...turning,
    ];
  };
  return unpack(rk4Step(derivative, 0, pack(state), step), state);
}

interface Settled {
  readonly body: LoadBody;
  readonly impactSpeed: number;
}

/** Lands a free body that reached its support, or slides a resting one under the applied force. */
function settle(
  isFree: boolean,
  before: LoadBody,
  after: LoadBody,
  seatOf: HangingMass,
  support: number,
  applied: Vec3,
  rig: Rig,
  step: number,
): Settled {
  if (!isFree) {
    const slid = slideUnder(before, seatOf.mass, applied, rig.surroundings.friction, step);
    return { body: seat(slid, seatOf, support), impactSpeed: 0 };
  }
  if (after.position.y - seatOf.hangDepth > support) return { body: { ...after, grounded: false }, impactSpeed: 0 };
  const impactSpeed = before.grounded ? 0 : Math.max(0, -after.velocity.y);
  return { body: seat(after, seatOf, support), impactSpeed };
}

/** Advances hook block and payload one fixed step. */
export function stepTandem(
  hook: LoadBody,
  cargo: Cargo,
  hookProps: HangingMass,
  cargoProps: CargoProps,
  cable: CableProperties,
  motion: CableMotion,
  surroundings: TandemSurroundings,
  step: number,
): TandemStep {
  const rig: Rig = { hookProps, cargoProps, cable, surroundings };
  const start: Tandem = { hook, cargo };
  const forces = forcesOn(rig, motion, start);
  const freedom = freedomOf(rig, start, forces);
  const flown = integrate(rig, motion, start, freedom, step);
  const hookEnd = settle(freedom.hook, hook, flown.hook, hookProps, surroundings.hookSupport, forces.onHook, rig, step);
  const cargoEnd = settle(
    freedom.cargo,
    cargo.body,
    flown.cargo.body,
    cargoSeat(cargoProps),
    surroundings.cargoSupport,
    forces.onCargo,
    rig,
    step,
  );
  const isTurning = !cargoEnd.body.grounded;
  const end: Tandem = {
    hook: hookEnd.body,
    cargo: { body: cargoEnd.body, yaw: flown.cargo.yaw, yawRate: isTurning ? flown.cargo.yawRate : 0 },
  };
  const final = forcesOn(rig, cableAfter(motion, step), end);
  return {
    hook: end.hook,
    cargo: end.cargo,
    tension: final.tension,
    slingTension: final.slingTension,
    impactSpeed: cargoEnd.impactSpeed,
  };
}

/** Kinetic, gravitational and elastic energy of both bodies, yaw included; used by the tests. */
export function tandemEnergy(
  state: Tandem,
  hookProps: HangingMass,
  cargoProps: CargoProps,
  cable: CableProperties,
  motion: CableMotion,
): number {
  const { hook, cargo } = state;
  const ropeStretch = Math.max(0, magnitude(subtract(hook.position, motion.pivot)) - motion.length);
  const slingStretch = Math.max(0, magnitude(subtract(cargo.body.position, hook.position)) - cargoProps.slingLength);
  const ropeStiffness = 1 / ((motion.length - motion.link + cable.fixedRopeLength) / cable.axialStiffness + 1 / cable.structureStiffness);
  const kinetic =
    0.5 * hookProps.mass * dot(hook.velocity, hook.velocity) +
    0.5 * cargoProps.mass * dot(cargo.body.velocity, cargo.body.velocity) +
    0.5 * yawInertia(cargoProps.mass, cargoProps.size) * cargo.yawRate ** 2;
  const potential = GRAVITY * (hookProps.mass * hook.position.y + cargoProps.mass * cargo.body.position.y);
  const elastic = 0.5 * ropeStiffness * ropeStretch ** 2 + 0.5 * cable.slingStiffness * slingStretch ** 2;
  return kinetic + potential + elastic;
}
