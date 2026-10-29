import {describe, expect, it} from 'vitest';
import {normalizeBatchTokenMetadata, normalizeGetToken} from '@/api/token-metadata';
import {normalizeSearchData} from '@/api/search';
import {normalizeTokenMarket} from './market';
import {normalizeTokenOverview} from './token-overview';
import {normalizeTokenRisk} from './token-risk';
import {mergeBoardUpdates} from './ws';

const ref = {chain: 'base', address: '0xabc'};
const rawRisk = {
  result_is_scam: null, token_is_scam: false, potential_scam_reasons: ['MinimumLiquidity'],
  assessment: {
    mode: 'enforce', grade: 4, checks_complete: false, valid_until_ms: '1789000060000', policy_version: 'policy-v1', decision_version: 'decision-v2', confirmation_version: 'semantic:77',
    recommendation_allowed: false, keyword_search_allowed: true, square_distribution_allowed: false,
    goplus_status: 'storage_error', goplus_observed_at_ms: '1789000000000', last_attempt_at_ms: '1789000000001', buy_action: 'unavailable',
    items: [{code: 'goplus_buy_tax', grade: 4, display_source: 'goplus', params: {rate: '3.88'}, evidence: [{source: 'goplus', field: 'buy_tax', value: '0.0388', observed_at_ms: '1789000000000'}]}],
    checks: [{code: 'goplus_buy_tax', state: 'flagged', value: '3.88'}],
  },
};
const expected = normalizeTokenRisk(rawRisk);
describe('whole canonical metadata risk retention', () => {
  it('single and batch metadata keep all assessment, evidence, params, versions, availability and permission fields', () => {
    const info = {...ref, decimals: 18};
    expect(normalizeGetToken({info, risk: rawRisk})?.risk).toEqual(expected);
    for (const status of [1, 2, 3, 4, 5]) {
      expect(normalizeBatchTokenMetadata({results: [{...ref, status, info, personal: {is_favorited: false}, risk: rawRisk}]}, [ref]).results[0].risk).toEqual(expected);
    }
  });
  it('market, overview, search and board WS normalization preserve the same whole risk', () => {
    expect(normalizeTokenMarket({...ref, risk: rawRisk}).risk).toEqual(expected);
    expect(normalizeTokenOverview({...ref, risk: rawRisk}, ref.chain, ref.address).risk).toEqual(expected);
    expect(normalizeSearchData({tokens: [{...ref, market: {risk: rawRisk}}]}).tokens?.[0].market?.risk).toEqual(expected);
    const current = normalizeTokenMarket({...ref, risk: rawRisk});
    expect(mergeBoardUpdates([current], {...ref, risk: rawRisk})[0].risk).toEqual(expected);
  });
  it('round-tripping normalized metadata cannot strip the assessment', () => {
    expect(normalizeTokenRisk(expected).assessment).toEqual(expected.assessment);
  });
});
