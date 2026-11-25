import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { loadSource } from './unit/load-source.mjs';

// The template's hard boundaries, checked on the source. Pulse's flood is the
// one deliberate exception to the pacer rule; see README, "Pulse floods on purpose".
const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function sourcesUnder(directory) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  return Promise.all(
    entries.filter((entry) => entry.isFile()).map(async (entry) => {
      const path = join(root, directory, entry.name);
      return [relative(root, path), await readFile(path, 'utf8')];
    }),
  );
}

const sources = new Map([...(await sourcesUnder('src')), ['index.html', await readFile(join(root, 'index.html'), 'utf8')]]);

function stringLiterals(source) {
  const file = ts.createSourceFile('source.ts', source, ts.ScriptTarget.ES2022, true);
  const literals = [];
  const visit = (node) => {
    const parent = node.parent ?? node;
    const moduleSpecifier = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent);
    if (ts.isStringLiteralLike(node) && !moduleSpecifier) literals.push(node.text);
    if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) literals.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return literals;
}

test('no ambient network, no shim import, no forms', () => {
  for (const [path, source] of sources) {
    assert.doesNotMatch(source, /\bfetch\s*\(|new\s+WebSocket\b|new\s+EventSource\b|XMLHttpRequest/, path);
    assert.doesNotMatch(source, /['"]@napplet\/shim['"]/, path);
    assert.doesNotMatch(source, /<form\b/, path);
    assert.doesNotMatch(source, /\b(?:local|session)Storage\b/, path);
  }
});

test('only src/shell.ts holds callable SDK bindings', () => {
  for (const [path, source] of sources) {
    if (path === 'src/shell.ts') continue;
    for (const [, names] of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@napplet\/sdk'/g)) {
      for (const name of names.split(',').map((entry) => entry.trim()).filter(Boolean)) {
        assert.match(name, /^type\s+\w+$/, `${path} imports ${name} from the SDK`);
      }
    }
  }
});

test('no heading or masthead: the shell shows the name', () => {
  const html = sources.get('index.html');
  assert.doesNotMatch(html, /<h[1-6]\b|<header\b/);
  assert.doesNotMatch(html, /class="[^"]*\b(?:masthead|eyebrow|hero)\b/);
  assert.match(sources.get('src/styles.css'), /html,\s*body,\s*#app\s*\{[^}]*height:\s*100%/);
});

test('what people read uses the shell vocabulary', () => {
  const forbidden = /\baccounts?\b|nostr|napplet|relay|pubkey|npub|nsec|\bnip-?\d|preview/i;
  const html = sources.get('index.html').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(html, forbidden, 'index.html');
  for (const literal of stringLiterals(sources.get('src/words.ts'))) assert.doesNotMatch(literal, forbidden, `src/words.ts: ${literal}`);
  const { ACTIONS, EXTRA_ACTIONS } = loadSource('actions.js');
  for (const { label, hint } of [...ACTIONS, ...EXTRA_ACTIONS]) {
    assert.doesNotMatch(label, forbidden, label);
    assert.doesNotMatch(hint, forbidden, hint);
  }
  for (const { title, description, blurb } of loadSource('specs.js').SAMPLES) {
    for (const text of [title, description, blurb]) assert.doesNotMatch(text, forbidden, text);
  }
});
