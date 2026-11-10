import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { JSR_REGISTRY, listPackages, NPM_REGISTRY, registryLookups, renderPending, unpublished } from './check-unpublished.mjs';

const packages = [
  { slug: 'core', name: '@kernlize/core', version: '0.6.0' },
  { slug: 'guard', name: '@kernlize/guard', version: '0.1.1' },
];

const registry = (answers) => (url) => {
  const answer = answers[url];
  if (answer === undefined) throw new Error(`unexpected ${url}`);
  return Promise.resolve(typeof answer === 'number' ? new Response(null, { status: answer }) : Response.json({ versions: Object.fromEntries(answer.map((v) => [v, {}])) }));
};

test('reads the public packages of the workspace in slug order', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'unpublished-'));
  for (const [slug, manifest] of [['guard', { name: '@kernlize/guard', version: '0.1.1' }], ['docs', { name: '@kernlize/docs', version: '0.0.0', private: true }], ['bridges', { name: '@kernlize/bridges', version: '0.2.1' }]]) {
    await mkdir(path.join(root, 'packages', slug), { recursive: true });
    await writeFile(path.join(root, 'packages', slug, 'package.json'), JSON.stringify(manifest));
  }
  expect(await listPackages(root)).toEqual([{ slug: 'bridges', name: '@kernlize/bridges', version: '0.2.1' }, { slug: 'guard', name: '@kernlize/guard', version: '0.1.1' }]);
});

test('asks npm by the escaped name and JSR by the kernl scope and slug', async () => {
  const asked = [];
  const { npm, jsr } = registryLookups((url) => {
    asked.push(url);
    return Promise.resolve(Response.json({ versions: { '0.1.0': {} } }));
  });
  expect([...(await npm(packages[1]))]).toEqual(['0.1.0']);
  expect([...(await jsr(packages[1]))]).toEqual(['0.1.0']);
  expect(asked).toEqual([`${NPM_REGISTRY}@kernlize%2Fguard`, `${JSR_REGISTRY}@kernl/guard/meta.json`]);
});

test('a package the registry has never seen is null; any other failure is an error, not an empty answer', async () => {
  const { npm, jsr } = registryLookups(registry({ [`${NPM_REGISTRY}@kernlize%2Fguard`]: 404, [`${JSR_REGISTRY}@kernl/guard/meta.json`]: 503 }));
  expect(await npm(packages[1])).toBeNull();
  await expect(jsr(packages[1])).rejects.toThrow('answered HTTP 503');
});

test('lists each version a registry is missing, with why', async () => {
  const lookups = registryLookups(registry({
    [`${NPM_REGISTRY}@kernlize%2Fcore`]: ['0.5.0'],
    [`${NPM_REGISTRY}@kernlize%2Fguard`]: ['0.1.0', '0.1.1'],
    [`${JSR_REGISTRY}@kernl/core/meta.json`]: ['0.6.0'],
    [`${JSR_REGISTRY}@kernl/guard/meta.json`]: 404,
  }));
  const rows = await unpublished(packages, lookups);
  expect(rows).toEqual([
    { registry: 'npm', name: '@kernlize/core', version: '0.6.0', reason: 'the version is not published' },
    { registry: 'jsr', name: '@kernl/guard', version: '0.1.1', reason: 'the package does not exist there yet' },
  ]);
  expect(renderPending(rows, 2)).toBe(['npm  @kernlize/core@0.6.0  the version is not published', 'jsr  @kernl/guard@0.1.1  the package does not exist there yet', '2 packages checked on npm and JSR: 2 version(s) to publish'].join('\n'));
});

test('an empty list reads as nothing to publish', () => {
  expect(renderPending([], 4)).toBe('4 packages checked on npm and JSR: nothing to publish');
});

test('the command writes its verdict for the workflow', async () => {
  const output = path.join(await mkdtemp(path.join(tmpdir(), 'gh-output-')), 'out');
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/check-unpublished.mjs'], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, GITHUB_OUTPUT: output }, stdio: 'pipe' });
  expect(await readFile(output, 'utf8')).toMatch(/^pending=(true|false)\n$/);
});
