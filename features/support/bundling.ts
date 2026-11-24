import { Given, Then, When } from 'quickpickle';
import { join, resolve } from 'node:path';
import { build, type Metafile } from 'esbuild';
import { expect } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

interface BundleWorld {
  host?: string;
  inputs?: readonly string[];
}

/** Where each provider is imported from: the ratchet and group providers are their own entries. */
const PROVIDERS: Record<string, { readonly name: string; readonly from: string }> = {
  private: { name: 'privateDm', from: '@kernlize/core/kernel' },
  ratchet: { name: 'ratchet', from: '@kernlize/core/messaging/ratchet' },
  groups: { name: 'groups', from: '@kernlize/core/messaging/groups' },
};

Given('a host that composes the kernel with messages over {string}', (world: BundleWorld, list: string) => {
  const providers = list.split(',').map((id) => PROVIDERS[id] ?? { name: id, from: id });
  world.host = [
    "import { createKernel, messagingModule } from '@kernlize/core/kernel';",
    ...providers.map((provider) => `import { ${provider.name} } from '${provider.from}';`),
    `export const compose = (host) => createKernel({ host, modules: [messagingModule({ providers: [${providers.map((provider) => `${provider.name}()`).join(', ')}] })] });`,
  ].join('\n');
});

Given('a host that composes kernl with its own modules', (world: BundleWorld) => {
  world.host = "import { createKernl } from '@kernlize/core';\nexport const compose = (host) => createKernl({ host });";
});

When('the host is bundled for the browser from the built packages', async (world: BundleWorld) => {
  // Resolved from the web app, which depends on the built `@kernlize/core` as any host would.
  const result = await build({
    stdin: { contents: world.host ?? '', resolveDir: join(root, 'apps/web'), loader: 'js' },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    metafile: true,
    write: false,
    logLevel: 'silent',
  });
  world.inputs = Object.keys((result.metafile as Metafile).inputs);
});

const fromPackage = (inputs: readonly string[] | undefined, name: string): readonly string[] => (inputs ?? []).filter((path) => path.includes(`/node_modules/${name}/`));

Then('the bundle holds no code from {string}', (world: BundleWorld, name: string) => {
  expect(fromPackage(world.inputs, name)).toEqual([]);
});

Then('the bundle holds code from {string}', (world: BundleWorld, name: string) => {
  expect(fromPackage(world.inputs, name).length).toBeGreaterThan(0);
});
