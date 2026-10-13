/** Folds simulation steps into mission telemetry and decides success or failure. */
import type { CraneSpec } from '../craneSpec';
import type { Goal, Mission, PlaceGoal, ReachGoal } from './missions';
import type { GroundLoad } from './rigging';
import { type SimulationState, type StepEvents, isCarrying, loadSwing } from './simulation';

export type Outcome = 'running' | 'success' | 'failed';

export interface Progress {
  readonly elapsed: number;
  /** Widest rope angle with the payload in the air, radians. */
  readonly maxSwing: number;
  readonly hardestLanding: number;
  readonly hardLandings: number;
  readonly peakUtilization: number;
  readonly collisions: number;
  readonly cutoffs: number;
  readonly overloaded: boolean;
  /** Rope angle when the payload last touched down, radians; infinite until it has landed once. */
  readonly touchdownSwing: number;
  readonly holdTime: number;
  readonly inContact: boolean;
  readonly wasBlocked: boolean;
  readonly outcome: Outcome;
  readonly message: string;
}

export const HARD_LANDING_SPEED = 0.5;
const BUMP_THRESHOLD = 0.05;
const STILL_SPEED = 0.02;
const SURFACE_TOLERANCE = 0.3;

export const INITIAL_PROGRESS: Progress = {
  elapsed: 0,
  maxSwing: 0,
  hardestLanding: 0,
  hardLandings: 0,
  peakUtilization: 0,
  collisions: 0,
  cutoffs: 0,
  overloaded: false,
  touchdownSwing: Number.POSITIVE_INFINITY,
  holdTime: 0,
  inContact: false,
  wasBlocked: false,
  outcome: 'running',
  message: '',
};

const swingOf = loadSwing;

function trackSwing(progress: Progress, state: SimulationState, spec: CraneSpec): Progress {
  if (!isCarrying(state)) return progress;
  return { ...progress, maxSwing: Math.max(progress.maxSwing, swingOf(state, spec)) };
}

function trackLanding(progress: Progress, state: SimulationState, events: StepEvents, spec: CraneSpec): Progress {
  if (events.touchdownSpeed <= 0 || state.cargo === null) return progress;
  const isHard = events.touchdownSpeed > HARD_LANDING_SPEED;
  return {
    ...progress,
    hardestLanding: Math.max(progress.hardestLanding, events.touchdownSpeed),
    hardLandings: progress.hardLandings + (isHard ? 1 : 0),
    touchdownSwing: swingOf(state, spec),
  };
}

function trackBumps(progress: Progress, events: StepEvents): Progress {
  const inContact = events.bumpSpeed > BUMP_THRESHOLD;
  const isNewHit = inContact && !progress.inContact;
  return { ...progress, inContact, collisions: progress.collisions + (isNewHit ? 1 : 0) };
}

function trackLmi(progress: Progress, state: SimulationState): Progress {
  const isBlocked = state.lmi.status === 'cutoff' || state.lmi.status === 'overload';
  const isNewCutoff = isBlocked && !progress.wasBlocked;
  return {
    ...progress,
    wasBlocked: isBlocked,
    cutoffs: progress.cutoffs + (isNewCutoff ? 1 : 0),
    overloaded: progress.overloaded || state.lmi.status === 'overload',
    peakUtilization: Math.max(progress.peakUtilization, state.lmi.utilization),
  };
}

const isStill = (state: SimulationState): boolean =>
  Math.abs(state.crane.trolley.speed) < STILL_SPEED && Math.abs(state.crane.hoist.rate) < STILL_SPEED;

function isHolding(goal: ReachGoal, state: SimulationState): boolean {
  if (state.cargo?.payload.id !== goal.payloadId) return false;
  const isOnTarget = Math.abs(state.lmi.utilization - goal.utilization) <= goal.tolerance;
  return isCarrying(state) && isOnTarget && isStill(state);
}

function judgeReach(progress: Progress, goal: ReachGoal, state: SimulationState, step: number): Progress {
  if (progress.cutoffs > 0) return { ...progress, outcome: 'failed', message: 'O LMI bloqueou os movimentos.' };
  const holdTime = isHolding(goal, state) ? progress.holdTime + step : 0;
  if (holdTime < goal.holdSeconds) return { ...progress, holdTime };
  return { ...progress, holdTime, outcome: 'success', message: 'Carga mantida a 95 % do momento.' };
}

function judgeStep(progress: Progress, goal: Goal | null, state: SimulationState, step: number): Progress {
  if (goal === null) return progress;
  if (progress.overloaded) return { ...progress, outcome: 'failed', message: 'Sobrecarga acima de 110 %: falha grave.' };
  if (goal.kind === 'reach') return judgeReach(progress, goal, state, step);
  return progress;
}

/** Updates the telemetry with one simulation step. */
export function track(
  progress: Progress,
  mission: Mission,
  state: SimulationState,
  events: StepEvents,
  spec: CraneSpec,
  step: number,
): Progress {
  if (progress.outcome !== 'running') return progress;
  const timed = { ...progress, elapsed: progress.elapsed + step };
  const swung = trackSwing(timed, state, spec);
  const landed = trackLanding(swung, state, events, spec);
  const tracked = trackLmi(trackBumps(landed, events), state);
  return judgeStep(tracked, mission.goal, state, step);
}

function isInZone(goal: PlaceGoal, load: GroundLoad): boolean {
  const { center, radius } = goal.zone;
  const offset = Math.hypot(load.position.x - center.x, load.position.z - center.z);
  return offset <= radius && Math.abs(load.position.y - center.y) <= SURFACE_TOLERANCE;
}

/** Called when the hook is released: a placing mission ends once the payload stands in the zone. */
export function judgeRelease(progress: Progress, mission: Mission, released: GroundLoad): Progress {
  const goal = mission.goal;
  if (progress.outcome !== 'running' || goal === null || goal.kind !== 'place') return progress;
  if (released.payload.id !== goal.payloadId) return progress;
  if (!isInZone(goal, released)) return { ...progress, message: 'Fora do alvo. Reposicione a carga.' };
  if (!(progress.touchdownSwing <= goal.maxTouchdownSwing)) {
    return { ...progress, message: 'Balanço acima do permitido no pouso. Tente de novo.' };
  }
  return { ...progress, outcome: 'success', message: 'Carga posicionada.' };
}
