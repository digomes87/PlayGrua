/** Seeded, stateless random numbers (mulberry32) so the simulation stays deterministic. */

export interface Draw {
  readonly value: number;
  readonly state: number;
}

const INCREMENT = 0x6d2b79f5;
const UINT32_RANGE = 4294967296;
const SMALLEST_UNIFORM = 1e-12;

export const seedRandom = (seed: number): number => seed >>> 0;

export function nextUniform(state: number): Draw {
  const next = (state + INCREMENT) >>> 0;
  const mixed = Math.imul(next ^ (next >>> 15), next | 1);
  const scrambled = mixed ^ (mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61));
  return { value: ((scrambled ^ (scrambled >>> 14)) >>> 0) / UINT32_RANGE, state: next };
}

/** Standard normal sample via Box-Muller. */
export function nextGaussian(state: number): Draw {
  const radial = nextUniform(state);
  const angular = nextUniform(radial.state);
  const radius = Math.sqrt(-2 * Math.log(Math.max(radial.value, SMALLEST_UNIFORM)));
  return { value: radius * Math.cos(2 * Math.PI * angular.value), state: angular.state };
}
