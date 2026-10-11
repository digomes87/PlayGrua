import { describe, expect, test } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type KeyValueStore,
  loadBestResults,
  loadSettings,
  recordResult,
  saveSettings,
} from '../src/sim/storage';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

const brokenStore: KeyValueStore = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

describe('best results', () => {
  test('start empty', () => {
    expect(loadBestResults(memoryStore())).toEqual({});
  });

  test('keep the higher score per mission', () => {
    const store = memoryStore();

    recordResult(store, 'basic', { score: 700, seconds: 200 });
    recordResult(store, 'basic', { score: 650, seconds: 150 });
    const best = recordResult(store, 'wind', { score: 400, seconds: 320 });

    expect(best).toEqual({ basic: { score: 700, seconds: 200 }, wind: { score: 400, seconds: 320 } });
    expect(loadBestResults(store)).toEqual(best);
  });

  test('survive corrupted or foreign data', () => {
    expect(loadBestResults(memoryStore({ 'playgrua.best.v1': '{not json' }))).toEqual({});
    expect(loadBestResults(memoryStore({ 'playgrua.best.v1': '[1,2]' }))).toEqual({});
    expect(
      loadBestResults(memoryStore({ 'playgrua.best.v1': '{"basic":{"score":"x"},"wind":{"score":5,"seconds":9},"hack":1}' })),
    ).toEqual({ wind: { score: 5, seconds: 9 } });
  });

  test('do not throw when storage is unavailable', () => {
    expect(loadBestResults(brokenStore)).toEqual({});
    expect(recordResult(brokenStore, 'basic', { score: 1, seconds: 1 })).toEqual({ basic: { score: 1, seconds: 1 } });
  });
});

describe('settings', () => {
  test('default when nothing is stored', () => {
    expect(loadSettings(memoryStore())).toEqual(DEFAULT_SETTINGS);
  });

  test('round-trip through the store', () => {
    const store = memoryStore();
    const settings = { expo: 0.8, deadzone: 0.1, muted: true };

    expect(saveSettings(store, settings)).toBe(true);
    expect(loadSettings(store)).toEqual(settings);
  });

  test('clamp out-of-range values and replace invalid ones', () => {
    const store = memoryStore({ 'playgrua.settings.v1': '{"expo":7,"deadzone":0.9,"muted":"yes"}' });

    expect(loadSettings(store)).toEqual({ expo: 1, deadzone: 0.5, muted: false });
  });

  test('report a failed save instead of throwing', () => {
    expect(saveSettings(brokenStore, DEFAULT_SETTINGS)).toBe(false);
  });
});
