#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'kernl-packages-'));
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
try {
  const tarballs = [];
  for (const slug of readdirSync(join(root, 'packages'))) {
    const pkg = JSON.parse(readFileSync(join(root, 'packages', slug, 'package.json'), 'utf8'));
    if (pkg.private) continue;
    run('pnpm', ['--filter', pkg.name, 'pack', '--pack-destination', dir]);
    const tarball = join(dir, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`);
    const files = run('tar', ['-tzf', tarball]).split('\n');
    const packed = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json']));
    assert.equal(packed.name, `@kernlize/${slug}`);
    assert.ok(!JSON.stringify(packed).includes('workspace:'), `${pkg.name}: unresolved workspace dependency`);
    for (const file of ['dist/index.js', 'dist/index.d.ts', 'LICENSE', 'README.md']) {
      assert.ok(files.includes(`package/${file}`), `${pkg.name}: missing ${file}`);
    }
    for (const field of ['dependencies', 'peerDependencies']) {
      assert.ok(!Object.keys(packed[field] ?? {}).some((name) => name.startsWith('@kernl/')));
    }
    tarballs.push(tarball);
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], dir);
  const names = tarballs.map((path) => JSON.parse(run('tar', ['-xOf', path, 'package/package.json'])).name);
  run(process.execPath, ['--input-type=module', '-e', `await Promise.all(${JSON.stringify(names)}.map((name) => import(name)))`], dir);
  writeFileSync(join(dir, 'consumer.ts'), names.map((name, index) => `import * as pkg${index} from '${name}';\nconsole.log(pkg${index});`).join('\n'));
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--target', 'ES2022', 'consumer.ts'], dir);
  console.log(`[check-packages] ${names.length} tarballs installed, imported and type-checked outside the workspace`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
