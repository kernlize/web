import type { AppletSummary, KernlHost, ShellKernl } from './contract';

/** Already installed means the same verified artifact (not only the same address) can run with its current grants. */
export function alreadyGranted(kernl: {
  readonly intents: Pick<ShellKernl['intents'], 'installed'>;
  readonly grants: Pick<ShellKernl['grants'], 'get' | 'baselineDomains' | 'availableDomains'>;
}, target: AppletSummary): boolean {
  const installed = kernl.intents.installed().some((entry) => entry.catalogId === target.manifest.catalogId && entry.artifactHash === target.identity.hash);
  if (!installed) return false;
  const grant = kernl.grants.get(target.identity);
  if (!grant || grant.blocked) return false;
  const offered = kernl.grants.availableDomains();
  const granted = [...kernl.grants.baselineDomains(), ...grant.domains];
  const required = [...target.requires, ...(target.manifest.archetypes.length ? ['intent'] : [])];
  return required.every((domain) => offered.includes(domain) && granted.includes(domain) && !grant.withheld.includes(domain));
}

/** A request uses the source window's verified title, not the supplied label. Do not enqueue a review for a window that closed during lookup. */
export function reviewAppletLink(deps: {
  readonly kernl: Pick<ShellKernl, 'resolve'>;
  readonly source: (windowId: string) => AppletSummary | undefined;
  readonly review: NonNullable<NonNullable<KernlHost['asks']>['link.open-applet']>;
  readonly failed: (error: unknown) => void;
}): NonNullable<KernlHost['openAppletLink']> {
  const pending = new Set<string>();
  return async (windowId, pointer, signal) => {
    const source = deps.source(windowId);
    if (!source || signal?.aborted || pending.has(windowId)) return false;
    pending.add(windowId);
    const active = (): boolean => !signal?.aborted && deps.source(windowId) === source;
    try {
      const target = await deps.kernl.resolve(pointer);
      if (!active()) return false;
      const opened = await deps.review({
        kind: 'link.open-applet', windowId, applet: source.identity,
        facts: { source: source.title, target },
        defaultText: { title: 'Open an applet link' },
        ...(signal ? { signal } : {}),
      });
      return opened === true && active();
    } catch (error) {
      if (active()) deps.failed(error);
      return false;
    } finally {
      pending.delete(windowId);
    }
  };
}
