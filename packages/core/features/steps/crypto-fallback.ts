import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { runInNewContext } from 'node:vm';
import { createFallbackSubtle, installCryptoFallback, renderRandomUuidFallbackScript, type CryptoFallbackReport, type CryptoScope } from '@kernlize/core/crypto';
import { scratch, type CoreWorld } from './world.js';

const platform = globalThis.crypto.subtle;
const fallback = createFallbackSubtle();
const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const bytes = (length: number, seed = 1): Uint8Array => Uint8Array.from({ length }, (_, at) => (at * 7 + seed) & 0xff);
const hex = (buffer: ArrayBuffer): string => Buffer.from(buffer).toString('hex');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MESSAGE = text('who is at the keyboard?');
const X25519_PKCS8_PREFIX = '302e020100300506032b656e04220420';

function scope(world: CoreWorld): CryptoScope {
  return scratch(world).cryptoScope as CryptoScope;
}

Given('a scope with the platform\'s Web Crypto', (world: CoreWorld) => {
  scratch(world).cryptoScope = { crypto: globalThis.crypto };
});

Given('a scope with only getRandomValues', (world: CoreWorld) => {
  scratch(world).cryptoScope = { crypto: { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) } };
});

Given('a scope without crypto', (world: CoreWorld) => {
  scratch(world).cryptoScope = {};
});

Given('a scope with crypto but no randomness', (world: CoreWorld) => {
  scratch(world).cryptoScope = { crypto: {} };
});

When('the shell installs the crypto fallback', (world: CoreWorld) => {
  scratch(world).cryptoReport = installCryptoFallback(scope(world));
});

When('the applet-side randomUUID script runs in that scope', (world: CoreWorld) => {
  const script = renderRandomUuidFallbackScript();
  const body = /^<script data-kernl-crypto-fallback>([\s\S]*)<\/script>$/.exec(script)?.[1];
  expect(body).toBeDefined();
  runInNewContext(body as string, { window: scope(world) });
});

Then('the fallback added nothing', (world: CoreWorld) => {
  expect(scratch(world).cryptoReport as CryptoFallbackReport).toEqual({ randomUUID: false, subtle: false });
});

Then('the fallback added randomUUID and subtle', (world: CoreWorld) => {
  expect(scratch(world).cryptoReport as CryptoFallbackReport).toEqual({ randomUUID: true, subtle: true });
});

Then('the scope still has the platform\'s Web Crypto', (world: CoreWorld) => {
  expect(scope(world).crypto?.subtle).toBe(platform);
});

Then('the scope\'s randomUUID returns version 4 UUIDs', (world: CoreWorld) => {
  const crypto = scope(world).crypto as Pick<Crypto, 'randomUUID'>;
  const ids = new Set(Array.from({ length: 32 }, () => crypto.randomUUID()));
  expect(ids.size).toBe(32);
  for (const id of ids) expect(id).toMatch(UUID_V4);
});

async function bothImport(format: 'raw' | 'pkcs8', data: BufferSource, algorithm: AlgorithmIdentifier | HmacImportParams, usages: KeyUsage[]): Promise<[CryptoKey, CryptoKey]> {
  return [await platform.importKey(format, data, algorithm, true, usages), await fallback.importKey(format, data, algorithm, true, usages)];
}

async function ed25519Pair(): Promise<{ pkcs8: ArrayBuffer; raw: ArrayBuffer; jwk: JsonWebKey }> {
  const pair = (await platform.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
  return { pkcs8: await platform.exportKey('pkcs8', pair.privateKey), raw: await platform.exportKey('raw', pair.publicKey), jwk: await platform.exportKey('jwk', pair.privateKey) };
}

async function x25519Pair(): Promise<{ pkcs8: ArrayBuffer; raw: ArrayBuffer; jwk: JsonWebKey }> {
  const pair = (await platform.generateKey('X25519', true, ['deriveBits'])) as CryptoKeyPair;
  return { pkcs8: await platform.exportKey('pkcs8', pair.privateKey), raw: await platform.exportKey('raw', pair.publicKey), jwk: await platform.exportKey('jwk', pair.privateKey) };
}

async function sameOutput(run: (subtle: SubtleCrypto, keys: readonly CryptoKey[]) => Promise<ArrayBuffer>, keys: [readonly CryptoKey[], readonly CryptoKey[]] = [[], []]): Promise<void> {
  expect(hex(await run(fallback, keys[1]))).toBe(hex(await run(platform, keys[0])));
}

async function keyPairs(format: 'raw' | 'pkcs8', data: ArrayBuffer, algorithm: AlgorithmIdentifier | HmacImportParams, usages: KeyUsage[]): Promise<[CryptoKey[], CryptoKey[]]> {
  const [p, f] = await bothImport(format, data, algorithm, usages);
  return [[p], [f]];
}

async function digestMatches(hash: string): Promise<void> {
  await sameOutput((subtle) => subtle.digest(hash, MESSAGE));
  await sameOutput((subtle) => subtle.digest({ name: hash }, MESSAGE.slice().buffer));
}

async function aesMatches(name: 'AES-GCM' | 'AES-CBC', params: Record<string, unknown>): Promise<void> {
  const keys = await keyPairs('raw', bytes(16).buffer, { name }, ['encrypt']);
  await sameOutput((subtle, [key]) => subtle.encrypt({ name, ...params } as AesGcmParams, key as CryptoKey, MESSAGE), keys);
}

async function x25519Matches(): Promise<void> {
  const [mine, theirs] = [await x25519Pair(), await x25519Pair()];
  const [pPriv, fPriv] = await bothImport('pkcs8', mine.pkcs8, 'X25519', ['deriveBits']);
  const [pPub, fPub] = await bothImport('raw', theirs.raw, 'X25519', []);
  const expected = hex(await platform.deriveBits({ name: 'X25519', public: pPub }, pPriv, 256));
  expect(hex(await fallback.deriveBits({ name: 'X25519', public: fPub }, fPriv, 256))).toBe(expected);
  expect(hex(await fallback.deriveBits({ name: 'X25519', public: fPub }, fPriv, null))).toBe(expected);
  expect(hex(await call('deriveBits', { name: 'X25519', public: fPub }, fPriv) as ArrayBuffer)).toBe(expected);
}

async function keyExportMatches(curve: 'Ed25519' | 'X25519'): Promise<void> {
  const pair = curve === 'Ed25519' ? await ed25519Pair() : await x25519Pair();
  const usages: KeyUsage[] = curve === 'Ed25519' ? ['sign'] : ['deriveBits'];
  const fromPkcs8 = await fallback.importKey('pkcs8', pair.pkcs8, curve, true, usages);
  const jwk = await fallback.exportKey('jwk', fromPkcs8);
  expect([jwk.kty, jwk.crv, jwk.x, jwk.d]).toEqual([pair.jwk.kty, pair.jwk.crv, pair.jwk.x, pair.jwk.d]);
  const fromJwk = await fallback.importKey('jwk', pair.jwk, curve, true, usages);
  expect(hex(await fallback.exportKey('pkcs8', fromJwk))).toBe(hex(pair.pkcs8));
  const publicJwk = { kty: 'OKP', crv: curve, x: pair.jwk.x } as JsonWebKey;
  const publicKey = await fallback.importKey('jwk', publicJwk, curve, true, []);
  expect(hex(await fallback.exportKey('raw', publicKey))).toBe(hex(pair.raw));
  expect((await fallback.exportKey('jwk', publicKey)).x).toBe(pair.jwk.x);
}

const MATCHES: Record<string, () => Promise<void>> = {
  'SHA-1 digest': () => digestMatches('SHA-1'),
  'SHA-256 digest': () => digestMatches('SHA-256'),
  'SHA-384 digest': () => digestMatches('SHA-384'),
  'SHA-512 digest': () => digestMatches('SHA-512'),
  'HMAC SHA-256 signature': async () => {
    const keys = await keyPairs('raw', bytes(32).buffer, { name: 'HMAC', hash: 'SHA-256' }, ['sign']);
    await sameOutput((subtle, [key]) => subtle.sign('HMAC', key as CryptoKey, MESSAGE), keys);
  },
  'HKDF SHA-256 bits': async () => {
    const [p, f] = [await platform.importKey('raw', bytes(32), 'HKDF', false, ['deriveBits']), await fallback.importKey('raw', bytes(32), 'HKDF', true, ['deriveBits'])];
    const params = { name: 'HKDF', hash: { name: 'SHA-256' }, salt: bytes(16, 3), info: text('kernl') };
    await sameOutput((subtle, [key]) => subtle.deriveBits(params, key as CryptoKey, 384), [[p], [f]]);
  },
  'AES-GCM ciphertext': () => aesMatches('AES-GCM', { iv: bytes(12, 5), additionalData: text('aad'), tagLength: 128 }),
  'AES-GCM without aad': () => aesMatches('AES-GCM', { iv: bytes(12, 5) }),
  'AES-CBC ciphertext': () => aesMatches('AES-CBC', { iv: bytes(16, 9) }),
  'X25519 shared secret': x25519Matches,
  'Ed25519 signature': async () => {
    const keys = await keyPairs('pkcs8', (await ed25519Pair()).pkcs8, 'Ed25519', ['sign']);
    await sameOutput((subtle, [key]) => subtle.sign('Ed25519', key as CryptoKey, MESSAGE), keys);
  },
  'Ed25519 key export': () => keyExportMatches('Ed25519'),
  'X25519 key export': () => keyExportMatches('X25519'),
};

Then(/^the fallback's (.+) matches the platform's$/, async (_world: CoreWorld, operation: string) => {
  const check = MATCHES[operation];
  expect(check, operation).toBeDefined();
  await (check as () => Promise<void>)();
});

Then('the platform verifies an Ed25519 signature from the fallback', async () => {
  const pair = (await fallback.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
  const signature = await fallback.sign('Ed25519', pair.privateKey, MESSAGE);
  const publicKey = await platform.importKey('raw', await fallback.exportKey('raw', pair.publicKey), 'Ed25519', true, ['verify']);
  expect(await platform.verify('Ed25519', publicKey, signature, MESSAGE)).toBe(true);
});

Then('the fallback verifies an Ed25519 signature from the platform', async () => {
  const pair = (await platform.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
  const signature = await platform.sign('Ed25519', pair.privateKey, MESSAGE);
  const publicKey = await fallback.importKey('raw', await platform.exportKey('raw', pair.publicKey), 'Ed25519', true, ['verify']);
  expect(await fallback.verify('Ed25519', publicKey, signature, MESSAGE)).toBe(true);
  expect(await fallback.verify('Ed25519', publicKey, signature, text('someone else'))).toBe(false);
  expect(await fallback.verify('Ed25519', publicKey, bytes(10), MESSAGE)).toBe(false);
});

Then('the fallback verifies its own HMAC and rejects a forgery', async () => {
  const key = await fallback.importKey('raw', bytes(32), { name: 'HMAC', hash: { name: 'SHA-512' } }, false, ['sign', 'verify']);
  const mac = new Uint8Array(await fallback.sign({ name: 'HMAC' }, key, MESSAGE));
  expect(await fallback.verify('HMAC', key, mac, MESSAGE)).toBe(true);
  const forged = mac.slice();
  forged[0] = (forged[0] as number) ^ 1;
  expect(await fallback.verify('HMAC', key, forged, MESSAGE)).toBe(false);
  expect(await fallback.verify('HMAC', key, mac.slice(1), MESSAGE)).toBe(false);
});

Then('the platform decrypts AES-GCM from the fallback', async () => {
  const [p, f] = await bothImport('raw', bytes(32), { name: 'AES-GCM' }, ['encrypt', 'decrypt']);
  const params = { name: 'AES-GCM', iv: bytes(12, 2), additionalData: text('aad') };
  const sealed = await fallback.encrypt(params, f, MESSAGE);
  expect(new Uint8Array(await platform.decrypt(params, p, sealed))).toEqual(MESSAGE);
  expect(new Uint8Array(await fallback.decrypt(params, f, sealed))).toEqual(MESSAGE);
});

Then('the fallback decrypts AES-CBC from the platform', async () => {
  const [p, f] = await bothImport('raw', bytes(24), { name: 'AES-CBC' }, ['encrypt', 'decrypt']);
  const params = { name: 'AES-CBC', iv: bytes(16, 4) };
  const sealed = await platform.encrypt(params, p, MESSAGE);
  expect(new Uint8Array(await fallback.decrypt(params, f, sealed))).toEqual(MESSAGE);
});

Then('the fallback round-trips generated keys', async () => {
  const gcmKey = (await fallback.generateKey('AES-GCM', true, ['encrypt'])) as CryptoKey;
  expect((await fallback.exportKey('raw', gcmKey)).byteLength).toBe(32);
  const cbcKey = (await fallback.generateKey({ name: 'AES-CBC', length: 128 }, true, ['encrypt'])) as CryptoKey;
  expect((await fallback.exportKey('raw', cbcKey)).byteLength).toBe(16);
  const macKey = (await fallback.generateKey({ name: 'HMAC', hash: 'SHA-512' }, true, ['sign'])) as CryptoKey;
  const jwk = await fallback.exportKey('jwk', macKey);
  expect(jwk.kty).toBe('oct');
  const again = await fallback.importKey('jwk', jwk, { name: 'HMAC', hash: 'SHA-512' }, true, ['sign']);
  expect(hex(await fallback.sign('HMAC', again, MESSAGE))).toBe(hex(await fallback.sign('HMAC', macKey, MESSAGE)));
  const kem = (await fallback.generateKey('X25519', true, ['deriveBits'])) as CryptoKeyPair;
  expect(hex(await fallback.exportKey('pkcs8', kem.privateKey))).toMatch(new RegExp(`^${X25519_PKCS8_PREFIX}`));
  expect((await fallback.exportKey('jwk', kem.publicKey)).d).toBeUndefined();
});

async function fallbackKey(kind: 'aes' | 'hmac' | 'hkdf' | 'ed-public' | 'ed-private' | 'x-private', extractable = true): Promise<CryptoKey> {
  if (kind === 'aes') return fallback.importKey('raw', bytes(16), 'AES-GCM', extractable, ['encrypt', 'decrypt']);
  if (kind === 'hmac') return fallback.importKey('raw', bytes(32), { name: 'HMAC', hash: 'SHA-256' }, extractable, ['sign']);
  if (kind === 'hkdf') return fallback.importKey('raw', bytes(32), 'HKDF', false, ['deriveBits']);
  if (kind === 'ed-public') return fallback.importKey('raw', bytes(32), 'Ed25519', extractable, ['verify']);
  if (kind === 'ed-private') return fallback.importKey('pkcs8', (await ed25519Pair()).pkcs8, 'Ed25519', extractable, ['sign']);
  return fallback.importKey('pkcs8', (await x25519Pair()).pkcs8, 'X25519', extractable, ['deriveBits']);
}

/** Calls the fallback with arguments its types would refuse, as a careless caller could. */
function call(method: keyof SubtleCrypto, ...args: unknown[]): Promise<unknown> {
  return Reflect.apply(fallback[method], fallback, args);
}

const REJECTIONS: Record<string, () => Promise<unknown>> = {
  'digest with MD5': () => call('digest', 'MD5', MESSAGE),
  'digest a number': () => call('digest', 'SHA-256', 5),
  'import an RSA key': () => call('importKey', 'raw', bytes(32), { name: 'RSA-OAEP' }, true, []),
  'import an X25519 spki key': () => call('importKey', 'spki', bytes(44), 'X25519', true, []),
  'import a short Ed25519 key': () => call('importKey', 'raw', bytes(31), 'Ed25519', true, []),
  'import a truncated Ed25519 pkcs8 key': () => call('importKey', 'pkcs8', bytes(40), 'Ed25519', true, []),
  'import an X25519 pkcs8 key as Ed25519': async () => call('importKey', 'pkcs8', (await x25519Pair()).pkcs8, 'Ed25519', true, []),
  'import an RSA jwk as Ed25519': () => call('importKey', 'jwk', { kty: 'RSA' }, 'Ed25519', true, []),
  'import an X25519 jwk as Ed25519': async () => call('importKey', 'jwk', { kty: 'OKP', crv: 'X25519', x: (await x25519Pair()).jwk.x }, 'Ed25519', true, []),
  'import an empty OKP jwk': () => call('importKey', 'jwk', { kty: 'OKP', crv: 'Ed25519' }, 'Ed25519', true, []),
  'import a 10-byte AES key': () => call('importKey', 'raw', bytes(10), 'AES-GCM', true, []),
  'import an AES jwk without k': () => call('importKey', 'jwk', { kty: 'oct' }, 'AES-GCM', true, []),
  'import an RSA jwk as AES': () => call('importKey', 'jwk', { kty: 'RSA' }, 'AES-GCM', true, []),
  'import an AES pkcs8 key': () => call('importKey', 'pkcs8', bytes(16), 'AES-GCM', true, []),
  'import an HMAC key without a hash': () => call('importKey', 'raw', bytes(32), 'HMAC', true, []),
  'generate an RSA key': () => call('generateKey', { name: 'RSA-PSS' }, true, []),
  'generate an HMAC key without a hash': () => call('generateKey', 'HMAC', true, []),
  'export a non-extractable key': async () => call('exportKey', 'raw', await fallbackKey('aes', false)),
  'export a secret key as pkcs8': async () => call('exportKey', 'pkcs8', await fallbackKey('aes')),
  'export a private Ed25519 key as raw': async () => call('exportKey', 'raw', await fallbackKey('ed-private')),
  'sign with a platform key': async () => call('sign', 'HMAC', await platform.importKey('raw', bytes(32), { name: 'HMAC', hash: 'SHA-256' }, true, ['sign']), MESSAGE),
  'sign HMAC with an AES key': async () => call('sign', 'HMAC', await fallbackKey('aes'), MESSAGE),
  'sign with an Ed25519 public key': async () => call('sign', 'Ed25519', await fallbackKey('ed-public'), MESSAGE),
  'verify with an Ed25519 private key': async () => call('verify', 'Ed25519', await fallbackKey('ed-private'), bytes(64), MESSAGE),
  'encrypt with AES-CTR': async () => call('encrypt', { name: 'AES-CTR', counter: bytes(16), length: 64 }, await fallbackKey('aes'), MESSAGE),
  'encrypt AES-GCM without an iv': async () => call('encrypt', 'AES-GCM', await fallbackKey('aes'), MESSAGE),
  'encrypt AES-GCM with a 96-bit tag': async () => call('encrypt', { name: 'AES-GCM', iv: bytes(12), tagLength: 96 }, await fallbackKey('aes'), MESSAGE),
  'decrypt tampered AES-GCM': async () => call('decrypt', { name: 'AES-GCM', iv: bytes(12) }, await fallbackKey('aes'), bytes(40)),
  'derive bits without parameters': async () => call('deriveBits', 'X25519', await fallbackKey('x-private'), 256),
  'derive HKDF bits without a length': async () => call('deriveBits', { name: 'HKDF', hash: 'SHA-256', salt: bytes(4), info: bytes(4) }, await fallbackKey('hkdf'), null),
  'derive bits from an HMAC key': async () => call('deriveBits', { name: 'HMAC' }, await fallbackKey('hmac'), 256),
  'derive a key': () => call('deriveKey'),
};

When(/^the fallback is asked to (.+)$/, async (world: CoreWorld, request: string) => {
  const run = REJECTIONS[request];
  expect(run, request).toBeDefined();
  scratch(world).cryptoRejection = await (run as () => Promise<unknown>)().then(
    () => undefined,
    (error: unknown) => error,
  );
});

Then('it rejects with a {string}', (world: CoreWorld, name: string) => {
  const error = scratch(world).cryptoRejection;
  expect(error).toBeInstanceOf(DOMException);
  expect((error as DOMException).name).toBe(name);
});
