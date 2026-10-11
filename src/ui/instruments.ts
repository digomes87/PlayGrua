/** Values shown on the instrument panel, derived from the simulation state. */
import type { CraneSpec } from '../craneSpec';
import { trolleyPosition } from '../physics/crane';
import { type LmiStatus, capacityAt } from '../physics/loadChart';
import { swingAngle } from '../physics/pendulum';
import { kgToTonnes, msToKmh, radToDeg } from '../physics/units';
import { windHeading, windSpeed } from '../physics/wind';
import { type SimulationConfig, type SimulationState, hookPoint } from '../sim/simulation';

export type WindLevel = 'normal' | 'alert' | 'lockout';

export interface Instruments {
  readonly radius: number;
  readonly hookHeight: number;
  /** Jib heading, 0 to 360 degrees. */
  readonly slewDegrees: number;
  readonly loadTonnes: number;
  readonly capacityTonnes: number;
  readonly utilization: number;
  readonly lmiStatus: LmiStatus;
  readonly windKmh: number;
  readonly windAverageKmh: number;
  /** Compass bearing the wind blows towards, degrees clockwise from north. */
  readonly windBearing: number;
  /** Compass bearing of the jib, same frame as the wind. */
  readonly jibBearing: number;
  readonly windLevel: WindLevel;
  readonly swingDegrees: number;
}

const FULL_TURN = 360;

const wrapDegrees = (degrees: number): number => ((degrees % FULL_TURN) + FULL_TURN) % FULL_TURN;

/** World heading (radians from +X/east towards +Z/south) as a compass bearing. */
export const bearingOf = (heading: number): number =>
  wrapDegrees(radToDeg(Math.atan2(Math.cos(heading), -Math.sin(heading))));

export function windLevelAt(speed: number, spec: CraneSpec): WindLevel {
  if (speed >= spec.windLimits.lockout) return 'lockout';
  if (speed >= spec.windLimits.alert) return 'alert';
  return 'normal';
}

export function readInstruments(state: SimulationState, config: SimulationConfig): Instruments {
  const { spec } = config;
  const radius = state.crane.trolley.radius;
  const speed = windSpeed(state.wind, config.wind);
  return {
    radius,
    hookHeight: hookPoint(state, spec).y,
    slewDegrees: wrapDegrees(radToDeg(state.crane.slew.angle)),
    loadTonnes: kgToTonnes(state.lmi.measuredLoad),
    capacityTonnes: kgToTonnes(capacityAt(spec.loadChart, radius)),
    utilization: state.lmi.utilization,
    lmiStatus: state.lmi.status,
    windKmh: msToKmh(speed),
    windAverageKmh: msToKmh(state.wind.averageSpeed),
    windBearing: bearingOf(windHeading(state.wind, config.wind)),
    jibBearing: bearingOf(state.crane.slew.angle),
    windLevel: windLevelAt(speed, spec),
    swingDegrees: radToDeg(swingAngle(state.body, trolleyPosition(state.crane, spec))),
  };
}
