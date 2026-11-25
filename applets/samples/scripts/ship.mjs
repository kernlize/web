#!/usr/bin/env node
// Signs the three sample manifests with a throwaway key and writes them, with the exact bytes each
// manifest's `x` tag hashes, into shipped/ (or the directory given as the first argument).
//
// The key is made fresh on every run and lives only in this process: it is never written, logged or
// returned. A shell that ships the samples trusts `publisher` from samples.json, so each build is
// its own publisher and nobody can sign another manifest under it later.
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const NAMES = ['notes', 'pulse', 'profiles'];

/** NIP-01: the id is the sha256 of the serialised `[0, pubkey, created_at, kind, tags, content]`. */
export function eventId({ pubkey, created_at, kind, tags, content }) {
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, pubkey, created_at, kind, tags, content]))));
}

function tagValue(tags, name) {
  return tags.find((tag) => tag[0] === name)?.[1];
}

async function sample(name, signer) {
  const dist = join(root, 'dist', name);
  const template = JSON.parse(await readFile(join(dist, '.nip5a-manifest.json'), 'utf8'));
  const html = await readFile(join(dist, 'index.html'));
  const hash = bytesToHex(sha256(html));
  if (tagValue(template.tags, 'x') !== hash) throw new Error(`${name}: the x tag does not hash dist/${name}/index.html`);
  if (tagValue(template.tags, 'd') !== name) throw new Error(`${name}: the d tag is ${tagValue(template.tags, 'd')}`);
  // Only the event's own fields: the template also carries the plugin's `artifactHash`.
  const unsigned = { kind: template.kind, tags: template.tags, content: template.content, pubkey: signer.pubkey, created_at: signer.createdAt };
  const id = eventId(unsigned);
  const manifest = { id, ...unsigned, sig: signer.sign(id) };
  return { entry: { name, title: tagValue(template.tags, 'title'), manifest, file: `${name}.html` }, html };
}

/** Sign every sample with one fresh key and write samples.json and the html files into `outDir`. */
export async function ship(outDir = join(root, 'shipped')) {
  const secretKey = schnorr.utils.randomSecretKey();
  const signer = {
    pubkey: bytesToHex(schnorr.getPublicKey(secretKey)),
    createdAt: Math.floor(Date.now() / 1000),
    sign: (id) => bytesToHex(schnorr.sign(hexToBytes(id), secretKey)),
  };
  const built = [];
  for (const name of NAMES) built.push(await sample(name, signer));
  secretKey.fill(0);
  await mkdir(outDir, { recursive: true });
  for (const { entry, html } of built) await writeFile(join(outDir, entry.file), html);
  const shipped = { publisher: signer.pubkey, samples: built.map(({ entry }) => entry) };
  await writeFile(join(outDir, 'samples.json'), `${JSON.stringify(shipped, null, 2)}\n`);
  return shipped;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const { publisher, samples } = await ship(outDir);
  console.log(`shipped/samples.json  publisher ${publisher}`);
  for (const { file, manifest } of samples) console.log(`shipped/${file}  ${manifest.tags.find((tag) => tag[0] === 'x')[1]}`);
}
