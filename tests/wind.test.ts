import { describe, expect, test } from 'vitest';
import { nextGaussian, nextUniform, seedRandom } from '../src/physics/random';
import { AIR_DENSITY, FIXED_STEP, PHYSICS_RATE_HZ, kmhToMs } from '../src/physics/units';
import { vec3 } from '../src/physics/vec3';
import {
  CALM,
  type WindConfig,
  type WindState,
  createWind,
  dragForce,
  slewWindTorque,
  stepWind,
  windHeading,
  windSpeed,
  windVelocityAt,
} from '../src/physics/wind';
import { SPEC } from './helpers';

const GUSTY: WindConfig = {
  ...CALM,
  meanSpeed: kmhToMs(25),
  turbulenceIntensity: 0.2,
  peakSpeed: kmhToMs(40),
  directionSpread: 0.25,
  seed: 42,
};

function simulate(config: WindConfig, seconds: number, observe: (state: WindState) => void = () => undefined): WindState {
  let state = createWind(config);
  for (let index = 0; index < seconds * PHYSICS_RATE_HZ; index += 1) {
    state = stepWind(state, config, FIXED_STEP);
    observe(state);
  }
  return state;
}

describe('seeded random', () => {
  test('uniform samples stay in [0, 1) and repeat for the same seed', () => {
    let state = seedRandom(7);
    const values: number[] = [];
    for (let index = 0; index < 1000; index += 1) {
      const draw = nextUniform(state);
      values.push(draw.value);
      state = draw.state;
    }

    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(nextUniform(seedRandom(7)).value).toBe(values[0]);
  });

  test('gaussian samples have zero mean and unit variance', () => {
    let state = seedRandom(99);
    let sum = 0;
    let squares = 0;
    const count = 20000;
    for (let index = 0; index < count; index += 1) {
      const draw = nextGaussian(state);
      sum += draw.value;
      squares += draw.value ** 2;
      state = draw.state;
    }

    expect(sum / count).toBeCloseTo(0, 1);
    expect(squares / count).toBeCloseTo(1, 1);
  });
});

describe('wind model', () => {
  test('the same seed produces the identical gust sequence', () => {
    expect(simulate(GUSTY, 30)).toEqual(simulate(GUSTY, 30));
  });

  test('a different seed produces different gusts', () => {
    expect(simulate({ ...GUSTY, seed: 43 }, 30).gust).not.toBe(simulate(GUSTY, 30).gust);
  });

  test('gusts vary around the mean and never exceed the peak speed', () => {
    let lowest = Infinity;
    let highest = 0;
    let sum = 0;
    const seconds = 600;
    simulate(GUSTY, seconds, (state) => {
      const speed = windSpeed(state, GUSTY);
      lowest = Math.min(lowest, speed);
      highest = Math.max(highest, speed);
      sum += speed;
    });
    const mean = sum / (seconds * PHYSICS_RATE_HZ);

    expect(highest).toBeLessThanOrEqual(GUSTY.peakSpeed);
    expect(highest).toBeGreaterThan(1.2 * GUSTY.meanSpeed);
    expect(lowest).toBeLessThan(0.8 * GUSTY.meanSpeed);
    expect(Math.abs(mean - GUSTY.meanSpeed)).toBeLessThan(0.15 * GUSTY.meanSpeed);
  });

  test('changes smoothly from one step to the next', () => {
    let previous = windSpeed(createWind(GUSTY), GUSTY);
    let largestJump = 0;
    simulate(GUSTY, 60, (state) => {
      const speed = windSpeed(state, GUSTY);
      largestJump = Math.max(largestJump, Math.abs(speed - previous));
      previous = speed;
    });

    expect(largestJump).toBeLessThan(0.5);
  });

  test('the direction wanders slowly around its mean', () => {
    let widest = 0;
    simulate(GUSTY, 600, (state) => {
      widest = Math.max(widest, Math.abs(windHeading(state, GUSTY) - GUSTY.meanDirection));
    });

    expect(widest).toBeGreaterThan(0.05);
    expect(widest).toBeLessThan(1.5);
  });

  test('calm air stays calm', () => {
    const state = simulate(CALM, 10);

    expect(windSpeed(state, CALM)).toBe(0);
    expect(state.averageSpeed).toBe(0);
  });

  test('is slower near the ground than at the anemometer', () => {
    const state = createWind(GUSTY);

    const top = windVelocityAt(state, GUSTY, GUSTY.referenceHeight);
    const low = windVelocityAt(state, GUSTY, 5);

    expect(top.x).toBeCloseTo(GUSTY.meanSpeed, 9);
    expect(low.x).toBeLessThan(top.x);
    expect(low.x).toBeGreaterThan(0.5 * top.x);
  });

  test('the running average tracks the mean speed', () => {
    expect(simulate(GUSTY, 600).averageSpeed).toBeCloseTo(GUSTY.meanSpeed, 0);
  });
});

describe('aerodynamic forces', () => {
  test('drag is ½·ρ·Cd·A·v² along the relative wind', () => {
    const force = dragForce(vec3(10, 0, 0), 2);

    expect(force.x).toBeCloseTo(0.5 * AIR_DENSITY * 2 * 100, 9);
    expect(force.y).toBe(0);
    expect(force.z).toBe(0);
  });

  test('drag grows with the square of the speed and linearly with the area', () => {
    expect(dragForce(vec3(20, 0, 0), 2).x).toBeCloseTo(4 * dragForce(vec3(10, 0, 0), 2).x, 9);
    expect(dragForce(vec3(10, 0, 0), 6).x).toBeCloseTo(3 * dragForce(vec3(10, 0, 0), 2).x, 9);
  });

  test('a cross wind turns the jib downwind', () => {
    const blowingTowardsPlusZ = vec3(0, 0, 15);

    expect(slewWindTorque(SPEC.aero, blowingTowardsPlusZ, 0, 0)).toBeGreaterThan(0);
    expect(slewWindTorque(SPEC.aero, blowingTowardsPlusZ, Math.PI, 0)).toBeLessThan(0);
  });

  test('wind along the jib produces no slewing torque', () => {
    expect(slewWindTorque(SPEC.aero, vec3(15, 0, 0), 0, 0)).toBeCloseTo(0, 9);
  });

  test('still air damps a slewing jib', () => {
    expect(slewWindTorque(SPEC.aero, vec3(0, 0, 0), 0, 0.08)).toBeLessThan(0);
  });

  test('the slew motor can hold the jib at the 72 km/h limit', () => {
    const torque = slewWindTorque(SPEC.aero, vec3(0, 0, SPEC.windLimits.lockout), 0, 0);

    expect(torque).toBeLessThan(SPEC.slew.motorTorque);
  });
});
