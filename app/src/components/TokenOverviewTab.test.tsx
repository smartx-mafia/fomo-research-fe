import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {normalizeTokenOverview} from '@/lib/token-overview';
import {TokenOverviewContent} from './TokenOverviewTab';

const now = 1_788_922_311_890;
const quality = {state: 1, freshness: 1, source: 'codex.filterTokens', definition_version: 'overview-v1', observed_at_ms: now};
const data = normalizeTokenOverview({
  chain: 'solana', address: 'TokenA',
  profile: {website: 'https://example.org', twitter: null, quality},
  activity: {volume_5m_usd: 0, buyers_1h: 0, sellers_1h: null, quality},
  holder_summary: {top10_percent: 18.6, quality: {...quality, source: 'codex.holders'}},
  trading_route_display: {label: null, kind: 'display_only', status: 'unavailable'},
}, 'solana', 'TokenA');

describe('Overview presentation', () => {
  it('renders zero, unavailable and percent values faithfully without unsupported fields', () => {
    const html = renderToStaticMarkup(<TokenOverviewContent chain="solana" address="TokenA" data={data} now={now} />);
    expect(html).toContain('$0');
    expect(html).toContain('18.60%');
    expect(html).toContain('Sellers · 1h');
    expect(html).toContain('>—<');
    expect(html).toContain('Unique buying addresses');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).not.toMatch(/ATH|ATL|Honeypot|Community verified|Best route|Jupiter|Insiders|Snipers/);
  });

  it('labels old snapshots and hides values and links once expired', () => {
    const older = renderToStaticMarkup(<TokenOverviewContent chain="solana" address="TokenA" data={data} now={now + 60_001} />);
    expect(older).toContain('Older snapshot');
    const expired = renderToStaticMarkup(<TokenOverviewContent chain="solana" address="TokenA" data={data} now={now + 300_000} />);
    expect(expired).not.toContain('$0');
    expect(expired).not.toContain('18.60%');
    expect(expired).not.toContain('href=');
  });

  it('labels explicit route text as display-only and escapes source text', () => {
    const configured = {...data, trading_route_display: {label: '<script>not a quote</script>', kind: 'display_only' as const, status: 'configured' as const}};
    const html = renderToStaticMarkup(<TokenOverviewContent chain="solana" address="TokenA" data={configured} now={now} />);
    expect(html).toContain('Display only');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('keeps an optional error local to Overview rather than treating the token as missing', () => {
    const html = renderToStaticMarkup(<TokenOverviewContent chain="solana" address="TokenA" now={now} error={new Error('network')} />);
    expect(html).toContain('Overview is temporarily unavailable');
    expect(html).not.toContain('Token not found');
  });
});
