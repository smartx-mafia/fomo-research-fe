import {describe, expect, it} from 'vitest';

import {normalizeSearchData} from './search';

describe('token search risk compatibility', () => {
  it('preserves the backend market-cap descending order', () => {
    const data = normalizeSearchData({scope: 1, tokens: [
      {chain: 'bitcoin', address: 'btc', symbol: 'BTC', market: {market_cap: 1_900_000_000_000}},
      {chain: 'ethereum', address: '0xbtc', symbol: 'BTC', market: {market_cap: 500_000_000}},
      {chain: 'base', address: '0xsmall', symbol: 'BTC', market: {market_cap: 2_000_000}},
    ]});

    expect(data.tokens?.map((token) => token.address)).toEqual(['btc', '0xbtc', '0xsmall']);
    expect(data.tokens?.map((token) => token.market?.market_cap)).toEqual([
      1_900_000_000_000,
      500_000_000,
      2_000_000,
    ]);
  });

  it('keeps risky results visible and reads risk only from the TokenMarket mirror', () => {
    const data = normalizeSearchData({scope: 1, tokens: [{
      chain: 'base',
      address: '0xabc',
      symbol: 'RISK',
      market: {
        chain: '',
        address: '0xconflicting-inner',
        price: 1,
        updated_at: '1788922311890',
        result_is_scam: true,
        token_is_scam: false,
        potential_scam_reasons: [],
        risk_observed: true,
      },
    }]});

    expect(data.tokens).toHaveLength(1);
    expect(data.tokens?.[0]).not.toHaveProperty('risk');
    expect(data.tokens?.[0].market).toMatchObject({
      chain: 'base',
      address: '0xabc',
      risk: {level: 'SCAM', resultIsScam: true, tokenIsScam: false},
    });
  });

  it('lets nested market risk win over flat rollout fields', () => {
    const token = normalizeSearchData({tokens: [{
      chain: 'solana',
      address: 'TokenA',
      market: {
        updated_at: 1_788_922_311_890,
        result_is_scam: true,
        risk_observed: true,
        risk: {
          resultIsScam: false,
          tokenIsScam: false,
          potentialScamReasons: [],
          level: 'NO_FLAG_REPORTED',
          quality: {state: 'AVAILABLE', freshness: 'FRESH', source: 'codex.filterTokens', definitionVersion: 'token-risk-v2', observedAtMs: '1788922311890'},
        },
      },
    }]}).tokens?.[0];

    expect(token?.market?.risk.level).toBe('NO_FLAG_REPORTED');
    expect(token?.market?.risk.resultIsScam).toBe(false);
  });
});
