/** Mission score from the telemetry: time, swing, landing speed, moment peaks and collisions. */
import { radToDeg } from '../physics/units';
import type { Mission } from './missions';
import type { Progress } from './progress';

export const SCORING = {
  maximum: 1000,
  perSecondOverPar: 2,
  perDegreeOfSwing: 12,
  softLandingSpeed: 0.25,
  perLandingSpeed: 400,
  comfortableUtilization: 0.9,
  perUtilization: 1500,
  perCollision: 150,
  perCutoff: 100,
} as const;

export interface ScoreLine {
  readonly label: string;
  readonly value: string;
  readonly penalty: number;
}

/** Missions that ask for a high utilization are only penalised above their own target band. */
function comfortableUtilization(mission: Mission): number {
  const goal = mission.goal;
  if (goal === null || goal.kind !== 'reach') return SCORING.comfortableUtilization;
  return goal.utilization + goal.tolerance;
}

export function scoreLines(progress: Progress, mission: Mission): readonly ScoreLine[] {
  const overtime = Math.max(0, progress.elapsed - mission.parSeconds);
  const swingDegrees = radToDeg(progress.maxSwing);
  const landingExcess = Math.max(0, progress.hardestLanding - SCORING.softLandingSpeed);
  const momentExcess = Math.max(0, progress.peakUtilization - comfortableUtilization(mission));
  return [
    { label: 'Tempo', value: `${progress.elapsed.toFixed(1)} s`, penalty: overtime * SCORING.perSecondOverPar },
    { label: 'Balanço máximo', value: `${swingDegrees.toFixed(1)}°`, penalty: swingDegrees * SCORING.perDegreeOfSwing },
    {
      label: 'Velocidade de pouso',
      value: `${progress.hardestLanding.toFixed(2)} m/s`,
      penalty: landingExcess * SCORING.perLandingSpeed,
    },
    {
      label: 'Pico de momento',
      value: `${(progress.peakUtilization * 100).toFixed(0)} %`,
      penalty: momentExcess * SCORING.perUtilization + progress.cutoffs * SCORING.perCutoff,
    },
    { label: 'Colisões', value: `${progress.collisions}`, penalty: progress.collisions * SCORING.perCollision },
  ];
}

export function scoreOf(progress: Progress, mission: Mission): number {
  if (progress.outcome !== 'success') return 0;
  const penalties = scoreLines(progress, mission).reduce((total, line) => total + line.penalty, 0);
  return Math.round(Math.min(Math.max(SCORING.maximum - penalties, 0), SCORING.maximum));
}
