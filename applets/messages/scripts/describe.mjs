#!/usr/bin/env node
// Writes shipped/applet.json: what the applet declares (applet.json) plus the SHA-256 of the built
// artifact. A shell that ships the applet pins that hash and refuses bytes that do not match it.
// It is kept out of dist/, which must hold the one file a deployment publishes.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const declared = JSON.parse(await readFile(join(root, 'applet.json'), 'utf8'));
const artifact = await readFile(join(root, 'dist', 'index.html'));
const sha256 = createHash('sha256').update(artifact).digest('hex');
await mkdir(join(root, 'shipped'), { recursive: true });
await writeFile(join(root, 'shipped', 'applet.json'), `${JSON.stringify({ ...declared, sha256 }, null, 2)}\n`);
console.log(`shipped/applet.json  ${sha256}`);
