/** Fixed-step integration primitives: RK4, semi-implicit Euler and the frame accumulator. */

export type StateVector = readonly number[];
export type Derivative = (time: number, state: StateVector) => StateVector;

const advance = (state: StateVector, slope: StateVector, step: number): StateVector =>
  state.map((value, index) => value + slope[index]! * step);

export function rk4Step(derivative: Derivative, time: number, state: StateVector, step: number): StateVector {
  const half = step / 2;
  const first = derivative(time, state);
  const second = derivative(time + half, advance(state, first, half));
  const third = derivative(time + half, advance(state, second, half));
  const fourth = derivative(time + step, advance(state, third, step));
  const weight = step / 6;
  return state.map(
    (value, index) => value + weight * (first[index]! + 2 * second[index]! + 2 * third[index]! + fourth[index]!),
  );
}

export interface Motion {
  readonly position: number;
  readonly velocity: number;
}

/** Velocity first, then position with the new velocity (symplectic Euler). */
export function semiImplicitEuler(motion: Motion, acceleration: number, step: number): Motion {
  const velocity = motion.velocity + acceleration * step;
  return { position: motion.position + velocity * step, velocity };
}

export interface FrameBudget {
  readonly steps: number;
  readonly remainder: number;
  /** Fraction of a step left over, used to interpolate the rendered state. */
  readonly alpha: number;
}

const ROUNDING_GUARD = 1e-9;

/** Classic accumulator: converts a variable frame time into a whole number of fixed steps. */
export function consumeFrame(accumulated: number, frameSeconds: number, step: number, maxSteps: number): FrameBudget {
  const total = accumulated + Math.min(Math.max(frameSeconds, 0), maxSteps * step);
  const steps = Math.min(Math.floor(total / step + ROUNDING_GUARD), maxSteps);
  const remainder = Math.max(total - steps * step, 0);
  return { steps, remainder, alpha: Math.min(remainder / step, 1) };
}
