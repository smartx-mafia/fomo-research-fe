import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }));
vi.mock('./envelope', () => ({ call: callMock }));

import { fetchTokenTradeBoard, normalizeTokenTradeBoard } from './token-trade-boards';

describe('token trade board contract', () => {
  beforeEach(() => callMock.mockReset());

  it('requests the platform board with scope and clamps the limit without a cursor', async () => {
    callMock.mockResolvedValue({ data: {
      token: { chain: 'bsc', address: '0xabc', decimals: 18, symbol: 'ABC', name: 'ABC Token' },
      items: [{
        side: 'buy', occurred_at: 1789616411, token_amount: '123.450000000000000001', usd: '9.99',
        execution_price_usd: '0.08089012345678901234', market_cap_usd_at_trade: '1000000.123456789',
        tx_hash: '0xtx', tx_chain: 'solana', actor_type: 'user', actor_id: 'u1',
        user: { identifier: 'u1', username: 'alice', nickname: 'Alice', avatar_url: 'https://img/alice.png' },
      }], coverage: [],
    }});

    await expect(fetchTokenTradeBoard('platform', 'bsc', '0xabc', { scope: 'all', limit: 500, bearer: 'jwt' })).resolves.toMatchObject({
      token: { chain: 'bsc', address: '0xabc', decimals: 18, symbol: 'ABC' },
      items: [{ side: 'buy', occurredAt: 1789616411, tokenAmount: '123.450000000000000001', usd: '9.99', executionPriceUSD: '0.08089012345678901234', marketCapUSDAtTrade: '1000000.123456789', actorType: 'user', actorID: 'u1', user: { identifier: 'u1', username: 'alice' } }],
      coverage: [],
    });
    expect(callMock).toHaveBeenCalledWith(
      '/v1/tokens/bsc/0xabc/platform-trades?scope=all&limit=200',
      { bearer: 'jwt', signal: undefined, preserveInt64Fields: ['occurred_at'] },
    );
  });

  it('keeps zero amounts and treats an empty token object as unavailable metadata', () => {
    const page = normalizeTokenTradeBoard({
      token: { chain: '', address: '', decimals: 0 },
      items: [{ side: 'sell', occurred_at: '1789616411', token_amount: '0', usd: '0', execution_price_usd: '', market_cap_usd_at_trade: '', tx_hash: '', tx_chain: '', actor_type: 'smart_money', actor_id: '0xwallet', smart_money: { address: '0xwallet', chains: ['bsc'], display_name: '' } }],
      coverage: ['gmgn_not_configured'],
    });
    expect(page.token).toBeUndefined();
    expect(page.items[0]).toMatchObject({ side: 'sell', occurredAt: 1789616411, tokenAmount: '0', usd: '0', smartMoney: { address: '0xwallet', chains: ['bsc'] } });
    expect(page.items[0]?.executionPriceUSD).toBeUndefined();
    expect(page.coverage).toEqual(['gmgn_not_configured']);
  });
});
