import { Given, When, Then } from 'quickpickle';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect } from 'vitest';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const slugs = ['bridges', 'core', 'guard', 'kernel', 'messaging', 'modules', 'preset', 'ui-model'];
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

Given('the publishable workspace packages', () => {
  for (const slug of slugs) expect(json(join(root, 'packages', slug, 'package.json')).private).not.toBe(true);
});
When('the JSR release workspace is prepared', () => {
  execFileSync(process.execPath, ['scripts/prepare-jsr.mjs'], { cwd: root });
});
Then('npm packages use the kernlize scope and built exports', () => {
  for (const slug of slugs) {
    const pkg = json(join(root, 'packages', slug, 'package.json'));
    expect(pkg.name).toBe(`@kernlize/${slug}`);
    expect(pkg.exports['.']).toEqual({ types: './dist/index.d.ts', import: './dist/index.js' });
  }
});
Then('JSR packages use the kernl scope and TypeScript exports', () => {
  for (const slug of slugs) {
    const pkg = json(join(root, '.jsr', slug, 'deno.json'));
    expect(pkg.name).toBe(`@kernl/${slug}`);
    expect(pkg.version).toBe(json(join(root, 'packages', slug, 'package.json')).version);
    expect(pkg.exports['.']).toBe('./src/index.ts');
    expect(existsSync(join(root, '.jsr', slug, 'LICENSE'))).toBe(true);
  }
});
Then('JSR internal dependencies use the matching workspace versions', () => {
  // Each package maps the workspace packages it depends on, whichever way round they stand.
  const versionOf = (name: string): string => json(join(root, 'packages', name.replace('@kernlize/', ''), 'package.json')).version;
  for (const slug of slugs) {
    const deno = json(join(root, '.jsr', slug, 'deno.json'));
    const internal = Object.keys(json(join(root, 'packages', slug, 'package.json')).dependencies ?? {}).filter((name) => name.startsWith('@kernlize/'));
    for (const name of internal) expect(deno.imports[name]).toBe(`jsr:@kernl/${name.replace('@kernlize/', '')}@^${versionOf(name)}`);
  }
  expect(json(join(root, '.jsr/core/deno.json')).imports['@kernlize/kernel']).toBe(`jsr:@kernl/kernel@^${versionOf('@kernlize/kernel')}`);
  expect(json(join(root, '.jsr/modules/deno.json')).imports['@kernlize/kernel']).toBe(`jsr:@kernl/kernel@^${versionOf('@kernlize/kernel')}`);
  expect(json(join(root, '.jsr/ui-model/deno.json')).imports['@kernlize/core']).toBe(`jsr:@kernl/core@^${versionOf('@kernlize/core')}`);
  expect(json(join(root, '.jsr/modules/deno.json')).imports['rxjs']).toBe('npm:rxjs@7.8.2');
});
Then('JSR sources exclude tests and resolve relative TypeScript imports', () => {
  const check = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) check(path);
      else {
        expect(entry.name).not.toMatch(/\.test\.ts$/);
        const source = readFileSync(path, 'utf8');
        const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
        for (const statement of tree.statements) {
          if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) || !statement.moduleSpecifier) continue;
          const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
          if (specifier.startsWith('.')) {
            expect(specifier).toMatch(/\.ts$/);
            expect(existsSync(resolve(dir, specifier))).toBe(true);
          }
        }
      }
    }
  };
  for (const slug of slugs) check(join(root, '.jsr', slug, 'src'));
});
Then("every kehto and napplet dependency is exempt from Deno's minimum dependency age", () => {
  const { minimumDependencyAge } = json(join(root, '.jsr/deno.json'));
  expect(minimumDependencyAge.exclude).toEqual(['npm:@kehto/*', 'npm:@napplet/*']);
  const own = slugs.flatMap((slug) => Object.values<string>(json(join(root, '.jsr', slug, 'deno.json')).imports))
    .filter((target) => /^npm:@(kehto|napplet)\//.test(target));
  expect(own.length).toBeGreaterThan(0);
  for (const target of own) expect(minimumDependencyAge.exclude.some((rule: string) => target.startsWith(rule.slice(0, -1)))).toBe(true);
});
Then("every other dependency keeps Deno's default minimum dependency age", () => {
  const { minimumDependencyAge } = json(join(root, '.jsr/deno.json'));
  expect(Object.keys(minimumDependencyAge)).toEqual(['exclude']);
});
