import { describe, expect, test } from 'vitest';
import { capacityAt } from '../src/physics/loadChart';
import { swingAngle } from '../src/physics/pendulum';
import { trolleyPosition } from '../src/physics/crane';
import { GRAVITY, kmhToMs, radToDeg } from '../src/physics/units';
import { CALM } from '../src/physics/wind';
import { CONCRETE_BLOCK, FORMWORK_PANEL, PRECAST_BEAM, REBAR_BUNDLE } from '../src/sim/payloads';
import { canUnrig, unrig } from '../src/sim/rigging';
import { type SimulationState, createSimulation } from '../src/sim/simulation';
import { SPEC } from './helpers';
import { GUSTY, OPEN_FIELD, advance, liftedAt, slungAt } from './simHelpers';

const swingOf = (state: SimulationState): number => swingAngle(state.body, trolleyPosition(state.crane, SPEC));

const scripted = (config = { ...OPEN_FIELD, wind: GUSTY }): SimulationState => {
  const lifted = advance(slungAt(REBAR_BUNDLE, 12, config), { hoist: 1 }, 8, config);
  const slewed = advance(lifted, { slew: 1, trolley: 0.6 }, 12, config);
  const reversed = advance(slewed, { slew: -0.5, trolley: -1, hoist: -0.4, fine: true }, 7, config);
  return advance(reversed, {}, 5, config);
};

describe('determinism', () => {
  test('two runs with the same inputs and seed end in the identical state', () => {
    expect(scripted()).toEqual(scripted());
  });

  test('a different wind seed gives a different state', () => {
    const other = scripted({ ...OPEN_FIELD, wind: { ...GUSTY, seed: 7 } });

    expect(other.body.position).not.toEqual(scripted().body.position);
  });
});

describe('lifting', () => {
  test('the empty hook hangs at rest reading its own weight', () => {
    const start = createSimulation(OPEN_FIELD, { radius: 20, hookHeight: 20, slewAngle: 0, groundLoads: [] });

    const settled = advance(start, {}, 5);

    expect(settled.lmi.measuredLoad).toBeCloseTo(SPEC.masses.hookBlock, 0);
    expect(settled.body.position.y).toBeCloseTo(start.body.position.y, 3);
    expect(radToDeg(swingOf(settled))).toBeLessThan(0.01);
  });

  test('the LMI reads payload plus hook block once the load hangs', () => {
    const lifted = liftedAt(REBAR_BUNDLE, 12);

    expect(lifted.body.grounded).toBe(false);
    expect(lifted.lmi.measuredLoad).toBeCloseTo(REBAR_BUNDLE.mass + SPEC.masses.hookBlock, -1);
    expect(lifted.lmi.status).toBe('normal');
  });

  test('a load sitting on the ground weighs nothing on the hook until the rope takes it up', () => {
    const slung = advance(slungAt(REBAR_BUNDLE, 12), {}, 1);

    expect(slung.body.grounded).toBe(true);
    expect(slung.lmi.measuredLoad).toBeLessThan(SPEC.masses.hookBlock);
  });

  test('snatching a slackened rope at full speed shows a much higher peak load than a gentle lift', () => {
    const peakOf = (start: SimulationState, fine: boolean): number => {
      let peak = 0;
      advance(start, { hoist: 1, fine }, 12, OPEN_FIELD, (state) => {
        peak = Math.max(peak, state.lmi.measuredLoad);
      });
      return peak;
    };
    const staticLoad = REBAR_BUNDLE.mass + SPEC.masses.hookBlock;
    const slack = advance(slungAt(REBAR_BUNDLE, 12), { hoist: -1 }, 3);

    expect(slack.tension).toBeLessThan(0.5 * SPEC.masses.hookBlock * GRAVITY);
    const snatched = peakOf(slack, false);
    const gentle = peakOf(slungAt(REBAR_BUNDLE, 12), true);

    expect(snatched).toBeGreaterThan(1.2 * staticLoad);
    expect(gentle).toBeLessThan(1.2 * staticLoad);
    expect(snatched - gentle).toBeGreaterThan(0.08 * staticLoad);
  });
});

describe('LMI in operation', () => {
  test('refuses to lift a load heavier than the capacity at the radius', () => {
    const radius = 40;
    expect(PRECAST_BEAM.mass).toBeGreaterThan(capacityAt(SPEC.loadChart, radius));

    const attempt = advance(slungAt(PRECAST_BEAM, radius), { hoist: 1, fine: true }, 30);

    expect(attempt.body.grounded).toBe(true);
    expect(['cutoff', 'overload']).toContain(attempt.lmi.status);
    expect(attempt.crane.hoist.rate).toBe(0);
    expect(attempt.lmi.measuredLoad).toBeLessThan(PRECAST_BEAM.mass);
  });

  test('trolleying out with 3 t stops at the cutoff radius and can only come back', () => {
    let peak = 0;
    const pushed = advance(liftedAt(CONCRETE_BLOCK, 12), { trolley: 1, fine: true }, 150, OPEN_FIELD, (state) => {
      peak = Math.max(peak, state.lmi.utilization);
    });

    expect(pushed.lmi.status).toBe('cutoff');
    expect(pushed.crane.trolley.speed).toBe(0);
    expect(pushed.crane.trolley.radius).toBeGreaterThan(29);
    expect(pushed.crane.trolley.radius).toBeLessThan(33);
    expect(peak).toBeLessThan(SPEC.lmi.overload);

    const stuck = advance(pushed, { trolley: 1, hoist: 1 }, 5);
    expect(stuck.crane.trolley.radius).toBeCloseTo(pushed.crane.trolley.radius, 6);
    expect(stuck.crane.hoist.length).toBeCloseTo(pushed.crane.hoist.length, 6);

    const retreated = advance(pushed, { trolley: -1 }, 10);
    expect(retreated.crane.trolley.radius).toBeLessThan(pushed.crane.trolley.radius - 3);
    expect(retreated.lmi.status).not.toBe('cutoff');
  });

  test('lowering stays available at cutoff', () => {
    const pushed = advance(liftedAt(CONCRETE_BLOCK, 12), { trolley: 1, fine: true }, 150);

    const lowered = advance(pushed, { hoist: -1 }, 2);

    expect(lowered.crane.hoist.length).toBeGreaterThan(pushed.crane.hoist.length + 0.5);
  });
});

describe('swing', () => {
  test('starting and stopping the trolley leaves the load swinging', () => {
    let widest = 0;
    const moved = advance(liftedAt(REBAR_BUNDLE, 12), { trolley: 1 }, 6, OPEN_FIELD, (state) => {
      widest = Math.max(widest, swingOf(state));
    });
    const stopped = advance(moved, {}, 4);

    expect(radToDeg(widest)).toBeGreaterThan(1);
    expect(radToDeg(widest)).toBeLessThan(15);
    expect(Math.abs(stopped.body.velocity.x)).toBeGreaterThan(0.01);
  });

  test('slewing throws the load outwards and behind the jib', () => {
    const slewing = advance(liftedAt(REBAR_BUNDLE, 40), { slew: 1 }, 25);
    const pivot = trolleyPosition(slewing.crane, SPEC);
    const loadRadius = Math.hypot(slewing.body.position.x, slewing.body.position.z);

    expect(loadRadius).toBeGreaterThan(Math.hypot(pivot.x, pivot.z));
    expect(radToDeg(swingOf(slewing))).toBeGreaterThan(0.2);
  });

  test('hoisting a swinging load widens its swing angle as the rope shortens', () => {
    const swinging = advance(advance(liftedAt(REBAR_BUNDLE, 12), { trolley: 1 }, 4), {}, 3);
    const lateSwing = (command: { hoist: number }): number => {
      let widest = 0;
      advance(advance(swinging, command, 22), {}, 12, OPEN_FIELD, (state) => {
        widest = Math.max(widest, swingOf(state));
      });
      return widest;
    };

    expect(lateSwing({ hoist: 1 })).toBeGreaterThan(1.4 * lateSwing({ hoist: 0 }));
  });
});

describe('wind on the load', () => {
  const steadyBreeze = { ...CALM, meanSpeed: kmhToMs(40), meanDirection: Math.PI / 2, peakSpeed: kmhToMs(40) };
  const windy = { ...OPEN_FIELD, wind: steadyBreeze };
  const driftOf = (state: SimulationState): number => state.body.position.z - trolleyPosition(state.crane, SPEC).z;

  test('a large panel is pushed downwind much more than a compact block', () => {
    const panel = advance(liftedAt(FORMWORK_PANEL, 20, windy), {}, 60, windy);
    const block = advance(liftedAt(CONCRETE_BLOCK, 20, windy), {}, 60, windy);

    expect(driftOf(panel)).toBeGreaterThan(0.5);
    expect(driftOf(panel)).toBeGreaterThan(8 * driftOf(block));
  });

  test('the steady deflection matches the drag-to-weight ratio', () => {
    const panel = advance(liftedAt(FORMWORK_PANEL, 20, windy), {}, 240, windy);
    const height = panel.body.position.y;
    const speed = steadyBreeze.meanSpeed * (height / steadyBreeze.referenceHeight) ** steadyBreeze.shearExponent;
    const drag = 0.5 * 1.225 * (FORMWORK_PANEL.dragArea + 0.3) * speed ** 2;
    const expected = Math.atan(drag / ((FORMWORK_PANEL.mass + SPEC.masses.hookBlock) * GRAVITY));

    expect(swingOf(panel)).toBeCloseTo(expected, 2);
  });

  test('above 72 km/h the drives are locked but the weathervane turns the jib downwind', () => {
    const storm = { ...CALM, meanSpeed: kmhToMs(80), meanDirection: Math.PI / 2, peakSpeed: kmhToMs(80) };
    const config = { ...OPEN_FIELD, wind: storm };
    const start = createSimulation(config, { radius: 20, hookHeight: 30, slewAngle: 0, groundLoads: [] });

    const locked = advance(start, { slew: -1, trolley: 1, hoist: 1 }, 10, config);
    const released = advance(start, { weathervane: true }, 240, config);

    expect(locked.crane.slew.angle).toBe(0);
    expect(locked.crane.trolley.radius).toBe(20);
    expect(locked.crane.hoist.length).toBe(start.crane.hoist.length);
    expect(Math.abs(released.crane.slew.angle - Math.PI / 2)).toBeLessThan(0.35);
  });
});

describe('setting down', () => {
  test('a gentle landing is slow, goes slack and lets the hook be released', () => {
    const lifted = liftedAt(REBAR_BUNDLE, 12);
    let touchdown = 0;
    const landed = advance(lifted, { hoist: -1, fine: true }, 30, OPEN_FIELD, (_state, events) => {
      touchdown = Math.max(touchdown, events.touchdownSpeed);
    });

    expect(landed.body.grounded).toBe(true);
    expect(touchdown).toBeGreaterThan(0.1);
    expect(touchdown).toBeLessThan(0.5);
    expect(landed.crane.hoist.rate).toBe(0);
    expect(canUnrig(landed, landed.tension, SPEC)).toBe(true);

    const released = advance({ ...landed, ...unrig(landed, SPEC.masses.hookBlock, 0) }, {}, 3);
    expect(released.rigged).toBeNull();
    expect(released.groundLoads).toHaveLength(1);
    expect(released.groundLoads[0]!.position.y).toBeCloseTo(0, 6);
    expect(released.lmi.measuredLoad).toBeLessThan(SPEC.masses.hookBlock * 1.1);
  });

  test('lowering at full speed is reported as a hard landing', () => {
    let touchdown = 0;
    advance(liftedAt(REBAR_BUNDLE, 12), { hoist: -1 }, 15, OPEN_FIELD, (_state, events) => {
      touchdown = Math.max(touchdown, events.touchdownSpeed);
    });

    expect(touchdown).toBeGreaterThan(0.5);
  });

  test('a suspended load cannot be released', () => {
    const lifted = liftedAt(REBAR_BUNDLE, 12);

    expect(canUnrig(lifted, lifted.tension, SPEC)).toBe(false);
  });
});
