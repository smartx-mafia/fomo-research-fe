// @vitest-environment jsdom
import React, {StrictMode, act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {SWRConfig} from 'swr';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {MarketApiError} from '@/lib/market';
import {normalizeTokenOverview, type TokenOverview} from '@/lib/token-overview';
import {useTokenOverview} from './useTokenOverview';

const {fetchMock} = vi.hoisted(() => ({fetchMock: vi.fn()}));
vi.mock('@/lib/market', async (original) => ({...await original<typeof import('@/lib/market')>(), fetchTokenOverview: fetchMock}));

function snapshot(address: string, buyers = 7): TokenOverview {
  const q = {state: 1, freshness: 1, source: 'codex.filterTokens', definition_version: 'overview-v1', observed_at_ms: Date.now()};
  return normalizeTokenOverview({
    chain: 'solana', address,
    profile: {website: null, twitter: null, quality: q},
    activity: {volume_5m_usd: 0, buyers_1h: buyers, sellers_1h: 0, quality: q},
    holder_summary: {top10_percent: null, quality: {...q, source: 'codex.holders', state: 0}},
    trading_route_display: {label: null, kind: 'display_only', status: 'unavailable'},
  }, 'solana', address);
}

function Probe({address}: {address: string}) {
  const {data, error, now} = useTokenOverview('solana', address);
  return <output>{data ? `${data.address}:${data.activity.buyers_1h}` : error ? 'error' : 'loading'}<span>{now}</span></output>;
}

describe('mounted Overview hook + real SWR lifecycle', () => {
  let root: Root;
  let element: HTMLDivElement;
  let visibility: DocumentVisibilityState;
  let cache: Map<string, unknown>;
  let config: {provider: () => Map<string, never>};

  beforeEach(() => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
    vi.setSystemTime(1_788_922_311_890);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => visibility});
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => visibility !== 'visible'});
    fetchMock.mockReset();
    fetchMock.mockImplementation((_chain: string, address: string) => Promise.resolve(snapshot(address)));
    element = document.createElement('div');
    document.body.appendChild(element);
    root = createRoot(element);
    cache = new Map();
    config = {provider: () => cache as Map<string, never>};
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    await vi.advanceTimersByTimeAsync(1);
    element.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function render(addresses = ['A'], keyByToken = false) {
    await act(async () => root.render(<StrictMode><SWRConfig value={config}>{addresses.map((address, index) => <Probe key={keyByToken ? `${address}:${index}` : index} address={address} />)}</SWRConfig></StrictMode>));
  }

  async function elapse(ms: number) {
    // Flush each local clock render, otherwise React's test batching could hide
    // the bug where an unstable refreshInterval resets the 30s timer every second.
    for (let elapsed = 0; elapsed < ms; elapsed += 1_000) {
      await act(async () => {await vi.advanceTimersByTimeAsync(Math.min(1_000, ms - elapsed));});
    }
  }

  async function setVisible(next: DocumentVisibilityState) {
    await act(async () => {
      visibility = next;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await elapse(1);
  }

  it('polls again after 30s despite the local 1s clock and Strict Mode', async () => {
    await render();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(element.textContent).toContain('A:7');
    await elapse(31_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await elapse(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('cancels a hidden page request, ignores late data and resumes on return', async () => {
    let settle!: (data: TokenOverview) => void;
    fetchMock.mockImplementationOnce(() => new Promise<TokenOverview>((resolve) => {settle = resolve;}));
    await render();
    const firstSignal = fetchMock.mock.calls[0][2] as AbortSignal;
    await setVisible('hidden');
    expect(firstSignal.aborted).toBe(true);
    await act(async () => settle(snapshot('A', 111)));
    await elapse(90_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await setVisible('visible');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(element.textContent).toContain('A:7');
    expect(element.textContent).not.toContain('A:111');
  });

  it('does not abort a shared request when only one of two consumers leaves', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await render(['A', 'A']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = fetchMock.mock.calls[0][2] as AbortSignal;
    await render(['A']);
    await elapse(1);
    expect(signal.aborted).toBe(false);
    await render([]);
    await elapse(1);
    expect(signal.aborted).toBe(true);
    await elapse(90_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('keeps a late A response from replacing newer A data after A → B → A (token-keyed remount: %s)', async (keyByToken) => {
    let settle!: (data: TokenOverview) => void;
    fetchMock.mockImplementationOnce(() => new Promise<TokenOverview>((resolve) => {settle = resolve;}));
    await render(['A'], keyByToken);
    const firstSignal = fetchMock.mock.calls[0][2] as AbortSignal;
    await render(['B'], keyByToken);
    await elapse(1);
    expect(firstSignal.aborted).toBe(true);
    expect(element.textContent).toContain('B:7');
    await render(['A'], keyByToken);
    await elapse(20);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(element.textContent).toContain('A:7');
    await act(async () => settle(snapshot('A', 111)));
    expect(element.textContent).toContain('A:7');
    expect(element.textContent).not.toContain('A:111');
  });

  it('recovers after four transient failures while continuously visible, then returns to normal polling', async () => {
    for (let i = 0; i < 4; i++) fetchMock.mockRejectedValueOnce(new MarketApiError(500301, 'temporary storage outage'));
    await render();
    expect(element.textContent).toContain('error');
    for (let i = 0; i < 4; i++) await elapse(63_000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(element.textContent).toContain('A:7');
    await elapse(31_000);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it.each([400000, 500098, 100305, 100306])('does not retry permanent error %s while visible', async (code) => {
    fetchMock.mockRejectedValue(new MarketApiError(code, 'permanent'));
    await render();
    await elapse(130_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
