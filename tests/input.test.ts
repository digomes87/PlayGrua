import { describe, expect, test } from 'vitest';
import { NO_INPUT, mergeInputs } from '../src/input/actions';
import { shapeAxis } from '../src/input/curves';
import { CAB_LAYOUT, type PadState, pressedActions, readPad } from '../src/input/gamepad';

const LINEAR = { deadzone: 0.1, expo: 0 };

const pad = (axes: number[], pressed: number[] = []): PadState => ({
  axes,
  buttons: Array.from({ length: 16 }, (_unused, index) => ({ pressed: pressed.includes(index) })),
});

describe('gamepad cab layout', () => {
  test('left stick X slews, pushing the left stick forward sends the trolley out', () => {
    const input = readPad(pad([1, -1, 0, 0]), [], CAB_LAYOUT, LINEAR);

    expect(input.axes.slew).toBe(1);
    expect(input.axes.trolley).toBe(1);
    expect(input.axes.hoist).toBe(0);
  });

  test('pulling the right stick back raises the hook', () => {
    expect(readPad(pad([0, 0, 0, 1]), [], CAB_LAYOUT, LINEAR).axes.hoist).toBe(1);
    expect(readPad(pad([0, 0, 0, -1]), [], CAB_LAYOUT, LINEAR).axes.hoist).toBe(-1);
  });

  test('stick drift inside the deadzone commands nothing', () => {
    expect(readPad(pad([0.05, -0.08, 0, 0.09]), [], CAB_LAYOUT, LINEAR).axes).toEqual({ slew: 0, trolley: -0, hoist: 0 });
  });

  test('a held button fires its action once, on the press', () => {
    const held = pad([0, 0, 0, 0], [3]);

    expect(pressedActions(held, [], CAB_LAYOUT)).toEqual(['camera']);
    expect(pressedActions(held, held.buttons.map((button) => button.pressed), CAB_LAYOUT)).toEqual([]);
  });

  test('shoulder button holds fine mode and X sounds the horn', () => {
    const input = readPad(pad([0, 0, 0, 0], [4, 2]), [], CAB_LAYOUT, LINEAR);

    expect(input.fine).toBe(true);
    expect(input.horn).toBe(true);
  });

  test('tolerates a pad with fewer axes and buttons than the layout expects', () => {
    expect(readPad({ axes: [0.5], buttons: [] }, [], CAB_LAYOUT, LINEAR).axes.hoist).toBe(0);
  });
});

describe('merging devices', () => {
  test('keyboard and gamepad demands add up and saturate', () => {
    const keyboard = { ...NO_INPUT, axes: { slew: 1, trolley: 0, hoist: -1 }, actions: ['camera' as const] };
    const gamepad = { ...NO_INPUT, axes: { slew: 0.6, trolley: 0.3, hoist: 0.4 }, fine: true, actions: ['menu' as const] };

    const merged = mergeInputs(keyboard, gamepad);

    expect(merged.axes).toEqual({ slew: 1, trolley: 0.3, hoist: -0.6 });
    expect(merged.fine).toBe(true);
    expect(merged.actions).toEqual(['camera', 'menu']);
  });
});

describe('joystick response curve', () => {
  const linear = { deadzone: 0, expo: 0 };

  test('is zero inside the deadzone and continuous at its edge', () => {
    const curve = { deadzone: 0.1, expo: 0 };

    expect(shapeAxis(0.05, curve)).toBe(0);
    expect(shapeAxis(-0.1, curve)).toBe(0);
    expect(shapeAxis(0.11, curve)).toBeCloseTo(0.0111, 3);
  });

  test('reaches full scale at full deflection whatever the settings', () => {
    expect(shapeAxis(1, { deadzone: 0.2, expo: 0.7 })).toBeCloseTo(1, 9);
    expect(shapeAxis(-1, { deadzone: 0.2, expo: 0.7 })).toBeCloseTo(-1, 9);
    expect(shapeAxis(3, linear)).toBe(1);
  });

  test('is odd-symmetric', () => {
    const curve = { deadzone: 0.05, expo: 0.5 };

    expect(shapeAxis(-0.6, curve)).toBeCloseTo(-shapeAxis(0.6, curve), 12);
  });

  test('expo softens the response around the centre', () => {
    expect(shapeAxis(0.5, linear)).toBe(0.5);
    expect(shapeAxis(0.5, { deadzone: 0, expo: 1 })).toBeCloseTo(0.125, 9);
    expect(shapeAxis(0.5, { deadzone: 0, expo: 0.5 })).toBeCloseTo(0.3125, 9);
  });
});
