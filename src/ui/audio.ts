/** Cab sounds from WebAudio oscillators: LMI alarm, wind alarm and horn. No audio files. */

export interface SoundState {
  readonly lmi: 'off' | 'warning' | 'cutoff';
  readonly windAlert: boolean;
  readonly horn: boolean;
  readonly muted: boolean;
}

interface Voice {
  readonly gain: GainNode;
}

const RAMP = 0.015;
const LEVELS = { alarm: 0.07, wind: 0.05, horn: 0.16 } as const;

/** Square-wave gate: on for `duty` of every `period` seconds. */
const isGateOpen = (time: number, period: number, duty: number): boolean => time % period < period * duty;

export class CabAudio {
  private context: AudioContext | null = null;
  private voices: { alarm: Voice; wind: Voice; horn: Voice } | null = null;

  /** Browsers only allow audio after a user gesture; call this from one. */
  unlock(): void {
    if (this.context !== null) {
      void this.context.resume();
      return;
    }
    try {
      this.context = new AudioContext();
      this.voices = {
        alarm: this.voice('square', [1150]),
        wind: this.voice('sine', [520]),
        horn: this.voice('sawtooth', [220, 277]),
      };
    } catch {
      this.context = null;
    }
  }

  update(state: SoundState): void {
    if (this.context === null || this.voices === null) return;
    const now = this.context.currentTime;
    const alarmOpen =
      (state.lmi === 'warning' && isGateOpen(now, 0.7, 0.3)) || (state.lmi === 'cutoff' && isGateOpen(now, 0.24, 0.6));
    const windOpen = state.windAlert && isGateOpen(now, 2.4, 0.18);
    this.level(this.voices.alarm, alarmOpen && !state.muted ? LEVELS.alarm : 0, now);
    this.level(this.voices.wind, windOpen && !state.muted ? LEVELS.wind : 0, now);
    this.level(this.voices.horn, state.horn && !state.muted ? LEVELS.horn : 0, now);
  }

  private level(voice: Voice, target: number, now: number): void {
    voice.gain.gain.setTargetAtTime(target, now, RAMP);
  }

  private voice(type: OscillatorType, frequencies: readonly number[]): Voice {
    const context = this.context!;
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(context.destination);
    frequencies.forEach((frequency) => {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start();
    });
    return { gain };
  }
}
