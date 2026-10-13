import { describe, expect, test } from 'vitest';
import { approachSpeed, rampToward } from '../src/physics/actuators';
import {
  type CraneCommand,
  type CraneLoads,
  type CraneState,
  IDLE_COMMAND,
  createCrane,
  hoistSpeedLimit,
  stepCrane,
  structureInertia,
  totalSlewInertia,
  trolleyPosition,
} from '../src/physics/crane';
import { FIXED_STEP, GRAVITY, PHYSICS_RATE_HZ, rpmToRadPerSecond } from '../src/physics/units';
import { SPEC } from './helpers';

const HOOK_ONLY: CraneLoads = {
  slewTorque: 0,
  suspendedMass: SPEC.masses.hookBlock,
  payloadMass: 0,
  cableTension: SPEC.masses.hookBlock * GRAVITY,
  trolleyForce: 0,
};

function run(crane: CraneState, command: CraneCommand, seconds: number, loads: CraneLoads = HOOK_ONLY): CraneState {
  let current = crane;
  for (let index = 0; index < seconds * PHYSICS_RATE_HZ; index += 1) {
    current = stepCrane(current, command, loads, SPEC, FIXED_STEP);
  }
  return current;
}

/** Quasi-static rope reaction of a load that follows the jib: -m r² α, lagged by one step. */
function slewWithLoad(radius: number, suspendedMass: number, seconds: number): CraneState {
  let crane = createCrane(SPEC, radius, 20);
  let torque = 0;
  for (let index = 0; index < seconds * PHYSICS_RATE_HZ; index += 1) {
    const loads = { ...HOOK_ONLY, suspendedMass, slewTorque: torque };
    const next = stepCrane(crane, { ...IDLE_COMMAND, slew: 1 }, loads, SPEC, FIXED_STEP);
    const acceleration = (next.slew.rate - crane.slew.rate) / FIXED_STEP;
    torque = -suspendedMass * radius ** 2 * acceleration;
    crane = next;
  }
  return crane;
}

describe('drive ramps', () => {
  test('accelerates and decelerates at different rates', () => {
    expect(rampToward(0, 1, 0.4, 0.5, 1)).toBeCloseTo(0.4, 9);
    expect(rampToward(1, 0, 0.4, 0.5, 1)).toBeCloseTo(0.5, 9);
  });

  test('lands exactly on the target', () => {
    expect(rampToward(0.01, 0, 0.4, 0.5, 1)).toBe(0);
  });

  test('approach speed vanishes at the limit', () => {
    expect(approachSpeed(0, 0.5)).toBe(0);
    expect(approachSpeed(-1, 0.5)).toBe(0);
    expect(approachSpeed(4, 0.5)).toBeGreaterThan(1);
  });
});

describe('trolley', () => {
  test('ramps up to full speed instead of jumping', () => {
    const start = createCrane(SPEC, 20, 20);

    const early = run(start, { ...IDLE_COMMAND, trolley: 1 }, 1);
    const late = run(start, { ...IDLE_COMMAND, trolley: 1 }, 5);

    expect(early.trolley.speed).toBeCloseTo(SPEC.trolley.acceleration, 2);
    expect(late.trolley.speed).toBeCloseTo(SPEC.trolley.maxSpeed, 6);
  });

  test('coasts down on its ramp after the joystick is released', () => {
    const moving = run(createCrane(SPEC, 20, 20), { ...IDLE_COMMAND, trolley: 1 }, 5);

    const justReleased = run(moving, IDLE_COMMAND, 1);
    const stopped = run(moving, IDLE_COMMAND, 3);

    expect(justReleased.trolley.speed).toBeCloseTo(SPEC.trolley.maxSpeed - SPEC.trolley.deceleration, 2);
    expect(stopped.trolley.speed).toBe(0);
    expect(stopped.trolley.radius).toBeGreaterThan(moving.trolley.radius + 0.9);
  });

  test('stops at the outer and inner limits without overshooting', () => {
    const outer = run(createCrane(SPEC, 50, 20), { ...IDLE_COMMAND, trolley: 1 }, 40);
    const inner = run(createCrane(SPEC, 10, 20), { ...IDLE_COMMAND, trolley: -1 }, 40);

    expect(outer.trolley.radius).toBeCloseTo(SPEC.geometry.maxRadius, 2);
    expect(outer.trolley.radius).toBeLessThanOrEqual(SPEC.geometry.maxRadius);
    expect(Math.abs(outer.trolley.speed)).toBeLessThan(0.02);
    expect(inner.trolley.radius).toBeCloseTo(SPEC.geometry.minRadius, 2);
    expect(inner.trolley.radius).toBeGreaterThanOrEqual(SPEC.geometry.minRadius);
  });

  test('fine mode scales the speed down', () => {
    const fine = run(createCrane(SPEC, 20, 20), { ...IDLE_COMMAND, trolley: 1, fine: true }, 5);

    expect(fine.trolley.speed).toBeCloseTo(SPEC.trolley.maxSpeed * SPEC.fineControlFactor, 6);
  });
});

describe('hoist', () => {
  test('raising shortens the rope at up to 1.2 m/s with a light load', () => {
    const raised = run(createCrane(SPEC, 20, 10), { ...IDLE_COMMAND, hoist: 1 }, 5);

    expect(raised.hoist.rate).toBeCloseTo(-SPEC.hoist.lightSpeed, 6);
    expect(raised.hoist.length).toBeLessThan(37);
  });

  test('drops to the slow gear above 4 t', () => {
    expect(hoistSpeedLimit(SPEC, 4000)).toBe(1.2);
    expect(hoistSpeedLimit(SPEC, 4001)).toBe(0.6);

    const heavy = run(createCrane(SPEC, 10, 10), { ...IDLE_COMMAND, hoist: 1 }, 5, { ...HOOK_ONLY, payloadMass: 5000 });

    expect(heavy.hoist.rate).toBeCloseTo(-SPEC.hoist.heavySpeed, 6);
  });

  test('stops at the maximum hook height', () => {
    const top = run(createCrane(SPEC, 20, 40), { ...IDLE_COMMAND, hoist: 1 }, 30);

    expect(SPEC.geometry.trolleyHeight - top.hoist.length).toBeCloseTo(SPEC.geometry.maxHookHeight, 2);
    expect(top.hoist.length).toBeGreaterThanOrEqual(SPEC.geometry.trolleyHeight - SPEC.geometry.maxHookHeight);
  });

  test('the slack-rope switch refuses to pay out more rope', () => {
    const start = createCrane(SPEC, 20, 5);

    const slack = run(start, { ...IDLE_COMMAND, hoist: -1 }, 5, { ...HOOK_ONLY, cableTension: 0 });

    expect(slack.hoist.length).toBe(start.hoist.length);
  });

  test('the slack-rope switch still allows raising', () => {
    const start = createCrane(SPEC, 20, 5);

    const raised = run(start, { ...IDLE_COMMAND, hoist: 1 }, 2, { ...HOOK_ONLY, cableTension: 0 });

    expect(raised.hoist.length).toBeLessThan(start.hoist.length);
  });
});

describe('slew', () => {
  test('inertia comes from the masses and grows with trolley radius and load', () => {
    const jibOnly = (SPEC.masses.jib * SPEC.geometry.jibLength ** 2) / 3;

    expect(structureInertia(SPEC, 0)).toBeGreaterThan(jibOnly);
    expect(structureInertia(SPEC, 60)).toBeGreaterThan(structureInertia(SPEC, 10));
    expect(totalSlewInertia(SPEC, 60, 1900) - structureInertia(SPEC, 60)).toBeCloseTo(1900 * 3600, 3);
  });

  test('reaches 0.8 rpm and no more', () => {
    const turning = run(createCrane(SPEC, 10, 20), { ...IDLE_COMMAND, slew: 1 }, 30);

    expect(turning.slew.rate).toBeCloseTo(rpmToRadPerSecond(0.8), 4);
  });

  test('does not stop instantly when the command is released', () => {
    const turning = run(createCrane(SPEC, 10, 20), { ...IDLE_COMMAND, slew: 1 }, 30);

    const justReleased = run(turning, IDLE_COMMAND, 1);
    const stopped = run(turning, IDLE_COMMAND, 10);

    expect(justReleased.slew.rate).toBeGreaterThan(0.5 * turning.slew.rate);
    expect(stopped.slew.driveRate).toBeCloseTo(0, 12);
    expect(Math.abs(stopped.slew.rate)).toBeLessThan(0.1 * turning.slew.rate);
    expect(stopped.slew.angle).toBeGreaterThan(turning.slew.angle);
  });

  test('accelerates more slowly with a rated load at the jib tip', () => {
    const light = slewWithLoad(10, SPEC.masses.hookBlock, 5);
    const heavy = slewWithLoad(60, 1900, 5);

    expect(heavy.slew.rate).toBeLessThan(0.85 * light.slew.rate);
  });

  test('the holding brake resists moderate wind torque', () => {
    const held = run(createCrane(SPEC, 30, 20), IDLE_COMMAND, 20, { ...HOOK_ONLY, slewTorque: 1.0e5 });

    expect(held.slew.driveRate).toBeCloseTo(0, 12);
    expect(held.slew.angle).toBeGreaterThan(0);
    expect(held.slew.angle).toBeLessThan(2 * (1.0e5 / SPEC.slew.torsionalStiffness));
  });

  test('the holding brake slips when the torque exceeds its capacity', () => {
    const slipped = run(createCrane(SPEC, 30, 20), IDLE_COMMAND, 20, { ...HOOK_ONLY, slewTorque: 4.0e5 });

    expect(slipped.slew.angle).toBeGreaterThan(0);
  });

  test('weathervane mode lets an external torque turn the jib', () => {
    const free = run(createCrane(SPEC, 30, 20), { ...IDLE_COMMAND, weathervane: true }, 20, {
      ...HOOK_ONLY,
      slewTorque: 1.0e5,
    });

    expect(free.slew.angle).toBeGreaterThan(0.5);
  });
});

describe('emergency stop', () => {
  test('brings every axis to rest on the emergency ramps, ignoring the joysticks', () => {
    const full = { ...IDLE_COMMAND, slew: 1, trolley: 1, hoist: 1 };
    const moving = run(createCrane(SPEC, 20, 10), full, 20);

    const stopped = run(moving, { ...full, emergencyStop: true }, 6);

    expect(stopped.slew.driveRate).toBeCloseTo(0, 12);
    expect(Math.abs(stopped.slew.rate)).toBeLessThan(0.01);
    expect(stopped.trolley.speed).toBe(0);
    expect(stopped.hoist.rate).toBe(0);
  });

  test('stops the trolley faster than the normal ramp', () => {
    const moving = run(createCrane(SPEC, 20, 10), { ...IDLE_COMMAND, trolley: 1 }, 5);

    const normal = run(moving, IDLE_COMMAND, 5);
    const emergency = run(moving, { ...IDLE_COMMAND, emergencyStop: true }, 5);

    expect(emergency.trolley.radius).toBeLessThan(normal.trolley.radius);
  });
});

describe('geometry', () => {
  test('the suspension point follows radius and slew angle', () => {
    const crane = createCrane(SPEC, 30, 20);
    const quarterTurn = { ...crane, slew: { ...crane.slew, angle: Math.PI / 2 } };

    const position = trolleyPosition(quarterTurn, SPEC);

    expect(position.x).toBeCloseTo(0, 9);
    expect(position.y).toBe(SPEC.geometry.trolleyHeight);
    expect(position.z).toBeCloseTo(30, 9);
  });
});

describe('torsional flexibility of tower and jib', () => {
  const start = createCrane(SPEC, 30, 20);
  const steps = (seconds: number): number => seconds * PHYSICS_RATE_HZ;

  test('the jib lags the drive while accelerating and catches up at constant speed', () => {
    const accelerating = run(start, { ...IDLE_COMMAND, slew: 1 }, 3);
    const cruising = run(start, { ...IDLE_COMMAND, slew: 1 }, 40);

    expect(accelerating.slew.twist).toBeGreaterThan(0.0005);
    expect(Math.abs(cruising.slew.twist)).toBeLessThan(0.0002);
    expect(cruising.slew.rate).toBeCloseTo(cruising.slew.driveRate, 4);
  });

  test('after the brake closes the jib rings at the frequency of its inertia on the tower stiffness', () => {
    let crane = run(run(start, { ...IDLE_COMMAND, slew: 1 }, 20), IDLE_COMMAND, 6);
    const crossings: number[] = [];
    let previous = crane.slew.rate;
    for (let index = 1; index <= steps(20); index += 1) {
      crane = stepCrane(crane, IDLE_COMMAND, HOOK_ONLY, SPEC, FIXED_STEP);
      if (previous < 0 && crane.slew.rate >= 0) crossings.push(index * FIXED_STEP);
      previous = crane.slew.rate;
    }
    const period = (crossings[crossings.length - 1]! - crossings[0]!) / (crossings.length - 1);
    const expected = 2 * Math.PI * Math.sqrt(structureInertia(SPEC, 30) / SPEC.slew.torsionalStiffness);

    expect(crane.slew.driveRate).toBeCloseTo(0, 12);
    expect(crossings.length).toBeGreaterThan(3);
    expect(Math.abs(period - expected) / expected).toBeLessThan(0.02);
  });

  test('the ringing dies out', () => {
    const stopped = run(run(start, { ...IDLE_COMMAND, slew: 1 }, 20), IDLE_COMMAND, 6);
    const later = run(stopped, IDLE_COMMAND, 60);
    const energy = (crane: CraneState): number =>
      0.5 * structureInertia(SPEC, 30) * crane.slew.rate ** 2 + 0.5 * SPEC.slew.torsionalStiffness * crane.slew.twist ** 2;

    expect(energy(later)).toBeLessThan(0.01 * energy(stopped));
  });

  test('a steady torque on the jib winds it up by torque over stiffness against the brake', () => {
    const held = run(start, IDLE_COMMAND, 120, { ...HOOK_ONLY, slewTorque: 1.0e5 });

    expect(held.slew.angle).toBeCloseTo(1.0e5 / SPEC.slew.torsionalStiffness, 5);
    expect(held.slew.twist).toBeCloseTo(-1.0e5 / SPEC.slew.torsionalStiffness, 5);
  });
});
