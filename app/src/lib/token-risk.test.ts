import {describe, expect, it} from 'vitest';

import {normalizeTokenRisk, tokenRiskStatus} from './token-risk';

describe('TokenRisk compatibility normalizer', () => {
  it('prefers canonical nested risk over transitional flat fields', () => {
    const risk = normalizeTokenRisk({
      resultIsScam: false,
      tokenIsScam: null,
      potentialScamReasons: [],
      level: 'NO_FLAG_REPORTED',
      quality: {
        state: 'AVAILABLE',
        freshness: 'FRESH',
        source: 'codex.filterTokens',
        definitionVersion: 'token-risk-v2',
        observedAtMs: '1788922311890',
      },
    }, {
      flat: {result_is_scam: true, risk_observed: true},
      observedAtMs: 1,
    });

    expect(risk).toEqual({
      resultIsScam: false,
      tokenIsScam: null,
      potentialScamReasons: [],
      level: 'NO_FLAG_REPORTED',
      quality: {
        state: 'AVAILABLE',
        freshness: 'FRESH',
        source: 'codex.filterTokens',
        definitionVersion: 'token-risk-v2',
        observedAtMs: '1788922311890',
      },
    });
  });

  it('adapts observed flat fields without collapsing null, false and true', () => {
    const risk = normalizeTokenRisk(undefined, {
      flat: {
        result_is_scam: false,
        token_is_scam: null,
        potential_scam_reasons: [],
        risk_observed: true,
      },
      observedAtMs: '1788922311890',
    });

    expect(risk).toMatchObject({
      resultIsScam: false,
      tokenIsScam: null,
      potentialScamReasons: [],
      level: 'NO_FLAG_REPORTED',
      quality: {state: 'AVAILABLE', source: 'codex.filterTokens', observedAtMs: '1788922311890'},
    });
    expect(tokenRiskStatus(risk, 1_788_922_311_890)).toBe('fresh');
  });

  it.each([
    ['source', {source: 'codex'}],
    ['definition version', {definitionVersion: 'future-v3'}],
    ['state', {state: 'UNAVAILABLE'}],
    ['freshness', {freshness: 'UNKNOWN'}],
    ['observation time', {observedAtMs: null}],
  ])('downgrades canonical risk with an invalid %s to UNAVAILABLE', (_label, delta) => {
    const risk = normalizeTokenRisk({
      resultIsScam: false,
      tokenIsScam: false,
      potentialScamReasons: [],
      level: 'NO_FLAG_REPORTED',
      quality: {
        state: 'AVAILABLE',
        freshness: 'FRESH',
        source: 'codex.filterTokens',
        definitionVersion: 'token-risk-v2',
        observedAtMs: '1788922311890',
        ...delta,
      },
    });

    expect(risk.quality.state).toBe('UNAVAILABLE');
    expect(risk.quality.freshness).toBe('UNKNOWN');
    expect(risk.level).toBe('UNKNOWN');
    expect(tokenRiskStatus(risk, 1_788_922_311_890)).toBe('unavailable');
  });

  it('requires canonical quality even when a nested riskObserved flag is true', () => {
    const risk = normalizeTokenRisk({
      resultIsScam: false,
      tokenIsScam: false,
      potentialScamReasons: [],
      riskObserved: true,
      level: 'NO_FLAG_REPORTED',
    });
    expect(risk).toMatchObject({level: 'UNKNOWN', quality: {state: 'UNAVAILABLE'}});
  });

  it('retains canonical POTENTIAL when every unsafe reason is rejected', () => {
    const risk = normalizeTokenRisk({
      resultIsScam: false,
      tokenIsScam: false,
      potentialScamReasons: [`bad\u202Ereason`, `bad\u0000reason`],
      level: 'POTENTIAL',
      quality: {
        state: 'AVAILABLE', freshness: 'FRESH', source: 'codex.filterTokens',
        definitionVersion: 'token-risk-v2', observedAtMs: '1788922311890',
      },
    });
    expect(risk).toMatchObject({level: 'POTENTIAL', potentialScamReasons: []});
  });

  it('derives SCAM and POTENTIAL from flat compatibility facts', () => {
    expect(normalizeTokenRisk(undefined, {
      flat: {result_is_scam: true, token_is_scam: false, potential_scam_reasons: [], risk_observed: true},
      observedAtMs: 1,
    }).level).toBe('SCAM');
    expect(normalizeTokenRisk(undefined, {
      flat: {result_is_scam: false, token_is_scam: null, potential_scam_reasons: ['MinimumLiquidity'], risk_observed: true},
      observedAtMs: 1,
    }).level).toBe('POTENTIAL');
  });

  it('maps missing and old contracts to UNKNOWN plus UNAVAILABLE', () => {
    expect(normalizeTokenRisk(undefined)).toEqual({
      resultIsScam: null,
      tokenIsScam: null,
      potentialScamReasons: [],
      level: 'UNKNOWN',
      quality: {state: 'UNAVAILABLE', freshness: 'UNKNOWN', source: '', definitionVersion: '', observedAtMs: null},
    });
    expect(normalizeTokenRisk(undefined, {flat: {symbol: 'OLD'}, observedAtMs: 123}).level).toBe('UNKNOWN');
  });

  it('accepts legacy Overview snake_case while rejecting boolean lookalikes', () => {
    const risk = normalizeTokenRisk({
      result_is_scam: 0,
      token_is_scam: 'false',
      potential_scam_reasons: ['MinimumLiquidity', 'MinimumLiquidity', `bad\u202Ereason`],
      quality: {
        state: 2,
        freshness: 2,
        source: 'codex.filterTokens',
        definition_version: 'overview-v1',
        observed_at_ms: 1_788_922_311_890,
      },
    });

    expect(risk).toMatchObject({
      resultIsScam: null,
      tokenIsScam: null,
      potentialScamReasons: ['MinimumLiquidity'],
      level: 'POTENTIAL',
      quality: {state: 'PARTIAL', freshness: 'STALE', definitionVersion: 'overview-v1'},
    });
  });
});
