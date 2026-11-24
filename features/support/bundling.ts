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

Given('a host that composes the kernel package with no modules', (world: BundleWorld) => {
  world.host = "import { createKernel } from '@kernlize/kernel';\nexport const compose = (host) => createKernel({ host, modules: [] });";
});

Given('a host that composes kernl with its own modules', (world: BundleWorld) => {
  world.host = "import { createKernl } from '@kernlize/core';\nexport const compose = (host) => createKernl({ host });";
});

Given('a host that draws the grants list from the view models', (world: BundleWorld) => {
  world.host = "import { grantGroups } from '@kernlize/ui-model';\nexport const groups = grantGroups;";
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
  // What reaches the output: esbuild parses files tree shaking then drops, so a parsed input alone is not bundled code.
  world.inputs = Object.values((result.metafile as Metafile).outputs).flatMap((output) => Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0).map(([path]) => path));
});

const fromPackage = (inputs: readonly string[] | undefined, name: string): readonly string[] => (inputs ?? []).filter((path) => path.includes(`/node_modules/${name}/`));

Then('the bundle holds no code from {string}', (world: BundleWorld, name: string) => {
  expect(fromPackage(world.inputs, name)).toEqual([]);
});

Then('the bundle holds code from {string}', (world: BundleWorld, name: string) => {
  expect(fromPackage(world.inputs, name).length).toBeGreaterThan(0);
});

const fromWorkspace = (inputs: readonly string[] | undefined, slug: string): readonly string[] => (inputs ?? []).filter((path) => path.includes(`packages/${slug}/`));

Then('the bundle holds code from the workspace package {string}', (world: BundleWorld, slug: string) => {
  expect(fromWorkspace(world.inputs, slug).length).toBeGreaterThan(0);
});

Then('the bundle holds no code from the workspace package {string}', (world: BundleWorld, slug: string) => {
  expect(fromWorkspace(world.inputs, slug)).toEqual([]);
});

Then('the bundle holds no code from any installed package', (world: BundleWorld) => {
  // The view models and the seal they read come from the workspace; nothing under node_modules, not rxjs, kehto or applesauce.
  expect((world.inputs ?? []).filter((path) => path.includes('/node_modules/'))).toEqual([]);
});
