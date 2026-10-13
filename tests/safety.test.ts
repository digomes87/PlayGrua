import { describe, expect, test } from 'vitest';
import { createCrane } from '../src/physics/crane';
import { OPEN_ZONES } from '../src/physics/interlocks';
import { vec3 } from '../src/physics/vec3';
import { isRopeFouled } from '../src/sim/collisions';
import { CONCRETE_BLOCK } from '../src/sim/payloads';
import { INITIAL_PROGRESS, track } from '../src/sim/progress';
import { missionById } from '../src/sim/missions';
import { scoreOf } from '../src/sim/scoring';
import { createSimulation } from '../src/sim/simulation';
import type { ForbiddenZone, Obstacle } from '../src/sim/site';
import { zoneAt, zonePermits } from '../src/sim/zoning';
import { FIXED_STEP } from '../src/physics/units';
import { SPEC } from './helpers';
import { OPEN_FIELD, advance, liftedAt } from './simHelpers';

const STREET: ForbiddenZone = { id: 'street', label: 'Street', minX: -80, maxX: 80, minZ: 48, maxZ: 80 };
const at = (radius: number, angle: number) => {
  const crane = createCrane(SPEC, radius, 20);
  return { ...crane, slew: { ...crane.slew, angle } };
};

describe('zoning', () => {
  test('far from any zone every motion is free', () => {
    expect(zonePermits(at(20, 0), [STREET], SPEC)).toEqual(OPEN_ZONES);
  });

  test('pointing at the street, trolleying out is refused within the margin and in is free', () => {
    const permits = zonePermits(at(46.5, Math.PI / 2), [STREET], SPEC);

    expect(permits.trolleyOut).toBe(false);
    expect(permits.trolleyIn).toBe(true);
  });

  test('slewing is refused only in the direction that swings the trolley into the zone', () => {
    const angle = Math.asin(47 / 55);
    const permits = zonePermits(at(55, angle), [STREET], SPEC);

    expect(permits.slewPositive).toBe(false);
    expect(permits.slewNegative).toBe(true);
  });

  test('a trolley already inside is left free to drive out', () => {
    const inside = at(55, Math.PI / 2);

    expect(zoneAt([STREET], vec3(0, 47, 55))).toBe(STREET);
    expect(zonePermits(inside, [STREET], SPEC)).toEqual(OPEN_ZONES);
  });

  test('in the simulation the trolley stops short of the street however long the joystick is held', () => {
    const config = { ...OPEN_FIELD, site: { obstacles: [], zones: [STREET] } };
    const start = createSimulation(config, { radius: 30, hookHeight: 30, slewAngle: Math.PI / 2, groundLoads: [] });

    const pushed = advance(start, { trolley: 1 }, 60, config);

    expect(pushed.crane.trolley.radius).toBeGreaterThan(44);
    expect(pushed.crane.trolley.radius).toBeLessThan(48);
    expect(pushed.crane.trolley.speed).toBe(0);
  });
});

describe('LMI approach slowdown', () => {
  test('past 90% the trolley creeps out and reaches the cutoff without overshooting into overload', () => {
    let fastestAboveWarning = 0;
    let peak = 0;
    advance(liftedAt(CONCRETE_BLOCK, 12), { trolley: 1 }, 120, OPEN_FIELD, (state) => {
      peak = Math.max(peak, state.lmi.utilization);
      if (state.lmi.utilization > 0.97) fastestAboveWarning = Math.max(fastestAboveWarning, state.crane.trolley.speed);
    });

    expect(fastestAboveWarning).toBeLessThan(0.35);
    expect(peak).toBeGreaterThanOrEqual(1);
    expect(peak).toBeLessThan(1.05);
  });
});

describe('rope against the structure', () => {
  const tower: Obstacle = { id: 'tower', kind: 'building', minX: 10, maxX: 20, minZ: -5, maxZ: 5, height: 30 };

  test('a rope hanging beside the building is clear', () => {
    expect(isRopeFouled([tower], vec3(25, 47, 0), vec3(25, 5, 0))).toBe(false);
  });

  test('a hook resting on the roof is clear', () => {
    expect(isRopeFouled([tower], vec3(15, 47, 0), vec3(15, 30.6, 0))).toBe(false);
  });

  test('a load swung in under the roof line with the trolley above the roof fouls the rope', () => {
    expect(isRopeFouled([tower], vec3(14, 47, 0), vec3(22, 8, 0))).toBe(true);
  });

  test('a rope passing the corner outside the plan is clear', () => {
    expect(isRopeFouled([tower], vec3(22, 47, 6), vec3(24, 10, 8))).toBe(false);
  });

  test('each contact is counted once and costs points like a collision', () => {
    const mission = missionById('basic');
    const state = createSimulation({ ...OPEN_FIELD }, { radius: 20, hookHeight: 20, slewAngle: 0, groundLoads: [] });
    const fouled = { touchdownSpeed: 0, bumpSpeed: 0, ropeFouled: true };
    const clear = { ...fouled, ropeFouled: false };

    const first = track(INITIAL_PROGRESS, mission, state, fouled, SPEC, FIXED_STEP);
    const held = track(first, mission, state, fouled, SPEC, FIXED_STEP);
    const again = track(track(held, mission, state, clear, SPEC, FIXED_STEP), mission, state, fouled, SPEC, FIXED_STEP);
    const done = { ...again, outcome: 'success' as const };

    expect(held.ropeContacts).toBe(1);
    expect(again.ropeContacts).toBe(2);
    expect(scoreOf(done, mission)).toBeLessThan(scoreOf({ ...done, ropeContacts: 0 }, mission));
  });
});
