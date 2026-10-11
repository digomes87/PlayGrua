/** Wind: mean speed plus seeded Ornstein-Uhlenbeck gusts, slowly veering direction, drag forces. */
import type { AeroSegment } from '../craneSpec';
import { nextGaussian, seedRandom } from './random';
import { AIR_DENSITY } from './units';
import { type Vec3, dot, magnitude, scale, vec3 } from './vec3';

export interface WindConfig {
  readonly meanSpeed: number;
  /** Heading the air travels towards, radians from +X towards +Z. */
  readonly meanDirection: number;
  /** Gust standard deviation as a fraction of the mean speed. */
  readonly turbulenceIntensity: number;
  readonly gustTimeScale: number;
  readonly peakSpeed: number;
  readonly directionSpread: number;
  readonly directionTimeScale: number;
  /** Anemometer height; speeds are referred to it. */
  readonly referenceHeight: number;
  readonly shearExponent: number;
  readonly averagingTime: number;
  readonly seed: number;
}

export interface WindState {
  readonly random: number;
  readonly gust: number;
  readonly veer: number;
  readonly averageSpeed: number;
}

const MIN_SHEAR_HEIGHT = 2;

export const CALM: WindConfig = {
  meanSpeed: 0,
  meanDirection: 0,
  turbulenceIntensity: 0,
  gustTimeScale: 5,
  peakSpeed: 0,
  directionSpread: 0,
  directionTimeScale: 60,
  referenceHeight: 50,
  shearExponent: 0.15,
  averagingTime: 60,
  seed: 1,
};

export const createWind = (config: WindConfig): WindState => ({
  random: seedRandom(config.seed),
  gust: 0,
  veer: 0,
  averageSpeed: config.meanSpeed,
});

/** Exact discretisation of an Ornstein-Uhlenbeck process with stationary deviation `deviation`. */
function relax(value: number, deviation: number, timeScale: number, noise: number, step: number): number {
  const decay = Math.exp(-step / timeScale);
  return value * decay + deviation * Math.sqrt(1 - decay * decay) * noise;
}

/** Instantaneous speed at the anemometer. */
export const windSpeed = (state: WindState, config: WindConfig): number =>
  Math.min(Math.max(config.meanSpeed + state.gust, 0), config.peakSpeed);

export const windHeading = (state: WindState, config: WindConfig): number => config.meanDirection + state.veer;

export function stepWind(state: WindState, config: WindConfig, step: number): WindState {
  const gustDraw = nextGaussian(state.random);
  const veerDraw = nextGaussian(gustDraw.state);
  const gustDeviation = config.turbulenceIntensity * config.meanSpeed;
  const gust = relax(state.gust, gustDeviation, config.gustTimeScale, gustDraw.value, step);
  const veer = relax(state.veer, config.directionSpread, config.directionTimeScale, veerDraw.value, step);
  const next = { random: veerDraw.state, gust, veer, averageSpeed: state.averageSpeed };
  const blend = 1 - Math.exp(-step / config.averagingTime);
  return { ...next, averageSpeed: state.averageSpeed + (windSpeed(next, config) - state.averageSpeed) * blend };
}

/** Wind velocity vector at a height, using a power-law shear profile. */
export function windVelocityAt(state: WindState, config: WindConfig, height: number): Vec3 {
  const shear = (Math.max(height, MIN_SHEAR_HEIGHT) / config.referenceHeight) ** config.shearExponent;
  const speed = windSpeed(state, config) * shear;
  const heading = windHeading(state, config);
  return vec3(speed * Math.cos(heading), 0, speed * Math.sin(heading));
}

/** F = 1/2 * rho * Cd * A * |v| * v, with `dragArea` = Cd * A and v the air velocity relative to the body. */
export const dragForce = (relativeVelocity: Vec3, dragArea: number): Vec3 =>
  scale(relativeVelocity, 0.5 * AIR_DENSITY * dragArea * magnitude(relativeVelocity));

/** Slewing torque of the wind on jib, counter-jib and counterweight, relative to their own motion. */
export function slewWindTorque(
  segments: readonly AeroSegment[],
  windVelocity: Vec3,
  slewAngle: number,
  slewRate: number,
): number {
  const tangent = vec3(-Math.sin(slewAngle), 0, Math.cos(slewAngle));
  const crossWind = dot(windVelocity, tangent);
  return segments.reduce((torque, segment) => {
    const relative = crossWind - slewRate * segment.arm;
    return torque + 0.5 * AIR_DENSITY * segment.dragArea * Math.abs(relative) * relative * segment.arm;
  }, 0);
}
