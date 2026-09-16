import {afterEach, describe, expect, it, vi} from 'vitest';
import {fetchTokenOverview, MARKET_API_BASE, MarketApiError} from './market';
import {normalizeTokenOverview, overviewDescription, overviewLink, overviewPollDelay, overviewStatus} from './token-overview';
import {tokenRiskStatus} from './token-risk';

const now = 1_788_922_311_890;
const q = {state: 1, freshness: 1, source: 'codex.filterTokens', definition_version: 'overview-v1', observed_at_ms: now};
function fixture() {
  return {
    chain: 'solana', address: 'TokenA',
    profile: {website: 'https://example.org', twitter: null, telegram: 'https://t.me/example', description: 'A project description.', quality: q},
    activity: {volume_5m_usd: 0, buyers_1h: 0, sellers_1h: null, quality: q},
    holder_summary: {top10_percent: 18.6, quality: {...q, source: 'codex.holders'}},
    holder_intelligence: {
      dev_held_percent: 0,
      sniper_count: 0,
      sniper_held_percent: 0,
      insider_count: 2,
      insider_held_percent: 3.25,
      bundler_count: null,
      bundler_held_percent: null,
      suspicious_count: 2,
      suspicious_held_percent: 3.25,
      top10_percent: 21.5,
      quality: q,
    },
    risk: {result_is_scam: false, token_is_scam: null, potential_scam_reasons: [], quality: q},
    contract_status: {
      mint_authority: null,
      mintable_valid: true,
      freeze_authority: 'FreezeAuthority',
      freezable_valid: false,
      b20_transfer_paused: false,
      b20_mint_paused: null,
      b20_burn_paused: true,
      quality: q,
    },
    trading_route_display: {label: null, kind: 'display_only', status: 'unavailable'},
  };
}

describe('Overview contract and freshness', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves reported zero, nullable fields and percent units', () => {
    const data = normalizeTokenOverview(fixture(), 'solana', 'TokenA');
    expect(data.activity).toMatchObject({volume_5m_usd: 0, buyers_1h: 0, sellers_1h: null});
    expect(data.holder_summary.top10_percent).toBe(18.6);
    expect(data.profile).toMatchObject({telegram: 'https://t.me/example', description: 'A project description.'});
    expect(data.holder_intelligence).toMatchObject({dev_held_percent: 0, sniper_count: 0, sniper_held_percent: 0, top10_percent: 21.5});
    expect(data.risk).toMatchObject({resultIsScam: false, tokenIsScam: null, potentialScamReasons: [], level: 'NO_FLAG_REPORTED'});
    expect(data.contract_status).toMatchObject({mint_authority: null, mintable_valid: true, freezable_valid: false, b20_transfer_paused: false, b20_burn_paused: true});
    expect(data.trading_route_display.label).toBeNull();
  });

  it.each([null, undefined, '', '0', false, -1, NaN, Infinity, {}, []])('rejects malformed numbers %s without coercing zero', (bad) => {
    const raw = {...fixture(), activity: {...fixture().activity, volume_5m_usd: bad, buyers_1h: bad}};
    const data = normalizeTokenOverview(raw, 'solana', 'TokenA');
    expect(data.activity.volume_5m_usd).toBeNull();
    expect(data.activity.buyers_1h).toBeNull();
  });

  it.each([1.5, Number.MAX_SAFE_INTEGER + 1])('rejects non-exact address counts %s', (bad) => {
    const raw = {...fixture(), activity: {...fixture().activity, buyers_1h: bad}};
    expect(normalizeTokenOverview(raw, 'solana', 'TokenA').activity.buyers_1h).toBeNull();
  });

  it.each(['dev_held_percent', 'sniper_held_percent', 'insider_held_percent', 'bundler_held_percent', 'suspicious_held_percent', 'top10_percent'] as const)('validates %s as a 0..100 percentage', (field) => {
    for (const bad of [null, undefined, '', '0', false, -1, 100.0001, NaN, Infinity, {}, []]) {
      const raw = {...fixture(), holder_intelligence: {...fixture().holder_intelligence, [field]: bad}};
      expect(normalizeTokenOverview(raw, 'solana', 'TokenA').holder_intelligence[field]).toBeNull();
    }
  });

  it.each(['sniper_count', 'insider_count', 'bundler_count', 'suspicious_count'] as const)('validates %s as a non-negative safe integer', (field) => {
    for (const bad of [null, undefined, '', '0', false, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, {}, []]) {
      const raw = {...fixture(), holder_intelligence: {...fixture().holder_intelligence, [field]: bad}};
      expect(normalizeTokenOverview(raw, 'solana', 'TokenA').holder_intelligence[field]).toBeNull();
    }
  });

  it('preserves only literal risk and contract booleans', () => {
    const raw = {
      ...fixture(),
      risk: {result_is_scam: 0, token_is_scam: 'false', potential_scam_reasons: [], quality: q},
      contract_status: {...fixture().contract_status, mintable_valid: 1, freezable_valid: 'false', b20_transfer_paused: 0},
    };
    const data = normalizeTokenOverview(raw, 'solana', 'TokenA');
    expect(data.risk).toMatchObject({resultIsScam: null, tokenIsScam: null});
    expect(data.contract_status).toMatchObject({mintable_valid: null, freezable_valid: null, b20_transfer_paused: null});
  });

  it('bounds descriptions and risk reasons without interpreting source text as markup', () => {
    expect(overviewDescription('  <b>About</b>\nSecond line  ')).toBe('<b>About</b>\nSecond line');
    expect(overviewDescription('First line\r\n\tSecond line')).toBe('First line\n\tSecond line');
    expect(overviewDescription('First line\rSecond line')).toBeNull();
    expect(overviewDescription(`safe\u0000unsafe`)).toBeNull();
    expect(overviewDescription(`left\u202Eright`)).toBeNull();
    expect(overviewDescription(`left\u2066right`)).toBeNull();
    expect(overviewDescription('x'.repeat(2_001))).toHaveLength(2_000);
    expect(overviewDescription('x'.repeat(8_193))).toBeNull();
    const reasons = Array.from({length: 40}, (_, index) => `UnknownReason${index}`);
    const raw = {...fixture(), risk: {...fixture().risk, potential_scam_reasons: ['MinimumLiquidity', 'MinimumLiquidity', null, `bad\u0000reason`, `bad\u202Ereason`, `bad\u2066reason`, `\uFEFFTrimmedReason`, ...reasons]}};
    const data = normalizeTokenOverview(raw, 'solana', 'TokenA');
    expect(data.risk.potentialScamReasons).toHaveLength(32);
    expect(data.risk.potentialScamReasons.slice(0, 2)).toEqual(['MinimumLiquidity', 'UnknownReason0']);
  });

  it('inspects at most 64 potential-risk input items', () => {
    const raw = {...fixture(), risk: {...fixture().risk, potential_scam_reasons: [...Array(64).fill(null), 'MinimumLiquidity']}};
    expect(normalizeTokenOverview(raw, 'solana', 'TokenA').risk.potentialScamReasons).toEqual([]);
  });

  it('accepts safe Telegram links and rejects malformed profile and authority text', () => {
    const raw = {
      ...fixture(),
      profile: {...fixture().profile, telegram: 'javascript:alert(1)', description: `bad\u0007text`},
      contract_status: {...fixture().contract_status, freeze_authority: `bad\u2066address`, mint_authority: `bad\u202Eaddress`},
    };
    const data = normalizeTokenOverview(raw, 'solana', 'TokenA');
    expect(data.profile.telegram).toBeNull();
    expect(data.profile.description).toBeNull();
    expect(data.contract_status.freeze_authority).toBeNull();
    expect(data.contract_status.mint_authority).toBeNull();
    const oversized = {...fixture(), contract_status: {...fixture().contract_status, mint_authority: 'x'.repeat(513)}};
    expect(normalizeTokenOverview(oversized, 'solana', 'TokenA').contract_status.mint_authority).toBeNull();
  });

  it('normalizes missing v1 groups as unavailable for legacy backends', () => {
    const current = fixture();
    const legacy = {
      chain: current.chain,
      address: current.address,
      profile: {website: current.profile.website, twitter: current.profile.twitter, quality: current.profile.quality},
      activity: current.activity,
      holder_summary: current.holder_summary,
      trading_route_display: current.trading_route_display,
    };
    const data = normalizeTokenOverview(legacy, 'solana', 'TokenA');
    expect(data.profile).toMatchObject({telegram: null, description: null});
    expect(data.holder_intelligence.quality.state).toBe(0);
    expect(data.holder_intelligence).toMatchObject({dev_held_percent: null, sniper_count: null, top10_percent: null});
    expect(data.risk).toMatchObject({resultIsScam: null, tokenIsScam: null, potentialScamReasons: [], level: 'UNKNOWN'});
    expect(data.risk.quality.state).toBe('UNAVAILABLE');
    expect(data.contract_status).toMatchObject({mint_authority: null, mintable_valid: null, b20_transfer_paused: null});
    expect(data.contract_status.quality.state).toBe(0);
  });

  it('rejects the wrong token identity and preserves Solana case', () => {
    expect(() => normalizeTokenOverview(fixture(), 'solana', 'TokenB')).toThrow(/match/);
    expect(() => normalizeTokenOverview(fixture(), 'solana', 'tokena')).toThrow(/match/);
    expect(() => normalizeTokenOverview(null, 'solana', 'TokenA')).toThrow(/match/);
    const raw = {...fixture(), chain: 'base', address: '0xabc'};
    expect(normalizeTokenOverview(raw, 'base', '0xABC').address).toBe('0xabc');
  });

  it('expires cached fields even without a successful refresh', () => {
    const data = normalizeTokenOverview(fixture(), 'solana', 'TokenA');
    expect(overviewStatus(data.activity.quality, now + 60_000)).toBe('fresh');
    expect(overviewStatus(data.activity.quality, now + 60_001)).toBe('stale');
    expect(overviewStatus(data.activity.quality, now + 299_999)).toBe('stale');
    expect(overviewStatus(data.holder_summary.quality, now + 299_999, true)).toBe('fresh');
    expect(overviewStatus(data.holder_intelligence.quality, now + 60_000)).toBe('fresh');
    expect(overviewStatus(data.holder_intelligence.quality, now + 60_001)).toBe('stale');
    expect(tokenRiskStatus(data.risk, now + 60_001)).toBe('stale');
    expect(overviewStatus(data.contract_status.quality, now + 60_001)).toBe('stale');
    expect(overviewStatus(data.activity.quality, now + 300_000)).toBe('unavailable');
    expect(overviewStatus(data.holder_summary.quality, now + 300_000, true)).toBe('unavailable');
    expect(overviewStatus(data.holder_intelligence.quality, now + 300_000)).toBe('unavailable');
    expect(tokenRiskStatus(data.risk, now + 300_000)).toBe('unavailable');
    expect(overviewStatus(data.contract_status.quality, now + 300_000)).toBe('unavailable');
    expect(overviewStatus(data.activity.quality, now - 1)).toBe('unavailable');
  });

  it('fails closed for unknown versions, unavailable and missing timestamps', () => {
    for (const delta of [{state: 0}, {freshness: 0}, {definition_version: 'overview-v2'}, {observed_at_ms: null}, {observed_at_ms: 0}, {source: 'unknown'}]) {
      const raw = {...fixture(), activity: {...fixture().activity, quality: {...q, ...delta}}};
      const data = normalizeTokenOverview(raw, 'solana', 'TokenA');
      expect(overviewStatus(data.activity.quality, now)).toBe('unavailable');
    }
  });

  it.each(['javascript:alert(1)', 'data:text/html,hello', '//example.org', 'https://user:secret@example.org', 'https://example.org/\npath', `https://example.org/a\u202Eb`, 'https://example.org/' + '<'.repeat(1_000), 'https://example.org/' + 'a'.repeat(2048)])('does not expose an unsafe link %s', (link) => {
    expect(overviewLink(link)).toBeNull();
  });

  it('exposes route labels only with explicit display-only configuration', () => {
    const raw = {...fixture(), trading_route_display: {label: 'Jupiter', kind: 'display_only', status: 'configured'}};
    expect(normalizeTokenOverview(raw, 'solana', 'TokenA').trading_route_display.label).toBe('Jupiter');
    for (const delta of [{kind: 'quote'}, {status: 'unavailable'}, {label: '   '}, {label: `safe\u202Eunsafe`}, {label: 'x'.repeat(129)}, {label: 'x'.repeat(257)}]) {
      expect(normalizeTokenOverview({...raw, trading_route_display: {...raw.trading_route_display, ...delta}}, 'solana', 'TokenA').trading_route_display.label).toBeNull();
    }
  });

  it('uses a bounded roughly 30-second jitter', () => {
    expect(overviewPollDelay(0)).toBe(27_000);
    expect(overviewPollDelay(0.5)).toBe(30_000);
    expect(overviewPollDelay(1)).toBe(33_000);
  });

  it('uses exactly one cache-only request with no HTTP cache and forwards abort', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({code: 200, data: fixture()})));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await fetchTokenOverview('solana', 'TokenA', controller.signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${MARKET_API_BASE}/v1/tokens/solana/TokenA/overview`);
    expect(fetchMock.mock.calls[0][1].cache).toBe('no-store');
    controller.abort();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it.each([400000, 500098, 500301])('does not fall back to a paid endpoint on error %s', async (code) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({code, msg: 'Unavailable', trace_id: 'overview-test'})));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchTokenOverview('solana', 'TokenA')).rejects.toMatchObject({code, traceId: 'overview-test'} satisfies Partial<MarketApiError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
