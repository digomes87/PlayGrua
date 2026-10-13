import { describe, expect, test } from 'vitest';
import { IDLE_COMMAND } from '../src/physics/crane';
import { FIXED_STEP } from '../src/physics/units';
import { type PlaceGoal, missionById } from '../src/sim/missions';
import { EMPTY_RECORDING, commandsOf, recordRigging, recordStep } from '../src/sim/recording';
import { Replay } from '../src/sim/replay';
import { Session } from '../src/sim/session';
import { DEFAULT_SITE } from '../src/sim/site';
import { hoistTo, hover, pickUp, setDown } from './autopilot';
import { SPEC } from './helpers';

const SLEW = { ...IDLE_COMMAND, slew: 1 };

describe('recording', () => {
  test('identical consecutive commands share one segment', () => {
    const recording = [IDLE_COMMAND, { ...IDLE_COMMAND }, SLEW, SLEW, IDLE_COMMAND].reduce(recordStep, EMPTY_RECORDING);

    expect(recording.steps).toBe(5);
    expect(recording.segments.map((segment) => segment.steps)).toEqual([2, 2, 1]);
    expect([...commandsOf(recording)]).toEqual([IDLE_COMMAND, IDLE_COMMAND, SLEW, SLEW, IDLE_COMMAND]);
  });

  test('rigging is logged at the step it happened', () => {
    const recording = recordRigging([SLEW, SLEW, SLEW].reduce(recordStep, EMPTY_RECORDING));

    expect(recording.riggingAt).toEqual([3]);
  });
});

describe('replay', () => {
  test('playing a recorded mission back reproduces the identical final state and result', () => {
    const live = new Session(missionById('precision'), SPEC, DEFAULT_SITE);
    const goal = live.mission.goal as PlaceGoal;
    pickUp(live, live.mission.loads[0]!.position);
    hoistTo(live, 9);
    hover(live, { target: goal.zone.center, tolerance: 0.3, authority: 1 });
    setDown(live, { target: goal.zone.center, tolerance: 0.3, authority: 0.25 });

    const replay = new Replay(live.mission, SPEC, DEFAULT_SITE, live.recording);
    replay.advance(Math.floor(live.recording.steps / 2));
    const halfway = replay.progress;
    replay.advance(live.recording.steps);

    expect(live.recording.riggingAt).toHaveLength(2);
    expect(halfway).toBeCloseTo(0.5, 2);
    expect(replay.isFinished).toBe(true);
    expect(replay.session.state).toEqual(live.state);
    expect(replay.session.progress).toEqual(live.progress);
  });

  test('a replay asked for more steps than were recorded stops at the end', () => {
    const live = new Session(missionById('free'), SPEC, DEFAULT_SITE);
    for (let index = 0; index < 240; index += 1) live.advance(FIXED_STEP, SLEW);

    const replay = new Replay(live.mission, SPEC, DEFAULT_SITE, live.recording);
    replay.advance(10_000);

    expect(replay.session.state.time).toBeCloseTo(live.state.time, 9);
    expect(replay.session.state.crane.slew.angle).toBe(live.state.crane.slew.angle);
  });
});
