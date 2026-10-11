/** Safety interlocks between the operator demand and the drives: LMI cutoff and wind lockout. */
import type { CraneCommand } from './crane';
import type { MotionPermits } from './loadChart';

const allow = (demand: number, positiveAllowed: boolean, negativeAllowed: boolean): number => {
  if (demand > 0 && !positiveAllowed) return 0;
  if (demand < 0 && !negativeAllowed) return 0;
  return demand;
};

/**
 * Above the wind limit every powered motion is refused except lowering the load, so it can be
 * landed before the crane is left to weathervane.
 */
const windPermits = (locked: boolean): MotionPermits => ({
  hoistUp: !locked,
  hoistDown: true,
  trolleyOut: !locked,
  trolleyIn: !locked,
});

export function applyInterlocks(command: CraneCommand, lmi: MotionPermits, windLocked: boolean): CraneCommand {
  const wind = windPermits(windLocked);
  return {
    ...command,
    slew: windLocked ? 0 : command.slew,
    hoist: allow(command.hoist, lmi.hoistUp && wind.hoistUp, lmi.hoistDown && wind.hoistDown),
    trolley: allow(command.trolley, lmi.trolleyOut && wind.trolleyOut, lmi.trolleyIn && wind.trolleyIn),
  };
}
