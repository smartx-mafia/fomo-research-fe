import {beforeEach, describe, expect, it, vi} from 'vitest';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));

import {listTransfers, normalizeTransferPage} from './transfers';

describe('transfer history contract', () => {
  beforeEach(() => callMock.mockReset());

  it('uses the opaque provider cursor exactly once', async () => {
    callMock.mockResolvedValue({data: {transfers: [], next_cursor: ''}});
    await expect(listTransfers('jwt', 'opaque+/=')).resolves.toEqual({transfers: [], next_cursor: undefined});
    expect(callMock).toHaveBeenCalledWith('/v1/transfers?cursor=opaque%2B%2F%3D', {bearer: 'jwt', signal: undefined});
  });

  it('normalizes finalized direct Solana USDC movements without assigning business intent', () => {
    expect(normalizeTransferPage({transfers: [{
      direction: 1, chain: 'solana', asset_symbol: 'USDC', asset_address: 'mint', asset_decimals: 6,
      amount_raw: '900719925474099312345', counterparty: '', tx_hash: 'signature', occurred_at: {seconds: '1788796800', nanos: 0},
    }], next_cursor: 'next'})).toEqual({transfers: [{
      direction: 1, chain: 'solana', asset_symbol: 'USDC', asset_address: 'mint', asset_decimals: 6,
      amount_raw: '900719925474099312345', counterparty: undefined, tx_hash: 'signature', occurred_at: {seconds: '1788796800', nanos: 0},
    }], next_cursor: 'next'});
  });

  it('rejects malformed direction, amount, timestamps, and cursor shapes', () => {
    const base = {direction: 1, chain: 'solana', asset_symbol: 'USDC', asset_address: 'mint', asset_decimals: 6, amount_raw: '1', counterparty: '', tx_hash: 'sig', occurred_at: {seconds: 1}};
    expect(() => normalizeTransferPage({transfers: [{...base, direction: 0}], next_cursor: ''})).toThrow(/invalid transfer entry/);
    expect(() => normalizeTransferPage({transfers: [{...base, amount_raw: '1.5'}], next_cursor: ''})).toThrow(/invalid transfer entry/);
    expect(() => normalizeTransferPage({transfers: [{...base, occurred_at: {seconds: 0}}], next_cursor: ''})).toThrow(/occurred_at/);
    expect(() => normalizeTransferPage({transfers: [], next_cursor: 1})).toThrow(/next_cursor/);
  });
});
