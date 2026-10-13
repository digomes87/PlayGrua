/** A running mission: owns the fixed-step loop and the only mutable simulation state. */
import type { CraneSpec } from '../craneSpec';
import type { CraneCommand } from '../physics/crane';
import { consumeFrame } from '../physics/integrator';
import { FIXED_STEP } from '../physics/units';
import { type Vec3, lerp } from '../physics/vec3';
import type { Mission } from './missions';
import { INITIAL_PROGRESS, type Progress, judgeRelease, track } from './progress';
import { EMPTY_RECORDING, type Recording, recordRigging, recordStep } from './recording';
import { canUnrig, reachableLoad, rig, unrig } from './rigging';
import {
  type SimulationConfig,
  type SimulationState,
  createSimulation,
  stepSimulation,
} from './simulation';
import type { Site } from './site';

/** Largest catch-up per frame; beyond this the simulation slows down instead of spiralling. */
const MAX_STEPS_PER_FRAME = 12;

/** Interpolated pose for rendering between two physics steps. */
export interface RenderPose {
  readonly slewAngle: number;
  readonly radius: number;
  readonly hook: Vec3;
  /** Centre of gravity and heading of the slung payload. */
  readonly cargo: { readonly position: Vec3; readonly yaw: number } | null;
}

export type RiggingAction = 'rigged' | 'released' | 'none';

interface Timeline {
  readonly previous: SimulationState;
  readonly current: SimulationState;
  readonly leftover: number;
  readonly alpha: number;
  readonly progress: Progress;
  readonly recording: Recording;
}

export class Session {
  readonly config: SimulationConfig;
  private timeline: Timeline;

  constructor(
    readonly mission: Mission,
    spec: CraneSpec,
    site: Site,
  ) {
    this.config = { spec, site, wind: mission.wind };
    const start = createSimulation(this.config, { ...mission.start, groundLoads: mission.loads });
    this.timeline = { previous: start, current: start, leftover: 0, alpha: 0, progress: INITIAL_PROGRESS, recording: EMPTY_RECORDING };
  }

  get state(): SimulationState {
    return this.timeline.current;
  }

  get progress(): Progress {
    return this.timeline.progress;
  }

  /** Everything needed to play this operation again. */
  get recording(): Recording {
    return this.timeline.recording;
  }

  /** Runs as many fixed steps as the frame time allows. */
  advance(frameSeconds: number, command: CraneCommand): void {
    const budget = consumeFrame(this.timeline.leftover, frameSeconds, FIXED_STEP, MAX_STEPS_PER_FRAME);
    for (let index = 0; index < budget.steps; index += 1) this.step(command);
    this.timeline = { ...this.timeline, leftover: budget.remainder, alpha: budget.alpha };
  }

  pose(): RenderPose {
    const { previous, current, alpha } = this.timeline;
    const blend = (from: number, to: number): number => from + (to - from) * alpha;
    const before = previous.cargo ?? current.cargo;
    const cargo =
      current.cargo === null || before === null
        ? null
        : { position: lerp(before.body.position, current.cargo.body.position, alpha), yaw: blend(before.yaw, current.cargo.yaw) };
    return {
      slewAngle: blend(previous.crane.slew.angle, current.crane.slew.angle),
      radius: blend(previous.crane.trolley.radius, current.crane.trolley.radius),
      hook: lerp(previous.body.position, current.body.position, alpha),
      cargo,
    };
  }

  canRig(): boolean {
    return reachableLoad(this.state) !== undefined;
  }

  canRelease(): boolean {
    return canUnrig(this.state, this.state.tension, this.config.spec);
  }

  /** Slings the load under the hook, or releases the one standing slack on the ground. */
  toggleRigging(): RiggingAction {
    const { spec } = this.config;
    if (this.canRig()) return this.replace({ ...this.state, ...rig(this.state, spec) }, 'rigged');
    if (!this.canRelease()) return 'none';
    const released = { ...this.state, ...unrig(this.state) };
    const placed = released.groundLoads[released.groundLoads.length - 1]!;
    const progress = judgeRelease(this.timeline.progress, this.mission, placed);
    this.timeline = { ...this.timeline, progress };
    return this.replace(released, 'released');
  }

  private replace(state: SimulationState, action: RiggingAction): RiggingAction {
    const recording = recordRigging(this.timeline.recording);
    this.timeline = { ...this.timeline, previous: state, current: state, recording };
    return action;
  }

  private step(command: CraneCommand): void {
    const { current, progress } = this.timeline;
    const result = stepSimulation(current, command, this.config, FIXED_STEP);
    const tracked = track(progress, this.mission, result.state, result.events, this.config.spec, FIXED_STEP);
    const recording = recordStep(this.timeline.recording, command);
    this.timeline = { ...this.timeline, previous: current, current: result.state, progress: tracked, recording };
  }
}
