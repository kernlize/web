import { Given, When, Then } from 'quickpickle';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect } from 'vitest';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const slugs = ['bridges', 'core', 'guard', 'messaging'];
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
  const core = json(join(root, '.jsr/core/deno.json'));
  for (const slug of slugs.filter((name) => name !== 'core')) {
    const pkg = json(join(root, 'packages', slug, 'package.json'));
    expect(core.imports[pkg.name]).toBe(`jsr:@kernl/${slug}@^${pkg.version}`);
  }
  expect(core.imports['rxjs']).toBe('npm:rxjs@7.8.2');
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
