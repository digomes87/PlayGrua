/** Discrete operator actions and the analogue demand, independent of the device that produced them. */

export type Action = 'camera' | 'rigging' | 'tagline' | 'emergency' | 'weathervane' | 'menu' | 'restart';

export interface Axes {
  /** Positive turns the jib to the operator's right. */
  readonly slew: number;
  /** Positive sends the trolley out. */
  readonly trolley: number;
  /** Positive raises the hook. */
  readonly hoist: number;
}

export interface DeviceInput {
  readonly axes: Axes;
  readonly fine: boolean;
  readonly horn: boolean;
  readonly actions: readonly Action[];
}

export const NO_INPUT: DeviceInput = {
  axes: { slew: 0, trolley: 0, hoist: 0 },
  fine: false,
  horn: false,
  actions: [],
};

const clampUnit = (value: number): number => Math.min(Math.max(value, -1), 1);

/** Keyboard and gamepad act together: demands add up, saturating at full scale. */
export const mergeInputs = (first: DeviceInput, second: DeviceInput): DeviceInput => ({
  axes: {
    slew: clampUnit(first.axes.slew + second.axes.slew),
    trolley: clampUnit(first.axes.trolley + second.axes.trolley),
    hoist: clampUnit(first.axes.hoist + second.axes.hoist),
  },
  fine: first.fine || second.fine,
  horn: first.horn || second.horn,
  actions: [...first.actions, ...second.actions],
});
