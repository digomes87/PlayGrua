/** Plays a recording back by running the same mission again with the logged demand. */
import type { CraneSpec } from '../craneSpec';
import type { CraneCommand } from '../physics/crane';
import { FIXED_STEP } from '../physics/units';
import type { Mission } from './missions';
import { type Recording, commandsOf } from './recording';
import { Session } from './session';
import type { Site } from './site';

export class Replay {
  readonly session: Session;
  private readonly commands: Generator<CraneCommand>;
  private played = 0;
  private rigged = 0;

  constructor(
    mission: Mission,
    spec: CraneSpec,
    site: Site,
    private readonly recording: Recording,
  ) {
    this.session = new Session(mission, spec, site);
    this.commands = commandsOf(recording);
  }

  get isFinished(): boolean {
    return this.played >= this.recording.steps;
  }

  /** Fraction of the recording already played, 0 to 1. */
  get progress(): number {
    return this.recording.steps === 0 ? 1 : this.played / this.recording.steps;
  }

  /** Runs up to `count` recorded steps. */
  advance(count: number): void {
    for (let index = 0; index < count && !this.isFinished; index += 1) this.step();
    this.rigAsRecorded();
  }

  /** Repeats the rigging toggles logged for the step about to run, each one once. */
  private rigAsRecorded(): void {
    const { riggingAt } = this.recording;
    while (this.rigged < riggingAt.length && riggingAt[this.rigged] === this.played) {
      this.session.toggleRigging();
      this.rigged += 1;
    }
  }

  private step(): void {
    this.rigAsRecorded();
    const next = this.commands.next();
    if (next.done === true) return;
    this.session.advance(FIXED_STEP, next.value);
    this.played += 1;
  }
}
