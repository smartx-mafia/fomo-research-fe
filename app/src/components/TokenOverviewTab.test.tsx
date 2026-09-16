// @vitest-environment jsdom
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {within} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {normalizeTokenOverview} from '@/lib/token-overview';
import {normalizeTokenRisk} from '@/lib/token-risk';
import {TokenOverviewContent} from './TokenOverviewTab';

const now = 1_788_922_311_890;
const quality = {state: 1, freshness: 1, source: 'codex.filterTokens', definition_version: 'overview-v1', observed_at_ms: now};
const data = normalizeTokenOverview({
  chain: 'solana', address: 'TokenA',
  profile: {website: 'https://example.org', twitter: null, telegram: 'https://t.me/example', description: '<b>Plain text only</b>', quality},
  activity: {volume_5m_usd: 0, buyers_1h: 0, sellers_1h: null, quality},
  holder_summary: {top10_percent: 18.6, quality: {...quality, source: 'codex.holders'}},
  holder_intelligence: {
    dev_held_percent: 19.49481,
    sniper_count: 0,
    sniper_held_percent: 0,
    insider_count: 2,
    insider_held_percent: 3.2,
    bundler_count: 1,
    bundler_held_percent: 1.1,
    suspicious_count: 3,
    suspicious_held_percent: 4.3,
    top10_percent: 21.5,
    quality,
  },
  risk: {result_is_scam: false, token_is_scam: false, potential_scam_reasons: [], quality},
  contract_status: {
    mint_authority: 'MintAuthority',
    mintable_valid: true,
    freeze_authority: 'FreezeAuthority',
    freezable_valid: true,
    b20_transfer_paused: false,
    b20_mint_paused: null,
    b20_burn_paused: true,
    quality,
  },
  trading_route_display: {label: null, kind: 'display_only', status: 'unavailable'},
}, 'solana', 'TokenA');

describe('Overview presentation', () => {
  it('renders direct Codex holder fields, zero, Telegram and plain About text faithfully', () => {
    const html = renderToStaticMarkup(<TokenOverviewContent chain="solana" address="TokenA" data={data} now={now} />);
    expect(html).toContain('$0');
    expect(html).toContain('21.50%');
    expect(html).not.toContain('18.60%');
    expect(html).toContain('Developer holdings');
    expect(html).toContain('19.49%');
    expect(html).toContain('Sniper wallets');
    expect(html).toContain('0.00%');
    expect(html).toContain('>0<');
    expect(html).toContain('Suspicious wallets · deduplicated');
    expect(html).toContain('Direct value from the current Codex filterTokens snapshot.');
    expect(html).toContain('Sellers · 1h');
    expect(html).toContain('>—<');
    expect(html).toContain('Unique buying addresses');
    expect(html).toContain('href="https://t.me/example"');
    expect(html).toContain('Open token Telegram');
    expect(html).toContain('About');
    expect(html).toContain('&lt;b&gt;Plain text only&lt;/b&gt;');
    expect(html).not.toContain('<b>Plain text only</b>');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).not.toMatch(/\bATH\b|\bATL\b|Honeypot|Community verified|Best route|Jupiter|Pausable|safe token|safety certification/i);
  });

  it('prioritizes an explicit scam warning and translates known reasons', () => {
    const risky = {...data, risk: {...data.risk, resultIsScam: true, potentialScamReasons: ['MinimumLiquidity', 'SuspiciousWalletActivity'], level: 'SCAM' as const}};
    const html = renderToStaticMarkup(<TokenOverviewContent chain="solana" address="TokenA" data={risky} now={now} />);
    const container = document.createElement('div');
    container.innerHTML = html;
    const alert = within(container).getByRole('alert');
    expect(alert.className).toContain('border-red-500/40');
    expect(within(alert).getByRole('heading', {name: 'Scam warning'})).toBeTruthy();
    expect(alert.textContent).toContain('explicitly marked this token as a scam');
    expect(alert.textContent).toContain('Liquidity is below the minimum threshold used by Codex.');
    expect(alert.textContent).toContain('suspicious wallet activity');
    expect(html).not.toContain('Potential token risk</h2>');
  });

  it('renders potential-risk copy with a safe fallback for unknown reasons', () => {
    const risky = {...data, risk: {...data.risk, resultIsScam: null, tokenIsScam: false, potentialScamReasons: ['LiquidityUnknown', 'FutureUnknownReason'], level: 'POTENTIAL' as const}};
    const html = renderToStaticMarkup(<TokenOverviewContent chain="solana" address="TokenA" data={risky} now={now} />);
    const container = document.createElement('div');
    container.innerHTML = html;
    const alert = within(container).getByRole('alert');
    expect(alert.className).toContain('border-amber-500/40');
    expect(within(alert).getByRole('heading', {name: 'Potential token risk'})).toBeTruthy();
    expect(alert.textContent).toContain('could not determine the token’s liquidity');
    expect(alert.textContent).toContain('additional potential risk signal');
    expect(html).not.toContain('FutureUnknownReason');
    expect(html).not.toContain('Scam warning');
  });

  it('renders a fixed Potential warning when every supplier reason is rejected', () => {
    const risk = normalizeTokenRisk({
      resultIsScam: false,
      tokenIsScam: false,
      potentialScamReasons: [`bad\u202Ereason`, `bad\u0000reason`],
      level: 'POTENTIAL',
      quality: {
        state: 'AVAILABLE', freshness: 'FRESH', source: 'codex.filterTokens',
        definitionVersion: 'token-risk-v2', observedAtMs: String(now),
      },
    });
    expect(risk.potentialScamReasons).toEqual([]);
    const html = renderToStaticMarkup(<TokenOverviewContent chain="solana" address="TokenA" data={{...data, risk}} now={now} />);
    const container = document.createElement('div');
    container.innerHTML = html;
    const alert = within(container).getByRole('alert');
    expect(within(alert).getByRole('heading', {name: 'Potential token risk'})).toBeTruthy();
    expect(alert.textContent).toContain('Codex reported one or more potential risk signals.');
  });

  it('does not turn explicit false with no reasons into a safety certification', () => {
    const html = renderToStaticMarkup(<TokenOverviewContent chain="solana" address="TokenA" data={data} now={now} />);
    expect(html).not.toContain('Scam warning');
    expect(html).not.toContain('Potential token risk');
    expect(html).not.toMatch(/safe|verified|passed risk/i);
  });

  it('labels old snapshots and hides profile, risk, holder and contract values once expired', () => {
    const older = renderToStaticMarkup(<TokenOverviewContent chain="solana" address="TokenA" data={data} now={now + 60_001} />);
    expect(older).toContain('Older snapshot');
    const risky = {...data, risk: {...data.risk, tokenIsScam: true, level: 'SCAM' as const}};
    const expired = renderToStaticMarkup(<TokenOverviewContent chain="solana" address="TokenA" data={risky} now={now + 300_000} />);
    expect(expired).not.toContain('$0');
    expect(expired).not.toContain('21.50%');
    expect(expired).not.toContain('19.49%');
    expect(expired).not.toContain('MintAuthority');
    expect(expired).not.toContain('Plain text only');
    expect(expired).not.toContain('Scam warning');
    expect(expired).toContain('Risk status unavailable');
    expect(expired).toContain('No validated contract status is available');
    expect(expired).not.toContain('href=');
  });

  it('uses current-state B20 labels and does not claim absent authority when validation is false', () => {
    const unvalidated = {
      ...data,
      contract_status: {
        ...data.contract_status,
        mint_authority: null,
        mintable_valid: false,
        freeze_authority: null,
        freezable_valid: false,
      },
    };
    const html = renderToStaticMarkup(<TokenOverviewContent chain="solana" address="TokenA" data={unvalidated} now={now} />);
    const container = document.createElement('div');
    container.innerHTML = html;
    const contractSection = container.querySelector<HTMLElement>('#overview-contract-status')?.closest('section');
    expect(contractSection).toBeTruthy();
    const b20Heading = within(contractSection!).getByRole('heading', {name: 'B20 current state'});
    expect(b20Heading.closest('dl')).toBeNull();
    const b20List = b20Heading.nextElementSibling as HTMLElement | null;
    expect(b20List?.tagName).toBe('DL');
    const definitionValue = (label: string) => within(within(b20List!).getByText(label).parentElement!).getByRole('definition').textContent;
    expect(definitionValue('Transfer currently paused')).toBe('No');
    expect(definitionValue('Mint currently paused')).toBe('—');
    expect(definitionValue('Burn currently paused')).toBe('Yes');
    expect(html).not.toContain('Pausable');
    expect(html).not.toContain('None reported');
    expect(html.match(/did not validate this authority field/g)).toHaveLength(2);
  });

  it('keeps every definition-list group scoped to one direct term and definition', () => {
    const html = renderToStaticMarkup(<TokenOverviewContent chain="solana" address="TokenA" data={data} now={now} />);
    const container = document.createElement('div');
    container.innerHTML = html;
    const lists = [...container.querySelectorAll('dl')];
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) {
      for (const group of [...list.children]) {
        expect(group.querySelectorAll(':scope > dt')).toHaveLength(1);
        expect(group.querySelectorAll(':scope > dd')).toHaveLength(1);
        expect(group.querySelectorAll(':scope > p')).toHaveLength(0);
      }
    }
    const holderSection = container.querySelector<HTMLElement>('#overview-holders')?.closest('section');
    expect(holderSection).toBeTruthy();
    const sniperTerm = within(holderSection!).getByText('Sniper wallets');
    const sniperDefinition = sniperTerm.parentElement?.querySelector(':scope > dd');
    expect(sniperDefinition?.textContent).toContain('Wallets0');
    expect(sniperDefinition?.textContent).toContain('Held0.00%');
    expect(sniperDefinition?.textContent).toContain('Codex-tagged wallets');
  });

  it('renders neutral unavailable states for a legacy backend without the new groups', () => {
    const legacy = normalizeTokenOverview({
      chain: 'solana', address: 'TokenA',
      profile: {website: null, twitter: null, quality},
      activity: {volume_5m_usd: 0, buyers_1h: 0, sellers_1h: null, quality},
      holder_summary: {top10_percent: 18.6, quality: {...quality, source: 'codex.holders'}},
      trading_route_display: {label: null, kind: 'display_only', status: 'unavailable'},
    }, 'solana', 'TokenA');
    const html = renderToStaticMarkup(<TokenOverviewContent chain="solana" address="TokenA" data={legacy} now={now} />);
    expect(html).toContain('Risk status unavailable');
    expect(html).toContain('No validated contract status is available');
    expect(html).not.toContain('18.60%');
    expect(html).not.toContain('role="alert"');
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
