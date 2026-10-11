import { type CraneCommand, IDLE_COMMAND } from '../src/physics/crane';
import { FIXED_STEP, PHYSICS_RATE_HZ, kmhToMs } from '../src/physics/units';
import { vec3 } from '../src/physics/vec3';
import { CALM, type WindConfig } from '../src/physics/wind';
import type { Payload } from '../src/sim/payloads';
import { type GroundLoad, rig } from '../src/sim/rigging';
import {
  type SimulationConfig,
  type SimulationState,
  type StepEvents,
  createSimulation,
  stepSimulation,
} from '../src/sim/simulation';
import { SPEC } from './helpers';

export const OPEN_FIELD: SimulationConfig = { spec: SPEC, wind: CALM, site: { obstacles: [] } };

export const GUSTY: WindConfig = {
  ...CALM,
  meanSpeed: kmhToMs(25),
  meanDirection: Math.PI / 2,
  turbulenceIntensity: 0.2,
  peakSpeed: kmhToMs(40),
  directionSpread: 0.2,
  seed: 2024,
};

export type Observer = (state: SimulationState, events: StepEvents) => void;

export function advance(
  state: SimulationState,
  command: Partial<CraneCommand>,
  seconds: number,
  config: SimulationConfig = OPEN_FIELD,
  observe: Observer = () => undefined,
): SimulationState {
  const full = { ...IDLE_COMMAND, ...command };
  let current = state;
  for (let index = 0; index < Math.round(seconds * PHYSICS_RATE_HZ); index += 1) {
    const result = stepSimulation(current, full, config, FIXED_STEP);
    current = result.state;
    observe(current, result.events);
  }
  return current;
}

export const onGroundAt = (payload: Payload, radius: number): GroundLoad => ({
  payload,
  position: vec3(radius, 0, 0),
  yaw: 0,
});

/** Crane with the hook resting slack on top of a payload at `radius`, already slung. */
export function slungAt(payload: Payload, radius: number, config: SimulationConfig = OPEN_FIELD): SimulationState {
  const hookHeight = payload.size.y + 1.5;
  const start = createSimulation(config, {
    radius,
    hookHeight,
    slewAngle: 0,
    groundLoads: [onGroundAt(payload, radius)],
  });
  return { ...start, ...rig(start, SPEC) };
}

/** Slung payload lifted clear of the ground and left to settle. */
export function liftedAt(payload: Payload, radius: number, config: SimulationConfig = OPEN_FIELD): SimulationState {
  const lifted = advance(slungAt(payload, radius, config), { hoist: 1, fine: true }, 12, config);
  return advance(lifted, {}, 8, config);
}
