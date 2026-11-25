import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  checkDependencyRules,
  findAppNostrToolsImports,
  findFrameworkDependencies,
  findKehtoImports,
  findKernelModuleImports,
  findModulesAboveImports,
  findUnrequiredModuleImports,
  findNostrToolsImports,
  findPresetImports,
  findViewModelImports,
  importSpecifiers,
  valueImports,
} from './check-dependency-rules.mjs';

const roots = [];

function packages(files) {
  const root = mkdtempSync(join(tmpdir(), 'check-deps-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const manifest = (name, extra = {}) => JSON.stringify({ name, version: '0.1.0', ...extra });

test('importSpecifiers finds static, type-only, re-exported and dynamic imports', () => {
  const source = [
    "import { a } from 'x';",
    "import type { B } from '@scope/pkg/sub';",
    "import * as ns from \"y\";",
    "export { c } from './c.js';",
    "export * from 'z';",
    "const d = await import('dyn');",
    "import 'side-effect';",
    "const notAnImport = 'from \"nope\"';",
  ].join('\n');
  expect(importSpecifiers(source)).toEqual(['x', '@scope/pkg/sub', 'y', './c.js', 'z', 'dyn', 'side-effect']);
});

test('findNostrToolsImports flags direct and subpath imports in any package src', () => {
  const root = packages({
    'core/package.json': manifest('@kernlize/core'),
    'core/src/index.ts': "import { finalizeEvent } from 'nostr-tools';\nimport { npubEncode } from 'nostr-tools/nip19';\n",
    'guard/package.json': manifest('@kernlize/guard'),
    'guard/src/index.ts': "import { evaluate } from '@kehto/rate-limit/legacy';\n",
    'guard/src/types.d.ts': "import type { X } from 'nostr-tools';\n",
  });
  expect(findNostrToolsImports(root)).toEqual([
    'core/src/index.ts imports nostr-tools; kernl source never imports nostr-tools (D-002)',
    'core/src/index.ts imports nostr-tools/nip19; kernl source never imports nostr-tools (D-002)',
  ]);
});

test('findKehtoImports allows guard → @kehto/rate-limit and nothing else in leaf packages', () => {
  const root = packages({
    'guard/package.json': manifest('@kernlize/guard'),
    'guard/src/index.ts': "import type { FirewallConfig } from '@kehto/rate-limit/legacy';\nimport { grant } from '@kehto/acl';\n",
    'messaging/package.json': manifest('@kernlize/messaging'),
    'messaging/src/index.ts': "import { createDmService } from '@kehto/services';\n",
    'bridges/package.json': manifest('@kernlize/bridges'),
    'bridges/src/index.ts': "export const PACKAGE_NAME = '@kernlize/bridges';\n",
    'core/package.json': manifest('@kernlize/core'),
    'core/src/index.ts': "import { createShellBridge } from '@kehto/shell';\n",
  });
  expect(findKehtoImports(root)).toEqual([
    'guard/src/index.ts imports @kehto/acl; only the kernel, the modules and @kernlize/core compose kehto (guard may import @kehto/rate-limit)',
    'messaging/src/index.ts imports @kehto/services; only the kernel, the modules and @kernlize/core compose kehto (guard may import @kehto/rate-limit)',
  ]);
});

test('findFrameworkDependencies flags frameworks in every dependency field', () => {
  const root = packages({
    'guard/package.json': manifest('@kernlize/guard', { dependencies: { svelte: '^5.0.0' }, devDependencies: { lit: '^3.0.0' } }),
    'core/package.json': manifest('@kernlize/core', { peerDependencies: { react: '^19.0.0' }, dependencies: { rxjs: '^7.8.2' } }),
    'bridges/package.json': manifest('@kernlize/bridges'),
  });
  expect(findFrameworkDependencies(root)).toEqual([
    'packages/core/package.json lists react in peerDependencies; published packages have zero framework dependencies (D-004)',
    'packages/guard/package.json lists svelte in dependencies; published packages have zero framework dependencies (D-004)',
    'packages/guard/package.json lists lit in devDependencies; published packages have zero framework dependencies (D-004)',
  ]);
});

test('checkDependencyRules passes a clean workspace and handles a missing directory', () => {
  const root = packages({
    'guard/package.json': manifest('@kernlize/guard', { dependencies: { '@kehto/rate-limit': '^0.2.0' } }),
    'guard/src/index.ts': "import { evaluate } from '@kehto/rate-limit/legacy';\nexport const PACKAGE_NAME = '@kernlize/guard';\n",
    'core/package.json': manifest('@kernlize/core'),
    'core/src/index.ts': "import { EventStore } from 'applesauce-core';\nimport { createShellBridge } from '@kehto/shell';\n",
  });
  expect(checkDependencyRules(root)).toEqual([]);
  expect(checkDependencyRules(join(root, 'missing'))).toEqual([]);
});

test('findAppNostrToolsImports flags nostr-tools in app scripts, Svelte and Astro files', () => {
  const root = packages({
    'src/shell/ok.ts': "import { x } from '@kernlize/core';",
    'src/shell/bad.ts': "import { nip19 } from 'nostr-tools';",
    'src/shell/Bad.svelte': "<script lang=\"ts\">\n  import { getPublicKey } from 'nostr-tools/pure';\n</script>",
    'src/pages/bad.astro': "---\nimport { finalizeEvent } from 'nostr-tools';\n---",
    'src/styles/site.css': "@import 'nostr-tools';",
  });
  expect(findAppNostrToolsImports(join(root, 'src')).sort()).toEqual([
    'src/pages/bad.astro imports nostr-tools; the web app never imports nostr-tools (D-002)',
    'src/shell/Bad.svelte imports nostr-tools/pure; the web app never imports nostr-tools (D-002)',
    'src/shell/bad.ts imports nostr-tools; the web app never imports nostr-tools (D-002)',
  ]);
  expect(findAppNostrToolsImports(join(root, 'missing'))).toEqual([]);
});

test('checkDependencyRules includes the web app when its source directory is given', () => {
  const root = packages({
    'packages/guard/package.json': manifest('@kernlize/guard'),
    'packages/guard/src/index.ts': 'export {};',
    'apps/web/src/a.ts': "import 'nostr-tools';",
  });
  expect(checkDependencyRules(join(root, 'packages'))).toEqual([]);
  expect(checkDependencyRules(join(root, 'packages'), join(root, 'apps/web/src'))).toEqual([
    'src/a.ts imports nostr-tools; the web app never imports nostr-tools (D-002)',
  ]);
});

test('findViewModelImports flags any other package importing the view models, and lets the view models import the core', () => {
  const root = packages({
    'core/package.json': manifest('@kernlize/core'),
    'core/src/index.ts': "import { grantGroups } from '@kernlize/ui-model';\n",
    'ui-model/package.json': manifest('@kernlize/ui-model'),
    'ui-model/src/index.ts': "import { sealsApplet } from '@kernlize/core';\n",
  });
  expect(findViewModelImports(root)).toEqual(["core/src/index.ts imports @kernlize/ui-model; only a host's UI depends on the view models"]);
});

test('findPresetImports flags any package importing the preset, and lets the preset import the core', () => {
  const root = packages({
    'ui-model/package.json': manifest('@kernlize/ui-model'),
    'ui-model/src/index.ts': "import { kernlPreset } from '@kernlize/preset';\n",
    'preset/package.json': manifest('@kernlize/preset', { private: true }),
    'preset/src/index.ts': "import { kernlModules } from '@kernlize/core';\n",
  });
  expect(findPresetImports(root)).toEqual(['ui-model/src/index.ts imports @kernlize/preset; nothing published imports the preset (D-068)']);
});

test('findKehtoImports keeps kehto out of the view models', () => {
  const root = packages({
    'ui-model/package.json': manifest('@kernlize/ui-model'),
    'ui-model/src/index.ts': "import type { Runtime } from '@kehto/runtime';\n",
  });
  expect(findKehtoImports(root)).toEqual(['ui-model/src/index.ts imports @kehto/runtime; only the kernel, the modules and @kernlize/core compose kehto (guard may import @kehto/rate-limit)']);
});

test('findKernelModuleImports flags a kernel file or test importing a module, and lets it import itself and the leaf packages', () => {
  const root = packages({
    'kernel/package.json': manifest('@kernlize/kernel'),
    'kernel/src/applets/resolve.ts': "import { addressOf } from '@kernlize/core';\nimport { plan } from './plan.js';\nimport type { BridgeRegistry } from '@kernlize/bridges';\n",
    'kernel/src/applets/plan.ts': '',
    'kernel/src/applets/resolve.test.ts': "import { kernlPreset } from '@kernlize/preset';\nimport { x } from '../../../core/src/catalog/entry.js';\n",
  });
  expect(findKernelModuleImports(root)).toEqual([
    'kernel/src/applets/resolve.test.ts imports @kernlize/preset; the kernel imports no module (D-068)',
    'kernel/src/applets/resolve.test.ts imports ../../../core/src/catalog/entry.js; the kernel imports no module (D-068)',
    'kernel/src/applets/resolve.ts imports @kernlize/core; the kernel imports no module (D-068)',
  ]);
});

test('findModulesAboveImports flags a module importing core or the preset, and lets it import the kernel and other modules', () => {
  const root = packages({
    'modules/package.json': manifest('@kernlize/modules'),
    'modules/src/modules/theme.ts': "import type { KernlModule } from '@kernlize/kernel';\nimport { x } from '../catalog/entry.js';\nimport { createKernl } from '@kernlize/core';\n",
    'modules/src/catalog/entry.ts': '',
    'modules/src/catalog/entry.test.ts': "import { kernlPreset } from '@kernlize/preset';\n",
  });
  expect(findModulesAboveImports(root)).toEqual([
    'modules/src/catalog/entry.test.ts imports @kernlize/preset; a module imports only the kernel and other modules (D-068)',
    'modules/src/modules/theme.ts imports @kernlize/core; a module imports only the kernel and other modules (D-068)',
  ]);
});

test('valueImports skips type-only imports and keeps any that carry a value', () => {
  const source = [
    "import type { A } from './a.js';",
    "import { type B, type C } from './b.js';",
    "import { d, type E } from './d.js';",
    "export { f } from './f.js';",
    "export type { G } from './g.js';",
    "import * as h from './h.js';",
    "import { x } from 'rxjs';",
  ].join('\n');
  expect(valueImports(source)).toEqual(['./d.js', './f.js', './h.js']);
});

test('findUnrequiredModuleImports flags a value taken from a module not required, and allows types and required modules', () => {
  const root = packages({
    'modules/package.json': manifest('@kernlize/modules'),
    'modules/src/modules/messaging.ts': "import { locate } from '../people/locate.js';\nimport type { Profiles } from '../profiles/profiles.js';\n",
    'modules/src/modules/social.ts': "export const socialModule = () => ({ id: 'social', requires: ['people'] });\nimport { find } from '../people/person.js';\n",
    'modules/src/people/locate.ts': '',
    'modules/src/people/person.ts': '',
    'modules/src/profiles/profiles.ts': '',
    'modules/src/relays/mailboxes.ts': "import { DEFAULT_SUGGESTIONS } from './suggestions.js';\n",
    'modules/src/relays/suggestions.ts': '',
  });
  expect(findUnrequiredModuleImports(root)).toEqual(['modules/src/modules/messaging.ts imports ../people/locate.js from the people module, which messaging does not require (D-068)']);
});
