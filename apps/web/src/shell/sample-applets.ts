import type { PreviewPresetOptions, ShippedSamples } from '@kernlize/preset';
import { shippedSamples } from '@kernlize/preset';

/**
 * Each sample's page as its own chunk, read the first time the kernel asks for its bytes. The map
 * is spelled out because a bundler splits only imports it can see.
 */
const PAGES: Readonly<Record<string, () => Promise<{ default: string }>>> = {
  'notes.html': () => import('@kernlize/applet-samples/notes.html?raw'),
  'pulse.html': () => import('@kernlize/applet-samples/pulse.html?raw'),
  'profiles.html': () => import('@kernlize/applet-samples/profiles.html?raw'),
};

/**
 * One sample's page, by the file name `samples.json` gives it.
 *
 * @param file - Such as `notes.html`.
 * @returns The page as shipped; the kernel hashes it against the manifest before running it.
 * @throws `unavailable:blob` for a file the samples do not ship.
 * @example
 * ```ts
 * const html = await samplePage('notes.html');
 * ```
 */
export async function samplePage(file: string): Promise<string> {
  const load = PAGES[file];
  if (!load) throw new Error('unavailable:blob');
  return (await load()).default;
}

/**
 * The preview's sample applets as `@kernlize/applet-samples` built and signed them, with their
 * publisher's profile. The listing and each page load on demand, never with the shell's own code.
 *
 * @returns The `samples` and `seed` options for `previewPreset`.
 * @example
 * ```ts
 * const preview = previewPreset({ ...(await loadSampleApplets()), theme });
 * ```
 */
export async function loadSampleApplets(): Promise<Required<Pick<PreviewPresetOptions, 'samples' | 'seed'>>> {
  const listing = (await import('@kernlize/applet-samples/samples.json')).default as ShippedSamples;
  return shippedSamples(listing, samplePage);
}
