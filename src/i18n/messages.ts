/** Shape of an interface translation. The simulation emits identifiers; the text for them lives here. */
import type { LmiStatus } from '../physics/loadChart';
import type { CameraMode } from '../render/cameras';
import type { MissionId } from '../sim/missions';
import type { ProgressMessage } from '../sim/progress';
import type { ScoreCriterion } from '../sim/scoring';
import type { Language } from './language';

export interface MissionText {
  readonly title: string;
  readonly briefing: string;
}

export interface PageText {
  readonly title: string;
  readonly description: string;
  readonly stage: string;
  readonly scene: string;
  readonly hud: string;
  readonly menu: string;
}

export interface AlarmText {
  readonly emergency: string;
  readonly ropeFouled: string;
  readonly zoneLimit: string;
  readonly overload: string;
  readonly cutoff: string;
  readonly warning: string;
  readonly windLockout: string;
  readonly windAlert: string;
  readonly tagLine: string;
  readonly weathervane: string;
}

export interface HintText {
  readonly replay: (speed: number, percent: number) => string;
  readonly rig: string;
  readonly release: string;
}

export interface HudText {
  readonly load: string;
  readonly capacity: string;
  readonly radius: string;
  readonly height: string;
  readonly slew: string;
  readonly swing: string;
  readonly wind: string;
  readonly windMean: string;
  readonly camera: string;
  readonly moment: string;
  readonly windLegend: string;
}

export interface MenuText {
  readonly resume: string;
  readonly succeeded: string;
  readonly failed: string;
  readonly best: string;
  readonly retry: string;
  readonly replay: string;
  readonly missions: string;
  readonly controls: string;
  readonly joystick: string;
  readonly expo: string;
  readonly deadzone: string;
  readonly mute: string;
  /** Key or button, then what it does. */
  readonly keys: readonly (readonly [string, string])[];
}

export interface Messages {
  readonly language: Language;
  readonly page: PageText;
  readonly tagline: string;
  readonly languageSwitch: string;
  readonly missions: Readonly<Record<MissionId, MissionText>>;
  readonly progress: Readonly<Record<ProgressMessage, string>>;
  readonly score: Readonly<Record<ScoreCriterion, string>>;
  readonly cameras: Readonly<Record<CameraMode, string>>;
  readonly lmi: Readonly<Record<LmiStatus, string>>;
  readonly alarms: AlarmText;
  readonly hints: HintText;
  readonly hud: HudText;
  readonly menu: MenuText;
}
