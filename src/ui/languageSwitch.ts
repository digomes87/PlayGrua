/** Flag buttons that choose the interface language. */
import { LANGUAGES, type Language, type LanguageOption } from '../i18n/language';
import { element } from './dom';
import englishFlag from './flags/english.svg';
import portugueseFlag from './flags/portuguese.svg';

const FLAGS: Readonly<Record<Language, string>> = { en: englishFlag, pt: portugueseFlag };
const FLAG_SIZE = { width: 30, height: 20 } as const;

function flag(language: Language): HTMLImageElement {
  const image = element('img', 'language__flag');
  image.src = FLAGS[language];
  image.alt = '';
  image.width = FLAG_SIZE.width;
  image.height = FLAG_SIZE.height;
  return image;
}

function option(choice: LanguageOption, current: Language, onSelect: (language: Language) => void): HTMLElement {
  const button = element('button', 'language__option');
  button.type = 'button';
  button.lang = choice.locale;
  button.title = choice.name;
  button.setAttribute('aria-label', choice.name);
  button.setAttribute('aria-pressed', String(choice.id === current));
  button.append(flag(choice.id), element('span', 'language__code', choice.code));
  button.addEventListener('click', () => onSelect(choice.id));
  return button;
}

export function languageSwitch(label: string, current: Language, onSelect: (language: Language) => void): HTMLElement {
  const nav = element('nav', 'language');
  nav.setAttribute('aria-label', label);
  LANGUAGES.forEach((choice) => nav.append(option(choice, current, onSelect)));
  return nav;
}
