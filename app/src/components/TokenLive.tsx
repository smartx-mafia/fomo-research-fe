"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { TokenMarket } from "@/lib/types";
import { useTokenLive } from "@/lib/ws";
import TokenHeader from "@/components/TokenHeader";
import StatGrid from "@/components/StatGrid";

/**
 * WS 实时价广播：K 线图用它更新最后一根蜡烛的 c/h/l
 * （market-kline.md §5.2⑤：末根实时性交给 WS，不靠轮询 K 线）。
 */
const LivePriceContext = createContext<number | undefined>(undefined);

export function useLivePrice(): number | undefined {
  return useContext(LivePriceContext);
}

/**
 * 详情页实时区：订阅 token:{chain}:{address}，每帧是最新全量态，直接覆盖。
 * SSR 的 initial 数据在首帧到达前兜底。children 用作 chart 插槽，
 * 让 header 和 StatGrid 共享同一份实时数据而 chart 不必跟着重渲染——
 * chart 只通过 LivePriceContext 拿实时价。
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

  return (
    <LivePriceContext.Provider value={market.price}>
      <TokenHeader data={market} chain={chain} address={address} live={live} />
      {children}
      <StatGrid data={market} />
    </LivePriceContext.Provider>
  );
}
