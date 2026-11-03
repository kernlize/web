// D-006: the public site never names a protocol. Scans built output for the denylist; URLs are addresses, not prose, and are skipped.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DENYLIST = /\b(nostr|nip-?\d*|napplets?|relays?|pubkeys?|npub\w*|nsec\w*)\b/gi;
const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/g;
const SCANNED = new Set(['.html', '.md', '.txt', '.json', '.xml']);

const blankUrls = (line) => line.replace(URL_PATTERN, (url) => ' '.repeat(url.length));

/**
 * Find denylisted words in a text.
 * @param {string} text Rendered output to scan.
 * @param {string} file Label used in each hit.
 * @returns {{ file: string, line: number, column: number, match: string, text: string }[]} One entry per hit.
 */
export function findViolations(text, file = '<text>') {
  const hits = [];
  text.split('\n').forEach((raw, index) => {
    const line = blankUrls(raw);
    for (const match of line.matchAll(DENYLIST)) {
      hits.push({ file, line: index + 1, column: match.index + 1, match: match[0], text: raw.trim() });
    }
  });
  return hits;
}

async function listFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (SCANNED.has(path.extname(entry.name))) files.push(full);
  }
  return files.sort();
}

/**
 * Scan every HTML, Markdown, text, JSON and XML file under a directory.
 * @param {string} dir Built site directory.
 * @returns {Promise<ReturnType<typeof findViolations>>} Every hit, in file order.
 */
export async function scanDirectory(dir) {
  const hits = [];
  for (const file of await listFiles(dir)) {
    hits.push(...findViolations(await readFile(file, 'utf8'), path.relative(dir, file)));
  }
  return hits;
}

export function defaultDistDir() {
  return existsSync('.pages') ? '.pages' : path.join('apps', 'web', 'dist');
}

function dirFromArgs(argv) {
  const flag = argv.indexOf('--dir');
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1];
  const inline = argv.find((arg) => arg.startsWith('--dir='));
  return inline ? inline.slice('--dir='.length) : defaultDistDir();
}

async function main() {
  const dir = dirFromArgs(process.argv.slice(2));
  const hits = await scanDirectory(dir);
  for (const hit of hits) console.error(`${hit.file}:${hit.line}:${hit.column}  "${hit.match}"  ${hit.text}`);
  if (hits.length) {
    console.error(`\n${hits.length} public-vocabulary hit(s) in ${dir}`);
    process.exit(1);
  }
  process.stdout.write(`public vocabulary: clean (${dir})\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
