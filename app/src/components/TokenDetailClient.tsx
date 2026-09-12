'use client';

import useSWR from 'swr';

import DetailTabs from '@/components/DetailTabs';
import PriceChart from '@/components/PriceChart';
import {TradePanel} from '@/components/TradePanel';
import {TokenFollowHoldersCard} from '@/components/TokenFollowHoldersCard';
import TokenLive from '@/components/TokenLive';
import {PRIVY_APP_ID} from '@/config';
import {fetchTokenMarket, MarketApiError} from '@/lib/market';
import {useSession} from '@/session/storage';

export default function TokenDetailClient({chain, address}: {chain: string; address: string}) {
  const {data: market, error, isLoading} = useSWR(
    ['token-market', chain, address],
    () => fetchTokenMarket(chain, address, 0),
    {revalidateOnFocus: false, shouldRetryOnError: false},
  );
  // 「关注的人持有」是登录态社交数据：未登录时卡片自己渲染 null（不发请求）。
  const session = useSession();

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

      <DetailTabs key={`details:${chain}:${address}`} chain={chain} address={address} />

      {/* 登录用户的社交叠加块：空/静默失败时整块消失，不影响上面的 tab 布局。 */}
      <TokenFollowHoldersCard bearer={session?.jwt ?? null} chain={chain} address={address} />

      {PRIVY_APP_ID ? (
        <TradePanel chain={chain} address={address} symbol={market.symbol} />
      ) : (
        <section className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
          Trading requires NEXT_PUBLIC_PRIVY_APP_ID.
        </section>
      )}

    </div>
  );
}
