import { describe, expect, test } from 'vitest';
import { boxAero, yawInertia } from '../src/physics/aero';
import type { CableProperties, LoadBody } from '../src/physics/pendulum';
import { type Cargo, type CargoProps, stepTandem, tandemEnergy } from '../src/physics/tandem';
import { AIR_DENSITY, FIXED_STEP, GRAVITY, PHYSICS_RATE_HZ, degToRad } from '../src/physics/units';
import { ZERO, vec3 } from '../src/physics/vec3';
import { LOSSLESS_CABLE, PIVOT, SPEC, stillCable } from './helpers';

const HOOK = { mass: 300, dragArea: 0, hangDepth: 0.6 };
const ROPE = 20;
const SLING = 4;
const FAR = -1000;

const LOSSLESS: CableProperties = { ...LOSSLESS_CABLE, slingDampingRatio: 0, swivelDamping: 0 };
const block = (mass: number, dragCoefficient = 0): CargoProps => ({
  mass,
  size: vec3(1, 1, 1),
  dragCoefficient,
  slingLength: SLING,
});
const PANEL: CargoProps = { mass: 600, size: vec3(0.3, 3, 4), dragCoefficient: 1.3, slingLength: SLING };

const air = (wind = ZERO, support = FAR) => ({
  hookWind: wind,
  cargoWind: wind,
  hookSupport: support,
  cargoSupport: support,
  friction: SPEC.groundFriction,
  jibHeading: 0,
  tagLine: null,
});

/** Statically stretched lengths of rope and slings under the hanging masses. */
function restLengths(cable: CableProperties, cargo: CargoProps): { rope: number; sling: number } {
  const ropeStiffness = 1 / ((ROPE + cable.fixedRopeLength) / cable.axialStiffness + 1 / cable.structureStiffness);
  return {
    rope: ROPE + ((HOOK.mass + cargo.mass) * GRAVITY) / ropeStiffness,
    sling: SLING + (cargo.mass * GRAVITY) / cable.slingStiffness,
  };
}

/** Both links displaced in the XY plane by the given angles from the vertical. */
function displaced(cable: CableProperties, cargo: CargoProps, ropeAngle: number, slingAngle: number, yaw = 0) {
  const lengths = restLengths(cable, cargo);
  const hookAt = vec3(PIVOT.x + lengths.rope * Math.sin(ropeAngle), PIVOT.y - lengths.rope * Math.cos(ropeAngle), PIVOT.z);
  const cargoAt = vec3(hookAt.x + lengths.sling * Math.sin(slingAngle), hookAt.y - lengths.sling * Math.cos(slingAngle), PIVOT.z);
  const hook: LoadBody = { position: hookAt, velocity: ZERO, grounded: false };
  const cargoState: Cargo = { body: { position: cargoAt, velocity: ZERO, grounded: false }, yaw, yawRate: 0 };
  return { hook, cargo: cargoState, lengths };
}

function run(
  start: { hook: LoadBody; cargo: Cargo },
  cargo: CargoProps,
  cable: CableProperties,
  seconds: number,
  surroundings = air(),
  observe: (state: { hook: LoadBody; cargo: Cargo }, step: number) => void = () => undefined,
) {
  let state = { hook: start.hook, cargo: start.cargo };
  for (let index = 1; index <= seconds * PHYSICS_RATE_HZ; index += 1) {
    const next = stepTandem(state.hook, state.cargo, HOOK, cargo, cable, stillCable(ROPE), surroundings, FIXED_STEP);
    state = { hook: next.hook, cargo: next.cargo };
    observe(state, index);
  }
  return state;
}

/** Small-oscillation frequencies of a double pendulum, slow mode first. */
function modes(upperMass: number, lowerMass: number, upper: number, lower: number): { slow: number; fast: number } {
  const total = upperMass + lowerMass;
  const sum = total * (upper + lower);
  const root = Math.sqrt(total * (total * (upper + lower) ** 2 - 4 * upperMass * upper * lower));
  const scale = GRAVITY / (2 * upperMass * upper * lower);
  return { slow: Math.sqrt(scale * (sum - root)), fast: Math.sqrt(scale * (sum + root)) };
}

describe('double pendulum', () => {
  test.each([
    ['a light panel', 600],
    ['a 3 t block', 3000],
  ])('swings in its slow mode at the analytic frequency for %s', (_name, mass) => {
    const cargo = block(mass);
    const { lengths } = displaced(LOSSLESS, cargo, 0, 0);
    const { slow } = modes(HOOK.mass, mass, lengths.rope, lengths.sling);
    const shape = (slow ** 2 * lengths.rope) / (GRAVITY - slow ** 2 * lengths.sling);
    const start = displaced(LOSSLESS, cargo, degToRad(1), degToRad(1) * shape);
    const crossings: number[] = [];
    let previous = start.cargo.body.position.x - PIVOT.x;

    run(start, cargo, LOSSLESS, 80, air(), (state, step) => {
      const offset = state.cargo.body.position.x - PIVOT.x;
      if (previous < 0 && offset >= 0) crossings.push((step - offset / (offset - previous)) * FIXED_STEP);
      previous = offset;
    });
    const measured = (crossings[5]! - crossings[0]!) / 5;

    expect(Math.abs(measured - (2 * Math.PI) / slow) / measured).toBeLessThan(0.01);
  });

  test('a light payload on long slings swings measurably slower than a single pendulum to the hook', () => {
    const { lengths } = displaced(LOSSLESS, block(600), 0, 0);
    const { slow } = modes(HOOK.mass, 600, lengths.rope, lengths.sling);

    expect((2 * Math.PI) / slow).toBeGreaterThan(1.05 * 2 * Math.PI * Math.sqrt(lengths.rope / GRAVITY));
  });

  test('conserves energy within 0.5% over 60 s with both modes excited and nothing dissipating', () => {
    const cargo = block(600);
    const start = displaced(LOSSLESS, cargo, degToRad(15), degToRad(-10));
    const rest = displaced(LOSSLESS, cargo, 0, 0);
    const cable = stillCable(ROPE);
    const initial = tandemEnergy(start, HOOK, cargo, LOSSLESS, cable);
    const swing = initial - tandemEnergy(rest, HOOK, cargo, LOSSLESS, cable);

    let worst = 0;
    run(start, cargo, LOSSLESS, 60, air(), (state) => {
      worst = Math.max(worst, Math.abs(tandemEnergy(state, HOOK, cargo, LOSSLESS, cable) - initial));
    });

    expect(swing).toBeGreaterThan(0);
    expect(worst / swing).toBeLessThan(0.005);
  });

  test('the hook block and the payload do not move as one rigid link', () => {
    const cargo = block(600);
    const start = displaced(LOSSLESS, cargo, degToRad(10), degToRad(-10));
    let widestKink = 0;

    run(start, cargo, LOSSLESS, 20, air(), (state) => {
      const ropeAngle = Math.atan2(state.hook.position.x - PIVOT.x, PIVOT.y - state.hook.position.y);
      const slingAngle = Math.atan2(state.cargo.body.position.x - state.hook.position.x, state.hook.position.y - state.cargo.body.position.y);
      widestKink = Math.max(widestKink, Math.abs(ropeAngle - slingAngle));
    });

    expect(widestKink).toBeGreaterThan(degToRad(5));
  });

  test('at rest the rope carries both weights and the slings carry the payload', () => {
    const cargo = block(3000);
    const start = displaced(SPEC.cable, cargo, 0, 0);

    const result = stepTandem(start.hook, start.cargo, HOOK, cargo, SPEC.cable, stillCable(ROPE), air(), FIXED_STEP);

    expect(result.tension).toBeCloseTo(3300 * GRAVITY, -1);
    expect(result.slingTension).toBeCloseTo(3000 * GRAVITY, -1);
  });

  test('a payload on the ground under slack slings weighs nothing on the hook', () => {
    const cargo = block(3000);
    const hanging = displaced(SPEC.cable, cargo, 0, 0);
    const onGround: Cargo = {
      body: { position: vec3(PIVOT.x, hanging.hook.position.y - 3, PIVOT.z), velocity: ZERO, grounded: true },
      yaw: 0.4,
      yawRate: 0,
    };
    const support = onGround.body.position.y - 0.5;

    const settled = run({ hook: hanging.hook, cargo: onGround }, cargo, SPEC.cable, 5, air(ZERO, support));
    const result = stepTandem(settled.hook, settled.cargo, HOOK, cargo, SPEC.cable, stillCable(ROPE), air(ZERO, support), FIXED_STEP);

    expect(settled.cargo.body.grounded).toBe(true);
    expect(settled.cargo.body.position).toEqual(onGround.body.position);
    expect(settled.cargo.yaw).toBe(0.4);
    expect(result.slingTension).toBe(0);
    expect(result.tension).toBeCloseTo(HOOK.mass * GRAVITY, -1);
  });
});

describe('aerodynamics of a box payload', () => {
  const panel = { size: PANEL.size, dragCoefficient: PANEL.dragCoefficient };
  const wind = vec3(10, 0, 0);

  test('broadside to the wind the force is ½·ρ·Cd·A·v² along the wind', () => {
    const load = boxAero(panel, wind, 0, 0);

    expect(load.force.x).toBeCloseTo(0.5 * AIR_DENSITY * 1.3 * 12 * 100, 6);
    expect(load.force.z).toBeCloseTo(0, 9);
    expect(load.yawTorque).toBeCloseTo(0, 9);
  });

  test('edge-on the same panel catches a small fraction of that', () => {
    const edgeOn = boxAero(panel, wind, Math.PI / 2, 0);

    expect(Math.abs(edgeOn.force.x)).toBeLessThan(0.15 * boxAero(panel, wind, 0, 0).force.x);
  });

  test.each([20, 45, 70, -20, -45, -70])('at %d° off broadside the torque turns it back broadside', (degrees) => {
    const yaw = degToRad(degrees);

    expect(Math.sign(boxAero(panel, wind, yaw, 0).yawTorque)).toBe(-Math.sign(yaw));
  });

  test('spinning is resisted, in wind and in still air', () => {
    expect(boxAero(panel, wind, 0, 0.5).yawTorque).toBeLessThan(0);
    expect(boxAero(panel, ZERO, 0, -0.5).yawTorque).toBeGreaterThan(0);
  });

  test('still air produces no force on a payload at rest', () => {
    expect(boxAero(panel, ZERO, 0.3, 0)).toEqual({ force: vec3(0, 0, 0), yawTorque: 0 });
  });

  test('yaw inertia is that of a uniform box', () => {
    expect(yawInertia(600, PANEL.size)).toBeCloseTo((600 * (0.09 + 16)) / 12, 9);
  });
});

describe('payload heading', () => {
  test('a panel hanging edge-on in a steady breeze turns broadside to it', () => {
    const start = displaced(SPEC.cable, PANEL, 0, 0, degToRad(80));
    const settleSteps = 30 * PHYSICS_RATE_HZ;
    let sum = 0;
    let widest = 0;
    let count = 0;

    run(start, PANEL, SPEC.cable, 120, air(vec3(4, 0, 0)), (state, step) => {
      if (step < settleSteps) return;
      sum += state.cargo.yaw;
      widest = Math.max(widest, Math.abs(state.cargo.yaw));
      count += 1;
    });

    expect(Math.abs(sum / count)).toBeLessThan(degToRad(8));
    expect(widest).toBeLessThan(degToRad(20));
  });

  test('with no wind the payload keeps its heading in space', () => {
    const start = displaced(SPEC.cable, block(3000, 1.05), degToRad(5), degToRad(5), 0);
    const noFalls = { ...SPEC.cable, fallSpacing: 0 };

    const end = run(start, block(3000, 1.05), noFalls, 20);

    expect(end.cargo.yaw).toBeCloseTo(0, 6);
  });

  test('the two rope falls slowly bring the payload back in line with the jib', () => {
    const cargo = block(3000);
    const start = displaced(SPEC.cable, cargo, 0, 0, degToRad(30));

    const end = run(start, cargo, SPEC.cable, 120);

    expect(Math.abs(end.cargo.yaw)).toBeLessThan(degToRad(30));
  });
});
