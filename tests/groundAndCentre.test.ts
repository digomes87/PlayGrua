import { describe, expect, test } from 'vitest';
import { type LoadBody, stepLoad, stretchedLength } from '../src/physics/pendulum';
import { FIXED_STEP, GRAVITY, PHYSICS_RATE_HZ } from '../src/physics/units';
import { ZERO, magnitude, subtract, vec3 } from '../src/physics/vec3';
import { CONCRETE_BLOCK } from '../src/sim/payloads';
import { PIVOT, SPEC, stillCable } from './helpers';
import { advance, slungAt } from './simHelpers';

const MASS = 2300;
const load = { mass: MASS, dragArea: 0, hangDepth: 1 };
const ground = { windVelocity: ZERO, supportHeight: 0, friction: SPEC.groundFriction };

/** Rope from a pivot `offset` metres to the side, stretched to carry `share` of the weight. */
function sidePull(offset: number, share: number): { body: LoadBody; rope: ReturnType<typeof stillCable> } {
  const body: LoadBody = { position: vec3(PIVOT.x + offset, 1, PIVOT.z), velocity: ZERO, grounded: true };
  const distance = magnitude(subtract(body.position, PIVOT));
  const stretch = stretchedLength(SPEC.cable, MASS * share, 40) - 40;
  return { body, rope: stillCable(distance - stretch * (distance / 40)) };
}

describe('ground friction', () => {
  test('a small side pull leaves the load where it stands', () => {
    const { body, rope } = sidePull(2, 0.3);

    const result = stepLoad(body, load, SPEC.cable, rope, ground, FIXED_STEP);

    expect(result.body.position).toEqual(body.position);
    expect(result.tension).toBeGreaterThan(0);
  });

  test('a side pull beyond the friction limit drags the load towards the trolley', () => {
    const { body, rope } = sidePull(30, 0.6);
    let current = body;
    for (let index = 0; index < PHYSICS_RATE_HZ; index += 1) {
      current = stepLoad(current, load, SPEC.cable, rope, ground, FIXED_STEP).body;
    }

    expect(current.grounded).toBe(true);
    expect(current.position.y).toBe(1);
    expect(current.position.x).toBeLessThan(body.position.x - 0.05);
  });

  test('a dragged load comes back to rest once the rope goes slack', () => {
    const sliding: LoadBody = { position: vec3(PIVOT.x, 1, PIVOT.z), velocity: vec3(1, 0, 0), grounded: true };
    let current = sliding;
    for (let index = 0; index < PHYSICS_RATE_HZ; index += 1) {
      current = stepLoad(current, load, SPEC.cable, stillCable(47), ground, FIXED_STEP).body;
    }
    const expected = 1 / (2 * SPEC.groundFriction.kinetic * GRAVITY);

    expect(current.velocity).toEqual(ZERO);
    expect(current.position.x - sliding.position.x).toBeCloseTo(expected, 2);
  });

  test('a load landing with sideways speed skids instead of stopping dead', () => {
    const swingingDown: LoadBody = { position: vec3(PIVOT.x, 1.002, PIVOT.z), velocity: vec3(0.8, -0.3, 0), grounded: false };

    const landed = stepLoad(swingingDown, load, SPEC.cable, stillCable(47), ground, FIXED_STEP);

    expect(landed.body.grounded).toBe(true);
    expect(landed.body.velocity.x).toBeCloseTo(0.8, 1);
    expect(landed.body.velocity.y).toBe(0);
  });

  test('a load dragged past the edge of a slab falls', () => {
    const onSlab: LoadBody = { position: vec3(PIVOT.x, 11, PIVOT.z), velocity: ZERO, grounded: true };

    const result = stepLoad(onSlab, load, SPEC.cable, stillCable(47), ground, FIXED_STEP);

    expect(result.body.grounded).toBe(false);
    expect(result.body.velocity.y).toBeLessThan(0);
  });

  test('trolleying away from a load left on the ground drags it and never counts as carrying', () => {
    const slung = advance(slungAt(CONCRETE_BLOCK, 12), { hoist: 1, fine: true }, 0.4);

    const pulled = advance(slung, { trolley: 1 }, 30);
    const block = pulled.cargo!.body;

    expect(block.grounded).toBe(true);
    expect(block.position.x).toBeGreaterThan(13);
    expect(block.position.x).toBeLessThan(pulled.crane.trolley.radius);
  });
});
