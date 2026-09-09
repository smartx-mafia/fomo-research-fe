import {afterEach, describe, expect, it, vi} from 'vitest';
import {fetchTokenOverview, MARKET_API_BASE, MarketApiError} from './market';
import {normalizeTokenOverview, overviewLink, overviewPollDelay, overviewStatus} from './token-overview';

const now = 1_788_922_311_890;
const q = {state: 1, freshness: 1, source: 'codex.filterTokens', definition_version: 'overview-v1', observed_at_ms: now};
function fixture() {
  return {
    chain: 'solana', address: 'TokenA',
    profile: {website: 'https://example.org', twitter: null, quality: q},
    activity: {volume_5m_usd: 0, buyers_1h: 0, sellers_1h: null, quality: q},
    holder_summary: {top10_percent: 18.6, quality: {...q, source: 'codex.holders'}},
    trading_route_display: {label: null, kind: 'display_only', status: 'unavailable'},
  };
}

describe('Overview contract and freshness', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves reported zero, nullable fields and percent units', () => {
    const data = normalizeTokenOverview(fixture(), 'solana', 'TokenA');
    expect(data.activity).toMatchObject({volume_5m_usd: 0, buyers_1h: 0, sellers_1h: null});
    expect(data.holder_summary.top10_percent).toBe(18.6);
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
    expect(overviewStatus(data.activity.quality, now + 300_000)).toBe('unavailable');
    expect(overviewStatus(data.holder_summary.quality, now + 300_000, true)).toBe('unavailable');
    expect(overviewStatus(data.activity.quality, now - 1)).toBe('unavailable');
  });

  it('fails closed for unknown versions, unavailable and missing timestamps', () => {
    for (const delta of [{state: 0}, {freshness: 0}, {definition_version: 'overview-v2'}, {observed_at_ms: null}, {observed_at_ms: 0}, {source: 'unknown'}]) {
      const raw = {...fixture(), activity: {...fixture().activity, quality: {...q, ...delta}}};
      const data = normalizeTokenOverview(raw, 'solana', 'TokenA');
      expect(overviewStatus(data.activity.quality, now)).toBe('unavailable');
    }
  });

  it.each(['javascript:alert(1)', 'data:text/html,hello', '//example.org', 'https://user:secret@example.org', 'https://example.org/\npath', 'https://example.org/' + 'a'.repeat(2048)])('does not expose an unsafe link %s', (link) => {
    expect(overviewLink(link)).toBeNull();
  });

  it('exposes route labels only with explicit display-only configuration', () => {
    const raw = {...fixture(), trading_route_display: {label: 'Jupiter', kind: 'display_only', status: 'configured'}};
    expect(normalizeTokenOverview(raw, 'solana', 'TokenA').trading_route_display.label).toBe('Jupiter');
    for (const delta of [{kind: 'quote'}, {status: 'unavailable'}, {label: '   '}]) {
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
