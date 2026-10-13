/** Interface languages. English is the default; the choice is kept across visits. */

export type Language = 'en' | 'pt';

export interface LanguageOption {
  readonly id: Language;
  /** The language's name in the language itself. */
  readonly name: string;
  /** Short code shown next to the flag. */
  readonly code: string;
  /** BCP 47 tag for the `lang` attribute. */
  readonly locale: string;
}

export const DEFAULT_LANGUAGE: Language = 'en';

export const LANGUAGES: readonly LanguageOption[] = [
  { id: 'en', name: 'English', code: 'EN', locale: 'en' },
  { id: 'pt', name: 'Português', code: 'PT', locale: 'pt-BR' },
];

const isLanguage = (value: unknown): value is Language => LANGUAGES.some((option) => option.id === value);

/** Anything that is not a known language falls back to the default. */
export const parseLanguage = (value: unknown): Language => (isLanguage(value) ? value : DEFAULT_LANGUAGE);

export const optionFor = (language: Language): LanguageOption =>
  LANGUAGES.find((option) => option.id === language) ?? LANGUAGES[0]!;
