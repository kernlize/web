import { config, intent, link, notify, relay, torrent, type IntentDelivery, type Subscription } from '@napplet/sdk';
import { FLOOD_SIZE, SAMPLE_CONTACT, SAMPLE_LINK, SAMPLE_MAGNET, SETTINGS_SCHEMA, type Draft } from './actions.js';
import * as words from './words.js';

/**
 * Every request the page makes of the shell leaves through this module, one
 * per click. There is no pacer: a sample makes one request per button, and the
 * flood is meant to go over the guard's budget (see README, "Pulse floods on
 * purpose").
 */

const now = (): number => Math.floor(Date.now() / 1000);

/** Publish one draft; the shell signs it, and asks first for a change that replaces or erases. */
export async function publish(name: string, draft: Draft): Promise<string> {
  try {
    await relay.publish({ ...draft, tags: draft.tags.map((tag) => [...tag]), created_at: now() });
    return words.publishDone(name);
  } catch (error) {
    return words.publishFailed(name, error);
  }
}

export async function sendNotification(title: string): Promise<string> {
  try {
    await notify.send({ title, body: `${title} says hello.` });
    return words.NOTIFIED;
  } catch (error) {
    return words.notifyFailed(error);
  }
}

let settingsHeard: Subscription | undefined;

/** Register the schema the first time, so changes are heard and echoed, then ask the shell for the form. */
export async function openSettings(onValues: (text: string) => void): Promise<string | undefined> {
  try {
    if (!settingsHeard) {
      await config.registerSchema(SETTINGS_SCHEMA);
      settingsHeard = config.subscribe((values) => onValues(words.describeValues(values)));
    }
    config.openSettings();
    return undefined;
  } catch (error) {
    return words.settingsFailed(error);
  }
}

/** Hand a profile to whichever applet takes it; the shell may ask the person which. */
export async function openProfile(): Promise<string> {
  try {
    const result = await intent.open('napplet:profile/open', { payload: { pubkey: SAMPLE_CONTACT } });
    if (!result.ok) return words.intentWords(result, undefined);
    return words.intentWords(result, await takerTitle(result.handler));
  } catch (error) {
    return words.intentWords({ ok: false, error: error instanceof Error ? error.message : String(error) }, undefined);
  }
}

/** The handler's title from the shell's own list: the result names it only by an opaque id. */
async function takerTitle(handler: string): Promise<string | undefined> {
  try {
    const availability = await intent.available('profile');
    return availability.candidates.find((candidate) => candidate.id === handler)?.title;
  } catch {
    return undefined;
  }
}

export function onProfileRequest(write: (text: string) => void): Subscription {
  return intent.onDelivery((delivery: IntentDelivery) => write(words.deliveryWords(delivery)));
}

const flooded: Subscription[] = [];

/**
 * Forty subscriptions in one burst, deliberately past the guard's budget. A
 * read counts as answered when its end-of-stored-events arrives; what the guard
 * dropped never answers. They stay open until the page goes away.
 */
export function flood(write: (text: string) => void): void {
  let answered = 0;
  for (let index = 0; index < FLOOD_SIZE; index += 1) {
    let done = false;
    const markAnswered = (): void => {
      if (done) return;
      done = true;
      answered += 1;
    };
    flooded.push(relay.subscribe({ kinds: [1], limit: 1 }, () => undefined, markAnswered));
  }
  write(words.floodSent(FLOOD_SIZE));
  window.setTimeout(() => write(words.floodAnswered(answered, FLOOD_SIZE)), 3000);
}

export function closeFlood(): void {
  for (const subscription of flooded.splice(0)) subscription.close();
}

export async function download(): Promise<string> {
  try {
    return words.downloadWords(await torrent.add({ source: { sourceType: 'magnet', magnet: SAMPLE_MAGNET } }));
  } catch {
    return words.downloadFailed();
  }
}

export async function openLink(): Promise<string> {
  try {
    return words.linkWords(await link.open(SAMPLE_LINK, { label: 'kernl docs' }));
  } catch (error) {
    return words.linkFailed(error);
  }
}
