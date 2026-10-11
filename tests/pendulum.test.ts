import { describe, expect, test } from 'vitest';
import {
  type LoadBody,
  cableTension,
  mechanicalEnergy,
  stepLoad,
  stretchedLength,
  swingAngle,
} from '../src/physics/pendulum';
import { FIXED_STEP, GRAVITY, PHYSICS_RATE_HZ, degToRad } from '../src/physics/units';
import { ZERO, vec3 } from '../src/physics/vec3';
import {
  LOSSLESS_CABLE,
  PIVOT,
  SPEC,
  displaced,
  pointMass,
  stillCable,
  swingFreely,
} from './helpers';

const LOAD_MASS = 2300;

/** Mean period from the upward zero crossings of the horizontal offset. */
function measurePeriod(length: number, cycles: number): number {
  const start = displaced(LOSSLESS_CABLE, LOAD_MASS, length, degToRad(2));
  const crossings: number[] = [];
  let previous = start.position.x - PIVOT.x;
  swingFreely(start, pointMass(LOAD_MASS), LOSSLESS_CABLE, stillCable(length), 200 * PHYSICS_RATE_HZ, (body, step) => {
    const offset = body.position.x - PIVOT.x;
    if (previous < 0 && offset >= 0) crossings.push((step - offset / (offset - previous)) * FIXED_STEP);
    previous = offset;
  });
  return (crossings[cycles]! - crossings[0]!) / cycles;
}

describe('pendulum period', () => {
  test.each([5, 20, 40])('matches 2π√(L/g) within 1%% for a %d m rope', (length) => {
    const expected = 2 * Math.PI * Math.sqrt(stretchedLength(LOSSLESS_CABLE, LOAD_MASS, length) / GRAVITY);

    const measured = measurePeriod(length, 5);

    expect(Math.abs(measured - expected) / expected).toBeLessThan(0.01);
  });

  test('stays within 1% even against the unstretched rope length', () => {
    const expected = 2 * Math.PI * Math.sqrt(20 / GRAVITY);

    const measured = measurePeriod(20, 5);

    expect(Math.abs(measured - expected) / expected).toBeLessThan(0.01);
  });
});

describe('energy conservation', () => {
  test('drifts less than 0.5% over 60 s with no damping and no actuation', () => {
    const length = 25;
    const cable = stillCable(length);
    const load = pointMass(LOAD_MASS);
    const start = displaced(LOSSLESS_CABLE, LOAD_MASS, length, degToRad(20));
    const atRest = displaced(LOSSLESS_CABLE, LOAD_MASS, length, 0);
    const initial = mechanicalEnergy(start, LOAD_MASS, LOSSLESS_CABLE, cable);
    const swingEnergy = initial - mechanicalEnergy(atRest, LOAD_MASS, LOSSLESS_CABLE, cable);

    let worstDrift = 0;
    swingFreely(start, load, LOSSLESS_CABLE, cable, 60 * PHYSICS_RATE_HZ, (body) => {
      const drift = Math.abs(mechanicalEnergy(body, LOAD_MASS, LOSSLESS_CABLE, cable) - initial);
      worstDrift = Math.max(worstDrift, drift);
    });

    expect(swingEnergy).toBeGreaterThan(0);
    expect(worstDrift / swingEnergy).toBeLessThan(0.005);
  });

  test('loses energy when rope damping is enabled', () => {
    const cable = stillCable(25);
    const start = displaced(SPEC.cable, LOAD_MASS, 25, degToRad(20));
    const initial = mechanicalEnergy(start, LOAD_MASS, SPEC.cable, cable);

    const end = swingFreely(start, pointMass(LOAD_MASS), SPEC.cable, cable, 60 * PHYSICS_RATE_HZ);

    expect(mechanicalEnergy(end, LOAD_MASS, SPEC.cable, cable)).toBeLessThan(initial);
  });
});

describe('rope tension', () => {
  test('equals the weight for a load hanging at rest', () => {
    const body = displaced(SPEC.cable, LOAD_MASS, 20, 0);

    const tension = cableTension(SPEC.cable, LOAD_MASS, stillCable(20), body);

    expect(tension).toBeCloseTo(LOAD_MASS * GRAVITY, 3);
  });

  test('is zero when the rope is slack: it never pushes', () => {
    const body: LoadBody = { position: vec3(PIVOT.x, PIVOT.y - 10, PIVOT.z), velocity: ZERO, grounded: false };

    expect(cableTension(SPEC.cable, LOAD_MASS, stillCable(20), body)).toBe(0);
  });

  test('a load under a slack rope falls freely', () => {
    const start: LoadBody = { position: vec3(PIVOT.x, PIVOT.y - 10, PIVOT.z), velocity: ZERO, grounded: false };
    const steps = PHYSICS_RATE_HZ / 2;

    const end = swingFreely(start, pointMass(LOAD_MASS), SPEC.cable, stillCable(20), steps);

    expect(start.position.y - end.position.y).toBeCloseTo(0.5 * GRAVITY * 0.5 ** 2, 6);
  });

  test('rises above the static weight at the bottom of a swing', () => {
    const start = displaced(SPEC.cable, LOAD_MASS, 20, degToRad(25));
    const cable = stillCable(20);

    let peak = 0;
    swingFreely(start, pointMass(LOAD_MASS), SPEC.cable, cable, 10 * PHYSICS_RATE_HZ, (body) => {
      peak = Math.max(peak, cableTension(SPEC.cable, LOAD_MASS, cable, body));
    });

    expect(peak).toBeGreaterThan(1.1 * LOAD_MASS * GRAVITY);
  });
});

describe('ground contact', () => {
  const load = { mass: LOAD_MASS, dragArea: 0, hangDepth: 1 };
  const onGround: LoadBody = { position: vec3(PIVOT.x, 1, PIVOT.z), velocity: ZERO, grounded: true };
  const ground = { windVelocity: ZERO, supportHeight: 0, friction: SPEC.groundFriction };

  test('a grounded load under a slack rope stays put with zero tension', () => {
    const result = stepLoad(onGround, load, SPEC.cable, stillCable(47), ground, FIXED_STEP);

    expect(result.body).toEqual(onGround);
    expect(result.tension).toBe(0);
  });

  test('stays on the ground while the rope carries less than its weight', () => {
    const partial = stretchedLength(SPEC.cable, LOAD_MASS / 2, 45.8);
    const rope = { ...stillCable(45.8), pivot: vec3(PIVOT.x, 1 + partial, PIVOT.z) };

    const result = stepLoad(onGround, load, SPEC.cable, rope, ground, FIXED_STEP);

    expect(result.body.grounded).toBe(true);
    expect(result.tension).toBeCloseTo(0.5 * LOAD_MASS * GRAVITY, 0);
  });

  test('lifts off once the rope pull exceeds the weight', () => {
    let body = onGround;
    let length = 46;
    const hoistRate = -0.3;
    for (let index = 0; index < 5 * PHYSICS_RATE_HZ; index += 1) {
      const rope = { ...stillCable(length), lengthRate: hoistRate };
      body = stepLoad(body, load, SPEC.cable, rope, ground, FIXED_STEP).body;
      length += hoistRate * FIXED_STEP;
    }

    expect(body.grounded).toBe(false);
    expect(body.position.y).toBeGreaterThan(1.3);
  });

  test('snatching a load off the ground at full hoist speed overshoots the static tension', () => {
    let body = onGround;
    let length = 46.5;
    let peak = 0;
    const hoistRate = -1.2;
    for (let index = 0; index < 4 * PHYSICS_RATE_HZ; index += 1) {
      const rope = { ...stillCable(length), lengthRate: hoistRate };
      const result = stepLoad(body, load, SPEC.cable, rope, ground, FIXED_STEP);
      body = result.body;
      peak = Math.max(peak, result.tension);
      length += hoistRate * FIXED_STEP;
    }

    expect(peak).toBeGreaterThan(1.3 * LOAD_MASS * GRAVITY);
  });

  test('reports the vertical speed when an airborne load lands', () => {
    const falling: LoadBody = { position: vec3(PIVOT.x, 1.004, PIVOT.z), velocity: vec3(0, -0.8, 0), grounded: false };

    const result = stepLoad(falling, load, SPEC.cable, stillCable(47), ground, FIXED_STEP);

    expect(result.body.grounded).toBe(true);
    expect(result.body.position.y).toBe(1);
    expect(result.impactSpeed).toBeGreaterThan(0.8);
    expect(result.impactSpeed).toBeLessThan(0.9);
  });

  test('never sinks below the supporting surface', () => {
    const start: LoadBody = { position: vec3(PIVOT.x, 6, PIVOT.z), velocity: ZERO, grounded: false };
    let body = start;
    for (let index = 0; index < 3 * PHYSICS_RATE_HZ; index += 1) {
      body = stepLoad(body, load, SPEC.cable, stillCable(47), ground, FIXED_STEP).body;
      expect(body.position.y).toBeGreaterThanOrEqual(1);
    }

    expect(body.grounded).toBe(true);
  });
});

describe('swingAngle', () => {
  test('measures the rope angle from the vertical', () => {
    const body = displaced(SPEC.cable, LOAD_MASS, 20, degToRad(12));

    expect(swingAngle(body, PIVOT)).toBeCloseTo(degToRad(12), 9);
  });
});
