/** Mission select, settings and result screens. */
import type { Language } from '../i18n/language';
import type { Messages } from '../i18n/messages';
import { MISSIONS, type Mission, type MissionId } from '../sim/missions';
import type { Progress } from '../sim/progress';
import { scoreLines, scoreOf } from '../sim/scoring';
import type { BestResults, Settings } from '../sim/storage';
import { element } from './dom';
import { languageSwitch } from './languageSwitch';

export interface MenuHandlers {
  readonly onStart: (mission: MissionId) => void;
  readonly onResume: () => void;
  readonly onSettings: (settings: Settings) => void;
  readonly onReplay: () => void;
  readonly onLanguage: (language: Language) => void;
}

export interface MenuState {
  readonly best: BestResults;
  readonly settings: Settings;
  readonly canResume: boolean;
}

const PRIMARY_CONTROL = '.mission-row, .button';
const CHOSEN_LANGUAGE = '.language__option[aria-pressed="true"]';

function bestLabel(best: BestResults, mission: Mission): string {
  const result = best[mission.id];
  if (result === undefined) return mission.goal === null ? '' : '— pts';
  return `${result.score} pts · ${result.seconds.toFixed(0)} s`;
}

function keyTable(keys: Messages['menu']['keys']): HTMLElement {
  const table = element('table', 'keys');
  keys.forEach(([key, action]) => {
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
  private current: Settings = { expo: 0, deadzone: 0, muted: false };
  /** Draws the screen on show, so a change of language can draw it again. */
  private screen: () => void = () => undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: MenuHandlers,
    private text: Messages,
  ) {}

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
  }

  showMissions(state: MenuState): void {
    this.current = state.settings;
    this.show(() => this.drawMissions(state.best, state.canResume));
  }

  showResult(mission: Mission, progress: Progress, best: BestResults): void {
    this.show(() => this.drawResult(mission, progress, best));
  }

  /** Redraws the open screen in another language and keeps the focus on the language switch. */
  translate(text: Messages): void {
    this.text = text;
    if (!this.isOpen) return;
    this.screen();
    this.focus(CHOSEN_LANGUAGE);
  }

  private show(screen: () => void): void {
    this.screen = screen;
    screen();
    this.root.hidden = false;
    this.focus(PRIMARY_CONTROL);
  }

  private focus(selector: string): void {
    this.root.querySelector<HTMLElement>(selector)?.focus();
  }

  private drawMissions(best: BestResults, canResume: boolean): void {
    const list = element('ol', 'missions');
    MISSIONS.forEach((mission) => list.append(this.missionRow(mission, best)));
    const main = element('div');
    main.append(list);
    if (canResume) main.append(this.actions([[this.text.menu.resume, this.handlers.onResume, false]]));
    this.root.replaceChildren(this.masthead(), main, this.sidebar());
  }

  private drawResult(mission: Mission, progress: Progress, best: BestResults): void {
    const { menu } = this.text;
    const main = element('div');
    main.append(
      this.verdict(mission, progress),
      element('p', 'masthead__tagline', this.text.progress[progress.message]),
      this.scoreTable(mission, progress),
      element('p', 'mission-row__best', `${menu.best}: ${bestLabel(best, mission)}`),
      this.actions([
        [menu.retry, () => this.handlers.onStart(mission.id), false],
        [menu.replay, () => this.handlers.onReplay(), true],
        [menu.missions, () => this.handlers.onResume(), true],
      ]),
    );
    this.root.replaceChildren(this.masthead(), main, element('div'));
  }

  private masthead(): HTMLElement {
    const header = element('header', 'masthead');
    const title = element('h1', 'masthead__title', 'Play');
    title.append(element('em', '', 'Grua'));
    header.append(
      title,
      languageSwitch(this.text.languageSwitch, this.text.language, this.handlers.onLanguage),
      element('p', 'masthead__tagline', this.text.tagline),
    );
    return header;
  }

  private verdict(mission: Mission, progress: Progress): HTMLElement {
    const succeeded = progress.outcome === 'success';
    const label = succeeded ? this.text.menu.succeeded : this.text.menu.failed;
    const verdict = element('h2', succeeded ? 'verdict' : 'verdict verdict--failed', label);
    verdict.append(element('span', 'verdict__score', `${scoreOf(progress, mission)} pts`));
    return verdict;
  }

  private scoreTable(mission: Mission, progress: Progress): HTMLElement {
    const table = element('table', 'score-lines');
    scoreLines(progress, mission).forEach((line) => {
      const row = element('tr');
      const label = this.text.score[line.criterion];
      row.append(element('td', '', label), element('td', '', line.value), element('td', '', `−${line.penalty.toFixed(0)}`));
      table.append(row);
    });
    return table;
  }

  private missionRow(mission: Mission, best: BestResults): HTMLElement {
    const { title, briefing } = this.text.missions[mission.id];
    const item = element('li');
    const button = element('button', 'mission-row');
    const text = element('span');
    text.append(element('span', 'mission-row__title', title), element('span', 'mission-row__brief', briefing));
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

  private sidebar(): HTMLElement {
    const { menu } = this.text;
    const controls = element('section');
    controls.append(element('h2', '', menu.controls), keyTable(menu.keys));
    const tuning = element('section');
    const change = (patch: Partial<Settings>): void => {
      this.current = { ...this.current, ...patch };
      this.handlers.onSettings(this.current);
    };
    tuning.append(
      element('h2', '', menu.joystick),
      slider(menu.expo, this.current.expo, 1, (expo) => change({ expo })),
      slider(menu.deadzone, this.current.deadzone, 0.5, (deadzone) => change({ deadzone })),
      toggle(menu.mute, this.current.muted, (muted) => change({ muted })),
    );
    const sidebar = element('aside', 'sidebar');
    sidebar.append(controls, tuning);
    return sidebar;
  }
}
