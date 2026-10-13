import { describe, expect, test } from 'vitest';
import { IDLE_COMMAND } from '../src/physics/crane';
import { capacityAt } from '../src/physics/loadChart';
import { FIXED_STEP, degToRad, msToKmh } from '../src/physics/units';
import { MISSIONS, missionById } from '../src/sim/missions';
import { footprintOf } from '../src/sim/payloads';
import { INITIAL_PROGRESS, type Progress, judgeRelease, track } from '../src/sim/progress';
import { SCORING, scoreLines, scoreOf } from '../src/sim/scoring';
import { Session } from '../src/sim/session';
import { DEFAULT_SITE } from '../src/sim/site';
import { SPEC } from './helpers';

const run = (session: Session, command: Partial<typeof IDLE_COMMAND>, seconds: number): void => {
  for (let index = 0; index < seconds * 60; index += 1) session.advance(1 / 60, { ...IDLE_COMMAND, ...command });
};

const runUntil = (session: Session, command: Partial<typeof IDLE_COMMAND>, done: () => boolean, limit = 600): void => {
  for (let index = 0; index < limit * 120 && !done(); index += 1) session.advance(FIXED_STEP, { ...IDLE_COMMAND, ...command });
};

/** Drives the hook over the block of the limit mission (12 m, heading 0) and slings it. */
const pickUpBlock = (session: Session): void => {
  runUntil(session, { slew: -1, fine: true }, () => session.state.crane.slew.angle <= 0.004);
  runUntil(session, { trolley: 1, fine: true }, () => session.state.crane.trolley.radius >= 11.95);
  run(session, {}, 8);
  runUntil(session, { hoist: -1, fine: true }, () => session.canRig());
  expect(session.toggleRigging()).toBe('rigged');
};

describe('mission catalogue', () => {
  test('offers the five v1 missions', () => {
    expect(MISSIONS.map((mission) => mission.id)).toEqual(['free', 'basic', 'limit', 'wind', 'precision']);
  });

  test('every load starts within reach, under capacity and clear of the site', () => {
    for (const mission of MISSIONS) {
      for (const load of mission.loads) {
        const radius = Math.hypot(load.position.x, load.position.z);
        const half = footprintOf(load.payload);
        const blocked = DEFAULT_SITE.obstacles.some(
          (obstacle) =>
            load.position.x + half > obstacle.minX &&
            load.position.x - half < obstacle.maxX &&
            load.position.z + half > obstacle.minZ &&
            load.position.z - half < obstacle.maxZ,
        );

        expect(radius).toBeGreaterThanOrEqual(SPEC.geometry.minRadius);
        expect(load.payload.mass + SPEC.masses.hookBlock).toBeLessThan(capacityAt(SPEC.loadChart, radius));
        expect(blocked).toBe(false);
      }
    }
  });

  test('every placing zone sits on a real surface the payload may be carried to', () => {
    for (const mission of MISSIONS) {
      const goal = mission.goal;
      if (goal === null || goal.kind !== 'place') continue;
      const { center } = goal.zone;
      const radius = Math.hypot(center.x, center.z);
      const payload = mission.loads.find((load) => load.payload.id === goal.payloadId)!.payload;
      const surface = DEFAULT_SITE.obstacles
        .filter((o) => center.x > o.minX && center.x < o.maxX && center.z > o.minZ && center.z < o.maxZ)
        .reduce((top, o) => Math.max(top, o.height), 0);

      expect(surface).toBe(center.y);
      expect(radius).toBeLessThan(SPEC.geometry.maxRadius);
      expect(payload.mass + SPEC.masses.hookBlock).toBeLessThan(0.9 * capacityAt(SPEC.loadChart, radius));
    }
  });

  test('the basic mission picks at 12 m and lands on a slab 30 m up', () => {
    const basic = missionById('basic');
    const load = basic.loads[0]!;

    expect(load.payload.mass).toBe(2000);
    expect(Math.hypot(load.position.x, load.position.z)).toBe(12);
    expect(basic.goal).toMatchObject({ kind: 'place', zone: { center: { y: 30 } } });
  });

  test('the wind mission gusts up to 40 km/h and the precision target is 0.5 m at 2°', () => {
    expect(msToKmh(missionById('wind').wind.peakSpeed)).toBeCloseTo(40, 9);
    expect(missionById('precision').goal).toMatchObject({ zone: { radius: 0.5 }, maxTouchdownSwing: degToRad(2) });
  });
});

describe('mission flow', () => {
  test('the limit mission succeeds by holding 3 t at 95% without tripping the LMI', () => {
    const session = new Session(missionById('limit'), SPEC, DEFAULT_SITE);
    pickUpBlock(session);

    runUntil(session, { hoist: 1, fine: true }, () => session.state.body.position.y > 6);
    run(session, {}, 6);
    runUntil(session, { trolley: 1, fine: true }, () => session.state.lmi.utilization >= 0.95);
    run(session, {}, 12);

    expect(session.progress.cutoffs).toBe(0);
    expect(session.progress.outcome).toBe('success');
    expect(session.state.crane.trolley.radius).toBeGreaterThan(28);
    expect(scoreOf(session.progress, session.mission)).toBeGreaterThan(700);
  });

  test('the limit mission fails as soon as the LMI cuts the motion', () => {
    const session = new Session(missionById('limit'), SPEC, DEFAULT_SITE);
    pickUpBlock(session);
    runUntil(session, { hoist: 1, fine: true }, () => session.state.body.position.y > 6);

    runUntil(session, { trolley: 1 }, () => session.progress.outcome !== 'running', 200);

    expect(session.progress.outcome).toBe('failed');
    expect(session.progress.cutoffs).toBe(1);
  });

  test('releasing the payload away from the zone keeps the mission running', () => {
    const session = new Session(missionById('basic'), SPEC, DEFAULT_SITE);
    runUntil(session, { trolley: 1, slew: 1, fine: true }, () => session.state.crane.slew.angle >= 0);
    runUntil(session, { trolley: 1, fine: true }, () => session.state.crane.trolley.radius >= 12);
    run(session, {}, 5);
    runUntil(session, { hoist: -1, fine: true }, () => session.canRig());
    expect(session.toggleRigging()).toBe('rigged');
    run(session, { hoist: 1, fine: true }, 6);
    runUntil(session, { hoist: -1, fine: true }, () => session.canRelease());

    expect(session.toggleRigging()).toBe('released');
    expect(session.progress.outcome).toBe('running');
    expect(session.progress.message).toContain('Fora do alvo');
    expect(session.toggleRigging()).toBe('rigged');
  });

  test('rigging with nothing under the hook does nothing', () => {
    const session = new Session(missionById('basic'), SPEC, DEFAULT_SITE);

    expect(session.toggleRigging()).toBe('none');
  });

  test('the render pose interpolates between physics steps', () => {
    const session = new Session(missionById('free'), SPEC, DEFAULT_SITE);
    run(session, { slew: 1 }, 5);
    session.advance(1.5 * FIXED_STEP, { ...IDLE_COMMAND, slew: 1 });

    const pose = session.pose();

    expect(pose.slewAngle).toBeLessThan(session.state.crane.slew.angle);
    expect(pose.slewAngle).toBeGreaterThan(session.state.crane.slew.angle - 0.001);
  });

  test('physics advances the same simulated time at 30 and 144 fps', () => {
    const slow = new Session(missionById('free'), SPEC, DEFAULT_SITE);
    const fast = new Session(missionById('free'), SPEC, DEFAULT_SITE);
    for (let index = 0; index < 300; index += 1) slow.advance(1 / 30, { ...IDLE_COMMAND, slew: 1, trolley: 1 });
    for (let index = 0; index < 1440; index += 1) fast.advance(1 / 144, { ...IDLE_COMMAND, slew: 1, trolley: 1 });

    expect(fast.state.time).toBeCloseTo(slow.state.time, 1);
    expect(fast.state.crane.slew.angle).toBeCloseTo(slow.state.crane.slew.angle, 2);
  });
});

describe('placing verdict', () => {
  const precision = missionById('precision');
  const block = precision.loads[0]!;
  const landedAt = (x: number, z: number) => ({ ...block, position: { x, y: 0, z } });

  test('succeeds inside the 0.5 m target with a calm touchdown', () => {
    const calm: Progress = { ...INITIAL_PROGRESS, touchdownSwing: degToRad(1) };

    expect(judgeRelease(calm, precision, landedAt(-14.3, 14.2)).outcome).toBe('success');
  });

  test('keeps running outside the target', () => {
    expect(judgeRelease(INITIAL_PROGRESS, precision, landedAt(-14.6, 14)).outcome).toBe('running');
  });

  test('rejects a touchdown that was still swinging more than 2°', () => {
    const swinging: Progress = { ...INITIAL_PROGRESS, touchdownSwing: degToRad(2.5) };

    const verdict = judgeRelease(swinging, precision, landedAt(-14, 14));

    expect(verdict.outcome).toBe('running');
    expect(verdict.message).toContain('Balanço');
  });

  test('ignores a different payload', () => {
    const other = { ...landedAt(-14, 14), payload: { ...block.payload, id: 'other' } };

    expect(judgeRelease(INITIAL_PROGRESS, precision, other)).toBe(INITIAL_PROGRESS);
  });

  test('free training never ends', () => {
    expect(judgeRelease(INITIAL_PROGRESS, missionById('free'), landedAt(0, 0))).toBe(INITIAL_PROGRESS);
  });
});

describe('telemetry', () => {
  const session = new Session(missionById('free'), SPEC, DEFAULT_SITE);
  const state = session.state;
  const basic = missionById('basic');
  const quiet = { touchdownSpeed: 0, bumpSpeed: 0, ropeFouled: false };

  test('counts a collision once per contact, not once per step', () => {
    const hit = { touchdownSpeed: 0, bumpSpeed: 1, ropeFouled: false };
    const first = track(INITIAL_PROGRESS, basic, state, hit, SPEC, FIXED_STEP);
    const second = track(first, basic, state, hit, SPEC, FIXED_STEP);
    const apart = track(second, basic, state, quiet, SPEC, FIXED_STEP);
    const again = track(apart, basic, state, hit, SPEC, FIXED_STEP);

    expect(second.collisions).toBe(1);
    expect(again.collisions).toBe(2);
  });

  test('flags landings faster than 0.5 m/s as hard', () => {
    const carrying = { ...state, cargo: { payload: basic.loads[0]!.payload, slingLength: 2, body: state.body, yaw: 0, yawRate: 0 } };
    const soft = track(INITIAL_PROGRESS, basic, carrying, { touchdownSpeed: 0.3, bumpSpeed: 0, ropeFouled: false }, SPEC, FIXED_STEP);
    const hard = track(soft, basic, carrying, { touchdownSpeed: 0.8, bumpSpeed: 0, ropeFouled: false }, SPEC, FIXED_STEP);

    expect(soft.hardLandings).toBe(0);
    expect(hard.hardLandings).toBe(1);
    expect(hard.hardestLanding).toBe(0.8);
  });

  test('an attempt above 110% is a grave failure', () => {
    const overloaded = { ...state, lmi: { measuredLoad: 9000, utilization: 1.12, status: 'overload' as const } };

    const verdict = track(INITIAL_PROGRESS, basic, overloaded, quiet, SPEC, FIXED_STEP);

    expect(verdict.outcome).toBe('failed');
    expect(verdict.message).toContain('110');
  });

  test('stops counting once the mission is over', () => {
    const done: Progress = { ...INITIAL_PROGRESS, outcome: 'success' };

    expect(track(done, basic, state, quiet, SPEC, FIXED_STEP)).toBe(done);
  });
});

describe('scoring', () => {
  const basic = missionById('basic');
  const clean: Progress = { ...INITIAL_PROGRESS, outcome: 'success', elapsed: 200, peakUtilization: 0.6 };

  test('a clean run inside par scores the maximum', () => {
    expect(scoreOf(clean, basic)).toBe(SCORING.maximum);
  });

  test('an unfinished or failed run scores nothing', () => {
    expect(scoreOf({ ...clean, outcome: 'running' }, basic)).toBe(0);
    expect(scoreOf({ ...clean, outcome: 'failed' }, basic)).toBe(0);
  });

  test.each([
    ['time over par', { elapsed: 300 }],
    ['swing', { maxSwing: degToRad(8) }],
    ['a hard landing', { hardestLanding: 0.9 }],
    ['moment peaks', { peakUtilization: 0.99 }],
    ['collisions', { collisions: 2 }],
  ])('%s lowers the score', (_name, change) => {
    expect(scoreOf({ ...clean, ...change }, basic)).toBeLessThan(SCORING.maximum);
  });

  test('never goes below zero', () => {
    expect(scoreOf({ ...clean, collisions: 50 }, basic)).toBe(0);
  });

  test('the limit mission does not penalise the 95% it asks for', () => {
    const atLimit = { ...clean, elapsed: 100, peakUtilization: 0.955 };

    expect(scoreOf(atLimit, missionById('limit'))).toBe(SCORING.maximum);
    expect(scoreOf(atLimit, basic)).toBeLessThan(SCORING.maximum);
  });

  test('breaks the score down into the five criteria', () => {
    expect(scoreLines(clean, basic).map((line) => line.label)).toEqual([
      'Tempo',
      'Balanço máximo',
      'Velocidade de pouso',
      'Pico de momento',
      'Colisões e cabo em estrutura',
    ]);
  });
});
