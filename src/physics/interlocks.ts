/** Safety interlocks between the operator demand and the drives: LMI, wind lockout and zoning. */
import type { CraneCommand } from './crane';
import type { MotionPermits } from './loadChart';

/** Which way each horizontal motion may still go; false where a forbidden zone is too close. */
export interface ZonePermits {
  readonly slewPositive: boolean;
  readonly slewNegative: boolean;
  readonly trolleyOut: boolean;
  readonly trolleyIn: boolean;
}

export const OPEN_ZONES: ZonePermits = { slewPositive: true, slewNegative: true, trolleyOut: true, trolleyIn: true };

export interface Interlocks {
  readonly lmi: MotionPermits;
  readonly windLocked: boolean;
  readonly zones: ZonePermits;
}

const allow = (demand: number, positiveAllowed: boolean, negativeAllowed: boolean): number => {
  if (demand > 0 && !positiveAllowed) return 0;
  if (demand < 0 && !negativeAllowed) return 0;
  return demand;
};

/** Slows only the direction that raises the load moment. */
const slowed = (demand: number, factor: number): number => (demand > 0 ? demand * factor : demand);

/**
 * Above the wind limit every powered motion is refused except lowering the load, so it can be
 * landed before the crane is left to weathervane.
 */
export function applyInterlocks(command: CraneCommand, interlocks: Interlocks): CraneCommand {
  const { lmi, zones } = interlocks;
  const calm = !interlocks.windLocked;
  const hoist = allow(command.hoist, lmi.hoistUp && calm, lmi.hoistDown);
  const trolley = allow(command.trolley, lmi.trolleyOut && calm && zones.trolleyOut, lmi.trolleyIn && calm && zones.trolleyIn);
  return {
    ...command,
    slew: allow(command.slew, calm && zones.slewPositive, calm && zones.slewNegative),
    hoist: slowed(hoist, lmi.approachFactor),
    trolley: slowed(trolley, lmi.approachFactor),
  };
}
