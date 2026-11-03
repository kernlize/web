import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  checkDependencyRules,
  findFrameworkDependencies,
  findKehtoImports,
  findNostrToolsImports,
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
    'core/package.json': manifest('@kernl/core'),
    'core/src/index.ts': "import { finalizeEvent } from 'nostr-tools';\nimport { npubEncode } from 'nostr-tools/nip19';\n",
    'guard/package.json': manifest('@kernl/guard'),
    'guard/src/index.ts': "import { evaluate } from '@kehto/firewall';\n",
    'guard/src/types.d.ts': "import type { X } from 'nostr-tools';\n",
  });
  expect(findNostrToolsImports(root)).toEqual([
    'core/src/index.ts imports nostr-tools; kernl source never imports nostr-tools (D-002)',
    'core/src/index.ts imports nostr-tools/nip19; kernl source never imports nostr-tools (D-002)',
  ]);
});

test('findKehtoImports allows guard → @kehto/firewall and nothing else in leaf packages', () => {
  const root = packages({
    'guard/package.json': manifest('@kernl/guard'),
    'guard/src/index.ts': "import type { FirewallConfig } from '@kehto/firewall';\nimport { grant } from '@kehto/acl';\n",
    'messaging/package.json': manifest('@kernl/messaging'),
    'messaging/src/index.ts': "import { createDmService } from '@kehto/services';\n",
    'bridges/package.json': manifest('@kernl/bridges'),
    'bridges/src/index.ts': "export const PACKAGE_NAME = '@kernl/bridges';\n",
    'core/package.json': manifest('@kernl/core'),
    'core/src/index.ts': "import { createShellBridge } from '@kehto/shell';\n",
  });
  expect(findKehtoImports(root)).toEqual([
    'guard/src/index.ts imports @kehto/acl; only @kernl/core composes kehto (guard may import @kehto/firewall)',
    'messaging/src/index.ts imports @kehto/services; only @kernl/core composes kehto (guard may import @kehto/firewall)',
  ]);
});

test('findFrameworkDependencies flags frameworks in every dependency field', () => {
  const root = packages({
    'guard/package.json': manifest('@kernl/guard', { dependencies: { svelte: '^5.0.0' }, devDependencies: { lit: '^3.0.0' } }),
    'core/package.json': manifest('@kernl/core', { peerDependencies: { react: '^19.0.0' }, dependencies: { rxjs: '^7.8.2' } }),
    'bridges/package.json': manifest('@kernl/bridges'),
  });
  expect(findFrameworkDependencies(root)).toEqual([
    'packages/core/package.json lists react in peerDependencies; published packages have zero framework dependencies (D-004)',
    'packages/guard/package.json lists svelte in dependencies; published packages have zero framework dependencies (D-004)',
    'packages/guard/package.json lists lit in devDependencies; published packages have zero framework dependencies (D-004)',
  ]);
});

test('checkDependencyRules passes a clean workspace and handles a missing directory', () => {
  const root = packages({
    'guard/package.json': manifest('@kernl/guard', { dependencies: { '@kehto/firewall': '^0.6.3' } }),
    'guard/src/index.ts': "import { evaluate } from '@kehto/firewall';\nexport const PACKAGE_NAME = '@kernl/guard';\n",
    'core/package.json': manifest('@kernl/core'),
    'core/src/index.ts': "import { EventStore } from 'applesauce-core';\nimport { createShellBridge } from '@kehto/shell';\n",
  });
  expect(checkDependencyRules(root)).toEqual([]);
  expect(checkDependencyRules(join(root, 'missing'))).toEqual([]);
});
