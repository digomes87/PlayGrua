/** Load chart interpolation and the Load Moment Indicator (LMI) logic. */
import type { ChartPoint, CraneSpec } from '../craneSpec';
import { GRAVITY } from './units';

export type LoadChart = readonly ChartPoint[];
export type LmiStatus = 'normal' | 'warning' | 'cutoff' | 'overload';
export type LmiThresholds = CraneSpec['lmi'];

export interface LmiState {
  /** Load read from the rope tension, hook block included, in kilograms. */
  readonly measuredLoad: number;
  readonly utilization: number;
  readonly status: LmiStatus;
}

export interface LmiReading {
  readonly tension: number;
  readonly radius: number;
}

export interface MotionPermits {
  readonly hoistUp: boolean;
  readonly hoistDown: boolean;
  readonly trolleyOut: boolean;
  readonly trolleyIn: boolean;
}

/** Rated capacity at a radius: linear interpolation between table points, clamped at the ends. */
export function capacityAt(chart: LoadChart, radius: number): number {
  const first = chart[0]!;
  const last = chart[chart.length - 1]!;
  if (radius <= first.radius) return first.capacity;
  if (radius >= last.radius) return last.capacity;
  const upperIndex = chart.findIndex((point) => point.radius >= radius);
  const lower = chart[upperIndex - 1]!;
  const upper = chart[upperIndex]!;
  const fraction = (radius - lower.radius) / (upper.radius - lower.radius);
  return lower.capacity + fraction * (upper.capacity - lower.capacity);
}

export const utilizationAt = (chart: LoadChart, radius: number, measuredLoad: number): number =>
  measuredLoad / capacityAt(chart, radius);

const isBlocking = (status: LmiStatus): boolean => status === 'cutoff' || status === 'overload';

/** The cutoff latches until the utilization falls below the release threshold. */
export function classify(thresholds: LmiThresholds, utilization: number, previous: LmiStatus): LmiStatus {
  if (utilization >= thresholds.overload) return 'overload';
  if (utilization >= thresholds.cutoff) return 'cutoff';
  if (isBlocking(previous) && utilization >= thresholds.cutoffRelease) return 'cutoff';
  if (utilization >= thresholds.warning) return 'warning';
  return 'normal';
}

/** At cutoff only the motions that reduce the load moment stay available. */
export function permitsFor(status: LmiStatus): MotionPermits {
  const free = !isBlocking(status);
  return { hoistUp: free, hoistDown: true, trolleyOut: free, trolleyIn: true };
}

export const createLmi = (measuredLoad: number): LmiState => ({ measuredLoad, utilization: 0, status: 'normal' });

/** First-order sensor filter on the rope tension, then classification at the current radius. */
export function updateLmi(state: LmiState, reading: LmiReading, spec: CraneSpec, step: number): LmiState {
  const blend = 1 - Math.exp(-step / spec.lmi.filterTime);
  const measuredLoad = state.measuredLoad + (reading.tension / GRAVITY - state.measuredLoad) * blend;
  const utilization = utilizationAt(spec.loadChart, reading.radius, measuredLoad);
  return { measuredLoad, utilization, status: classify(spec.lmi, utilization, state.status) };
}
