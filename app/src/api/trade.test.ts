import {beforeEach, describe, expect, it, vi} from 'vitest';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));

import {
  createTrade,
  formatUnits,
  parseUnits,
  phaseOf,
  pollTrade,
  previewTrade,
  TRADE_PHASE_FAILED,
  TRADE_PHASE_PENDING,
  TRADE_PHASE_SUCCESS,
} from './trade';

const BASE_INTENT = {
  chain: 'base',
  side: 'buy' as const,
  token: '0x1111111111111111111111111111111111111111',
  amountIn: '1000000',
  slippageBps: 0,
};

describe('trade request contract', () => {
  beforeEach(() => callMock.mockReset());

  it('sends exact smallest-unit strings, preserves slippage 0, and funds non-Solana buys from Solana', async () => {
    callMock.mockResolvedValue({data: {trade_id: 't-1'}});
    await previewTrade('jwt', BASE_INTENT);
    expect(callMock).toHaveBeenCalledWith('/v1/meme/trades/preview', {
      method: 'POST',
      bearer: 'jwt',
      body: {
        wallet: {chain: 'base'},
        funding: {chain: 'solana'},
        side: 'buy',
        token: BASE_INTENT.token,
        amount_in: '1000000',
        slippage_bps: 0,
      },
      signal: undefined,
    });
  });

  it('accepts the documented upper slippage boundary and omits funding for sells', async () => {
    callMock.mockResolvedValue({data: {trade_id: 't-2'}});
    await createTrade('jwt', {...BASE_INTENT, side: 'sell', slippageBps: 10_000});
    expect(callMock.mock.calls[0]?.[1]?.body).toEqual({
      wallet: {chain: 'base'},
      side: 'sell',
      token: BASE_INTENT.token,
      amount_in: '1000000',
      slippage_bps: 10_000,
    });
  });

  it('rejects fractional smallest-unit strings and out-of-range slippage before calling the API', async () => {
    await expect(createTrade('jwt', {...BASE_INTENT, amountIn: '1.5'})).rejects.toThrow(/positive integer/);
    await expect(createTrade('jwt', {...BASE_INTENT, slippageBps: 10_001})).rejects.toThrow(/10,000/);
    expect(callMock).not.toHaveBeenCalled();
  });
});

describe('exact unit conversion', () => {
  it('parses and formats decimal values without floating-point arithmetic', () => {
    const raw = parseUnits('12345678901234567890.123456', 6);
    expect(raw.toString()).toBe('12345678901234567890123456');
    expect(formatUnits(raw, 6)).toBe('12345678901234567890.123456');
    expect(formatUnits('1000000', 6)).toBe('1');
  });

  it('rejects excess precision and non-decimal notation', () => {
    expect(() => parseUnits('1.0000001', 6)).toThrow(/at most 6/);
    expect(() => parseUnits('1e6', 6)).toThrow(/plain decimal/);
  });
});

describe('trade polling', () => {
  beforeEach(() => callMock.mockReset());

  it('maps every documented status representation', () => {
    expect(phaseOf({status: 1})).toBe(TRADE_PHASE_PENDING);
    expect(phaseOf({status: 'SUCCESS'})).toBe(TRADE_PHASE_SUCCESS);
    expect(phaseOf({status: 'TRADE_PHASE_FAILED'})).toBe(TRADE_PHASE_FAILED);
  });

  it('polls pending trades until a terminal response', async () => {
    callMock
      .mockResolvedValueOnce({data: {trade_id: 't-1', status: 'PENDING'}})
      .mockResolvedValueOnce({data: {trade_id: 't-1', status: 'SUCCESS', lifecycle: 'confirmed'}});
    const ticks: string[] = [];
    const result = await pollTrade('jwt', 't-1', {
      intervalMs: 0,
      onTick: (trade) => ticks.push(String(trade.status)),
    });
    expect(result.stop).toBe('settled');
    expect(result.rounds).toBe(2);
    expect(ticks).toEqual(['PENDING', 'SUCCESS']);
  });

  it('stops at a passed backend deadline and rejects unknown status values', async () => {
    callMock.mockResolvedValueOnce({
      data: {trade_id: 't-1', status: 'PENDING', deadline_at: new Date(Date.now() - 1_000).toISOString()},
    });
    await expect(pollTrade('jwt', 't-1', {intervalMs: 0})).resolves.toMatchObject({stop: 'deadline'});
    callMock.mockResolvedValueOnce({data: {trade_id: 't-2', status: 'MYSTERY'}});
    await expect(pollTrade('jwt', 't-2', {intervalMs: 0})).rejects.toThrow(/Unknown trade status/);
  });
});
