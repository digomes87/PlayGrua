/** Instrument panel drawn in HTML over the canvas. */
import type { LmiStatus } from '../physics/loadChart';
import type { Mission } from '../sim/missions';
import { element, setData, setText } from './dom';
import type { Instruments } from './instruments';

/** Utilization at the right edge of the moment bar. */
const BAR_SCALE = 1.2;

const STATUS_LABELS: Readonly<Record<LmiStatus, string>> = {
  normal: 'Normal',
  warning: 'Alerta 90 %',
  cutoff: 'Bloqueio',
  overload: 'Sobrecarga',
};

export interface Alarm {
  readonly text: string;
  readonly severity: 'warning' | 'danger';
  readonly steady: boolean;
}

export interface HudFrame {
  readonly instruments: Instruments;
  readonly alarms: readonly Alarm[];
  readonly elapsed: number;
  readonly hint: string;
  readonly cameraLabel: string;
}

interface Readout {
  readonly root: HTMLElement;
  readonly value: HTMLElement;
}

function readout(label: string, unit: string): Readout {
  const root = element('div', 'readout');
  const value = element('span');
  const figure = element('dd', 'figure');
  figure.append(value, element('small', '', unit));
  root.append(element('dt', 'label', label), figure);
  return { root, value };
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export class Hud {
  private readonly title = element('h1', 'mission__title');
  private readonly brief = element('p', 'mission__brief');
  private readonly clock = element('div', 'mission__clock figure');
  private readonly hint = element('p', 'mission__hint');
  private readonly alarms = element('ul', 'alarms');
  private readonly camera = element('div', 'camera__mode');
  private readonly moment = element('section', 'moment panel');
  private readonly momentValue = element('span');
  private readonly momentStatus = element('span', 'moment__status');
  private readonly fill = element('div', 'bar__fill');
  private readonly load = readout('Carga', 't');
  private readonly capacity = readout('Capacidade', 't');
  private readonly radius = readout('Raio', 'm');
  private readonly height = readout('Altura', 'm');
  private readonly slew = readout('Giro', '°');
  private readonly swing = readout('Balanço', '°');
  private readonly wind = element('section', 'wind panel');
  private readonly windNow = readout('Vento', 'km/h');
  private readonly windMean = readout('Média', 'km/h');
  private readonly windNeedle = element('div', 'dial__needle dial__needle--wind');
  private readonly jibNeedle = element('div', 'dial__needle');
  private alarmKey = '';

  constructor(private readonly root: HTMLElement) {
    root.append(this.buildMission(), this.alarms, this.buildCamera(), this.buildMoment(), this.buildGeometry(), this.buildWind());
    this.alarms.setAttribute('role', 'alert');
  }

  set visible(isVisible: boolean) {
    this.root.hidden = !isVisible;
  }

  showMission(mission: Mission): void {
    setText(this.title, mission.title);
    setText(this.brief, mission.briefing);
    this.clock.hidden = mission.goal === null;
  }

  update(frame: HudFrame): void {
    const { instruments } = frame;
    setText(this.clock, formatClock(frame.elapsed));
    setText(this.hint, frame.hint);
    setText(this.camera, frame.cameraLabel);
    this.updateMoment(instruments);
    setText(this.radius.value, instruments.radius.toFixed(1));
    setText(this.height.value, instruments.hookHeight.toFixed(1));
    setText(this.slew.value, instruments.slewDegrees.toFixed(0));
    setText(this.swing.value, instruments.swingDegrees.toFixed(1));
    this.updateWind(instruments);
    this.updateAlarms(frame.alarms);
  }

  private updateMoment(instruments: Instruments): void {
    setData(this.moment, 'status', instruments.lmiStatus);
    setText(this.momentValue, (instruments.utilization * 100).toFixed(0));
    setText(this.momentStatus, STATUS_LABELS[instruments.lmiStatus]);
    setText(this.load.value, instruments.loadTonnes.toFixed(2));
    setText(this.capacity.value, instruments.capacityTonnes.toFixed(2));
    this.fill.style.transform = `scaleX(${Math.min(instruments.utilization / BAR_SCALE, 1).toFixed(3)})`;
  }

  private updateWind(instruments: Instruments): void {
    setData(this.wind, 'level', instruments.windLevel);
    setText(this.windNow.value, instruments.windKmh.toFixed(0));
    setText(this.windMean.value, instruments.windAverageKmh.toFixed(0));
    this.windNeedle.style.transform = `rotate(${instruments.windBearing.toFixed(0)}deg)`;
    this.jibNeedle.style.transform = `rotate(${instruments.jibBearing.toFixed(0)}deg)`;
  }

  /** Rebuilds the list only when the set of alarms changes, so the blink is not restarted. */
  private updateAlarms(alarms: readonly Alarm[]): void {
    const key = alarms.map((alarm) => alarm.text).join('|');
    if (key === this.alarmKey) return;
    this.alarmKey = key;
    const items = alarms.map((alarm) => {
      const steady = alarm.steady ? ' alarm--steady' : '';
      const danger = alarm.severity === 'danger' ? ' alarm--danger' : '';
      return element('li', `alarm${danger}${steady}`, alarm.text);
    });
    this.alarms.replaceChildren(...items);
  }

  private buildMission(): HTMLElement {
    const panel = element('header', 'mission panel');
    panel.append(this.title, this.brief, this.clock, this.hint);
    this.hint.setAttribute('role', 'status');
    return panel;
  }

  private buildCamera(): HTMLElement {
    const panel = element('div', 'camera panel');
    panel.append(element('div', 'label', 'Câmera · C'), this.camera);
    return panel;
  }

  private buildMoment(): HTMLElement {
    const figure = element('div', 'moment__figure figure');
    figure.append(this.momentValue, element('span', 'moment__unit', '%'));
    const bar = element('div', 'bar');
    bar.append(this.fill, this.mark(0.9), this.mark(1));
    const pair = element('dl', 'moment__pair');
    pair.append(this.load.root, this.capacity.root);
    this.moment.append(element('div', 'label', 'Momento de carga · LMI'), this.momentStatus, figure, bar, pair);
    return this.moment;
  }

  private mark(utilization: number): HTMLElement {
    const mark = element('div', 'bar__mark');
    mark.style.left = `${((utilization / BAR_SCALE) * 100).toFixed(2)}%`;
    return mark;
  }

  private buildGeometry(): HTMLElement {
    const list = element('dl', 'geometry panel');
    list.append(this.radius.root, this.height.root, this.slew.root, this.swing.root);
    return list;
  }

  private buildWind(): HTMLElement {
    const dial = element('div', 'dial');
    dial.append(this.jibNeedle, this.windNeedle);
    dial.setAttribute('aria-hidden', 'true');
    const pair = element('dl', 'moment__pair');
    pair.append(this.windNow.root, this.windMean.root);
    this.wind.append(pair, dial, element('p', 'wind__legend', 'Seta: para onde o vento sopra · Linha: lança'));
    return this.wind;
  }
}
