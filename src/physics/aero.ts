/**
 * Wind load on a box-shaped payload that can turn about the vertical axis.
 *
 * Each pair of vertical faces is a flat plate. The normal force follows the Rayleigh-Kirchhoff
 * flat-plate law, scaled so that the broadside value is the payload's drag coefficient, and acts at
 * a centre of pressure that moves towards the leading edge at low incidence. That offset is what
 * turns a panel broadside to the wind.
 */
import { AIR_DENSITY } from './units';
import { type Vec3, ZERO, add, dot, scale, vec3 } from './vec3';

export interface BoxShape {
  /** x along the payload heading, y vertical, z across. */
  readonly size: Vec3;
  readonly dragCoefficient: number;
}

export interface AeroLoad {
  readonly force: Vec3;
  /** Torque about the vertical axis, positive in the direction of increasing heading. */
  readonly yawTorque: number;
}

interface Plate {
  readonly normal: Vec3;
  /** Horizontal direction along the plate. */
  readonly chordDirection: Vec3;
  readonly chord: number;
  readonly area: number;
}

const BROADSIDE = (2 * Math.PI) / (4 + Math.PI);
const STILL = 1e-9;

export const headingVector = (yaw: number): Vec3 => vec3(Math.cos(yaw), 0, Math.sin(yaw));

const acrossVector = (yaw: number): Vec3 => vec3(-Math.sin(yaw), 0, Math.cos(yaw));

const platesOf = (shape: BoxShape, yaw: number): readonly Plate[] => [
  {
    normal: headingVector(yaw),
    chordDirection: acrossVector(yaw),
    chord: shape.size.z,
    area: shape.size.y * shape.size.z,
  },
  {
    normal: acrossVector(yaw),
    chordDirection: headingVector(yaw),
    chord: shape.size.x,
    area: shape.size.y * shape.size.x,
  },
];

/** Normal force and yaw torque of one plate in a horizontal relative wind. */
function plateLoad(plate: Plate, dragCoefficient: number, wind: Vec3): AeroLoad {
  const speed = Math.hypot(wind.x, wind.z);
  if (speed < STILL) return { force: ZERO, yawTorque: 0 };
  const through = dot(wind, plate.normal);
  const along = dot(wind, plate.chordDirection);
  const sine = Math.abs(through) / speed;
  const cosine = Math.abs(along) / speed;
  const coefficient = ((dragCoefficient / BROADSIDE) * 2 * Math.PI * sine) / (4 + Math.PI * sine);
  const magnitude = 0.5 * AIR_DENSITY * speed * speed * plate.area * coefficient;
  const force = scale(plate.normal, Math.sign(through) * magnitude);
  const pressureOffset = (plate.chord * 0.75 * cosine) / (4 + Math.PI * sine);
  const arm = scale(plate.chordDirection, -Math.sign(along) * pressureOffset);
  return { force, yawTorque: arm.x * force.z - arm.z * force.x };
}

/** Strip-theory damping of a plate turning in the wind (linear term) and in still air (quadratic). */
function spinDamping(plate: Plate, dragCoefficient: number, windSpeed: number, yawRate: number): number {
  const reference = 0.5 * AIR_DENSITY * dragCoefficient * plate.area * plate.chord ** 2;
  return -reference * (windSpeed / 6 + (plate.chord * Math.abs(yawRate)) / 32) * yawRate;
}

function verticalDrag(shape: BoxShape, wind: Vec3): Vec3 {
  const area = shape.size.x * shape.size.z;
  return vec3(0, 0.5 * AIR_DENSITY * shape.dragCoefficient * area * Math.abs(wind.y) * wind.y, 0);
}

/** Aerodynamic force and yaw torque on the payload for the air velocity relative to it. */
export function boxAero(shape: BoxShape, relativeWind: Vec3, yaw: number, yawRate: number): AeroLoad {
  const speed = Math.hypot(relativeWind.x, relativeWind.z);
  return platesOf(shape, yaw).reduce<AeroLoad>(
    (total, plate) => {
      const load = plateLoad(plate, shape.dragCoefficient, relativeWind);
      const damping = spinDamping(plate, shape.dragCoefficient, speed, yawRate);
      return { force: add(total.force, load.force), yawTorque: total.yawTorque + load.yawTorque + damping };
    },
    { force: verticalDrag(shape, relativeWind), yawTorque: 0 },
  );
}

/** Yaw inertia of a uniform box about its vertical axis. */
export const yawInertia = (mass: number, size: Vec3): number => (mass * (size.x ** 2 + size.z ** 2)) / 12;
