import meta from '@kernlize/applet-messages/applet.json';
import type { AppletSummary, BuiltinApplet, Intents, MountPlan, ShellKernl } from './contract';

/** The applet the shell ships for messages, and where the Messages button looks first. */
export const MESSAGES_ADDRESS = `kernl:${meta.id}`;

/** The role an applet takes to be the one that shows messages. */
const MESSAGES_ARCHETYPE = 'dm';

/**
 * The messages applet as the shell ships it. Its hash is written by the applet's own build, next
 * to the bytes it hashes, and the bytes load only when messages are first opened. The domains it
 * starts with are the ones it cannot show a conversation without; each stays the user's to withdraw.
 */
export const MESSAGES_APPLET: BuiltinApplet = {
  ...meta,
  grants: ['dm', 'identity', 'notify'],
  load: async () => (await import('@kernlize/applet-messages/index.html?raw')).default,
};

/**
 * The address the Messages button opens: the applet the user made their own for messages, when it
 * is still installed, otherwise the one that comes with the shell.
 */
export function messagesAddress(intents: Pick<Intents, 'installed' | 'defaults'>): string {
  const chosen = intents.defaults.get(MESSAGES_ARCHETYPE);
  return intents.installed().find((applet) => applet.catalogId === chosen)?.address ?? MESSAGES_ADDRESS;
}

interface OpenDeps {
  readonly kernl: Pick<ShellKernl, 'decodePointer' | 'intents' | 'plan' | 'resolve'>;
  /** The window already showing the applet at an address, if one is open. */
  readonly running: (address: string) => string | undefined;
  readonly focus: (windowId: string) => void;
  readonly open: (plan: MountPlan) => void;
}

/**
 * Show messages: bring the window forward when the applet is already open, otherwise open it.
 * When the user's own choice cannot be opened right now, the applet that comes with the shell
 * is opened instead, so messages are never out of reach because a server is.
 */
export async function openMessages(deps: OpenDeps): Promise<void> {
  const { kernl } = deps;
  const address = messagesAddress(kernl.intents);
  const running = deps.running(address);
  if (running !== undefined) return deps.focus(running);
  const resolve = (target: string): Promise<AppletSummary> => kernl.resolve(kernl.decodePointer(target));
  const summary = await resolve(address).catch((reason: unknown) => {
    if (address === MESSAGES_ADDRESS) throw reason;
    return resolve(MESSAGES_ADDRESS);
  });
  deps.open(await kernl.plan(summary));
}
