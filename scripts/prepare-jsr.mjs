#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const output = join(root, '.jsr');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const packages = readdirSync(join(root, 'packages')).map((slug) => ({
  slug,
  manifest: json(join(root, 'packages', slug, 'package.json')),
})).filter(({ manifest }) => !manifest.private);
const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));

function dependencyTarget(name, range, slug) {
  const local = byName.get(name);
  if (local) {
    if (range !== 'workspace:^') throw new Error(`Unsupported workspace range: ${name}@${range}`);
    return `jsr:@kernl/${local.slug}@^${local.manifest.version}`;
  }
  const localPath = join(root, 'packages', slug, 'node_modules', name, 'package.json');
  const installed = json(existsSync(localPath) ? localPath : join(root, 'node_modules', name, 'package.json'));
  return `npm:${name}@${installed.version}`;
}

function sourceForJsr(source, path) {
  const tree = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true);
  const edits = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) && node.text.startsWith('.')) {
      const parent = node.parent;
      if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)
        || (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent))
        || (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword)) {
        const stem = node.text.endsWith('.js') ? node.text.slice(0, -3) : node.text;
        const specifier = stem.endsWith('.ts') ? stem : `${stem}.ts`;
        const text = existsSync(resolve(dirname(path), specifier)) ? specifier : `${stem}/index.ts`;
        if (!existsSync(resolve(dirname(path), text))) throw new Error(`Unresolved import in ${path}: ${node.text}`);
        edits.push({ start: node.getStart(tree) + 1, end: node.getEnd() - 1, text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  for (const edit of edits.reverse()) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}

function rewriteSources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) rewriteSources(path);
    else if (entry.name.endsWith('.ts')) writeFileSync(path, sourceForJsr(readFileSync(path, 'utf8'), path));
  }
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output);
writeJson(join(output, 'deno.json'), {
  workspace: packages.map(({ slug }) => `./${slug}`),
  compilerOptions: { lib: ['es2022', 'dom', 'dom.iterable'], strict: true },
});
for (const { slug, manifest } of packages) {
  if (manifest.name !== `@kernlize/${slug}`) throw new Error(`Unexpected npm name: ${manifest.name}`);
  const dir = join(output, slug);
  mkdirSync(dir);
  cpSync(join(root, 'packages', slug, 'src'), join(dir, 'src'), {
    recursive: true,
    filter: (path) => !path.endsWith('.test.ts'),
  });
  rewriteSources(join(dir, 'src'));
  cpSync(join(root, 'LICENSE'), join(dir, 'LICENSE'));
  writeFileSync(join(dir, 'README.md'), `# @kernl/${slug}\n\n${manifest.description}\n\n[Documentation](https://kernl.run/docs/packages/${slug}) · [Source](https://github.com/kernlize/web/tree/main/packages/${slug})\n\nnpm: \`@kernlize/${slug}\`. JSR: \`@kernl/${slug}\`.\n`);
  const dependencies = { ...manifest.peerDependencies, ...manifest.dependencies };
  writeJson(join(dir, 'deno.json'), {
    name: `@kernl/${slug}`,
    version: manifest.version,
    license: manifest.license,
    exports: { '.': './src/index.ts' },
    imports: Object.fromEntries(Object.entries(dependencies)
      .map(([name, range]) => [name, dependencyTarget(name, range, slug)])),
    publish: { include: ['src', 'README.md', 'LICENSE', 'deno.json'] },
  });
}
console.log(`[prepare-jsr] prepared ${packages.length} packages in .jsr/`);
