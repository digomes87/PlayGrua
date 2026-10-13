/**
 * Gamepad in the cab layout: left stick X slews and Y moves the trolley, right stick Y hoists
 * (pull back to raise). Standard-mapping button indices.
 */
import { type Action, type DeviceInput, NO_INPUT } from './actions';
import { type ResponseCurve, shapeAxis } from './curves';

export interface PadLayout {
  readonly slewAxis: number;
  readonly trolleyAxis: number;
  readonly hoistAxis: number;
  readonly fineButton: number;
  readonly hornButton: number;
  readonly actionButtons: Readonly<Record<number, Action>>;
}

export const CAB_LAYOUT: PadLayout = {
  slewAxis: 0,
  trolleyAxis: 1,
  hoistAxis: 3,
  fineButton: 4,
  hornButton: 2,
  actionButtons: { 0: 'rigging', 1: 'emergency', 3: 'camera', 5: 'weathervane', 7: 'tagline', 9: 'menu', 8: 'restart' },
};

/** The slice of the Gamepad API the mapping needs. */
export interface PadState {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}

const isDown = (pad: PadState, index: number): boolean => pad.buttons[index]?.pressed ?? false;

/** Buttons that went down since the previous snapshot, as actions. */
export function pressedActions(pad: PadState, previous: readonly boolean[], layout: PadLayout): readonly Action[] {
  return Object.entries(layout.actionButtons)
    .filter(([index]) => isDown(pad, Number(index)) && !(previous[Number(index)] ?? false))
    .map(([, action]) => action);
}

export function readPad(
  pad: PadState,
  previous: readonly boolean[],
  layout: PadLayout,
  curve: ResponseCurve,
): DeviceInput {
  const axis = (index: number): number => shapeAxis(pad.axes[index] ?? 0, curve);
  return {
    axes: { slew: axis(layout.slewAxis), trolley: -axis(layout.trolleyAxis), hoist: axis(layout.hoistAxis) },
    fine: isDown(pad, layout.fineButton),
    horn: isDown(pad, layout.hornButton),
    actions: pressedActions(pad, previous, layout),
  };
}

export class GamepadReader {
  private previous: readonly boolean[] = [];

  constructor(private readonly layout: PadLayout) {}

  read(curve: ResponseCurve): DeviceInput {
    const pad = firstConnected();
    if (pad === null) return NO_INPUT;
    const input = readPad(pad, this.previous, this.layout, curve);
    this.previous = pad.buttons.map((button) => button.pressed);
    return input;
  }
}

function firstConnected(): Gamepad | null {
  if (typeof navigator.getGamepads !== 'function') return null;
  return navigator.getGamepads().find((pad) => pad !== null && pad.connected) ?? null;
}
