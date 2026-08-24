"use client";

import type { ReactNode } from "react";
import type { TokenMarket } from "@/lib/types";
import { useTokenLive } from "@/lib/ws";
import TokenHeader from "@/components/TokenHeader";
import StatGrid from "@/components/StatGrid";

/**
 * 详情页实时区：订阅 token:{chain}:{address}，每帧是最新全量态，直接覆盖。
 * SSR 的 initial 数据在首帧到达前兜底。children 用作 chart 插槽，
 * 让 header 和 StatGrid 共享同一份实时数据而 chart 不必跟着重渲染。
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
    <>
      <TokenHeader data={market} chain={chain} address={address} live={live} />
      {children}
      <StatGrid data={market} />
    </>
  );
}
