import type { AppletStack, AppletSummary, ShellKernl } from './contract';

/** How many applets in a stack opened and how many could not. */
export interface StackOpening {
  readonly opened: number;
  readonly missed: number;
}

/** What a stack's applets came to when they were looked up, before any of them was planned. */
export interface StackLookup {
  readonly found: readonly AppletSummary[];
  /** Applets that could not be resolved or verified. */
  readonly missed: number;
}

/**
 * Resolve and verify every applet a stack names, without planning any of them.
 *
 * Each applet is looked up on its own, so one that is gone, unreachable or no
 * longer verifies does not stop the rest. Nothing is planned here: the applets
 * are looked up first so the person can answer for the whole stack at once.
 *
 * @param kernl - The shell's applet lifecycle.
 * @param stack - The stack to open.
 * @returns The applets that were found, in the order the stack listed them, and how many were missed.
 * @example
 * ```ts
 * const { found, missed } = await resolveStack(kernl, stack);
 * ```
 */
export async function resolveStack(kernl: ShellKernl, stack: AppletStack): Promise<StackLookup> {
  const found: AppletSummary[] = [];
  let missed = 0;
  for (const member of stack.members) {
    try {
      found.push(await kernl.resolve({ kind: 'address', pubkey: member.pubkey, identifier: member.identifier, eventKind: member.eventKind, relays: member.relays }));
    } catch {
      missed += 1;
    }
  }
  return { found, missed };
}

/**
 * Install every applet a stack names, so another applet can hand it work later,
 * without opening any of them. Installing records the verified applet and its
 * routing contracts; it plans nothing and asks nothing.
 *
 * @param kernl - The shell's applet lifecycle.
 * @param found - The verified applets {@link resolveStack} returned.
 * @example
 * ```ts
 * installStack(kernl, found); // seven applets in Yours, no windows
 * ```
 */
export function installStack(kernl: ShellKernl, found: readonly AppletSummary[]): void {
  for (const summary of found) kernl.install(summary);
}

/**
 * Open the selected applets in the stack's order. The firewall bounds how many
 * plans can wait for a frame, so let each applet mount before planning the next.
 *
 * @param found - The selected applets from {@link resolveStack}.
 * @param openMember - Bring forward an existing window or plan and mount a new one; reject if it could not open.
 * @returns Counts of applets opened and missed.
 * @example
 * ```ts
 * const { opened, missed } = await openStack(found, async (summary) => {
 *   await windows.openAndMount(await kernl.plan(summary));
 * });
 * ```
 */
export async function openStack<T>(found: readonly T[], openMember: (member: T, index: number) => Promise<void>): Promise<StackOpening> {
  let opened = 0;
  let missed = 0;
  for (const [index, member] of found.entries()) {
    try {
      await openMember(member, index);
      opened += 1;
    } catch {
      missed += 1;
    }
  }
  return { opened, missed };
}

/**
 * What to tell the person about a stack that did not open completely, or
 * undefined when every applet in it opened.
 *
 * @param opening - What {@link openStack} produced, with the lookups' misses added.
 * @param stack - The stack that was opened.
 * @returns A sentence naming the stack, or undefined when nothing was missed.
 * @example
 * ```ts
 * missedWords({ opened: 0, missed: 2 }, stack); // 'None of the 2 applets in Basics could be opened.'
 * ```
 */
export function missedWords(opening: StackOpening, stack: AppletStack): string | undefined {
  if (opening.missed === 0) return undefined;
  return opening.opened === 0
    ? `None of the ${opening.missed} applets in ${stack.title} could be opened.`
    : `${opening.missed} of ${stack.members.length} applets in ${stack.title} could not be opened.`;
}
