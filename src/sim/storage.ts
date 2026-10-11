/** localStorage persistence for best results and settings. Every access is guarded: storage may be unavailable. */
import type { MissionId } from './missions';

export interface BestResult {
  readonly score: number;
  readonly seconds: number;
}

export type BestResults = Partial<Record<MissionId, BestResult>>;

export interface Settings {
  /** 0 = linear stick response, 1 = fully cubic. */
  readonly expo: number;
  readonly deadzone: number;
  readonly muted: boolean;
}

/** Minimal slice of the Storage API, so tests can pass a fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_SETTINGS: Settings = { expo: 0.5, deadzone: 0.08, muted: false };

const BEST_KEY = 'playgrua.best.v1';
const SETTINGS_KEY = 'playgrua.settings.v1';
const MISSION_IDS: readonly MissionId[] = ['free', 'basic', 'limit', 'wind', 'precision'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function readJson(store: KeyValueStore, key: string): unknown {
  try {
    const raw = store.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(store: KeyValueStore, key: string, value: unknown): boolean {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function parseBest(value: unknown): BestResult | undefined {
  if (!isRecord(value) || !isFiniteNumber(value.score) || !isFiniteNumber(value.seconds)) return undefined;
  return { score: value.score, seconds: value.seconds };
}

export function loadBestResults(store: KeyValueStore): BestResults {
  const stored = readJson(store, BEST_KEY);
  if (!isRecord(stored)) return {};
  return MISSION_IDS.reduce<BestResults>((results, id) => {
    const best = parseBest(stored[id]);
    return best === undefined ? results : { ...results, [id]: best };
  }, {});
}

const isBetter = (candidate: BestResult, current: BestResult | undefined): boolean =>
  current === undefined || candidate.score > current.score;

/** Keeps the higher score per mission. Returns the table as it stands after the attempt. */
export function recordResult(store: KeyValueStore, mission: MissionId, result: BestResult): BestResults {
  const current = loadBestResults(store);
  if (!isBetter(result, current[mission])) return current;
  const updated = { ...current, [mission]: result };
  writeJson(store, BEST_KEY, updated);
  return updated;
}

const clampUnit = (value: unknown, fallback: number): number =>
  isFiniteNumber(value) ? Math.min(Math.max(value, 0), 1) : fallback;

export function loadSettings(store: KeyValueStore): Settings {
  const stored = readJson(store, SETTINGS_KEY);
  if (!isRecord(stored)) return DEFAULT_SETTINGS;
  return {
    expo: clampUnit(stored.expo, DEFAULT_SETTINGS.expo),
    deadzone: Math.min(clampUnit(stored.deadzone, DEFAULT_SETTINGS.deadzone), 0.5),
    muted: typeof stored.muted === 'boolean' ? stored.muted : DEFAULT_SETTINGS.muted,
  };
}

export const saveSettings = (store: KeyValueStore, settings: Settings): boolean =>
  writeJson(store, SETTINGS_KEY, settings);

const UNAVAILABLE: KeyValueStore = { getItem: () => null, setItem: () => undefined };

/** The browser store, or an inert stand-in when the browser refuses access. */
export function browserStore(): KeyValueStore {
  try {
    return window.localStorage;
  } catch {
    return UNAVAILABLE;
  }
}
