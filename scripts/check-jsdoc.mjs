#!/usr/bin/env node
// Fails when a public export of packages/*/src lacks a JSDoc `@example` with a ```ts fence, so the AGENTS.md rule is enforced rather than remembered.
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

/** An `@example` tag followed, anywhere later in the same JSDoc block, by a ```ts or ```typescript fence. */
export const EXAMPLE_PATTERN = /@example\b[\s\S]*?```(ts|typescript)\b/;

/**
 * Tell whether a declaration carries a JSDoc block with a fenced TypeScript `@example`.
 * @param {import('typescript').Declaration} declaration A declaration node from a program's source file.
 * @returns {boolean} True when one of its JSDoc blocks matches {@link EXAMPLE_PATTERN}.
 * @example
 * const source = ts.createSourceFile('a.ts', '/** @example\n * ```ts\n * f();\n * ```\n *' + '/\nexport function f() {}', ts.ScriptTarget.ES2022, true);
 * hasExample(source.statements[0]); // true
 */
export function hasExample(declaration) {
  return ts.getJSDocCommentsAndTags(declaration).some((doc) => EXAMPLE_PATTERN.test(doc.getText()));
}

/**
 * List the package entry points under a packages directory.
 * @param {string} packagesDir Absolute path of the `packages/` directory.
 * @returns {string[]} Absolute paths of every `packages/<name>/src/index.ts`, sorted.
 * @example
 * packageEntries('/repo/packages'); // ['/repo/packages/bridges/src/index.ts', …]
 */
export function packageEntries(packagesDir) {
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir)
    .map((slug) => join(packagesDir, slug, 'src', 'index.ts'))
    .filter((entry) => existsSync(entry))
    .sort();
}

/**
 * Tell whether an exported symbol is a type only (interface or type alias), with no runtime value.
 * @param {import('typescript').Symbol} symbol The resolved symbol.
 * @returns {boolean} True for interfaces and type aliases.
 */
function isTypeOnly(symbol) {
  return (symbol.flags & ts.SymbolFlags.Value) === 0;
}

/**
 * Collect the exports of one entry point that lack a fenced `@example`.
 * @param {import('typescript').Program} program Program containing the entry.
 * @param {string} entry Absolute path of the entry's `index.ts`.
 * @param {{ root: string, includeTypes: boolean }} options Root for relative paths; whether type-only exports count.
 * @returns {string[]} Violations as `file:symbol`.
 */
function entryViolations(program, entry, { root, includeTypes }) {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  const moduleSymbol = source && checker.getSymbolAtLocation(source);
  if (!moduleSymbol) return [`${relative(root, entry)}: not a module`];
  const violations = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    if (!includeTypes && isTypeOnly(symbol)) continue;
    const declarations = (symbol.declarations ?? []).filter((node) => !node.getSourceFile().isDeclarationFile);
    if (declarations.length === 0 || declarations.some(hasExample)) continue;
    violations.push(`${relative(root, declarations[0].getSourceFile().fileName)}:${exported.name}`);
  }
  return violations;
}

/**
 * Find every public export of the packages that lacks a JSDoc `@example` with a ```ts fence.
 *
 * Exports are what each `packages/<name>/src/index.ts` exposes, aliases (`export { x } from './file'`,
 * `export *`) resolved to the declaration that carries the JSDoc. Re-exports of other packages'
 * declarations (outside the program's own sources) are skipped.
 * @param {{ packagesDir: string, root?: string, includeTypes?: boolean }} input The packages directory, the root used for reported paths (defaults to its parent), and whether interfaces and type aliases count (default false).
 * @returns {string[]} Violations as `packages/<name>/src/<file>.ts:<symbol>`, sorted and unique; empty when every export is documented.
 * @example
 * missingExamples({ packagesDir: '/repo/packages' }); // ['packages/guard/src/profiles.ts:GUARD_PROFILES']
 */
export function missingExamples({ packagesDir, root = resolve(packagesDir, '..'), includeTypes = false }) {
  const entries = packageEntries(packagesDir);
  if (entries.length === 0) return [];
  const program = ts.createProgram(entries, {
    allowJs: false,
    noEmit: true,
    noResolve: false,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  });
  const violations = entries.flatMap((entry) => entryViolations(program, entry, { root, includeTypes }));
  return [...new Set(violations)].sort();
}

function main() {
  const repo = resolve(import.meta.dirname, '..');
  const includeTypes = process.argv.includes('--types');
  const violations = missingExamples({ packagesDir: join(repo, 'packages'), root: repo, includeTypes });
  if (violations.length > 0) {
    console.error('jsdoc: these public exports lack an @example with a ```ts fence:');
    for (const violation of violations) console.error(`  ${violation}`);
    console.error(`\njsdoc: ${violations.length} export(s) undocumented`);
    process.exit(1);
  }
  process.stdout.write('jsdoc: every public export has a fenced @example\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
