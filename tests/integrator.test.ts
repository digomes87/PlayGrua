import { describe, expect, test } from 'vitest';
import { consumeFrame, rk4Step, semiImplicitEuler } from '../src/physics/integrator';
import { FIXED_STEP } from '../src/physics/units';

describe('rk4Step', () => {
  test('integrates a harmonic oscillator over one period with fourth-order accuracy', () => {
    const oscillator = (_time: number, state: readonly number[]): readonly number[] => [state[1]!, -state[0]!];
    const stepCount = 200;
    const step = (2 * Math.PI) / stepCount;

    let state: readonly number[] = [1, 0];
    for (let index = 0; index < stepCount; index += 1) state = rk4Step(oscillator, index * step, state, step);

    expect(state[0]!).toBeCloseTo(1, 6);
    expect(state[1]!).toBeCloseTo(0, 6);
  });

  test('does not mutate the input state', () => {
    const state = Object.freeze([1, 2]);

    const next = rk4Step(() => [1, 1], 0, state, 0.5);

    expect(next).toEqual([1.5, 2.5]);
    expect(state).toEqual([1, 2]);
  });
});

describe('semiImplicitEuler', () => {
  test('updates velocity before position', () => {
    const next = semiImplicitEuler({ position: 0, velocity: 1 }, 2, 0.5);

    expect(next).toEqual({ position: 1, velocity: 2 });
  });
});

describe('consumeFrame', () => {
  test('turns a 60 fps frame into two 120 Hz steps with nothing left over', () => {
    const budget = consumeFrame(0, 1 / 60, FIXED_STEP, 12);

    expect(budget.steps).toBe(2);
    expect(budget.alpha).toBeCloseTo(0, 6);
  });

  test('carries the unused fraction of a step to the next frame', () => {
    const budget = consumeFrame(0, 1.5 * FIXED_STEP, FIXED_STEP, 12);

    expect(budget.steps).toBe(1);
    expect(budget.alpha).toBeCloseTo(0.5, 6);
    expect(budget.remainder).toBeCloseTo(0.5 * FIXED_STEP, 9);
  });

  test('caps the catch-up after a long stall', () => {
    const budget = consumeFrame(0, 5, FIXED_STEP, 12);

    expect(budget.steps).toBe(12);
    expect(budget.remainder).toBeLessThan(FIXED_STEP);
  });
});
