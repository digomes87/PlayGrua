/** Text that lives in the page itself rather than in a panel: document language, title and landmark names. */
import { optionFor } from '../i18n/language';
import type { Messages } from '../i18n/messages';

function name(id: string, label: string): void {
  document.getElementById(id)?.setAttribute('aria-label', label);
}

export function translatePage(text: Messages): void {
  document.documentElement.lang = optionFor(text.language).locale;
  document.title = text.page.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', text.page.description);
  name('stage', text.page.stage);
  name('scene', text.page.scene);
  name('hud', text.page.hud);
  name('overlay', text.page.menu);
}
