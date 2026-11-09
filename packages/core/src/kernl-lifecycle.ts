import type { Subscription } from 'rxjs';
import { originRegistry, type ShellAdapter, type ShellBridge } from '@kehto/shell';
import type { NappletArtifactCache } from '@kehto/nip/5d';
import type { AppletHandle, AppletIdentity, AppletPointer, AppletSummary, BuiltinApplet, FrameLike, Kernl, KernlHost, MountPlan, RelayTiers } from './types.js';
import type { ApplesaucePool } from './applesauce/relay-hooks.js';
import { resolveBuiltin } from './applets/builtin.js';
import { fetchManifestEvent, resolveApplet, type PublishedPointer, type ResolvedApplet } from './applets/resolve.js';
import { planMount } from './applets/plan.js';
import { mountApplet, type MountedApplet } from './applets/mount.js';
import type { GuardPipeline, WindowResolution } from './guard/pipeline.js';
import { applyRuntimeFirewallRules } from './guard/runtime-rules.js';
import type { KernlGrants } from './grants/grants.js';
import type { InstalledApplets } from './intents/installed.js';

/** What the applet lifecycle needs from the composed shell. */
export interface LifecycleContext {
  readonly pool: ApplesaucePool;
  readonly tiers: RelayTiers;
  readonly adapter: ShellAdapter;
  readonly bridge: ShellBridge;
  readonly pipeline: GuardPipeline;
  readonly grants: KernlGrants;
  /** Every planned applet is installed, so others can hand it work. */
  readonly installed: InstalledApplets;
  readonly host: Pick<KernlHost, 'onRevoked'>;
  /** Live handles keyed by window id; shared with the bridge's revocation hook. */
  readonly handles: Map<string, MountedApplet>;
  readonly subscriptions: Subscription;
  readonly openCache: () => Promise<NappletArtifactCache | undefined>;
  readonly fetchBlob: (sha256: string, servers: readonly string[]) => Promise<Uint8Array>;
  /** Applets the host ships with itself. */
  readonly builtins: readonly BuiltinApplet[];
}

/** The applet half of {@link Kernl}. */
export type AppletLifecycle = Pick<Kernl, 'resolve' | 'install' | 'plan' | 'mount' | 'applets' | 'handleWindowMessage'>;

function keyOf(identity: AppletIdentity): string {
  return `${identity.dTag}:${identity.hash}`;
}

/**
 * Resolve the window a window-level message came from, from the shell's own
 * registry and never from the message.
 *
 * @param handles - Live applet handles.
 * @param event - The window-level message.
 * @returns The window and its applet, or null for unregistered sources.
 * @example
 * ```ts
 * resolveWindow(handles, event)?.napplet; // 'chat'
 * ```
 */
export function resolveWindow(handles: ReadonlyMap<string, MountedApplet>, event: MessageEvent): WindowResolution | null {
  const windowId = event.source ? originRegistry.getWindowId(event.source as Window) : undefined;
  const handle = windowId === undefined ? undefined : handles.get(windowId);
  return windowId !== undefined && handle ? { windowId, napplet: handle.summary.identity.dTag } : null;
}

/**
 * Load a built-in applet and, the first time the user meets it, switch on the domains its host
 * vouches for. A domain this shell cannot provide is skipped, and an applet the user already has
 * a record for is left exactly as they set it.
 */
async function resolveShipped(context: LifecycleContext, id: string): Promise<ResolvedApplet> {
  const resolved = await resolveBuiltin(context.builtins, id);
  const { identity } = resolved.summary;
  if (context.grants.get(identity)) return resolved;
  context.grants.ensure(identity);
  const offered = context.grants.availableDomains();
  const wanted = context.builtins.find((applet) => applet.id === id)?.grants ?? [];
  for (const domain of wanted) if (offered.includes(domain)) context.grants.allowDomain(identity, domain);
  return resolved;
}

/**
 * The applet lifecycle: `resolve` fetches and verifies (or loads an applet the host ships), `plan` narrows the
 * environment under the user's grants and installs the applet, `mount` performs the NIP-5D mount order
 * and `handleWindowMessage` runs the guard in front of the bridge.
 *
 * @param context - The composed shell's parts.
 * @returns The lifecycle methods.
 * @example
 * ```ts
 * const lifecycle = createAppletLifecycle(context);
 * const summary = await lifecycle.resolve(pointer);
 * ```
 */
export function createAppletLifecycle(context: LifecycleContext): AppletLifecycle {
  const { handles, pipeline, bridge } = context;
  const verified = new Map<string, string>();
  let windowCounter = 0;
  const lookUp = async (pointer: PublishedPointer): Promise<ResolvedApplet> => {
    const event = await fetchManifestEvent(context.pool, context.tiers, pointer);
    const cache = await context.openCache();
    const { fetchBlob } = context;
    const relays = pointer.relays;
    return resolveApplet(cache ? { event, fetchBlob, cache, relays } : { event, fetchBlob, relays });
  };

  return {
    async resolve(pointer: AppletPointer): Promise<AppletSummary> {
      const resolved = pointer.kind === 'builtin' ? await resolveShipped(context, pointer.id) : await lookUp(pointer);
      verified.set(keyOf(resolved.summary.identity), resolved.indexHtml);
      return resolved.summary;
    },
    install(summary: AppletSummary) {
      if (!verified.has(keyOf(summary.identity))) throw new Error('invalid:unresolved');
      context.grants.ensure(summary.identity);
      return context.installed.install(summary);
    },
    async plan(summary: AppletSummary): Promise<MountPlan> {
      const indexHtml = verified.get(keyOf(summary.identity));
      if (indexHtml === undefined) throw new Error('invalid:unresolved');
      if (context.grants.get(summary.identity)?.blocked) throw new Error('denied:blocked');
      context.grants.ensure(summary.identity);
      context.installed.install(summary);
      windowCounter += 1;
      return planMount({ summary, indexHtml, adapter: context.adapter, guardProfile: pipeline.config.profile, windowId: `applet-${windowCounter}` });
    },
    mount(plan: MountPlan, frame: FrameLike): AppletHandle {
      applyRuntimeFirewallRules(bridge.runtime.firewallState, pipeline.config, plan.summary.identity.dTag);
      const handle = mountApplet(plan, frame, {
        bridge,
        originRegistry,
        guard: pipeline,
        onRevoked: (windowId, reason) => context.host.onRevoked(windowId, reason),
      });
      handles.set(plan.windowId, handle);
      context.subscriptions.add(handle.status$.subscribe((status) => {
        if (status === 'closed' || status === 'revoked') handles.delete(plan.windowId);
      }));
      return handle;
    },
    applets: () => [...handles.values()],
    handleWindowMessage(event) {
      pipeline.handleWindowMessage(event, (message) => resolveWindow(handles, message), (message) => bridge.handleMessage(message));
    },
  };
}
