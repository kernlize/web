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
  findNostrToolsImports,
  findViewModelImports,
  importSpecifiers,
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
    'guard/src/index.ts imports @kehto/acl; only @kernlize/core composes kehto (guard may import @kehto/rate-limit)',
    'messaging/src/index.ts imports @kehto/services; only @kernlize/core composes kehto (guard may import @kehto/rate-limit)',
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

test('findKehtoImports keeps kehto out of the view models', () => {
  const root = packages({
    'ui-model/package.json': manifest('@kernlize/ui-model'),
    'ui-model/src/index.ts': "import type { Runtime } from '@kehto/runtime';\n",
  });
  expect(findKehtoImports(root)).toEqual(['ui-model/src/index.ts imports @kehto/runtime; only @kernlize/core composes kehto (guard may import @kehto/rate-limit)']);
});

test('findKernelModuleImports flags a kernel file importing a module, and lets it import the kernel and the shared types', () => {
  const root = packages({
    'src/applets/resolve.ts': "import { addressOf } from '../catalog/entry.js';\nimport { plan } from './plan.js';\nimport type { Kernl } from '../types.js';\n",
    'src/kernl.ts': "import { createKernlServices } from './kernl-services.js';\n",
    'src/kernl-services.ts': '',
    'src/catalog/entry.ts': "import { resolve } from '../applets/resolve.js';\n",
    'src/applets/resolve.test.ts': "import { x } from '../catalog/entry.js';\n",
  });
  expect(findKernelModuleImports(join(root, 'src'))).toEqual(['packages/core/src/applets/resolve.ts imports ../catalog/entry.js; the kernel imports no module (D-068)']);
});
