import {describe, expect, it} from 'vitest';

import {normalizeSearchData} from './search';

describe('token search risk compatibility', () => {
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
