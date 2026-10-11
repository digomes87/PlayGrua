import { DEFAULT_CRANE_SPEC, type CraneSpec } from '../src/craneSpec';
import type { CableMotion, CableProperties, HangingMass, LoadBody } from '../src/physics/pendulum';
import { stepLoad, stretchedLength } from '../src/physics/pendulum';
import { FIXED_STEP } from '../src/physics/units';
import { ZERO, vec3 } from '../src/physics/vec3';

export const SPEC: CraneSpec = DEFAULT_CRANE_SPEC;

/** Rope with no dissipation at all, for conservation checks. */
export const LOSSLESS_CABLE: CableProperties = { ...SPEC.cable, dampingRatio: 0, swingDamping: 0 };

export const PIVOT = vec3(20, 47, 0);
export const FAR_BELOW = -1000;

export const stillCable = (length: number): CableMotion => ({
  pivot: PIVOT,
  pivotVelocity: ZERO,
  length,
  lengthRate: 0,
  link: 0,
});

export const pointMass = (mass: number): HangingMass => ({ mass, dragArea: 0, hangDepth: 0 });

/** Load displaced by `angle` from the vertical, at the statically stretched rope length. */
export function displaced(cable: CableProperties, mass: number, length: number, angle: number): LoadBody {
  const reach = stretchedLength(cable, mass, length);
  const position = vec3(PIVOT.x + reach * Math.sin(angle), PIVOT.y - reach * Math.cos(angle), PIVOT.z);
  return { position, velocity: ZERO, grounded: false };
}

export function swingFreely(
  body: LoadBody,
  load: HangingMass,
  cable: CableProperties,
  motion: CableMotion,
  steps: number,
  observe: (body: LoadBody, step: number) => void = () => undefined,
): LoadBody {
  const calm = { windVelocity: ZERO, supportHeight: FAR_BELOW, friction: SPEC.groundFriction };
  let current = body;
  for (let index = 1; index <= steps; index += 1) {
    current = stepLoad(current, load, cable, motion, calm, FIXED_STEP).body;
    observe(current, index);
  }
  return current;
}
