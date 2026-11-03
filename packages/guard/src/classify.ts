import type { GuardEnvelope, OpClass } from './types.js';

const DELETE_KIND = 5;

const EXACT: Readonly<Record<string, OpClass>> = {
  'relay.subscribe': 'relay:subscribe',
  'relay.close': 'control',
  'outbox.subscribe': 'outbox:subscribe',
  'outbox.query': 'outbox:subscribe',
  'outbox.getEvent': 'outbox:subscribe',
  'outbox.publish': 'outbox:publish',
  'outbox.close': 'control',
  'storage.set': 'storage:write',
  'storage.remove': 'storage:write',
  'storage.get': 'control',
  'storage.keys': 'control',
  'dm.send': 'dm:send',
  'intent.invoke': 'intent:invoke',
  'intent.open': 'intent:invoke',
};

const PREFIXED: readonly (readonly [string, OpClass])[] = [
  ['resource.', 'resource:bytes'],
  ['shell.', 'control'],
  ['inc.', 'control'],
  ['theme.', 'control'],
  ['identity.', 'control'],
  ['dm.', 'control'],
];

/**
 * Assign an operation class to an inbound applet envelope.
 *
 * kehto treats the class as an opaque key; this is where kernl gives it meaning.
 * Deletions get their own class because a flood of deletes is the cheapest way
 * for an applet to damage an account's public record.
 *
 * @param envelope - The envelope fields the guard classifies on.
 * @returns The operation class the rates and caps are keyed by.
 * @example
 * ```ts
 * classifyEnvelope({ type: 'relay.publish', kind: 5 }); // 'relay:publish:delete'
 * classifyEnvelope({ type: 'resource.fetch' }); // 'resource:bytes'
 * classifyEnvelope({ type: 'clipboard.write' }); // 'generic'
 * ```
 */
export function classifyEnvelope(envelope: GuardEnvelope): OpClass {
  const { type } = envelope;
  if (type === 'relay.publish' || type === 'relay.publishEncrypted') {
    return envelope.kind === DELETE_KIND ? 'relay:publish:delete' : 'relay:publish';
  }
  const exact = EXACT[type];
  if (exact) return exact;
  const prefixed = PREFIXED.find(([prefix]) => type.startsWith(prefix));
  return prefixed ? prefixed[1] : 'generic';
}

const encoder = new TextEncoder();

/**
 * UTF-8 byte length of a value's JSON form, used as the envelope `size`.
 *
 * Values JSON cannot represent (cycles, BigInt) measure as 0 rather than
 * throwing: the guard must never crash on applet input, and an unmeasurable
 * envelope is still subject to every other check.
 *
 * @param value - Any value, typically the raw envelope received from an applet.
 * @returns Byte length, or 0 when the value cannot be serialised.
 * @example
 * ```ts
 * estimateEnvelopeSize({ type: 'relay.subscribe' }); // 26
 * ```
 */
export function estimateEnvelopeSize(value: unknown): number {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}
