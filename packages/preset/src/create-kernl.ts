import { createKernel, isTheme, type AnyKernlModule, type ModuleApis, type Kernel } from '@kernlize/kernel';
import { kernlModules } from './modules/default.js';
import type { Kernl, KernlOptions } from './kernl-members.js';

/** kernl's own modules, built from the options a host that names none passes to `createKernl`. */
function modulesFrom(options: KernlOptions): readonly AnyKernlModule[] {
  return kernlModules({
    ...(isTheme(options.theme) ? { theme: options.theme } : {}),
    ...(options.eventCache ? { eventCache: options.eventCache } : {}),
    ...(options.controllers ? { controllers: options.controllers } : {}),
    ...(options.shortcuts ? { shortcuts: options.shortcuts } : {}),
    ...(options.intentRetry ? { intentRetry: options.intentRetry } : {}),
    ...(options.bridges ? { bridges: options.bridges } : {}),
    ...(options.messaging ? { messaging: { registry: options.messaging } } : {}),
    ...(options.torrent ? { torrent: options.torrent } : {}),
    ...(options.downloads ? { downloads: options.downloads } : {}),
    ...(options.remoteTools ? { remoteTools: options.remoteTools } : {}),
    ...(options.directConnections ? { directConnections: options.directConnections } : {}),
  });
}

/**
 * Compose the shell with kernl's opinions: {@link createKernel} over `kernlModules()` when the
 * host names no modules, built from the options it passes (D-061), or over the modules it names.
 * A host that names its own and wants nothing else bundled imports `createKernel` from
 * `@kernlize/kernel` instead.
 *
 * @param options - Host hooks, optional pre-built parts, and kernl's modules' options or the host's own modules.
 * @returns The shell.
 * @example
 * ```ts
 * const kernl = createKernl({ host });
 * window.addEventListener('message', (event) => kernl.handleWindowMessage(event));
 * const summary = await kernl.resolve(kernl.decodePointer(address));
 * const handle = kernl.mount(await kernl.plan(summary), iframe);
 * ```
 */
export function createKernl<const M extends readonly AnyKernlModule[]>(options: KernlOptions & { readonly modules: M }): Kernel & ModuleApis<M>;
export function createKernl(options: KernlOptions): Kernl;
export function createKernl(options: KernlOptions): Kernel {
  return createKernel({ ...options, modules: options.modules ?? modulesFrom(options) });
}
