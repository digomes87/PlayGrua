import { describe, expect, test } from 'vitest';
import { structureInertia } from '../src/physics/crane';
import { type LoadBody, cableStiffness, cableTension, stepLoad } from '../src/physics/pendulum';
import { FIXED_STEP, GRAVITY, degToRad } from '../src/physics/units';
import { ZERO, add, scale, vec3 } from '../src/physics/vec3';
import { supportHeightBelow } from '../src/sim/collisions';
import { missionById } from '../src/sim/missions';
import { CONCRETE_BLOCK, REBAR_BUNDLE } from '../src/sim/payloads';
import { INITIAL_PROGRESS, judgeRelease } from '../src/sim/progress';
import { unrig } from '../src/sim/rigging';
import type { SimulationState } from '../src/sim/simulation';
import type { Obstacle } from '../src/sim/site';
import { PIVOT, SPEC, stillCable } from './helpers';
import { OPEN_FIELD, advance, liftedAt, slungAt } from './simHelpers';

/** No dissipation and no aerodynamics, so the slewing part and the load form a closed system. */
const FRICTIONLESS = {
  ...OPEN_FIELD,
  spec: {
    ...SPEC,
    aero: [],
    slew: { ...SPEC.slew, freeFriction: 0 },
    cable: { ...SPEC.cable, dampingRatio: 0, swingDamping: 0, slingDampingRatio: 0, swivelDamping: 0 },
  },
};

const spin = (mass: number, body: LoadBody): number =>
  mass * (body.position.x * body.velocity.z - body.position.z * body.velocity.x);

/** Angular momentum about the tower axis, positive in the direction of increasing slew angle. */
function angularMomentum(state: SimulationState): number {
  const cargo = state.cargo === null ? 0 : spin(state.cargo.payload.mass, state.cargo.body);
  const jib = structureInertia(SPEC, state.crane.trolley.radius) * state.crane.slew.rate;
  return jib + spin(SPEC.masses.hookBlock, state.body) + cargo;
}

/** The lifted payload given a sideways shove across the jib. */
function shoved(state: SimulationState): SimulationState {
  const tangent = vec3(-Math.sin(state.crane.slew.angle), 0, Math.cos(state.crane.slew.angle));
  const cargo = state.cargo!;
  const body = { ...cargo.body, velocity: add(cargo.body.velocity, scale(tangent, 1.5)) };
  return { ...state, cargo: { ...cargo, body } };
}

describe('rope reaction on the slew axis', () => {
  const lifted = liftedAt(REBAR_BUNDLE, 30, FRICTIONLESS);

  test('a load swinging across the jib drags a free jib the same way', () => {
    const later = advance(shoved(lifted), { weathervane: true }, 6, FRICTIONLESS);

    expect(later.crane.slew.rate).toBeGreaterThan(0);
  });

  test('angular momentum of jib, hook block and payload is conserved while the jib slews freely', () => {
    const pushed = shoved(lifted);
    const initial = angularMomentum(pushed);

    let worst = 0;
    advance(pushed, { weathervane: true }, 30, FRICTIONLESS, (state) => {
      worst = Math.max(worst, Math.abs(angularMomentum(state) - initial));
    });

    expect(initial).toBeGreaterThan(5e4);
    expect(worst / initial).toBeLessThan(0.01);
  });
});

describe('rope stiffness', () => {
  test('ignores the rigid hook-to-centre link: only rope stretches', () => {
    const body: LoadBody = { position: vec3(PIVOT.x, PIVOT.y - 13.05, PIVOT.z), velocity: ZERO, grounded: false };
    const ropeOnly = { ...stillCable(10), pivot: vec3(PIVOT.x, PIVOT.y - 3, PIVOT.z) };
    const withLink = { ...stillCable(13), link: 3 };

    const expected = cableStiffness(SPEC.cable, 10) * 0.05;

    expect(cableTension(SPEC.cable, 2300, withLink, body)).toBeCloseTo(expected, 3);
    expect(cableTension(SPEC.cable, 2300, ropeOnly, body)).toBeCloseTo(expected, 3);
  });
});

describe('support under the centre of gravity', () => {
  const slab: Obstacle = { id: 'slab', kind: 'building', minX: 20, maxX: 30, minZ: -5, maxZ: 5, height: 10 };
  const wide = { halfWidth: 1.65, hangDepth: 1 };
  const above = (x: number): LoadBody => ({ position: vec3(x, 11, 0), velocity: ZERO, grounded: false });

  test('a load whose centre overhangs the edge is not held up by the slab', () => {
    expect(supportHeightBelow([slab], above(19.5), wide)).toBe(0);
  });

  test('a load whose centre is over the slab is supported even with part of it overhanging', () => {
    expect(supportHeightBelow([slab], above(20.5), wide)).toBe(10);
  });
});

describe('releasing the hook', () => {
  test('neither the hook block nor the payload moves when the slings are taken off', () => {
    const hookOnTop = advance(slungAt(CONCRETE_BLOCK, 12), { hoist: -1 }, 4);
    const released = { ...hookOnTop, ...unrig(hookOnTop) };

    const settled = advance(released, {}, 2);

    expect(released.body).toBe(hookOnTop.body);
    expect(released.groundLoads[0]!.position.y).toBeCloseTo(0, 9);
    expect(Math.hypot(settled.body.position.x - 12, settled.body.position.z)).toBeLessThan(0.05);
  });
});

describe('precision verdict', () => {
  const precision = missionById('precision');
  const inZone = { ...precision.loads[0]!, position: vec3(-14, 0, 14) };

  test('a payload that was never lifted and landed cannot pass the swing check', () => {
    const verdict = judgeRelease(INITIAL_PROGRESS, precision, inZone);

    expect(verdict.outcome).toBe('running');
  });

  test('a calm recorded touchdown passes', () => {
    const verdict = judgeRelease({ ...INITIAL_PROGRESS, touchdownSwing: degToRad(0.5) }, precision, inZone);

    expect(verdict.outcome).toBe('success');
  });
});

describe('drag on a sliding load', () => {
  test('a load sliding with the wind feels no air force and coasts on friction alone', () => {
    const load = { mass: 800, dragArea: 15, hangDepth: 1 };
    const wind = vec3(6, 0, 0);
    const sliding: LoadBody = { position: vec3(PIVOT.x, 1, PIVOT.z), velocity: wind, grounded: true };
    const ground = { windVelocity: wind, supportHeight: 0, friction: SPEC.groundFriction };

    const next = stepLoad(sliding, load, SPEC.cable, stillCable(47), ground, FIXED_STEP).body;

    expect(next.velocity.x).toBeCloseTo(6 - SPEC.groundFriction.kinetic * GRAVITY * FIXED_STEP, 9);
  });
});
