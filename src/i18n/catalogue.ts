/** The interface text for each language. */
import { ENGLISH } from './english';
import type { Language } from './language';
import type { Messages } from './messages';
import { PORTUGUESE } from './portuguese';

const CATALOGUE: Readonly<Record<Language, Messages>> = { en: ENGLISH, pt: PORTUGUESE };

export const messagesFor = (language: Language): Messages => CATALOGUE[language];
