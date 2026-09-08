import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {ApiError} from '@/api/envelope';
import {
  clearOpinionIntent,
  newOpinionIdempotencyKey,
  opinionFailureIsUncertain,
  readOpinionIntent,
  writeOpinionIntent,
  type OpinionIntent,
} from './opinion-recovery';

class MemoryStorage {
  private rows = new Map<string, string>();
  getItem(key: string): string | null {return this.rows.get(key) ?? null;}
  setItem(key: string, value: string): void {this.rows.set(key, String(value));}
  removeItem(key: string): void {this.rows.delete(key);}
}

const intent: OpinionIntent = {
  targetID: '1:evm:0xabc:3',
  mode: 'create',
  body: 'First round looks strong',
  xLinkURL: '',
  idempotencyKey: 'opinion-test-key',
};

beforeEach(() => vi.stubGlobal('sessionStorage', new MemoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('opinion intent recovery', () => {
  it('round trips an intent through sessionStorage and clears it per target', () => {
    expect(writeOpinionIntent(intent)).toBe(true);
    expect(readOpinionIntent(intent.targetID)).toEqual(intent);
    expect(readOpinionIntent('1:evm:0xother:1')).toBeNull();
    clearOpinionIntent(intent.targetID);
    expect(readOpinionIntent(intent.targetID)).toBeNull();
  });

  it('keeps edit identity fields through a round trip', () => {
    const edit: OpinionIntent = {...intent, mode: 'edit', opinionID: 41, baseVersionID: 87, body: 'Edited'};
    expect(writeOpinionIntent(edit)).toBe(true);
    expect(readOpinionIntent(edit.targetID)).toEqual(edit);
  });

  it('reads corrupt or field-incomplete records as null', () => {
    const key = `smartx.opinion.recovery.v1.${intent.targetID}`;
    const edit: OpinionIntent = {...intent, mode: 'edit', opinionID: 41, baseVersionID: 87};
    for (const broken of [
      '{broken',
      '42',
      JSON.stringify({...intent, body: undefined}),
      JSON.stringify({...intent, xLinkURL: undefined}),
      JSON.stringify({...intent, idempotencyKey: ''}),
      JSON.stringify({...intent, mode: 'draft'}),
      JSON.stringify({...intent, targetID: ''}),
      JSON.stringify({...edit, opinionID: undefined}),
      JSON.stringify({...edit, baseVersionID: 1.5}),
    ]) {
      sessionStorage.setItem(key, broken);
      expect(readOpinionIntent(intent.targetID)).toBeNull();
    }
  });

  it('returns false instead of throwing when storage is unavailable or the write is truncated', () => {
    vi.stubGlobal('sessionStorage', {setItem: () => {throw new Error('quota');}, getItem: () => null, removeItem: () => undefined});
    expect(writeOpinionIntent(intent)).toBe(false);
    vi.stubGlobal('sessionStorage', {setItem: () => undefined, getItem: () => 'truncated', removeItem: () => undefined});
    expect(writeOpinionIntent(intent)).toBe(false);
    vi.stubGlobal('sessionStorage', {setItem: () => undefined, getItem: () => null, removeItem: () => {throw new Error('blocked');}});
    expect(() => clearOpinionIntent(intent.targetID)).not.toThrow();
    expect(() => readOpinionIntent(intent.targetID)).not.toThrow();
  });

  it('generates unique opinion-prefixed idempotency keys', () => {
    expect(newOpinionIdempotencyKey()).toMatch(/^opinion-[0-9a-f-]{36}$/);
    expect(newOpinionIdempotencyKey()).not.toBe(newOpinionIdempotencyKey());
  });
});

describe('opinion failure classification', () => {
  it('treats transport, network, and post-write backend faults as uncertain', () => {
    expect(opinionFailureIsUncertain(new ApiError('transport', 504, 'no envelope'))).toBe(true);
    expect(opinionFailureIsUncertain(new ApiError('network', 0, 'fetch threw'))).toBe(true);
    for (const code of [420000, 500097, 500100, 500101]) {
      expect(opinionFailureIsUncertain(new ApiError('business', code, 'fault'))).toBe(true);
    }
  });

  it('treats deterministic rejections and non-API errors as certain', () => {
    for (const code of [100100, 100101, 200100, 200103, 420100, 420101, 430103, 430114, 600100, 400000]) {
      expect(opinionFailureIsUncertain(new ApiError('business', code, 'rejected'))).toBe(false);
    }
    expect(opinionFailureIsUncertain(new Error('shape'))).toBe(false);
    expect(opinionFailureIsUncertain('nope')).toBe(false);
  });
});
