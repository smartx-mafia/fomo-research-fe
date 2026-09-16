import {describe, expect, it} from 'vitest';

import {mergeBoardUpdates} from './ws';

describe('board WebSocket risk merge', () => {
  it('carries backend risk without client-side membership filtering', () => {
    const items = mergeBoardUpdates([], [{
      chain: 'base',
      address: '0xabc',
      updated_at: '1788922311890',
      result_is_scam: true,
      token_is_scam: false,
      potential_scam_reasons: [],
      risk_observed: true,
    }]);

    expect(items).toHaveLength(1);
    expect(items[0].risk.level).toBe('SCAM');
  });

  it('replaces an existing row with its latest canonical risk', () => {
    const first = mergeBoardUpdates([], [{chain: 'base', address: '0xabc'}]);
    const next = mergeBoardUpdates(first, [{
      chain: 'base',
      address: '0xabc',
      risk: {
        resultIsScam: false,
        tokenIsScam: false,
        potentialScamReasons: [],
        quality: {state: 'AVAILABLE', freshness: 'FRESH', source: 'codex.filterTokens', definitionVersion: 'token-risk-v2', observedAtMs: '1788922311890'},
        level: 'NO_FLAG_REPORTED',
      },
    }]);

    expect(next).toHaveLength(1);
    expect(next[0].risk.level).toBe('NO_FLAG_REPORTED');
  });
});
