import { describe, expect, test } from 'vitest';
import { radToDeg } from '../src/physics/units';
import { vec3 } from '../src/physics/vec3';
import { type MissionId, type PlaceGoal, missionById } from '../src/sim/missions';
import { scoreOf } from '../src/sim/scoring';
import { Session } from '../src/sim/session';
import { DEFAULT_SITE } from '../src/sim/site';
import { hookPoint } from '../src/sim/simulation';
import { hoistTo, hover, pickUp, setDown, wait } from './autopilot';
import { SPEC } from './helpers';

interface Flight {
  /** Hook height used to carry the load over the site. */
  readonly travelHeight: number;
  /** Gap between the payload underside and the landing surface where the final approach starts. */
  readonly approachGap: number;
  readonly tolerance: number;
}

/** Hook point down to the underside of the slung payload. */
const slingDepth = (session: Session): number => {
  const cargo = session.state.cargo;
  return cargo === null ? 0 : cargo.slingLength + cargo.payload.size.y / 2;
};

/** Picks the mission payload, carries it over the zone and lands it there. */
function fly(id: MissionId, flight: Flight): Session {
  const session = new Session(missionById(id), SPEC, DEFAULT_SITE);
  const goal = session.mission.goal as PlaceGoal;
  const load = session.mission.loads[0]!;
  pickUp(session, load.position);
  hoistTo(session, flight.travelHeight);
  hover(session, { target: goal.zone.center, tolerance: 1, authority: 1 });
  hoistTo(session, goal.zone.center.y + slingDepth(session) + flight.approachGap);
  wait(session, 20);
  hover(session, { target: goal.zone.center, tolerance: flight.tolerance, authority: 0.25 });
  setDown(session, { target: goal.zone.center, tolerance: flight.tolerance, authority: 0.25 });
  return session;
}

describe('missions played from start to finish', () => {
  test('basic lift: 2 t of rebar from 12 m radius onto the slab 30 m up', () => {
    const session = fly('basic', { travelHeight: 36, approachGap: 2, tolerance: 0.6 });
    const placed = session.state.groundLoads[0]!;

    expect(session.progress.outcome).toBe('success');
    expect(placed.position.y).toBeCloseTo(30, 6);
    expect(session.progress.collisions).toBe(0);
    expect(session.progress.cutoffs).toBe(0);
    expect(scoreOf(session.progress, session.mission)).toBeGreaterThan(500);
  });

  test('wind: the formwork panel is landed on the podium in gusts up to 40 km/h', () => {
    const session = fly('wind', { travelHeight: 16, approachGap: 2, tolerance: 0.8 });
    const placed = session.state.groundLoads[0]!;

    expect(session.progress.outcome).toBe('success');
    expect(placed.position.y).toBeCloseTo(6, 6);
    expect(radToDeg(session.progress.maxSwing)).toBeGreaterThan(2);
    expect(session.progress.collisions).toBe(0);
  });

  test('precision: the block lands inside the 0.5 m target swinging less than 2°', () => {
    const session = fly('precision', { travelHeight: 9, approachGap: 1.5, tolerance: 0.12 });
    const placed = session.state.groundLoads[0]!;
    const target = (session.mission.goal as PlaceGoal).zone.center;

    expect(session.progress.outcome).toBe('success');
    expect(Math.hypot(placed.position.x - target.x, placed.position.z - target.z)).toBeLessThan(0.5);
    expect(radToDeg(session.progress.touchdownSwing)).toBeLessThan(2);
    expect(session.progress.hardLandings).toBe(0);
  });

  test('the pilot only ever acts through the hook: an empty hook hover leaves the load alone', () => {
    const session = new Session(missionById('basic'), SPEC, DEFAULT_SITE);

    hover(session, { target: vec3(20, 0, 5), tolerance: 0.2, authority: 1 });

    expect(Math.hypot(hookPoint(session.state).x - 20, hookPoint(session.state).z - 5)).toBeLessThan(0.3);
    expect(session.state.groundLoads).toHaveLength(1);
    expect(session.progress.outcome).toBe('running');
  });
});
