import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const sourceRoot = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'src');
const loaded = new Map();

/**
 * Load a pure module from src/ the way the guidance test does: transpile the
 * TypeScript in memory and evaluate it as CommonJS. Only relative imports are
 * resolved, so a module that reaches for the SDK or the DOM fails here, which
 * is what keeps the tested logic free of both.
 */
export function loadSource(name) {
  const file = resolve(sourceRoot, name.replace(/\.js$/, '.ts'));
  const known = loaded.get(file);
  if (known) return known.exports;
  const module = { exports: {} };
  loaded.set(file, module);
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const require = (specifier) => {
    if (!specifier.startsWith('./')) throw new Error(`${name} imports ${specifier}; pure modules stay inside src/`);
    return loadSource(specifier);
  };
  new Function('module', 'exports', 'require', compiled)(module, module.exports, require);
  return module.exports;
}
