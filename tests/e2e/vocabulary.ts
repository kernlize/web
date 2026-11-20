import type { Frame, Locator, Page } from '@playwright/test';
import { expect, openSettings, SETTINGS_SECTIONS } from './fixtures';
import { DENIED_WORDS, withoutAddresses } from '../../apps/web/src/shell/vocabulary';

/** Everything a person can perceive in a frame: text, accessible names and hints, and the values of fields. */
export async function perceivable(frame: Frame | Page): Promise<string> {
  return frame.evaluate(() => {
    const attributes = ['title', 'aria-label', 'placeholder', 'alt', 'aria-description'];
    const parts = [document.title, document.body.innerText];
    for (const element of document.querySelectorAll('*')) {
      for (const name of attributes) {
        const value = element.getAttribute(name);
        if (value) parts.push(value);
      }
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) parts.push(element.value);
    }
    return parts.join('\n');
  });
}

/**
 * Fail when any frame of the page shows a word the shell's own denylist forbids (D-006). Addresses are
 * blanked first: a relay is shown by its own host, whatever words that host contains (D-051).
 */
export async function expectClean(page: Page, where: string): Promise<void> {
  for (const frame of page.frames()) {
    const text = await perceivable(frame);
    const hit = DENIED_WORDS.exec(withoutAddresses(text));
    expect(hit?.[0], `${where} (${frame === page.mainFrame() ? 'page' : 'applet frame'})`).toBeUndefined();
  }
}

/** Open Settings and read every section in turn, with what is folded away opened: only the section showing is rendered text. */
export async function expectCleanSettings(page: Page, where: string): Promise<Locator> {
  const settings = await openSettings(page);
  for (const section of SETTINGS_SECTIONS) {
    await settings.getByRole('tab', { name: section }).click();
    await expect(settings.getByRole('tabpanel', { name: section })).toBeVisible();
    await settings.locator('details').evaluateAll((all) => all.forEach((d) => d.setAttribute('open', '')));
    await expectClean(page, `${where}: ${section}`);
  }
  return settings;
}
