/** Drive ramps shared by slew, trolley and hoist: the joystick sets a target speed, never a position. */

/** Fraction of the theoretical braking curve used when approaching a travel limit. */
const SOFT_LIMIT_MARGIN = 0.7;

export const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

const isSpeedingUp = (current: number, target: number): boolean =>
  Math.abs(target) > Math.abs(current) && current * target >= 0;

/** Moves a speed towards its target at the inverter ramp: `acceleration` when gaining speed, `deceleration` otherwise. */
export function rampToward(
  current: number,
  target: number,
  acceleration: number,
  deceleration: number,
  step: number,
): number {
  const rate = isSpeedingUp(current, target) ? acceleration : deceleration;
  return current + clamp(target - current, -rate * step, rate * step);
}

/** Highest speed from which the drive can still stop within `distance` of a limit switch. */
export const approachSpeed = (distance: number, deceleration: number): number =>
  Math.sqrt(2 * SOFT_LIMIT_MARGIN * deceleration * Math.max(distance, 0));
