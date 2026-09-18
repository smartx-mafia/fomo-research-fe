import {beforeEach, describe, expect, it, vi} from 'vitest';

import {clearTradeRecovery, readTradeRecovery, writeTradeRecovery} from './trade-recovery';

class MemoryStorage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('trade recovery marker', () => {
  beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));

  it('persists only the original trade locator and normalizes EVM token identity', () => {
    expect(writeTradeRecovery('alice', 'bsc', '0xABCDEF0000000000000000000000000000000000', 'fingerprint', {
      trade_id: 'trade-1', side: 'buy', token: '0xABCDEF0000000000000000000000000000000000',
    })).toBe(true);
    expect(readTradeRecovery('alice', 'bsc', '0xabcdef0000000000000000000000000000000000')).toEqual({
      version: 1,
      actorID: 'alice',
      chain: 'bsc',
      token: '0xabcdef0000000000000000000000000000000000',
      fingerprint: 'fingerprint',
      tradeID: 'trade-1',
      side: 'buy',
    });
  });

  it('clears a terminal trade marker and fails closed when storage is unavailable', () => {
    expect(writeTradeRecovery('alice', 'solana', 'TokenA', 'fingerprint', {
      trade_id: 'trade-1', side: 'sell', token: 'TokenA',
    })).toBe(true);
    expect(clearTradeRecovery('alice', 'solana', 'TokenA', 'fingerprint')).toBe(true);
    expect(readTradeRecovery('alice', 'solana', 'TokenA')).toBeUndefined();
    vi.stubGlobal('localStorage', {setItem: () => { throw new Error('blocked'); }});
    expect(writeTradeRecovery('alice', 'solana', 'TokenA', 'fingerprint', {
      trade_id: 'trade-1', side: 'sell', token: 'TokenA',
    })).toBe(false);
  });

  it('surfaces a corrupt marker so the caller can block a new financial action', () => {
    const target = localStorage as unknown as MemoryStorage;
    target.setItem('smartx.trade.recovery.v1.alice.solana.TokenA.fingerprint', '{broken');
    expect(() => readTradeRecovery('alice', 'solana', 'TokenA')).toThrow(/corrupt/);
  });

  it('never overwrites a different unresolved trade for the same account and token', () => {
    expect(writeTradeRecovery('alice', 'solana', 'TokenA', 'first', {
      trade_id: 'trade-1', side: 'buy', token: 'TokenA',
    })).toBe(true);
    expect(writeTradeRecovery('alice', 'solana', 'TokenA', 'second', {
      trade_id: 'trade-2', side: 'buy', token: 'TokenA',
    })).toBe(false);
    expect(readTradeRecovery('alice', 'solana', 'TokenA')).toMatchObject({tradeID: 'trade-1', fingerprint: 'first'});
  });
});
