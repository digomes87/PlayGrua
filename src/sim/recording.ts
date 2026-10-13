/**
 * Log of an operation: the joystick demand at every physics step and the steps at which the hook
 * was rigged or released. The simulation is deterministic, so this is all a replay needs.
 */
import type { CraneCommand } from '../physics/crane';

interface Segment {
  readonly command: CraneCommand;
  readonly steps: number;
}

export interface Recording {
  /** Run-length encoded demand: consecutive identical commands share one segment. */
  readonly segments: readonly Segment[];
  /** Step counts at which the rigging was toggled, before that step ran. */
  readonly riggingAt: readonly number[];
  readonly steps: number;
}

export const EMPTY_RECORDING: Recording = { segments: [], riggingAt: [], steps: 0 };

const isSame = (first: CraneCommand, second: CraneCommand): boolean =>
  first.slew === second.slew &&
  first.trolley === second.trolley &&
  first.hoist === second.hoist &&
  first.fine === second.fine &&
  first.emergencyStop === second.emergencyStop &&
  first.weathervane === second.weathervane;

export function recordStep(recording: Recording, command: CraneCommand): Recording {
  const last = recording.segments[recording.segments.length - 1];
  const steps = recording.steps + 1;
  if (last === undefined || !isSame(last.command, command)) {
    return { ...recording, steps, segments: [...recording.segments, { command, steps: 1 }] };
  }
  const extended = { command: last.command, steps: last.steps + 1 };
  return { ...recording, steps, segments: [...recording.segments.slice(0, -1), extended] };
}

export const recordRigging = (recording: Recording): Recording => ({
  ...recording,
  riggingAt: [...recording.riggingAt, recording.steps],
});

/** The demand of every step in order, expanded from the segments. */
export function* commandsOf(recording: Recording): Generator<CraneCommand> {
  for (const segment of recording.segments) {
    for (let index = 0; index < segment.steps; index += 1) yield segment.command;
  }
}
