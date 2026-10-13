import { describe, expect, test } from 'vitest';
import { messagesFor } from '../src/i18n/catalogue';
import { DEFAULT_LANGUAGE, LANGUAGES, optionFor, parseLanguage } from '../src/i18n/language';
import { MISSIONS } from '../src/sim/missions';

/** Every leaf of a catalogue as `path: text`, with functions called on sample values. */
function leaves(value: unknown, path = ''): string[] {
  if (typeof value === 'function') return [`${path}: ${String(value(4, 50))}`];
  if (typeof value !== 'object' || value === null) return [`${path}: ${String(value)}`];
  return Object.entries(value).flatMap(([key, child]) => leaves(child, `${path}/${key}`));
}

const pathsOf = (entries: readonly string[]): string[] => entries.map((entry) => entry.split(': ')[0]!);

describe('interface language', () => {
  test('defaults to English', () => {
    expect(DEFAULT_LANGUAGE).toBe('en');
    expect(parseLanguage(null)).toBe('en');
    expect(parseLanguage('fr')).toBe('en');
    expect(parseLanguage(7)).toBe('en');
  });

  test('accepts the languages on offer', () => {
    expect(LANGUAGES.map((option) => parseLanguage(option.id))).toEqual(['en', 'pt']);
  });

  test('tags each language for the page', () => {
    expect(optionFor('en').locale).toBe('en');
    expect(optionFor('pt').locale).toBe('pt-BR');
  });
});

describe('translations', () => {
  test('each catalogue answers for its own language', () => {
    LANGUAGES.forEach((option) => expect(messagesFor(option.id).language).toBe(option.id));
  });

  test('Portuguese covers exactly what English covers', () => {
    expect(pathsOf(leaves(messagesFor('pt')))).toEqual(pathsOf(leaves(messagesFor('en'))));
  });

  test('no text is left blank, apart from the absence of a progress message', () => {
    LANGUAGES.forEach((option) => {
      const blank = leaves(messagesFor(option.id)).filter((entry) => entry.endsWith(': '));

      expect(blank).toEqual(['/progress/none: ']);
    });
  });

  test('every mission has a title and a briefing in both languages', () => {
    LANGUAGES.forEach((option) => {
      const { missions } = messagesFor(option.id);

      expect(Object.keys(missions).sort()).toEqual(MISSIONS.map((mission) => mission.id).sort());
    });
  });

  test('the replay hint carries the speed and the progress', () => {
    expect(messagesFor('en').hints.replay(4, 50)).toBe('Replay 4× · 50 % · Esc ends');
    expect(messagesFor('pt').hints.replay(4, 50)).toBe('Replay 4× · 50 % · Esc encerra');
  });
});
