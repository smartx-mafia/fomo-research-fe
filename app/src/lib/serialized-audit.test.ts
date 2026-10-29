import {describe, expect, it} from 'vitest';
import {normalizeSerializedAudit, serializedChainSymbol, validSerializedAddress} from './serialized-audit';

describe('Serialized Audit contract', () => {
  it('maps app chain slugs to provider symbols', () => {
    expect(serializedChainSymbol('ethereum')).toBe('ETH');
    expect(serializedChainSymbol('robinhood')).toBe('ROBINHOOD');
    expect(serializedChainSymbol('unknown')).toBeUndefined();
  });

  it('validates addresses by chain family', () => {
    expect(validSerializedAddress('robinhood', '0x1111111111111111111111111111111111111111')).toBe(true);
    expect(validSerializedAddress('robinhood', 'So11111111111111111111111111111111111111112')).toBe(false);
    expect(validSerializedAddress('solana', 'So11111111111111111111111111111111111111112')).toBe(true);
  });

  it('normalizes the documented audit response and drops malformed findings', () => {
    const result = normalizeSerializedAudit({audit: {
      isSafe: false, isTokenSafe: false, description: 'Owner can mint.', address: '0x1111111111111111111111111111111111111111',
      chain: 'ROBINHOOD', vulnerabilities: [{type: 'UnlimitedMinting', impact: 'critical', description: 'Unlimited supply.', mitigated: false}, {type: '', impact: 'warning'}],
    }});
    expect(result.state).toBe('ready');
    if (result.state === 'ready') expect(result.audit.vulnerabilities).toHaveLength(1);
  });

  it('preserves a documented no-verdict response', () => {
    expect(normalizeSerializedAudit({audit: null, reason: 'decompile_disabled', message: 'Opt in to decompilation.'})).toEqual({state: 'unavailable', reason: 'decompile_disabled', message: 'Opt in to decompilation.'});
  });
});
