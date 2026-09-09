"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type {TimedQuote} from '@/lib/chart-data';
import type { TokenMarket } from "@/lib/types";
import { useTokenLive } from "@/lib/ws";
import TokenHeader from "@/components/TokenHeader";
import StatGrid from "@/components/StatGrid";

/**
 * 带时间戳的报价广播：图表独立画实时报价线，不用跨池报价改写主池 OHLCV。
 */
const LivePriceContext = createContext<TimedQuote | undefined>(undefined);

export function useLiveQuote(): TimedQuote | undefined {
  return useContext(LivePriceContext);
}

/**
 * 详情页实时区：订阅 token:{chain}:{address}，每帧是最新全量态，直接覆盖。
 * SSR 的 initial 数据在首帧到达前兜底。children 用作 chart 插槽，
 * 让 header 和 StatGrid 共享同一份实时数据而 chart 不必跟着重渲染——
 * chart 只通过 LivePriceContext 拿带观测时间与连接状态的报价。
 */
export default function TokenLive({
  initial,
  chain,
  address,
  children,
}: {
  initial: TokenMarket;
  chain: string;
  address: string;
  children?: ReactNode;
}) {
  const { data, live } = useTokenLive(chain, address, initial);
  const market = data ?? initial;
  const quote = useMemo(() => market.price !== undefined && market.updated_at !== undefined ? {
    chain: market.chain, address: market.address, price: market.price, observedAt: market.updated_at, connected: live,
  } : undefined, [market.chain, market.address, market.price, market.updated_at, live]);

  return (
    <LivePriceContext.Provider value={quote}>
      <TokenHeader data={market} chain={chain} address={address} live={live} />
      {children}
      <StatGrid data={market} />
    </LivePriceContext.Provider>
  );
}
