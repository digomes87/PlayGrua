import { describe, expect, test } from 'vitest';
import type { LoadBody } from '../src/physics/pendulum';
import { ZERO, vec3 } from '../src/physics/vec3';
import { resolveSideHits, supportHeightBelow } from '../src/sim/collisions';
import { CONCRETE_BLOCK, REBAR_BUNDLE, footprintOf } from '../src/sim/payloads';
import { asObstacle, reachableLoad, rig } from '../src/sim/rigging';
import type { Obstacle, Site } from '../src/sim/site';
import { createSimulation } from '../src/sim/simulation';
import { SPEC } from './helpers';
import { OPEN_FIELD, advance, liftedAt, onGroundAt } from './simHelpers';

const SLAB: Obstacle = { id: 'slab', kind: 'building', minX: 20, maxX: 30, minZ: -5, maxZ: 5, height: 10 };
const FOOTPRINT = { halfWidth: 0.5, hangDepth: 1 };
const at = (x: number, y: number, z: number, velocity = ZERO): LoadBody => ({
  position: vec3(x, y, z),
  velocity,
  grounded: false,
});

describe('support height', () => {
  test('is the ground away from any obstacle', () => {
    expect(supportHeightBelow([SLAB], at(0, 5, 0), FOOTPRINT)).toBe(0);
  });

  test('is the slab top when the load is above it', () => {
    expect(supportHeightBelow([SLAB], at(25, 12, 0), FOOTPRINT)).toBe(10);
  });

  test('ignores a slab the load is already below', () => {
    expect(supportHeightBelow([SLAB], at(25, 6, 0), FOOTPRINT)).toBe(0);
  });

  test('picks the highest of stacked surfaces', () => {
    const crate = { ...SLAB, id: 'crate', minX: 24, maxX: 26, height: 11 };

    expect(supportHeightBelow([SLAB, crate], at(25, 13, 0), FOOTPRINT)).toBe(11);
  });
});

describe('side hits', () => {
  test('a load swinging into a wall is pushed out and bounces back', () => {
    const hit = resolveSideHits([SLAB], at(19.8, 6, 0, vec3(1.5, 0, 0.2)), FOOTPRINT);

    expect(hit.speed).toBeCloseTo(1.5, 9);
    expect(hit.body.position.x).toBeCloseTo(19.5, 9);
    expect(hit.body.velocity.x).toBeLessThan(0);
    expect(hit.body.velocity.z).toBe(0.2);
  });

  test('a load clear of the wall is left alone', () => {
    const body = at(15, 6, 0, vec3(1, 0, 0));

    expect(resolveSideHits([SLAB], body, FOOTPRINT)).toEqual({ body, speed: 0 });
  });

  test('a load above the slab is not a side hit', () => {
    const body = at(25, 11.2, 0);

    expect(resolveSideHits([SLAB], body, FOOTPRINT).speed).toBe(0);
  });

  test('a load dragged along the ground into a wall is stopped by it too', () => {
    const dragged = { ...at(19.8, 1, 0, vec3(0.4, 0, 0)), grounded: true };

    const hit = resolveSideHits([SLAB], dragged, FOOTPRINT);

    expect(hit.body.position.x).toBeCloseTo(19.5, 9);
    expect(hit.speed).toBeCloseTo(0.4, 9);
  });
});

describe('site collisions in the simulation', () => {
  const wall: Site = { obstacles: [{ id: 'wall', kind: 'building', minX: 16, maxX: 20, minZ: -8, maxZ: 8, height: 12 }] };
  const config = { ...OPEN_FIELD, site: wall };

  test('trolleying a low load into a building registers a bump and stops it', () => {
    let hardest = 0;
    const moved = advance(liftedAt(REBAR_BUNDLE, 10, config), { trolley: 1 }, 12, config, (_state, events) => {
      hardest = Math.max(hardest, events.bumpSpeed);
    });

    expect(hardest).toBeGreaterThan(0.3);
    expect(moved.cargo!.body.position.x + footprintOf(REBAR_BUNDLE)).toBeLessThanOrEqual(16 + 1e-9);
  });

  test('a load can be landed on top of a building', () => {
    const slab: Site = { obstacles: [{ ...wall.obstacles[0]!, minX: 8, maxX: 16 }] };
    const elevated = { ...OPEN_FIELD, site: slab };
    const start = createSimulation(elevated, { radius: 12, hookHeight: 20, slewAngle: 0, groundLoads: [] });

    const lowered = advance(start, { hoist: -1 }, 20, elevated);

    expect(lowered.body.grounded).toBe(true);
    expect(lowered.body.position.y).toBeCloseTo(12 + SPEC.geometry.hookBlockHeight, 6);
  });
});

describe('rigging', () => {
  const load = onGroundAt(CONCRETE_BLOCK, 12);
  const start = createSimulation(OPEN_FIELD, { radius: 12, hookHeight: 2.5, slewAngle: 0, groundLoads: [load] });

  test('a ground load is an obstacle the hook can rest on', () => {
    const lowered = advance(start, { hoist: -1 }, 10);

    expect(asObstacle(load, 0).height).toBe(CONCRETE_BLOCK.size.y);
    expect(lowered.body.grounded).toBe(true);
    expect(lowered.body.position.y).toBeCloseTo(CONCRETE_BLOCK.size.y + SPEC.geometry.hookBlockHeight, 6);
  });

  test('the hook reaches a load directly below it', () => {
    expect(reachableLoad(start)).toBe(load);
  });

  test('the hook does not reach a load that is too far or too far below', () => {
    const offset = createSimulation(OPEN_FIELD, { radius: 15, hookHeight: 2.5, slewAngle: 0, groundLoads: [load] });
    const high = createSimulation(OPEN_FIELD, { radius: 12, hookHeight: 9, slewAngle: 0, groundLoads: [load] });

    expect(reachableLoad(offset)).toBeUndefined();
    expect(reachableLoad(high)).toBeUndefined();
  });

  test('rigging puts the payload on the slings without moving the hook or the payload', () => {
    const rigged = rig(start, SPEC);
    const cargo = rigged.cargo!;

    expect(cargo.payload).toBe(CONCRETE_BLOCK);
    expect(rigged.groundLoads).toHaveLength(0);
    expect(rigged.body).toBe(start.body);
    expect(cargo.body.grounded).toBe(true);
    expect(cargo.body.position.y).toBeCloseTo(CONCRETE_BLOCK.size.y / 2, 9);
    expect(cargo.slingLength).toBeCloseTo(start.body.position.y - CONCRETE_BLOCK.size.y / 2, 6);
  });

  test('rigging with nothing in reach changes nothing', () => {
    const empty = createSimulation(OPEN_FIELD, { radius: 30, hookHeight: 2.5, slewAngle: 0, groundLoads: [load] });

    expect(rig(empty, SPEC)).toBe(empty);
  });
});
