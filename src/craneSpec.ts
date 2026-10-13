/**
 * Single source of truth for the crane. Every reference value of the simulator lives here.
 * All quantities are SI (m, kg, s, N, rad) unless the name says otherwise.
 */
import { kmhToMs, rpmToRadPerSecond, tonnesToKg } from './physics/units';

export interface ChartPoint {
  readonly radius: number;
  readonly capacity: number;
}

/** Lumped wind surface of the slewing part: drag area (Cd * A) and signed lever arm along the jib. */
export interface AeroSegment {
  readonly dragArea: number;
  readonly arm: number;
}

export interface HoistGear {
  readonly force: number;
  readonly reflectedMass: number;
}

export interface CraneSpec {
  readonly geometry: {
    readonly trolleyHeight: number;
    readonly maxHookHeight: number;
    readonly jibLength: number;
    readonly counterJibLength: number;
    readonly minRadius: number;
    readonly maxRadius: number;
    readonly hookBlockHeight: number;
  };
  readonly masses: {
    readonly jib: number;
    readonly counterJib: number;
    readonly counterweight: number;
    readonly counterweightRadius: number;
    readonly trolley: number;
    readonly hookBlock: number;
  };
  readonly slew: {
    readonly maxRate: number;
    readonly motorTorque: number;
    readonly acceleration: number;
    readonly brakeDeceleration: number;
    readonly brakeTorque: number;
    readonly controlBandwidth: number;
    readonly freeFriction: number;
  };
  readonly trolley: {
    readonly maxSpeed: number;
    readonly acceleration: number;
    readonly deceleration: number;
    /** Largest force the trolley drive puts on the trolley, N. */
    readonly driveForce: number;
    readonly brakeForce: number;
    /** Trolley mass plus the drive train reflected to it, kg. */
    readonly effectiveMass: number;
    readonly controlBandwidth: number;
  };
  readonly hoist: {
    readonly lightSpeed: number;
    readonly heavySpeed: number;
    readonly heavyLoadThreshold: number;
    readonly acceleration: number;
    readonly deceleration: number;
    /** Rope force the motor can hold and the drive train inertia seen at the hook, per gear. */
    readonly lightGear: HoistGear;
    readonly heavyGear: HoistGear;
    readonly brakeForce: number;
    readonly controlBandwidth: number;
    readonly maxCableLength: number;
    /** Fraction of the hook block weight below which the slack-rope switch stops lowering. */
    readonly slackTensionFraction: number;
  };
  readonly cable: {
    /** Rope axial stiffness E*A summed over the falls, in newtons. */
    readonly axialStiffness: number;
    /** Rope between the drum and the trolley sheaves, which also stretches. */
    readonly fixedRopeLength: number;
    /** Vertical stiffness of jib and tower seen at the trolley, in series with the rope. */
    readonly structureStiffness: number;
    readonly dampingRatio: number;
    /** Light swing damping (rope hysteresis), 1/s. */
    readonly swingDamping: number;
    /** Axial stiffness of the slings between hook and payload, N/m. */
    readonly slingStiffness: number;
    readonly slingDampingRatio: number;
    /** Distance between the two rope falls, which gives the hook block a weak heading. */
    readonly fallSpacing: number;
    /** Friction of the hook swivel, N·m·s/rad. */
    readonly swivelDamping: number;
  };
  readonly loadChart: readonly ChartPoint[];
  readonly lmi: {
    readonly warning: number;
    readonly cutoff: number;
    readonly cutoffRelease: number;
    readonly overload: number;
    readonly filterTime: number;
  };
  readonly windLimits: {
    readonly alert: number;
    readonly lockout: number;
  };
  readonly aero: readonly AeroSegment[];
  /** Coulomb friction of a load standing on concrete. */
  readonly groundFriction: {
    readonly static: number;
    readonly kinetic: number;
  };
  readonly fineControlFactor: number;
}

/**
 * Manufacturer-style table: 8 t up to 15 m, then roughly constant moment,
 * Q(r) = 90 / (r - 3.75) t rounded to 10 kg, closing at 1.6 t on the 60 m tip.
 */
const LOAD_CHART: readonly ChartPoint[] = [
  { radius: 2.5, capacity: 8000 },
  { radius: 15, capacity: 8000 },
  { radius: 20, capacity: 5540 },
  { radius: 25, capacity: 4240 },
  { radius: 30, capacity: 3430 },
  { radius: 35, capacity: 2880 },
  { radius: 40, capacity: 2480 },
  { radius: 45, capacity: 2180 },
  { radius: 50, capacity: 1950 },
  { radius: 55, capacity: 1760 },
  { radius: 60, capacity: 1600 },
];

export const DEFAULT_CRANE_SPEC: CraneSpec = {
  geometry: {
    trolleyHeight: 47,
    maxHookHeight: 45,
    jibLength: 60,
    counterJibLength: 15,
    minRadius: 2.5,
    maxRadius: 60,
    hookBlockHeight: 0.6,
  },
  masses: {
    jib: 9000,
    counterJib: 4000,
    counterweight: 16000,
    counterweightRadius: 13,
    trolley: 450,
    hookBlock: 300,
  },
  slew: {
    maxRate: rpmToRadPerSecond(0.8),
    motorTorque: 2.2e5,
    acceleration: 0.012,
    brakeDeceleration: 0.02,
    brakeTorque: 3.0e5,
    controlBandwidth: 2,
    freeFriction: 5.0e4,
  },
  trolley: {
    maxSpeed: 1.0,
    acceleration: 0.4,
    deceleration: 0.5,
    driveForce: 9000,
    brakeForce: 14000,
    effectiveMass: 1950,
    controlBandwidth: 20,
  },
  hoist: {
    lightSpeed: 1.2,
    heavySpeed: 0.6,
    heavyLoadThreshold: tonnesToKg(4),
    acceleration: 0.5,
    deceleration: 0.6,
    lightGear: { force: 55000, reflectedMass: 8000 },
    heavyGear: { force: 106000, reflectedMass: 32000 },
    brakeForce: 130000,
    controlBandwidth: 20,
    maxCableLength: 49,
    slackTensionFraction: 0.5,
  },
  cable: {
    axialStiffness: 1.7e7,
    fixedRopeLength: 30,
    structureStiffness: 2.5e5,
    dampingRatio: 0.08,
    swingDamping: 0.004,
    slingStiffness: 2.0e6,
    slingDampingRatio: 0.2,
    fallSpacing: 0.28,
    swivelDamping: 15,
  },
  loadChart: LOAD_CHART,
  lmi: {
    warning: 0.9,
    cutoff: 1.0,
    cutoffRelease: 0.97,
    overload: 1.1,
    filterTime: 0.1,
  },
  windLimits: {
    alert: kmhToMs(50),
    lockout: kmhToMs(72),
  },
  aero: [
    { dragArea: 24, arm: 30 },
    { dragArea: 9.6, arm: -7.5 },
    { dragArea: 9.6, arm: -13 },
  ],
  groundFriction: { static: 0.5, kinetic: 0.4 },
  fineControlFactor: 0.25,
};
