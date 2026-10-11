/** Joystick response shaping: deadzone, then a blend of linear and cubic ("expo"). */

const clampUnit = (value: number): number => Math.min(Math.max(value, -1), 1);

export interface ResponseCurve {
  readonly deadzone: number;
  /** 0 keeps the stick linear; 1 makes it fully cubic, with fine control around the centre. */
  readonly expo: number;
}

export function shapeAxis(raw: number, curve: ResponseCurve): number {
  const size = Math.abs(clampUnit(raw));
  if (size <= curve.deadzone) return 0;
  const travel = (size - curve.deadzone) / (1 - curve.deadzone);
  const shaped = (1 - curve.expo) * travel + curve.expo * travel ** 3;
  return Math.sign(raw) * shaped;
}
