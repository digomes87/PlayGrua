/** Application shell: wires input, simulation, 3D view, instrument panel and menus. */
import { DEFAULT_CRANE_SPEC } from './craneSpec';
import { type Action, type DeviceInput, mergeInputs } from './input/actions';
import { CAB_LAYOUT, GamepadReader } from './input/gamepad';
import { Keyboard } from './input/keyboard';
import type { CraneCommand } from './physics/crane';
import { CAMERA_LABELS } from './render/cameras';
import { SceneView } from './render/view';
import { PHYSICS_RATE_HZ } from './physics/units';
import { type MissionId, missionById } from './sim/missions';
import { Replay } from './sim/replay';
import { scoreOf } from './sim/scoring';
import { Session } from './sim/session';
import { DEFAULT_SITE } from './sim/site';
import { zonePermits } from './sim/zoning';
import { type BestResults, type Settings, browserStore, loadBestResults, loadSettings, recordResult, saveSettings } from './sim/storage';
import { CabAudio } from './ui/audio';
import { requireElement } from './ui/dom';
import { type Alarm, Hud } from './ui/hud';
import { type Instruments, readInstruments } from './ui/instruments';
import { Menu } from './ui/menu';

const MAX_FRAME_SECONDS = 0.25;
const MILLISECONDS = 1000;
/** A replay runs this many times faster than the operation it shows. */
const REPLAY_SPEED = 4;

interface Latches {
  readonly emergency: boolean;
  readonly weathervane: boolean;
}

const RELEASED: Latches = { emergency: false, weathervane: false };

interface Hazards {
  readonly isTagLineHeld: boolean;
  readonly isZoneLimited: boolean;
  readonly isRopeFouled: boolean;
}

function alarmsFor(instruments: Instruments, latches: Latches, hazards: Hazards): readonly Alarm[] {
  const candidates: readonly (Alarm | false)[] = [
    latches.emergency && { text: 'Parada de emergência · X para rearmar', severity: 'danger', steady: true },
    hazards.isRopeFouled && { text: 'Cabo encostado na estrutura', severity: 'danger', steady: false },
    hazards.isZoneLimited && { text: 'Limite de zona · movimento bloqueado', severity: 'warning', steady: true },
    instruments.lmiStatus === 'overload' && { text: 'Sobrecarga acima de 110 %', severity: 'danger', steady: false },
    instruments.lmiStatus === 'cutoff' && { text: 'LMI · bloqueio: só descer ou recolher', severity: 'danger', steady: false },
    instruments.lmiStatus === 'warning' && { text: 'LMI · 90 % da capacidade', severity: 'warning', steady: false },
    instruments.windLevel === 'lockout' && { text: 'Vento acima de 72 km/h · operação bloqueada · V libera o giro', severity: 'danger', steady: false },
    instruments.windLevel === 'alert' && { text: 'Vento forte', severity: 'warning', steady: false },
    hazards.isTagLineHeld && { text: 'Cabo-guia · sinaleiros segurando a carga', severity: 'warning', steady: true },
    latches.weathervane && { text: 'Cata-vento · freio de giro liberado', severity: 'warning', steady: true },
  ];
  return candidates.filter((alarm): alarm is Alarm => alarm !== false);
}

export class App {
  private readonly store = browserStore();
  private readonly view: SceneView;
  private readonly hud: Hud;
  private readonly menu: Menu;
  private readonly keyboard = new Keyboard(window);
  private readonly gamepad = new GamepadReader(CAB_LAYOUT);
  private readonly audio = new CabAudio();
  private session: Session;
  private settings: Settings;
  private best: BestResults;
  private latches = RELEASED;
  private lastFrame = 0;
  private isReported = false;
  private isBackdropDrawn = false;
  private replay: Replay | null = null;

  constructor() {
    const canvas = requireElement('scene', HTMLCanvasElement);
    this.settings = loadSettings(this.store);
    this.best = loadBestResults(this.store);
    this.view = new SceneView(canvas, DEFAULT_CRANE_SPEC, DEFAULT_SITE);
    this.hud = new Hud(requireElement('hud', HTMLElement));
    this.menu = new Menu(requireElement('overlay', HTMLElement), {
      onStart: (mission) => this.start(mission),
      onResume: () => this.resume(),
      onSettings: (settings) => this.applySettings(settings),
      onReplay: () => this.startReplay(),
    });
    this.session = this.load('free');
    window.addEventListener('resize', () => {
      this.view.resize();
      this.isBackdropDrawn = false;
    });
    window.addEventListener('pointerdown', () => this.audio.unlock());
    window.addEventListener('keydown', () => this.audio.unlock());
    this.openMenu(false);
  }

  run(): void {
    requestAnimationFrame((time) => this.frame(time));
  }

  private frame(time: number): void {
    const elapsed = Math.min((time - this.lastFrame) / MILLISECONDS, MAX_FRAME_SECONDS);
    this.lastFrame = time;
    const input = mergeInputs(this.keyboard.read(), this.gamepad.read(this.settings));
    input.actions.forEach((action) => this.perform(action));
    if (!this.menu.isOpen) this.advance(elapsed, input);
    this.draw();
    this.refresh(input);
    requestAnimationFrame((next) => this.frame(next));
  }

  /** Behind the menu the scene is a still backdrop: it is drawn once, not sixty times a second. */
  private draw(): void {
    if (this.menu.isOpen && this.isBackdropDrawn) return;
    this.isBackdropDrawn = this.menu.isOpen;
    this.view.render(this.shown);
  }

  /** The session on screen: the replay while one runs, the live operation otherwise. */
  private get shown(): Session {
    return this.replay?.session ?? this.session;
  }

  private advance(elapsed: number, input: DeviceInput): void {
    if (this.replay === null) return this.simulate(elapsed, input);
    this.replay.advance(Math.round(elapsed * PHYSICS_RATE_HZ * REPLAY_SPEED));
    if (this.replay.isFinished) this.endReplay();
  }

  private startReplay(): void {
    const { mission, config, recording } = this.session;
    this.replay = new Replay(mission, config.spec, config.site, recording);
    this.isBackdropDrawn = false;
    this.menu.hide();
    this.hud.visible = true;
  }

  private endReplay(): void {
    this.replay = null;
    this.isBackdropDrawn = false;
    this.report();
  }

  private simulate(elapsed: number, input: DeviceInput): void {
    this.session.advance(elapsed, this.commandFrom(input));
    if (this.session.progress.outcome === 'running' || this.isReported) return;
    this.isReported = true;
    this.report();
  }

  private commandFrom(input: DeviceInput): CraneCommand {
    return { ...input.axes, fine: input.fine, emergencyStop: this.latches.emergency, weathervane: this.latches.weathervane };
  }

  private refresh(input: DeviceInput): void {
    const instruments = readInstruments(this.shown.state, this.shown.config);
    const lmi = instruments.lmiStatus === 'normal' ? 'off' : instruments.lmiStatus === 'warning' ? 'warning' : 'cutoff';
    this.audio.update({
      lmi: this.menu.isOpen ? 'off' : lmi,
      windAlert: !this.menu.isOpen && instruments.windLevel !== 'normal',
      horn: input.horn,
      muted: this.settings.muted,
    });
    this.hud.update({
      instruments,
      alarms: alarmsFor(instruments, this.latches, this.hazards()),
      elapsed: this.shown.progress.elapsed,
      hint: this.hint(),
      cameraLabel: CAMERA_LABELS[this.view.cameraMode],
    });
  }

  private hazards(): Hazards {
    const { spec, site } = this.shown.config;
    const permits = zonePermits(this.shown.state.crane, site.zones, spec);
    return {
      isTagLineHeld: this.shown.state.cargo?.tagHeading != null,
      isZoneLimited: Object.values(permits).includes(false),
      isRopeFouled: this.shown.progress.isRopeFouled,
    };
  }

  private hint(): string {
    if (this.replay !== null) return `Replay ${REPLAY_SPEED}× · ${Math.round(this.replay.progress * 100)} % · Esc encerra`;
    if (this.session.canRig()) return 'Espaço: engatar a carga';
    if (this.session.canRelease()) return 'Espaço: soltar a carga';
    return this.session.progress.message;
  }

  private perform(action: Action): void {
    if (action === 'menu' && this.replay !== null) return this.endReplay();
    if (action === 'menu') return this.toggleMenu();
    if (this.replay !== null && action !== 'camera') return;
    if (this.menu.isOpen) return;
    if (action === 'camera') return void this.view.nextCamera();
    if (action === 'restart') return this.start(this.session.mission.id);
    if (action === 'rigging') return void this.session.toggleRigging();
    if (action === 'tagline') return void this.session.toggleTagLine();
    if (action === 'emergency') this.latches = { ...this.latches, emergency: !this.latches.emergency };
    if (action === 'weathervane') this.latches = { ...this.latches, weathervane: !this.latches.weathervane };
  }

  private load(mission: MissionId): Session {
    const session = new Session(missionById(mission), DEFAULT_CRANE_SPEC, DEFAULT_SITE);
    this.view.showMission(session.mission);
    this.hud.showMission(session.mission);
    this.latches = RELEASED;
    this.isReported = false;
    this.isBackdropDrawn = false;
    return session;
  }

  private start(mission: MissionId): void {
    this.session = this.load(mission);
    this.resume();
  }

  private resume(): void {
    if (this.isReported) return this.openMenu(false);
    this.menu.hide();
    this.hud.visible = true;
  }

  private toggleMenu(): void {
    if (this.menu.isOpen && !this.isReported) return this.resume();
    this.openMenu(!this.isReported);
  }

  private openMenu(canResume: boolean): void {
    this.hud.visible = false;
    this.menu.showMissions({ best: this.best, settings: this.settings, canResume });
  }

  private report(): void {
    const { mission, progress } = this.session;
    if (progress.outcome === 'success') {
      this.best = recordResult(this.store, mission.id, { score: scoreOf(progress, mission), seconds: progress.elapsed });
    }
    this.hud.visible = false;
    this.menu.showResult(mission, progress, this.best);
  }

  private applySettings(settings: Settings): void {
    this.settings = settings;
    saveSettings(this.store, settings);
  }
}
