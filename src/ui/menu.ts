/** Mission select, settings and result screens. */
import { MISSIONS, type Mission, type MissionId } from '../sim/missions';
import type { Progress } from '../sim/progress';
import { scoreLines, scoreOf } from '../sim/scoring';
import type { BestResults, Settings } from '../sim/storage';
import { element } from './dom';

export interface MenuHandlers {
  readonly onStart: (mission: MissionId) => void;
  readonly onResume: () => void;
  readonly onSettings: (settings: Settings) => void;
}

export interface MenuState {
  readonly best: BestResults;
  readonly settings: Settings;
  readonly canResume: boolean;
}

const KEYS: readonly (readonly [string, string])[] = [
  ['A / D', 'Giro à esquerda / direita'],
  ['W / S', 'Carrinho para fora / para dentro'],
  ['↑ / ↓', 'Guincho sobe / desce'],
  ['Shift', 'Modo fino (velocidade reduzida)'],
  ['Espaço', 'Engatar ou soltar a carga'],
  ['C', 'Trocar câmera'],
  ['H', 'Buzina'],
  ['X', 'Parada de emergência'],
  ['V', 'Cata-vento (libera o freio de giro)'],
  ['R · Esc', 'Reiniciar · Menu'],
  ['Gamepad', 'Esq.: giro e carrinho · Dir.: guincho · A engata · B emergência · Y câmera · LB fino'],
];

function masthead(): HTMLElement {
  const header = element('header', 'masthead');
  const title = element('h1', 'masthead__title', 'Play');
  title.append(element('em', '', 'Grua'));
  header.append(title, element('p', 'masthead__tagline', 'Simulador de grua torre · física real, sem atalhos'));
  return header;
}

function bestLabel(best: BestResults, mission: Mission): string {
  const result = best[mission.id];
  if (result === undefined) return mission.goal === null ? '' : '— pts';
  return `${result.score} pts · ${result.seconds.toFixed(0)} s`;
}

function keyTable(): HTMLElement {
  const table = element('table', 'keys');
  KEYS.forEach(([key, action]) => {
    const row = element('tr');
    const head = element('th', '', key);
    head.scope = 'row';
    row.append(head, element('td', '', action));
    table.append(row);
  });
  return table;
}

function slider(label: string, value: number, max: number, onInput: (value: number) => void): HTMLElement {
  const wrapper = element('label', 'setting');
  const input = element('input');
  const shown = element('span', 'figure', value.toFixed(2));
  input.type = 'range';
  input.min = '0';
  input.max = String(max);
  input.step = '0.01';
  input.value = String(value);
  input.addEventListener('input', () => {
    shown.textContent = input.valueAsNumber.toFixed(2);
    onInput(input.valueAsNumber);
  });
  wrapper.append(element('span', '', label), shown, input);
  return wrapper;
}

function toggle(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  const wrapper = element('label', 'setting');
  const input = element('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  wrapper.append(element('span', '', label), input);
  return wrapper;
}

export class Menu {
  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: MenuHandlers,
  ) {}

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
  }

  showMissions(state: MenuState): void {
    const list = element('ol', 'missions');
    MISSIONS.forEach((mission) => list.append(this.missionRow(mission, state.best)));
    const main = element('div');
    main.append(list);
    if (state.canResume) main.append(this.actions([['Continuar', this.handlers.onResume, false]]));
    this.open(masthead(), main, this.sidebar(state.settings));
  }

  showResult(mission: Mission, progress: Progress, best: BestResults): void {
    const succeeded = progress.outcome === 'success';
    const verdict = element('h2', succeeded ? 'verdict' : 'verdict verdict--failed', succeeded ? 'Missão cumprida' : 'Missão falhou');
    verdict.append(element('span', 'verdict__score', `${scoreOf(progress, mission)} pts`));
    const table = element('table', 'score-lines');
    scoreLines(progress, mission).forEach((line) => {
      const row = element('tr');
      row.append(element('td', '', line.label), element('td', '', line.value), element('td', '', `−${line.penalty.toFixed(0)}`));
      table.append(row);
    });
    const main = element('div');
    main.append(
      verdict,
      element('p', 'masthead__tagline', progress.message),
      table,
      element('p', 'mission-row__best', `Melhor: ${bestLabel(best, mission)}`),
      this.actions([
        ['Tentar de novo', () => this.handlers.onStart(mission.id), false],
        ['Missões', () => this.handlers.onResume(), true],
      ]),
    );
    this.open(masthead(), main, element('div'));
  }

  private open(...content: HTMLElement[]): void {
    this.root.replaceChildren(...content);
    this.root.hidden = false;
    this.root.querySelector('button')?.focus();
  }

  private missionRow(mission: Mission, best: BestResults): HTMLElement {
    const item = element('li');
    const button = element('button', 'mission-row');
    const text = element('span');
    text.append(element('span', 'mission-row__title', mission.title), element('span', 'mission-row__brief', mission.briefing));
    button.type = 'button';
    button.append(text, element('span', 'mission-row__best', bestLabel(best, mission)));
    button.addEventListener('click', () => this.handlers.onStart(mission.id));
    item.append(button);
    return item;
  }

  private actions(buttons: readonly (readonly [string, () => void, boolean])[]): HTMLElement {
    const row = element('div', 'actions');
    buttons.forEach(([label, onClick, isGhost]) => {
      const button = element('button', isGhost ? 'button button--ghost' : 'button', label);
      button.type = 'button';
      button.addEventListener('click', onClick);
      row.append(button);
    });
    return row;
  }

  private sidebar(settings: Settings): HTMLElement {
    const controls = element('section');
    controls.append(element('h2', '', 'Controles'), keyTable());
    const tuning = element('section');
    const change = (patch: Partial<Settings>): void => {
      this.current = { ...this.current, ...patch };
      this.handlers.onSettings(this.current);
    };
    this.current = settings;
    tuning.append(
      element('h2', '', 'Ajustes do joystick'),
      slider('Curva expo', settings.expo, 1, (expo) => change({ expo })),
      slider('Zona morta', settings.deadzone, 0.5, (deadzone) => change({ deadzone })),
      toggle('Silenciar alarmes', settings.muted, (muted) => change({ muted })),
    );
    const sidebar = element('aside', 'sidebar');
    sidebar.append(controls, tuning);
    return sidebar;
  }

  private current: Settings = { expo: 0, deadzone: 0, muted: false };
}
