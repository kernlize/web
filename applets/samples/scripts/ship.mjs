#!/usr/bin/env node
// Signs the three sample manifests, and two stacks over them, with a throwaway key and writes them, with the exact bytes each
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
import { sampleFor } from '../src/specs.ts';

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
  // The manifest plugin has no topics option, so each spec's topics become `t` tags here, before signing; the store filters by them.
  const tags = [...template.tags, ...sampleFor(name).topics.map((topic) => ['t', topic])];
  // Only the event's own fields: the template also carries the plugin's `artifactHash`.
  const unsigned = { kind: template.kind, tags, content: template.content, pubkey: signer.pubkey, created_at: signer.createdAt };
  const id = eventId(unsigned);
  const manifest = { id, ...unsigned, sig: signer.sign(id) };
  return { entry: { name, title: tagValue(template.tags, 'title'), manifest, file: `${name}.html` }, html };
}

/** The publisher's profile (kind 0), so a shell that seeds it names who published the samples. */
function profile(signer) {
  const unsigned = { kind: 0, tags: [], content: JSON.stringify({ name: 'kernl samples' }), pubkey: signer.pubkey, created_at: signer.createdAt };
  const id = eventId(unsigned);
  return { id, ...unsigned, sig: signer.sign(id) };
}

/**
 * Two NIP-51 app curation sets (kind 30267) over the samples, so a shell's Stacks tab has
 * something to list: Basics opens Notes and installs Profiles, and Live names Pulse with a relay
 * hint. `start` marks the members a stack opens, as kernl reads them (D-073). Basics is a second
 * newer, so a shell that lists stacks newest first shows it first.
 */
const STACKS = [
  { d: 'basics', title: 'Basics', description: 'Everything needed on a fresh identity.', members: [['notes', true], ['profiles', false]] },
  { d: 'live', title: 'Live', description: 'Applets that read the network constantly.', members: [['pulse', true, 'wss://relay.example']] },
];

function stacks(signer) {
  return STACKS.map(({ d, title, description, members }, index) => {
    const coordinate = (name) => `35129:${signer.pubkey}:${name}`;
    const tags = [
      ['d', d],
      ['title', title],
      ['description', description],
      ...members.map(([name, , relay]) => (relay ? ['a', coordinate(name), relay] : ['a', coordinate(name)])),
      ...members.filter(([, start]) => start).map(([name]) => ['start', coordinate(name)]),
    ];
    const unsigned = { kind: 30267, tags, content: '', pubkey: signer.pubkey, created_at: signer.createdAt + STACKS.length - 1 - index };
    const id = eventId(unsigned);
    return { id, ...unsigned, sig: signer.sign(id) };
  });
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
  const signedProfile = profile(signer);
  const signedStacks = stacks(signer);
  secretKey.fill(0);
  await mkdir(outDir, { recursive: true });
  for (const { entry, html } of built) await writeFile(join(outDir, entry.file), html);
  const shipped = { publisher: signer.pubkey, profile: signedProfile, samples: built.map(({ entry }) => entry), stacks: signedStacks };
  await writeFile(join(outDir, 'samples.json'), `${JSON.stringify(shipped, null, 2)}\n`);
  return shipped;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const { publisher, samples } = await ship(outDir);
  console.log(`shipped/samples.json  publisher ${publisher}`);
  for (const { file, manifest } of samples) console.log(`shipped/${file}  ${manifest.tags.find((tag) => tag[0] === 'x')[1]}`);
}
