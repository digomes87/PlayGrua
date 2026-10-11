/** A running mission: owns the fixed-step loop and the only mutable simulation state. */
import type { CraneSpec } from '../craneSpec';
import type { CraneCommand } from '../physics/crane';
import { consumeFrame } from '../physics/integrator';
import { FIXED_STEP } from '../physics/units';
import { type Vec3, lerp, vec3 } from '../physics/vec3';
import type { Mission } from './missions';
import { INITIAL_PROGRESS, type Progress, judgeRelease, track } from './progress';
import { canUnrig, reachableLoad, rig, unrig } from './rigging';
import {
  type SimulationConfig,
  type SimulationState,
  createSimulation,
  hookPointAt,
  stepSimulation,
} from './simulation';
import type { Site } from './site';

/** Largest catch-up per frame; beyond this the simulation slows down instead of spiralling. */
const MAX_STEPS_PER_FRAME = 12;

/** Interpolated pose for rendering between two physics steps. */
export interface RenderPose {
  readonly slewAngle: number;
  readonly radius: number;
  /** Centre of gravity of whatever hangs from the rope. */
  readonly centre: Vec3;
  readonly hook: Vec3;
}

export type RiggingAction = 'rigged' | 'released' | 'none';

interface Timeline {
  readonly previous: SimulationState;
  readonly current: SimulationState;
  readonly leftover: number;
  readonly alpha: number;
  readonly progress: Progress;
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
    this.timeline = { previous: start, current: start, leftover: 0, alpha: 0, progress: INITIAL_PROGRESS };
  }

  get state(): SimulationState {
    return this.timeline.current;
  }

  get progress(): Progress {
    return this.timeline.progress;
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
    const slewAngle = blend(previous.crane.slew.angle, current.crane.slew.angle);
    const radius = blend(previous.crane.trolley.radius, current.crane.trolley.radius);
    const centre = lerp(previous.body.position, current.body.position, alpha);
    const height = this.config.spec.geometry.trolleyHeight;
    const pivot = vec3(radius * Math.cos(slewAngle), height, radius * Math.sin(slewAngle));
    return { slewAngle, radius, centre, hook: hookPointAt(centre, pivot, current, this.config.spec) };
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
    const released = { ...this.state, ...unrig(this.state, spec.masses.hookBlock, this.state.crane.slew.angle) };
    const placed = released.groundLoads[released.groundLoads.length - 1]!;
    const progress = judgeRelease(this.timeline.progress, this.mission, placed);
    this.timeline = { ...this.timeline, progress };
    return this.replace(released, 'released');
  }

  private replace(state: SimulationState, action: RiggingAction): RiggingAction {
    this.timeline = { ...this.timeline, previous: state, current: state };
    return action;
  }

  private step(command: CraneCommand): void {
    const { current, progress } = this.timeline;
    const result = stepSimulation(current, command, this.config, FIXED_STEP);
    const tracked = track(progress, this.mission, result.state, result.events, this.config.spec, FIXED_STEP);
    this.timeline = { ...this.timeline, previous: current, current: result.state, progress: tracked };
  }
}
