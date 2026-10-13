import { describe, expect, test } from 'vitest';
import { stepTandem } from '../src/physics/tandem';
import { FIXED_STEP, PHYSICS_RATE_HZ, degToRad, kmhToMs } from '../src/physics/units';
import { ZERO, vec3 } from '../src/physics/vec3';
import { CALM } from '../src/physics/wind';
import { type PlaceGoal, missionById } from '../src/sim/missions';
import { FORMWORK_PANEL } from '../src/sim/payloads';
import { Replay } from '../src/sim/replay';
import { toggleTagLine } from '../src/sim/rigging';
import { Session } from '../src/sim/session';
import { type SimulationState, heldTagLine } from '../src/sim/simulation';
import { DEFAULT_SITE } from '../src/sim/site';
import { hoistTo, hover, pickUp, setDown, wait } from './autopilot';
import { PIVOT, SPEC, stillCable } from './helpers';
import { OPEN_FIELD, advance, liftedAt } from './simHelpers';

const HOOK = { mass: 300, dragArea: 0.3, hangDepth: 0.6 };
const PANEL = { mass: 600, size: vec3(0.3, 3, 4), dragCoefficient: 1.3, slingLength: 4 };

/** Panel on 20 m of rope in a steady wind; returns the widest heading and sideways sway after settling. */
function hang(windSpeed: number, isHeld: boolean, startYaw: number, heldHeading = 0): { yaw: number; sway: number } {
  let hook = { position: vec3(PIVOT.x, PIVOT.y - 20.06, PIVOT.z), velocity: ZERO, grounded: false };
  let cargo = { body: { position: vec3(PIVOT.x, PIVOT.y - 24.07, PIVOT.z), velocity: ZERO, grounded: false }, yaw: startYaw, yawRate: 0 };
  const wind = vec3(windSpeed, 0, 0);
  const surroundings = {
    hookWind: wind,
    cargoWind: wind,
    hookSupport: -1000,
    cargoSupport: -1000,
    friction: SPEC.groundFriction,
    jibHeading: 0,
    tagLine: isHeld ? { spec: SPEC.tagLine, heading: heldHeading } : null,
  };
  let yaw = 0;
  let sway = 0;
  for (let index = 0; index < 400 * PHYSICS_RATE_HZ; index += 1) {
    const next = stepTandem(hook, cargo, HOOK, PANEL, SPEC.cable, stillCable(20), surroundings, FIXED_STEP);
    hook = next.hook;
    cargo = next.cargo;
    if (index < 60 * PHYSICS_RATE_HZ) continue;
    yaw = Math.max(yaw, Math.abs(cargo.yaw - heldHeading));
    sway = Math.max(sway, Math.abs(cargo.body.position.z - PIVOT.z));
  }
  return { yaw, sway };
}

describe('tag lines on a panel in wind', () => {
  test('left free in a 29 km/h wind the panel turns right round and swings wide', () => {
    const free = hang(8, false, 0.2);

    expect(free.yaw).toBeGreaterThan(Math.PI);
    expect(free.sway).toBeGreaterThan(3);
  });

  test('held by the riggers the same panel keeps its heading within 5° and barely sways', () => {
    const held = hang(8, true, 0.2);

    expect(held.yaw).toBeLessThan(degToRad(5));
    expect(held.sway).toBeLessThan(0.5);
  });

  test('the riggers bring a panel that is 30° off back to the heading they hold', () => {
    const held = hang(6, true, degToRad(30));

    expect(held.yaw).toBeLessThan(degToRad(3));
  });

  test('a rigger cannot pull harder than a person: edge-on to a gale the panel still gets away', () => {
    const edgeOn = degToRad(70);

    const breeze = hang(4, true, edgeOn, edgeOn);
    const gale = hang(kmhToMs(70), true, edgeOn, edgeOn);

    expect(breeze.yaw).toBeLessThan(degToRad(10));
    expect(gale.yaw).toBeGreaterThan(degToRad(30));
  });
});

describe('tag lines in the simulation', () => {
  const steady = { ...CALM, meanSpeed: 8, meanDirection: Math.PI / 2, peakSpeed: 8 };
  const windy = { ...OPEN_FIELD, wind: steady };
  const widestTurn = (state: SimulationState, seconds: number): number => {
    const start = state.cargo!.yaw;
    let widest = 0;
    advance(state, {}, seconds, windy, (current) => {
      widest = Math.max(widest, Math.abs(current.cargo!.yaw - start));
    });
    return widest;
  };

  test('taking up the lines fixes the heading the payload has at that moment', () => {
    const lifted = liftedAt(FORMWORK_PANEL, 20, windy);
    const held = { ...lifted, ...toggleTagLine(lifted) };

    expect(held.cargo!.tagHeading).toBe(lifted.cargo!.yaw);
    expect({ ...held, ...toggleTagLine(held) }.cargo!.tagHeading).toBeNull();
  });

  test('a held panel turns far less than a free one over three minutes of wind', () => {
    const lifted = liftedAt(FORMWORK_PANEL, 20, windy);
    const held = { ...lifted, ...toggleTagLine(lifted) };

    expect(widestTurn(held, 180)).toBeLessThan(0.25 * widestTurn(lifted, 180));
  });

  test('the lines stop acting once the payload is higher than they reach', () => {
    const lifted = liftedAt(FORMWORK_PANEL, 20, windy);
    const cargo = { ...lifted.cargo!, tagHeading: 0 };
    const high = { ...cargo, body: { ...cargo.body, position: vec3(20, SPEC.tagLine.reach + 5, 0) } };

    expect(heldTagLine(cargo, 0, SPEC)).not.toBeNull();
    expect(heldTagLine(high, 0, SPEC)).toBeNull();
    expect(heldTagLine(high, 6, SPEC)).not.toBeNull();
  });

  test('with nothing on the hook there are no lines to take up', () => {
    const session = new Session(missionById('free'), SPEC, DEFAULT_SITE);

    expect(session.toggleTagLine()).toBe(false);
    expect(session.recording.tagLineAt).toEqual([]);
  });
});

describe('wind mission with tag lines', () => {
  test('the pilot lands the panel with the riggers holding it, and the replay matches', () => {
    const session = new Session(missionById('wind'), SPEC, DEFAULT_SITE);
    const goal = session.mission.goal as PlaceGoal;
    pickUp(session, session.mission.loads[0]!.position);
    expect(session.toggleTagLine()).toBe(true);
    hoistTo(session, 16);
    hover(session, { target: goal.zone.center, tolerance: 1, authority: 1 });
    hoistTo(session, goal.zone.center.y + session.state.cargo!.slingLength + 1.5 + 2);
    wait(session, 10);
    setDown(session, { target: goal.zone.center, tolerance: 0.8, authority: 0.25 });

    const replay = new Replay(session.mission, SPEC, DEFAULT_SITE, session.recording);
    replay.advance(session.recording.steps);

    expect(session.progress.outcome).toBe('success');
    expect(session.progress.elapsed).toBeLessThan(400);
    expect(replay.session.state).toEqual(session.state);
  });
});

describe('numerical check of the free panel', () => {
  /** Heading and sideways offset of the free panel after `seconds` at a given physics rate. */
  function after(seconds: number, rate: number): { yaw: number; offset: number } {
    let hook = { position: vec3(PIVOT.x, PIVOT.y - 20.06, PIVOT.z), velocity: ZERO, grounded: false };
    let cargo = { body: { position: vec3(PIVOT.x, PIVOT.y - 24.07, PIVOT.z), velocity: ZERO, grounded: false }, yaw: 0.2, yawRate: 0 };
    const wind = vec3(6, 0, 0);
    const surroundings = { hookWind: wind, cargoWind: wind, hookSupport: -1000, cargoSupport: -1000, friction: SPEC.groundFriction, jibHeading: 0, tagLine: null };
    for (let index = 0; index < seconds * rate; index += 1) {
      const next = stepTandem(hook, cargo, HOOK, PANEL, SPEC.cable, stillCable(20), surroundings, 1 / rate);
      hook = next.hook;
      cargo = next.cargo;
    }
    return { yaw: cargo.yaw, offset: cargo.body.position.z - PIVOT.z };
  }

  test('halving and quartering the time step gives the same motion while it is still regular', () => {
    const coarse = after(90, 120);
    const fine = after(90, 240);
    const finest = after(90, 480);

    expect(Math.abs(coarse.yaw - finest.yaw)).toBeLessThan(0.01);
    expect(Math.abs(fine.yaw - finest.yaw)).toBeLessThan(0.002);
    expect(Math.abs(coarse.offset - finest.offset)).toBeLessThan(0.02);
  });
});
