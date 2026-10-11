import { describe, expect, test } from 'vitest';
import { IDLE_COMMAND } from '../src/physics/crane';
import { applyInterlocks } from '../src/physics/interlocks';
import { capacityAt, classify, createLmi, permitsFor, updateLmi, utilizationAt } from '../src/physics/loadChart';
import { FIXED_STEP, GRAVITY } from '../src/physics/units';
import { SPEC } from './helpers';

const CHART = SPEC.loadChart;
const DEMAND_EVERYTHING = { ...IDLE_COMMAND, slew: 1, trolley: 1, hoist: 1 };
const DEMAND_REVERSE = { ...IDLE_COMMAND, slew: -1, trolley: -1, hoist: -1 };

describe('load chart', () => {
  test.each(CHART.map((point) => [point.radius, point.capacity]))(
    'returns the table value at %d m',
    (radius, capacity) => {
      expect(capacityAt(CHART, radius)).toBeCloseTo(capacity, 9);
    },
  );

  test('rates 8 t from minimum radius to 15 m and 1.6 t at the 60 m tip', () => {
    expect(capacityAt(CHART, 2.5)).toBe(8000);
    expect(capacityAt(CHART, 10)).toBe(8000);
    expect(capacityAt(CHART, 15)).toBe(8000);
    expect(capacityAt(CHART, 60)).toBe(1600);
  });

  test('interpolates linearly between table points', () => {
    expect(capacityAt(CHART, 17.5)).toBeCloseTo((8000 + 5540) / 2, 9);
  });

  test('never increases with radius', () => {
    let previous = capacityAt(CHART, 0);
    for (let radius = 0; radius <= 65; radius += 0.05) {
      const capacity = capacityAt(CHART, radius);
      expect(capacity).toBeLessThanOrEqual(previous);
      previous = capacity;
    }
  });

  test('decreases strictly beyond 15 m', () => {
    for (let radius = 15; radius < 60; radius += 0.5) {
      expect(capacityAt(CHART, radius + 0.5)).toBeLessThan(capacityAt(CHART, radius));
    }
  });

  test('clamps outside the table', () => {
    expect(capacityAt(CHART, 0)).toBe(8000);
    expect(capacityAt(CHART, 80)).toBe(1600);
  });

  test('keeps the load moment roughly constant beyond 15 m', () => {
    const moments = CHART.filter((point) => point.radius >= 15).map((point) => point.radius * point.capacity);

    expect(Math.min(...moments)).toBeGreaterThan(0.75 * Math.max(...moments));
  });

  test('utilization is measured load over capacity at the radius', () => {
    expect(utilizationAt(CHART, 60, 800)).toBeCloseTo(0.5, 9);
  });
});

describe('LMI classification', () => {
  test.each([
    [0.5, 'normal'],
    [0.899, 'normal'],
    [0.9, 'warning'],
    [0.999, 'warning'],
    [1.0, 'cutoff'],
    [1.09, 'cutoff'],
    [1.1, 'overload'],
  ] as const)('utilization %f is %s', (utilization, status) => {
    expect(classify(SPEC.lmi, utilization, 'normal')).toBe(status);
  });

  test('holds the cutoff until the utilization falls below the release threshold', () => {
    expect(classify(SPEC.lmi, 0.98, 'cutoff')).toBe('cutoff');
    expect(classify(SPEC.lmi, 0.96, 'cutoff')).toBe('warning');
  });
});

describe('LMI motion blocking', () => {
  test('below 100% every motion is permitted', () => {
    const gated = applyInterlocks(DEMAND_EVERYTHING, permitsFor('warning'), false);

    expect(gated).toEqual(DEMAND_EVERYTHING);
  });

  test.each(['cutoff', 'overload'] as const)('at %s it blocks hoisting up and trolleying out', (status) => {
    const gated = applyInterlocks(DEMAND_EVERYTHING, permitsFor(status), false);

    expect(gated.hoist).toBe(0);
    expect(gated.trolley).toBe(0);
    expect(gated.slew).toBe(1);
  });

  test.each(['cutoff', 'overload'] as const)('at %s it still allows lowering and trolleying in', (status) => {
    const gated = applyInterlocks(DEMAND_REVERSE, permitsFor(status), false);

    expect(gated.hoist).toBe(-1);
    expect(gated.trolley).toBe(-1);
  });

  test('reaches cutoff when the measured load hits the capacity at the radius', () => {
    const radius = 30;
    const tension = capacityAt(CHART, radius) * GRAVITY;

    let lmi = createLmi(0);
    for (let index = 0; index < 600; index += 1) lmi = updateLmi(lmi, { tension: tension * 1.001, radius }, SPEC, FIXED_STEP);

    expect(lmi.status).toBe('cutoff');
    expect(lmi.utilization).toBeCloseTo(1.001, 3);
    expect(permitsFor(lmi.status)).toEqual({ hoistUp: false, hoistDown: true, trolleyOut: false, trolleyIn: true });
  });

  test('the same load becomes a cutoff just by trolleying out', () => {
    const tension = 3300 * GRAVITY;
    const settle = (radius: number) => {
      let lmi = createLmi(3300);
      for (let index = 0; index < 600; index += 1) lmi = updateLmi(lmi, { tension, radius }, SPEC, FIXED_STEP);
      return lmi.status;
    };

    expect(settle(20)).toBe('normal');
    expect(settle(29)).toBe('warning');
    expect(settle(32)).toBe('cutoff');
  });
});

describe('wind lockout', () => {
  test('refuses every powered motion except lowering the load', () => {
    const free = permitsFor('normal');

    expect(applyInterlocks(DEMAND_EVERYTHING, free, true)).toMatchObject({ slew: 0, trolley: 0, hoist: 0 });
    expect(applyInterlocks(DEMAND_REVERSE, free, true)).toMatchObject({ slew: 0, trolley: 0, hoist: -1 });
  });

  test('leaves the weathervane request untouched', () => {
    const gated = applyInterlocks({ ...IDLE_COMMAND, weathervane: true }, permitsFor('normal'), true);

    expect(gated.weathervane).toBe(true);
  });
});
