'use client';

import useSWR from 'swr';

import DetailTabs from '@/components/DetailTabs';
import PriceChart from '@/components/PriceChart';
import {TradePanel} from '@/components/TradePanel';
import TokenLive from '@/components/TokenLive';
import {PRIVY_APP_ID} from '@/config';
import {fetchTokenMarket, MarketApiError} from '@/lib/market';

export default function TokenDetailClient({chain, address}: {chain: string; address: string}) {
  const {data: market, error, isLoading} = useSWR(
    ['token-market', chain, address],
    () => fetchTokenMarket(chain, address, 0),
    {revalidateOnFocus: false, shouldRetryOnError: false},
  );

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted">
        Loading token directly from the market API…
      </div>
    );
  }

  if (!market?.address) {
    const message = error instanceof MarketApiError && error.code === 500304
      ? 'Market data is warming up for this token — refresh in a few seconds.'
      : error instanceof Error ? error.message : 'Unknown error';
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-lg font-semibold text-foreground">Token not found</h1>
        <p className="max-w-md text-sm text-muted">
          Could not load data for <span className="font-mono">{address}</span> on{' '}
          <span className="font-mono">{chain}</span>.
          <span className="mt-1 block text-xs text-muted">{message}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <TokenLive key={`${chain}:${address}`} initial={market} chain={chain} address={address}>
        <PriceChart chain={chain} address={address} createdAt={market.created_at} />
      </TokenLive>

      {PRIVY_APP_ID ? (
        <TradePanel chain={chain} address={address} symbol={market.symbol} />
      ) : (
        <section className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
          Trading requires NEXT_PUBLIC_PRIVY_APP_ID.
        </section>
      )}

      <DetailTabs chain={chain} address={address} />
    </div>
  );
}
