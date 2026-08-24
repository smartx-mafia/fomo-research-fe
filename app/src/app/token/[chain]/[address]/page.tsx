import { fetchTokenMarket, MarketApiError } from "@/lib/market";
import type { TokenMarket } from "@/lib/types";
import TokenLive from "@/components/TokenLive";
import DetailTabs from "@/components/DetailTabs";
import PriceChart from "@/components/PriceChart";

export default async function TokenDetailPage({
  params,
}: {
  params: Promise<{ chain: string; address: string }>;
}) {
  const { chain, address } = await params;

  let market: TokenMarket | undefined;
  let errorMessage: string | undefined;

  try {
    market = await fetchTokenMarket(chain, address);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Unknown error";
    // 500304 = 行情管线暂无数据（榜外冷币首查稍慢），提示稍后刷新而不是"不存在"
    if (err instanceof MarketApiError && err.code === 500304) {
      errorMessage = "Market data is warming up for this token — refresh in a few seconds.";
    }
  }

  if (!market || !market.address) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-lg font-semibold text-foreground">Token not found</h1>
        <p className="max-w-md text-sm text-muted">
          Could not load data for <span className="font-mono">{address}</span> on{" "}
          <span className="font-mono">{chain}</span>.
          {errorMessage && <span className="mt-1 block text-xs text-muted">{errorMessage}</span>}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* TokenLive 订阅 token:{chain}:{address}，头部与 Overview 实时刷新；chart 作为插槽夹在中间 */}
      <TokenLive initial={market} chain={chain} address={address}>
        <PriceChart chain={chain} address={address} createdAt={market.created_at} />
      </TokenLive>

      <DetailTabs chain={chain} address={address} />
    </div>
  );
}
