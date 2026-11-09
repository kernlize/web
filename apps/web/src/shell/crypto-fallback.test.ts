import { describe, expect, it } from 'vitest';
import { cryptoFallback } from './crypto-fallback';

describe('crypto-fallback', () => {
  it('leaves a secure context alone', () => {
    expect(cryptoFallback).toEqual({ randomUUID: false, subtle: false });
    expect(typeof globalThis.crypto.randomUUID).toBe('function');
  });
});
