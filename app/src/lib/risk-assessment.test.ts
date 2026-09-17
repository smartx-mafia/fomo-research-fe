import {describe, expect, it} from 'vitest';
import {normalizeTokenRisk} from './token-risk';
import {normalizeRiskAssessment, normalizeRiskParams, riskCopy, riskItemCopy, riskItemTitle, riskTradeAction} from './risk-assessment';

describe('canonical assessment', () => {
  it('normalizes optional valid_until_ms in either naming convention without inventing a deadline', () => {
    expect(normalizeRiskAssessment({valid_until_ms: '1789000060000'}).validUntilMs).toBe('1789000060000');
    expect(normalizeRiskAssessment({validUntilMs: 1789000060000}).validUntilMs).toBe('1789000060000');
    for (const value of [undefined, null, '', 0, '0', -1, 'yesterday', Number.MAX_SAFE_INTEGER + 1]) {
      expect(normalizeRiskAssessment({valid_until_ms: value}).validUntilMs).toBeNull();
    }
  });
  it('preserves exact decimal rates in 0..100, including endpoints and leading/trailing zeros', () => {
    for (const rate of ['0', '0.000', '3.8800', '99.999999999999999999999', '100', '100.000000000000000000000', '000100.00', '000.0001']) {
      expect(normalizeRiskParams('goplus_buy_tax', {rate})).toEqual({rate});
    }
  });
  it('rejects out-of-range, non-decimal and non-string rates without changing backend grade', () => {
    for (const rate of ['100.000000000000000000001', '101', '000101', '-1', '+1', '.5', '1.', '1e2', 'NaN', 'Infinity', ' 3.88', '3.88 ', '3.88%', '', '<img src=x onerror=alert(1)>', '9'.repeat(513), 3.88, null]) {
      const risk = normalizeRiskAssessment({grade: 4, items: [{code: 'goplus_buy_tax', grade: 4, params: {rate}}]});
      expect(risk.items[0].params).toEqual({});
      expect(riskItemTitle(risk.items[0])).toBe('Buy tax');
      expect(risk.grade).toBe(4);
      expect(risk.items[0].grade).toBe(4);
    }
  });
  it('accepts creator honeypot counts only as decimal digits, without integer precision loss', () => {
    for (const count of ['0', '003', '9007199254740993123456789']) {
      expect(normalizeRiskParams('goplus_honeypot_with_same_creator', {count})).toEqual({count});
    }
    for (const count of ['-1', '+1', '1.0', '1e3', ' 1', '١', '', '<script>', '1'.repeat(513), 3, null]) {
      expect(normalizeRiskParams('goplus_honeypot_with_same_creator', {count})).toEqual({});
    }
  });
  it('does not expose arbitrary parameters or known names on unrelated risk codes', () => {
    expect(normalizeRiskParams('goplus_buy_tax', {rate: '5', note: 'free text', count: '2'})).toEqual({rate: '5'});
    expect(normalizeRiskParams('goplus_honeypot_with_same_creator', {count: '2', rate: '5'})).toEqual({count: '2'});
    expect(normalizeRiskParams('goplus_mintable', {rate: '5', count: '2', note: 'free text'})).toEqual({});
  });
  it('retains known enforced R5/R4 gates during decision-store failure, but unknown providers and observe mode do not gate', () => {
    expect(riskTradeAction(normalizeRiskAssessment({mode: 'enforce', grade: 5, buy_action: 'unavailable', goplus_status: 'storage_error'}), 'buy')).toBe('block');
    expect(riskTradeAction(normalizeRiskAssessment({mode: 'enforce', grade: 4, buy_action: 'unavailable'}), 'buy')).toBe('confirm');
    expect(riskTradeAction(normalizeRiskAssessment({mode: 'enforce', grade: 0, buy_action: 'unavailable'}), 'buy')).toBe('allow');
    expect(riskTradeAction(normalizeRiskAssessment({mode: 'observe', grade: 5, buy_action: 'unavailable'}), 'buy')).toBe('allow');
    expect(riskTradeAction(normalizeRiskAssessment({mode: 'enforce', grade: 5, buy_action: 'unavailable'}), 'sell')).toBe('allow');
  });
  it('uses the PRD qualifications for source, proxy, shutdown, privileges and tested-route restrictions', () => {
    expect(riskCopy('goplus_closed_source')[0]).toBe('Contract source unavailable');
    expect(riskCopy('goplus_closed_source')[1]).toContain('does not establish that the source is closed');
    expect(riskCopy('goplus_proxy')[0]).toBe('Proxy contract detected');
    expect(riskCopy('goplus_proxy')[1]).toContain('may be replaceable');
    expect(riskCopy('goplus_selfdestruct')[0]).toBe('Contract shutdown feature');
    expect(riskCopy('goplus_selfdestruct')[1]).toContain('network rules and execution conditions');
    expect(riskCopy('goplus_whitelisted')[0]).toBe('Special address privileges');
    expect(riskCopy('goplus_b20_whitelist')[0]).toBe('Whitelist-only trading');
    for (const code of ['goplus_cannot_buy', 'goplus_cannot_sell']) expect(riskCopy(code)[1]).toContain('tested route');
  });
  it.each([[2, 'Transfer hook program detected'], [4, 'Transfer hook can be modified'], [5, 'Malicious transfer hook']] as const)('explains transfer_hook using its backend item grade %s', (grade, title) => {
    const item = normalizeRiskAssessment({items: [{code: 'goplus_transfer_hook', grade, evidence: [{value: 'provider text is not used'}]}]}).items[0];
    expect(riskItemTitle(item)).toBe(title);
    expect(riskItemCopy(item)[1]).not.toContain('provider text');
  });
  it('preserves opaque hash:epoch versions and renders decimal-percent tax without recomputing raw ratios', () => {
    const risk = normalizeRiskAssessment({confirmation_version: 'semanticHash:42', items: [{code: 'goplus_buy_tax', params: {rate: '3.88'}, evidence: [{value: '0.0388'}]}]});
    expect(risk.confirmationVersion).toBe('semanticHash:42');
    expect(riskItemTitle(risk.items[0])).toBe('Buy tax (3.88%)');
    expect(risk.items[0].evidence[0].value).toBe('0.0388');
  });
  it('normalizes missing, null and protobuf unknowns without inferring R1 or R5 from provider flags', () => {
    for (const value of [null, undefined, {}, {grade: 0}, {grade: '5'}, {grade: 8}]) {
      const risk = normalizeRiskAssessment(value);
      expect(risk.grade).toBe(0);
      expect(risk.buyAction).toBe('unavailable');
      expect(risk.checksComplete).toBe(false);
      expect(riskTradeAction(risk, 'buy')).toBe('allow');
    }
    expect(normalizeTokenRisk({token_is_scam: true, assessment: {grade: 0}}).assessment?.grade).toBe(0);
  });
  it('guards enforcement by mode, and never gates sells', () => {
    for (const mode of ['', 'observe', 'ENFORCE', undefined]) {
      expect(riskTradeAction(normalizeRiskAssessment({mode, grade: 5, buy_action: 'block'}), 'buy')).toBe('allow');
    }
    expect(riskTradeAction(normalizeRiskAssessment({mode: 'enforce', grade: 5, buy_action: 'block'}), 'buy')).toBe('block');
    expect(riskTradeAction(normalizeRiskAssessment({mode: 'enforce', grade: 4, buy_action: 'confirm'}), 'buy')).toBe('confirm');
    expect(riskTradeAction(normalizeRiskAssessment({mode: 'enforce', grade: 5, buy_action: 'block'}), 'sell')).toBe('allow');
  });
  it('preserves versions, exact parameter strings and evidence; deduplicates by backend code', () => {
    const item = {code: 'goplus_buy_tax', grade: 3, display_source: 'goplus', params: {rate: '0.123456789012345678901'}, evidence: [{source: 'goplus', field: 'buy_tax', value: '0.00123456789012345678901', observed_at_ms: '9223372036854775807'}]};
    const result = normalizeRiskAssessment({mode: 'enforce', grade: 3, checks_complete: true, confirmation_version: 'v4', items: [item, item]});
    expect(result.items).toHaveLength(1);
    expect(result.items[0].params.rate).toBe(item.params.rate);
    expect(result.items[0].evidence[0].observedAtMs).toBe('9223372036854775807');
    expect(result.confirmationVersion).toBe('v4');
    expect(riskCopy('<script>')).toEqual(['Additional risk flagged', 'The risk service reported an additional risk for this token.']);
  });
});
