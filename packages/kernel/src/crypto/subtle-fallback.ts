import { cbc, gcm } from '@noble/ciphers/aes.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';

/**
 * The subset of `SubtleCrypto` the shell's dependencies call: the MLS group
 * stack (HPKE over X25519, HKDF, AES-GCM, Ed25519), the remote-signer
 * transports (AES-CBC, SHA-256) and the download client (SHA-1, SHA-256).
 * Anything else rejects with `NotSupportedError`, as a browser does for an
 * algorithm it lacks.
 */
type HashName = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
type Curve = 'Ed25519' | 'X25519';
type SecretAlg = 'AES-GCM' | 'AES-CBC' | 'HMAC' | 'HKDF';
type AlgorithmInput = AlgorithmIdentifier;

interface KeyMaterial {
  readonly bytes: Uint8Array;
  readonly hash?: HashName;
}

const HASHES = {
  'SHA-1': sha1,
  'SHA-256': sha256,
  'SHA-384': sha384,
  'SHA-512': sha512,
} as const;

/** RFC 8410 PKCS#8 prefixes: SEQUENCE { version 0, AlgorithmIdentifier { OID }, OCTET STRING { OCTET STRING (32) } }. */
const PKCS8_PREFIX: Record<Curve, Uint8Array> = {
  Ed25519: Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]),
  X25519: Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]),
};

const materials = new WeakMap<CryptoKey, KeyMaterial>();

function fail(name: 'NotSupportedError' | 'OperationError' | 'InvalidAccessError' | 'DataError', message: string): never {
  throw new DOMException(message, name);
}

function nameOf(alg: AlgorithmInput): string {
  return (typeof alg === 'string' ? alg : alg.name).toUpperCase();
}

/** A parameter of an algorithm object, such as `iv` or `hash`; a bare name has none. */
function param(alg: AlgorithmInput, field: string): unknown {
  return typeof alg === 'string' ? undefined : Reflect.get(alg, field);
}

function canonical(name: string): string {
  const upper = name.toUpperCase();
  if (upper === 'ED25519') return 'Ed25519';
  if (upper === 'X25519') return 'X25519';
  return upper;
}

function hashOf(input: unknown): HashName {
  const name = (typeof input === 'string' ? input : String(Reflect.get(Object(input), 'name') ?? '')).toUpperCase();
  if (name in HASHES) return name as HashName;
  return fail('NotSupportedError', `Unsupported hash: ${name || 'none'}`);
}

function bytesOf(data: BufferSource): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return fail('DataError', 'Expected a BufferSource');
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)), (char) => char.charCodeAt(0));
}

/** A key whose bytes are held in {@link materials}, out of reach of the object itself. */
class FallbackKey implements CryptoKey {
  readonly algorithm: KeyAlgorithm;
  readonly usages: KeyUsage[];

  constructor(
    readonly type: KeyType,
    algorithm: KeyAlgorithm,
    readonly extractable: boolean,
    usages: readonly KeyUsage[],
  ) {
    this.algorithm = Object.freeze(algorithm);
    this.usages = [...usages];
    Object.freeze(this);
  }
}

function makeKey(type: KeyType, algorithm: KeyAlgorithm, extractable: boolean, usages: readonly KeyUsage[], material: KeyMaterial): CryptoKey {
  const key = new FallbackKey(type, algorithm, extractable, usages);
  materials.set(key, material);
  return key;
}

function materialOf(key: CryptoKey, alg: string): KeyMaterial {
  const material = materials.get(key);
  if (material === undefined) return fail('InvalidAccessError', 'The key was not made by this fallback');
  if (canonical(key.algorithm.name) !== canonical(alg)) return fail('InvalidAccessError', `Key is ${key.algorithm.name}, not ${alg}`);
  return material;
}

function publicOf(curve: Curve, secret: Uint8Array): Uint8Array {
  return curve === 'Ed25519' ? ed25519.getPublicKey(secret) : x25519.getPublicKey(secret);
}

function curveKey(curve: Curve, isPrivate: boolean, bytes: Uint8Array, extractable: boolean, usages: readonly KeyUsage[]): CryptoKey {
  if (bytes.length !== 32) return fail('DataError', `${curve} keys are 32 bytes`);
  return makeKey(isPrivate ? 'private' : 'public', { name: curve }, extractable, usages, { bytes });
}

function importCurve(format: KeyFormat, data: BufferSource | JsonWebKey, curve: Curve, extractable: boolean, usages: readonly KeyUsage[]): CryptoKey {
  if (format === 'raw') return curveKey(curve, false, bytesOf(data as BufferSource), extractable, usages);
  if (format === 'pkcs8') {
    const der = bytesOf(data as BufferSource);
    const prefix = PKCS8_PREFIX[curve];
    if (der.length !== prefix.length + 32 || prefix.some((byte, at) => der[at] !== byte)) return fail('DataError', `Unsupported ${curve} PKCS#8 encoding`);
    return curveKey(curve, true, der.slice(prefix.length), extractable, usages);
  }
  if (format === 'jwk') {
    const jwk = data as JsonWebKey;
    if (jwk.kty !== 'OKP' || jwk.crv !== curve) return fail('DataError', `Expected an OKP ${curve} JWK`);
    if (jwk.d !== undefined) return curveKey(curve, true, fromBase64Url(jwk.d), extractable, usages);
    if (jwk.x !== undefined) return curveKey(curve, false, fromBase64Url(jwk.x), extractable, usages);
    return fail('DataError', 'JWK has neither x nor d');
  }
  return fail('NotSupportedError', `Unsupported ${curve} key format: ${format}`);
}

function secretAlgorithm(alg: SecretAlg, bytes: Uint8Array, hash: HashName | undefined): KeyAlgorithm {
  if (alg === 'HMAC') return { name: alg, hash: { name: hash }, length: bytes.length * 8 } as KeyAlgorithm;
  if (alg === 'HKDF') return { name: alg };
  return { name: alg, length: bytes.length * 8 } as KeyAlgorithm;
}

function importSecret(format: KeyFormat, data: BufferSource | JsonWebKey, algorithm: AlgorithmInput, extractable: boolean, usages: readonly KeyUsage[]): CryptoKey {
  const alg = nameOf(algorithm) as SecretAlg;
  const bytes = format === 'raw' ? bytesOf(data as BufferSource) : format === 'jwk' && (data as JsonWebKey).kty === 'oct' ? fromBase64Url((data as JsonWebKey).k ?? '') : fail('NotSupportedError', `Unsupported ${alg} key format: ${format}`);
  if (alg !== 'HMAC' && alg !== 'HKDF' && ![16, 24, 32].includes(bytes.length)) return fail('DataError', 'AES keys are 128, 192 or 256 bits');
  const hash = alg === 'HMAC' ? hashOf(param(algorithm, 'hash')) : undefined;
  const material: KeyMaterial = hash === undefined ? { bytes } : { bytes, hash };
  return makeKey('secret', secretAlgorithm(alg, bytes, hash), alg !== 'HKDF' && extractable, usages, material);
}

async function importKey(format: KeyFormat, data: BufferSource | JsonWebKey, algorithm: AlgorithmInput, extractable: boolean, usages: readonly KeyUsage[]): Promise<CryptoKey> {
  const name = canonical(nameOf(algorithm));
  if (name === 'Ed25519' || name === 'X25519') return importCurve(format, data, name, extractable, usages);
  if (['AES-GCM', 'AES-CBC', 'HMAC', 'HKDF'].includes(name)) return importSecret(format, data, algorithm, extractable, usages);
  return fail('NotSupportedError', `Unsupported algorithm: ${name}`);
}

function exportCurve(format: KeyFormat, key: CryptoKey, bytes: Uint8Array): ArrayBuffer | JsonWebKey {
  const curve = canonical(key.algorithm.name) as Curve;
  const isPrivate = key.type === 'private';
  if (format === 'raw' && !isPrivate) return bufferOf(bytes);
  if (format === 'pkcs8' && isPrivate) {
    const der = new Uint8Array(PKCS8_PREFIX[curve].length + 32);
    der.set(PKCS8_PREFIX[curve]);
    der.set(bytes, PKCS8_PREFIX[curve].length);
    return der.buffer;
  }
  if (format === 'jwk') {
    const jwk: JsonWebKey = { kty: 'OKP', crv: curve, x: toBase64Url(isPrivate ? publicOf(curve, bytes) : bytes), key_ops: [...key.usages], ext: true };
    if (isPrivate) jwk.d = toBase64Url(bytes);
    return jwk;
  }
  return fail('InvalidAccessError', `Cannot export a ${key.type} ${curve} key as ${format}`);
}

async function exportKey(format: KeyFormat, key: CryptoKey): Promise<ArrayBuffer | JsonWebKey> {
  const { bytes } = materialOf(key, key.algorithm.name);
  if (!key.extractable) return fail('InvalidAccessError', 'The key is not extractable');
  if (key.type !== 'secret') return exportCurve(format, key, bytes);
  if (format === 'raw') return bufferOf(bytes);
  if (format === 'jwk') return { kty: 'oct', k: toBase64Url(bytes), key_ops: [...key.usages], ext: true };
  return fail('NotSupportedError', `Cannot export a secret key as ${format}`);
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

async function generateKey(algorithm: AlgorithmInput, extractable: boolean, usages: readonly KeyUsage[]): Promise<CryptoKey | CryptoKeyPair> {
  const name = canonical(nameOf(algorithm));
  if (name === 'Ed25519' || name === 'X25519') {
    const secret = randomBytes(32);
    const publicUsages = usages.filter((usage) => usage === 'verify');
    const privateUsages = usages.filter((usage) => usage !== 'verify');
    return {
      publicKey: curveKey(name, false, publicOf(name, secret), true, publicUsages),
      privateKey: curveKey(name, true, secret, extractable, privateUsages),
    };
  }
  if (name === 'AES-GCM' || name === 'AES-CBC' || name === 'HMAC') {
    const length = param(algorithm, 'length') as number | undefined;
    const bits = length ?? (name === 'HMAC' ? HASHES[hashOf(param(algorithm, 'hash'))].outputLen * 8 : 256);
    return importSecret('raw', randomBytes(bits / 8), algorithm, extractable, usages);
  }
  return fail('NotSupportedError', `Unsupported algorithm: ${name}`);
}

async function sign(algorithm: AlgorithmInput, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer> {
  const name = canonical(nameOf(algorithm));
  const material = materialOf(key, name);
  if (name === 'HMAC') return bufferOf(hmac(HASHES[material.hash as HashName], material.bytes, bytesOf(data)));
  if (name === 'Ed25519' && key.type === 'private') return bufferOf(ed25519.sign(bytesOf(data), material.bytes));
  return fail('NotSupportedError', `Cannot sign with ${name}`);
}

async function verify(algorithm: AlgorithmInput, key: CryptoKey, signature: BufferSource, data: BufferSource): Promise<boolean> {
  const name = canonical(nameOf(algorithm));
  const material = materialOf(key, name);
  if (name === 'HMAC') {
    const expected = hmac(HASHES[material.hash as HashName], material.bytes, bytesOf(data));
    const given = bytesOf(signature);
    return given.length === expected.length && given.reduce((diff, byte, at) => diff | (byte ^ (expected[at] as number)), 0) === 0;
  }
  if (name === 'Ed25519' && key.type === 'public') {
    try {
      return ed25519.verify(bytesOf(signature), bytesOf(data), material.bytes);
    } catch {
      return false;
    }
  }
  return fail('NotSupportedError', `Cannot verify with ${name}`);
}

function aesCipher(algorithm: AlgorithmInput, key: CryptoKey): { encrypt(data: Uint8Array): Uint8Array; decrypt(data: Uint8Array): Uint8Array } {
  const name = nameOf(algorithm);
  if (name !== 'AES-CBC' && name !== 'AES-GCM') return fail('NotSupportedError', `Unsupported cipher: ${name}`);
  const { bytes } = materialOf(key, name);
  const iv = param(algorithm, 'iv');
  if (iv === undefined) return fail('DataError', `${name} needs an iv`);
  const nonce = bytesOf(iv as BufferSource);
  if (name === 'AES-CBC') return cbc(bytes, nonce);
  const tagLength = param(algorithm, 'tagLength') ?? 128;
  if (tagLength !== 128) return fail('NotSupportedError', 'Only 128-bit AES-GCM tags are supported');
  const aad = param(algorithm, 'additionalData');
  return gcm(bytes, nonce, aad === undefined ? undefined : bytesOf(aad as BufferSource));
}

async function encrypt(algorithm: AlgorithmInput, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer> {
  return bufferOf(aesCipher(algorithm, key).encrypt(bytesOf(data)));
}

async function decrypt(algorithm: AlgorithmInput, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer> {
  const cipher = aesCipher(algorithm, key);
  try {
    return bufferOf(cipher.decrypt(bytesOf(data)));
  } catch {
    return fail('OperationError', 'Decryption failed');
  }
}

async function deriveBits(algorithm: AlgorithmInput, baseKey: CryptoKey, length?: number | null): Promise<ArrayBuffer> {
  const name = canonical(nameOf(algorithm));
  const material = materialOf(baseKey, name);
  if (typeof algorithm === 'string') return fail('NotSupportedError', `${name} needs parameters`);
  if (name === 'X25519') {
    const peer = materialOf(param(algorithm, 'public') as CryptoKey, 'X25519');
    const shared = x25519.getSharedSecret(material.bytes, peer.bytes);
    return bufferOf(length === undefined || length === null ? shared : shared.slice(0, length / 8));
  }
  if (name === 'HKDF' && typeof length === 'number') {
    const salt = bytesOf(param(algorithm, 'salt') as BufferSource);
    const info = bytesOf(param(algorithm, 'info') as BufferSource);
    return bufferOf(hkdf(HASHES[hashOf(param(algorithm, 'hash'))], material.bytes, salt, info, length / 8));
  }
  return fail('NotSupportedError', `Cannot derive bits with ${name}`);
}

async function digest(algorithm: AlgorithmInput, data: BufferSource): Promise<ArrayBuffer> {
  return bufferOf(HASHES[hashOf(nameOf(algorithm))](bytesOf(data)));
}

async function unsupported(): Promise<never> {
  return fail('NotSupportedError', 'Not available in this fallback');
}

/**
 * Build a `SubtleCrypto` backed by audited pure-JS primitives, for a page the
 * browser does not consider a secure context (plain HTTP over Tor or another
 * overlay network), where `crypto.subtle` is undefined.
 *
 * Covers what the shell's dependencies call: `digest` (SHA-1/256/384/512);
 * HMAC and Ed25519 `sign`/`verify`; AES-GCM (128-bit tag) and AES-CBC
 * `encrypt`/`decrypt`; X25519 and HKDF `deriveBits`; Ed25519 and X25519 keys
 * in `raw`, `pkcs8` and `jwk`; AES and HMAC keys in `raw` and `jwk`. Anything
 * else rejects with `NotSupportedError`.
 *
 * @returns A `SubtleCrypto` whose keys only work with this instance.
 * @example
 * ```ts
 * const subtle = createFallbackSubtle();
 * const hash = await subtle.digest('SHA-256', new TextEncoder().encode('kernl'));
 * ```
 */
export function createFallbackSubtle(): SubtleCrypto {
  return {
    decrypt,
    deriveBits,
    deriveKey: unsupported,
    digest,
    encrypt,
    exportKey,
    generateKey,
    importKey,
    sign,
    unwrapKey: unsupported,
    verify,
    wrapKey: unsupported,
  } as SubtleCrypto;
}
