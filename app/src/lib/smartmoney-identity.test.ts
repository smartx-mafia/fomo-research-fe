import {describe, expect, it} from 'vitest';
import {isExternalSubjectId, parseSmartMoneyIdentityRoute as parse} from './smartmoney-identity';

describe('external smart-money navigation', () => {
  it('preserves IDs above the safe integer range and each typed route', () => {
    expect(parse('/smart-money', new URLSearchParams('subject_id=subject%3A9007199254740993123'))).toEqual({status: 'subject', subjectId: 'subject:9007199254740993123'});
    expect(parse('/smart-money', new URLSearchParams('namespace=solana&wallet_address=AbC'))).toEqual({status: 'wallet', namespace: 'solana', walletAddress: 'AbC'});
    expect(parse('/smart-money/base/0xabc', new URLSearchParams())).toEqual({status: 'legacy', chain: 'base', address: '0xabc'});
    expect(parse('/smart-money', new URLSearchParams('chain=base&address=0xabc'))).toEqual({status: 'legacy', chain: 'base', address: '0xabc'});
  });
  it.each(['subject:', 'subject:0', 'subject:-1', 'subject:01', 'subject:abc', 'subject:1.0', 'subject:1/2'])('rejects malformed subject %s', (id) => {
    expect(isExternalSubjectId(id)).toBe(false);
    expect(parse('/smart-money', new URLSearchParams({subject_id: id}))).toEqual({status: 'invalid'});
  });
  it.each([
    ['/smart-money', 'subject_id=subject:1&chain=base&address=0xabc'],
    ['/smart-money', 'subject_id=subject:1&subject_id=subject:2'],
    ['/smart-money', 'namespace=evm'],
    ['/smart-money', 'chain=base'],
    ['/smart-money/base/0xabc', 'subject_id=subject:1'],
    ['/smart-money/base/0xabc', 'chain=bsc&address=0xabc'],
    ['/smart-money/base/0xabc/extra', ''],
    ['/smart-money/base/%XX', ''],
  ])('rejects ambiguous or malformed URLs %s?%s', (path, query) => {
    expect(parse(path, new URLSearchParams(query))).toEqual({status: 'invalid'});
  });
});
