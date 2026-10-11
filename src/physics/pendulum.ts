/**
 * Suspended load as a spherical pendulum in Cartesian world coordinates.
 *
 * The rope is a tension-only axial spring-damper between the moving trolley and the load, so the
 * inertia of the suspension point, the variable length (including its Coriolis term), slack rope
 * and snatch loads all come out of Newton's second law in the inertial frame, with no small-angle
 * assumption. RK4 at the fixed physics step.
 */
import type { CraneSpec } from '../craneSpec';
import { type StateVector, rk4Step } from './integrator';
import { GRAVITY } from './units';
import { type Vec3, ZERO, add, dot, magnitude, normalize, reject, scale, subtract, vec3 } from './vec3';
import { dragForce } from './wind';

export type CableProperties = CraneSpec['cable'];

export interface LoadBody {
  /** Centre of gravity of hook block plus payload, the point mass on the end of the rope. */
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly grounded: boolean;
}

export interface HangingMass {
  readonly mass: number;
  /** Cd * A of the payload. */
  readonly dragArea: number;
  /** Distance from the centre of gravity down to the underside of whatever hangs. */
  readonly hangDepth: number;
}

export interface Friction {
  readonly static: number;
  readonly kinetic: number;
}

/**
 * Suspension point and unstretched pendulum length (rope plus the rigid hook-to-centre-of-gravity
 * link), both moving linearly during one step.
 */
export interface CableMotion {
  readonly pivot: Vec3;
  readonly pivotVelocity: Vec3;
  readonly length: number;
  readonly lengthRate: number;
  /** Rigid part of `length` (hook to centre of gravity); only the rest is rope and stretches. */
  readonly link: number;
}

export interface Surroundings {
  readonly windVelocity: Vec3;
  /** Height of the surface directly below the load. */
  readonly supportHeight: number;
  /** Coulomb friction between the load and that surface. */
  readonly friction: Friction;
}

export interface LoadStep {
  readonly body: LoadBody;
  readonly tension: number;
  /** Downward speed at touchdown, zero when the load did not land in this step. */
  readonly impactSpeed: number;
}

interface CablePull {
  readonly tension: number;
  /** Unit vector from the trolley to the load. */
  readonly direction: Vec3;
  readonly relativeVelocity: Vec3;
}

/** Vertical gap beyond which a grounded load has run out of surface and falls. */
const EDGE_TOLERANCE = 0.05;

const SLACK: CablePull = { tension: 0, direction: vec3(0, -1, 0), relativeVelocity: ZERO };

/** Rope stiffness E*A/L in series with the structure, for `ropeLength` of rope below the trolley. */
export function cableStiffness(cable: CableProperties, ropeLength: number): number {
  const rope = cable.axialStiffness / (ropeLength + cable.fixedRopeLength);
  return 1 / (1 / rope + 1 / cable.structureStiffness);
}

export const cableAfter = (motion: CableMotion, elapsed: number): CableMotion => ({
  ...motion,
  pivot: add(motion.pivot, scale(motion.pivotVelocity, elapsed)),
  length: motion.length + motion.lengthRate * elapsed,
});

function pullOf(cable: CableProperties, mass: number, motion: CableMotion, position: Vec3, velocity: Vec3): CablePull {
  const offset = subtract(position, motion.pivot);
  const distance = magnitude(offset);
  const stretch = distance - motion.length;
  if (stretch <= 0) return SLACK;
  const direction = scale(offset, 1 / distance);
  const relativeVelocity = subtract(velocity, motion.pivotVelocity);
  const stretchRate = dot(direction, relativeVelocity) - motion.lengthRate;
  const stiffness = cableStiffness(cable, motion.length - motion.link);
  const damping = 2 * cable.dampingRatio * Math.sqrt(stiffness * mass);
  const tension = Math.max(0, stiffness * stretch + damping * stretchRate);
  return { tension, direction, relativeVelocity };
}

/** Rope tension for a load at `position`. Zero when the rope is slack: it never pushes. */
export const cableTension = (
  cable: CableProperties,
  mass: number,
  motion: CableMotion,
  body: LoadBody,
): number => pullOf(cable, mass, motion, body.position, body.velocity).tension;

function swingDamping(cable: CableProperties, pull: CablePull): Vec3 {
  if (pull.tension === 0) return ZERO;
  return scale(reject(pull.relativeVelocity, pull.direction), -cable.swingDamping);
}

function acceleration(
  load: HangingMass,
  cable: CableProperties,
  motion: CableMotion,
  wind: Vec3,
  position: Vec3,
  velocity: Vec3,
): Vec3 {
  const pull = pullOf(cable, load.mass, motion, position, velocity);
  const ropeForce = scale(pull.direction, -pull.tension);
  const airForce = dragForce(subtract(wind, velocity), load.dragArea);
  const specificForce = scale(add(ropeForce, airForce), 1 / load.mass);
  return add(add(specificForce, swingDamping(cable, pull)), vec3(0, -GRAVITY, 0));
}

const pack = (position: Vec3, velocity: Vec3): StateVector => [
  position.x,
  position.y,
  position.z,
  velocity.x,
  velocity.y,
  velocity.z,
];

function fly(
  body: LoadBody,
  load: HangingMass,
  cable: CableProperties,
  motion: CableMotion,
  wind: Vec3,
  step: number,
): LoadBody {
  const derivative = (elapsed: number, state: StateVector): StateVector => {
    const position = vec3(state[0]!, state[1]!, state[2]!);
    const velocity = vec3(state[3]!, state[4]!, state[5]!);
    return pack(velocity, acceleration(load, cable, cableAfter(motion, elapsed), wind, position, velocity));
  };
  const next = rk4Step(derivative, 0, pack(body.position, body.velocity), step);
  return {
    position: vec3(next[0]!, next[1]!, next[2]!),
    velocity: vec3(next[3]!, next[4]!, next[5]!),
    grounded: false,
  };
}

/** Puts the load on the supporting surface, keeping only its motion along it. */
function seat(body: LoadBody, load: HangingMass, supportHeight: number): LoadBody {
  const position = vec3(body.position.x, supportHeight + load.hangDepth, body.position.z);
  return { position, velocity: vec3(body.velocity.x, 0, body.velocity.z), grounded: true };
}

/** A resting load leaves the ground once the vertical rope pull exceeds its weight. */
function liftsOff(body: LoadBody, load: HangingMass, cable: CableProperties, motion: CableMotion): boolean {
  const pull = pullOf(cable, load.mass, motion, body.position, ZERO);
  return -pull.direction.y * pull.tension > load.mass * GRAVITY;
}

/** True while the surface is still under the load; false after it slid past an edge. */
const isSupported = (body: LoadBody, load: HangingMass, supportHeight: number): boolean =>
  body.position.y - load.hangDepth <= supportHeight + EDGE_TOLERANCE;

/**
 * Load on a surface with Coulomb friction. A side pull below the static limit leaves it at rest;
 * above it the load is dragged, and friction brings it back to rest once the pull eases.
 */
function slide(
  body: LoadBody,
  load: HangingMass,
  cable: CableProperties,
  motion: CableMotion,
  surroundings: Surroundings,
  step: number,
): LoadBody {
  const pull = pullOf(cable, load.mass, motion, body.position, body.velocity);
  const airForce = dragForce(subtract(surroundings.windVelocity, body.velocity), load.dragArea);
  const applied = add(scale(pull.direction, -pull.tension), airForce);
  const normalForce = Math.max(0, load.mass * GRAVITY - applied.y);
  const driving = vec3(applied.x, 0, applied.z);
  const speed = magnitude(body.velocity);
  if (speed === 0 && magnitude(driving) <= surroundings.friction.static * normalForce) return body;
  const heading = speed > 0 ? scale(body.velocity, 1 / speed) : normalize(driving);
  const friction = scale(heading, -surroundings.friction.kinetic * normalForce);
  const velocity = add(body.velocity, scale(add(driving, friction), step / load.mass));
  if (dot(velocity, heading) <= 0) return { ...body, velocity: ZERO };
  return { ...body, position: add(body.position, scale(velocity, step)), velocity };
}

/**
 * Advances the load one fixed step. A grounded load rests or is dragged until the rope lifts it
 * or it slides off an edge; an airborne load that reaches the supporting surface lands on it and
 * keeps its horizontal speed, which friction then removes.
 */
export function stepLoad(
  body: LoadBody,
  load: HangingMass,
  cable: CableProperties,
  motion: CableMotion,
  surroundings: Surroundings,
  step: number,
): LoadStep {
  const finalCable = cableAfter(motion, step);
  const support = surroundings.supportHeight;
  if (body.grounded && isSupported(body, load, support) && !liftsOff(body, load, cable, finalCable)) {
    const resting = seat(slide(body, load, cable, motion, surroundings, step), load, support);
    return { body: resting, tension: cableTension(cable, load.mass, finalCable, resting), impactSpeed: 0 };
  }
  const flown = fly(body, load, cable, motion, surroundings.windVelocity, step);
  if (flown.position.y - load.hangDepth > support) {
    return { body: flown, tension: cableTension(cable, load.mass, finalCable, flown), impactSpeed: 0 };
  }
  const landed = seat(flown, load, support);
  const impactSpeed = body.grounded ? 0 : Math.max(0, -flown.velocity.y);
  return { body: landed, tension: cableTension(cable, load.mass, finalCable, landed), impactSpeed };
}

/** Kinetic + gravitational + elastic energy, used to verify the integrator. */
export function mechanicalEnergy(body: LoadBody, mass: number, cable: CableProperties, motion: CableMotion): number {
  const stretch = Math.max(0, magnitude(subtract(body.position, motion.pivot)) - motion.length);
  const kinetic = 0.5 * mass * dot(body.velocity, body.velocity);
  const elastic = 0.5 * cableStiffness(cable, motion.length - motion.link) * stretch * stretch;
  return kinetic + mass * GRAVITY * body.position.y + elastic;
}

/** Rope length under static load: unstretched length plus the elastic elongation. */
export const stretchedLength = (cable: CableProperties, mass: number, length: number): number =>
  length + (mass * GRAVITY) / cableStiffness(cable, length);

/** Angle between the rope and the vertical, in radians. */
export function swingAngle(body: LoadBody, pivot: Vec3): number {
  const offset = subtract(body.position, pivot);
  return Math.atan2(Math.hypot(offset.x, offset.z), -offset.y);
}
