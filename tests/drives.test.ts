import { describe, expect, test } from 'vitest';
import { type CraneCommand, type CraneLoads, type CraneState, IDLE_COMMAND, createCrane, stepCrane } from '../src/physics/crane';
import { FIXED_STEP, GRAVITY, PHYSICS_RATE_HZ } from '../src/physics/units';
import { CONCRETE_BLOCK } from '../src/sim/payloads';
import { loadSwing } from '../src/sim/simulation';
import { SPEC } from './helpers';
import { advance, liftedAt } from './simHelpers';

const HOOK_WEIGHT = SPEC.masses.hookBlock * GRAVITY;
const QUIET: CraneLoads = { slewTorque: 0, suspendedMass: 300, payloadMass: 0, cableTension: HOOK_WEIGHT, trolleyForce: 0 };

function run(crane: CraneState, command: Partial<CraneCommand>, seconds: number, loads: Partial<CraneLoads>): CraneState {
  let current = crane;
  for (let index = 0; index < seconds * PHYSICS_RATE_HZ; index += 1) {
    current = stepCrane(current, { ...IDLE_COMMAND, ...command }, { ...QUIET, ...loads }, SPEC, FIXED_STEP);
  }
  return current;
}

describe('trolley drive force', () => {
  const start = createCrane(SPEC, 20, 20);

  test('holds its speed against a rope pull within the drive force', () => {
    const pulled = run(start, { trolley: 1 }, 6, { trolleyForce: -6000 });

    expect(pulled.trolley.speed).toBeCloseTo(SPEC.trolley.maxSpeed, 3);
  });

  test('cannot keep its speed against a pull beyond the drive force', () => {
    const pulled = run(start, { trolley: 1 }, 2, { trolleyForce: -(SPEC.trolley.driveForce + 2000) });

    expect(pulled.trolley.speed).toBeLessThan(0);
  });

  test('the brake holds a parked trolley against a pull within its capacity', () => {
    const held = run(start, {}, 10, { trolleyForce: SPEC.trolley.brakeForce - 1000 });

    expect(held.trolley.radius).toBe(20);
  });

  test('a pull beyond the brake drags a parked trolley along the jib', () => {
    const dragged = run(start, {}, 3, { trolleyForce: SPEC.trolley.brakeForce + 4000 });

    expect(dragged.trolley.radius).toBeGreaterThan(21);
  });

  test('slewing throws the trolley outwards only if the centrifugal force beats the brake', () => {
    const spinning = { ...start, slew: { ...start.slew, rate: SPEC.slew.maxRate, reference: SPEC.slew.maxRate } };

    const after = run(spinning, { slew: 1 }, 5, {});

    expect(after.trolley.radius).toBe(20);
  });
});

describe('hoist drive force', () => {
  const start = createCrane(SPEC, 12, 10);
  const rated = 4300 * GRAVITY;

  test('raises a rated load at full speed', () => {
    const raised = run(start, { hoist: 1 }, 5, { cableTension: rated, payloadMass: 4000 });

    expect(raised.hoist.rate).toBeCloseTo(-SPEC.hoist.lightSpeed, 3);
  });

  test('stalls and pays out when the rope pulls harder than the motor can', () => {
    const stalled = run(start, { hoist: 1 }, 2, { cableTension: SPEC.hoist.lightGear.force + 8000, payloadMass: 4000 });

    expect(stalled.hoist.rate).toBeGreaterThan(0);
    expect(stalled.hoist.length).toBeGreaterThan(start.hoist.length);
  });

  test('the heavy gear holds twice the pull at half the speed', () => {
    const raised = run(start, { hoist: 1 }, 5, { cableTension: 8300 * GRAVITY, payloadMass: 8000 });

    expect(raised.hoist.rate).toBeCloseTo(-SPEC.hoist.heavySpeed, 3);
  });

  test('the brake holds the maximum load with the joystick released', () => {
    const held = run(start, {}, 10, { cableTension: 8300 * GRAVITY, payloadMass: 8000 });

    expect(held.hoist.length).toBe(start.hoist.length);
  });

  test('the brake slips under a pull beyond its capacity', () => {
    const slipped = run(start, {}, 2, { cableTension: SPEC.hoist.brakeForce + 20000, payloadMass: 8000 });

    expect(slipped.hoist.length).toBeGreaterThan(start.hoist.length);
  });
});

describe('load acting back on the drives', () => {
  test('a normal swing of 3 t does not move the parked trolley', () => {
    const swinging = advance(advance(liftedAt(CONCRETE_BLOCK, 12), { trolley: 1 }, 4), {}, 3);
    const radius = swinging.crane.trolley.radius;
    let widest = 0;

    const later = advance(swinging, {}, 20, undefined, (state) => {
      widest = Math.max(widest, loadSwing(state, SPEC));
    });

    expect(widest).toBeGreaterThan(0.01);
    expect(later.crane.trolley.radius).toBe(radius);
  });
});
