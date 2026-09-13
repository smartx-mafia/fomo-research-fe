'use client';

import {useMemo, useRef} from 'react';
import useSWR from 'swr';
import type {PortfolioReply} from '@/api/portfolio';
import {fetchTokenMarket} from '@/lib/market';
import {portfolioAssetKey, revaluePortfolio, type PortfolioQuote} from '@/lib/portfolio-live';

export function useLivePortfolio(snapshot: PortfolioReply | undefined, identifier?: string) {
  const assets = useMemo(() => snapshot?.positions.map((p) => [p.asset.chain, p.asset.token_address] as const) ?? [], [snapshot]);
  const retained = useRef(new Map<string, Record<string, PortfolioQuote>>());
  const cacheKey = `${identifier}:${JSON.stringify(assets)}`;
  const quotes = useSWR(identifier && assets.length ? ['portfolio-live-prices', identifier, JSON.stringify(assets)] : null, async () => {
    const result: Record<string, PortfolioQuote> = {...retained.current.get(cacheKey)};
    // Bounded concurrency; refresh only market data, never holdings or cash.
    for (let start = 0; start < assets.length; start += 4) {
      await Promise.all(assets.slice(start, start + 4).map(async ([chain, address]) => {
        try {
          const market = await fetchTokenMarket(chain, address);
          if (portfolioAssetKey(market.chain, market.address) !== portfolioAssetKey(chain, address) || market.price === undefined || market.price <= 0 || !market.updated_at) return;
          const price = market.price.toLocaleString('en-US', {useGrouping: false, maximumFractionDigits: 20});
          if (Number(price) > 0) result[portfolioAssetKey(chain, address)] = {price, at: market.updated_at};
        } catch { /* Keep the server's last valid valuation for this token. */ }
      }));
    }
    retained.current.set(cacheKey, result);
    return result;
  }, {refreshInterval: 30_000, dedupingInterval: 15_000, keepPreviousData: false, shouldRetryOnError: false});
  return useMemo(() => snapshot ? revaluePortfolio(snapshot, quotes.data ?? {}) : undefined, [snapshot, quotes.data]);
}
