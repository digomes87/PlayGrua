/** Instrument panel drawn in HTML over the canvas. */
import type { HudText, Messages } from '../i18n/messages';
import type { Mission } from '../sim/missions';
import { element, setData, setText } from './dom';
import type { Instruments } from './instruments';

/** Utilization at the right edge of the moment bar. */
const BAR_SCALE = 1.2;

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

interface Readouts {
  readonly load: Readout;
  readonly capacity: Readout;
  readonly radius: Readout;
  readonly height: Readout;
  readonly slew: Readout;
  readonly swing: Readout;
  readonly windNow: Readout;
  readonly windMean: Readout;
}

function readouts(labels: HudText): Readouts {
  return {
    load: readout(labels.load, 't'),
    capacity: readout(labels.capacity, 't'),
    radius: readout(labels.radius, 'm'),
    height: readout(labels.height, 'm'),
    slew: readout(labels.slew, '°'),
    swing: readout(labels.swing, '°'),
    windNow: readout(labels.wind, 'km/h'),
    windMean: readout(labels.windMean, 'km/h'),
  };
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
  private readonly wind = element('section', 'wind panel');
  private readonly windNeedle = element('div', 'dial__needle dial__needle--wind');
  private readonly jibNeedle = element('div', 'dial__needle');
  private readonly readouts: Readouts;
  private alarmKey = '';

  /** Builds the panel in one language; a change of language builds a new panel over the old one. */
  constructor(
    private readonly root: HTMLElement,
    private readonly text: Messages,
  ) {
    this.readouts = readouts(text.hud);
    root.replaceChildren(this.buildMission(), this.alarms, this.buildCamera(), this.buildMoment(), this.buildGeometry(), this.buildWind());
    this.alarms.setAttribute('role', 'alert');
  }

  set visible(isVisible: boolean) {
    this.root.hidden = !isVisible;
  }

  showMission(mission: Mission): void {
    const { title, briefing } = this.text.missions[mission.id];
    setText(this.title, title);
    setText(this.brief, briefing);
    this.clock.hidden = mission.goal === null;
  }

  update(frame: HudFrame): void {
    const { instruments } = frame;
    setText(this.clock, formatClock(frame.elapsed));
    setText(this.hint, frame.hint);
    setText(this.camera, frame.cameraLabel);
    this.updateMoment(instruments);
    this.updateGeometry(instruments);
    this.updateWind(instruments);
    this.updateAlarms(frame.alarms);
  }

  private updateGeometry(instruments: Instruments): void {
    const { radius, height, slew, swing } = this.readouts;
    setText(radius.value, instruments.radius.toFixed(1));
    setText(height.value, instruments.hookHeight.toFixed(1));
    setText(slew.value, instruments.slewDegrees.toFixed(0));
    setText(swing.value, instruments.swingDegrees.toFixed(1));
  }

  private updateMoment(instruments: Instruments): void {
    setData(this.moment, 'status', instruments.lmiStatus);
    setText(this.momentValue, (instruments.utilization * 100).toFixed(0));
    setText(this.momentStatus, this.text.lmi[instruments.lmiStatus]);
    setText(this.readouts.load.value, instruments.loadTonnes.toFixed(2));
    setText(this.readouts.capacity.value, instruments.capacityTonnes.toFixed(2));
    this.fill.style.transform = `scaleX(${Math.min(instruments.utilization / BAR_SCALE, 1).toFixed(3)})`;
  }

  private updateWind(instruments: Instruments): void {
    setData(this.wind, 'level', instruments.windLevel);
    setText(this.readouts.windNow.value, instruments.windKmh.toFixed(0));
    setText(this.readouts.windMean.value, instruments.windAverageKmh.toFixed(0));
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
    panel.append(element('div', 'label', this.text.hud.camera), this.camera);
    return panel;
  }

  private buildMoment(): HTMLElement {
    const figure = element('div', 'moment__figure figure');
    figure.append(this.momentValue, element('span', 'moment__unit', '%'));
    const bar = element('div', 'bar');
    bar.append(this.fill, this.mark(0.9), this.mark(1));
    const pair = element('dl', 'moment__pair');
    pair.append(this.readouts.load.root, this.readouts.capacity.root);
    this.moment.append(element('div', 'label', this.text.hud.moment), this.momentStatus, figure, bar, pair);
    return this.moment;
  }

  private mark(utilization: number): HTMLElement {
    const mark = element('div', 'bar__mark');
    mark.style.left = `${((utilization / BAR_SCALE) * 100).toFixed(2)}%`;
    return mark;
  }

  private buildGeometry(): HTMLElement {
    const list = element('dl', 'geometry panel');
    const { radius, height, slew, swing } = this.readouts;
    list.append(radius.root, height.root, slew.root, swing.root);
    return list;
  }

  private buildWind(): HTMLElement {
    const dial = element('div', 'dial');
    dial.append(this.jibNeedle, this.windNeedle);
    dial.setAttribute('aria-hidden', 'true');
    const pair = element('dl', 'moment__pair');
    pair.append(this.readouts.windNow.root, this.readouts.windMean.root);
    this.wind.append(pair, dial, element('p', 'wind__legend', this.text.hud.windLegend));
    return this.wind;
  }
}
