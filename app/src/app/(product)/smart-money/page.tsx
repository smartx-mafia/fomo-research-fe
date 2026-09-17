"use client";

import { Suspense } from "react";
import { SmartMoneyProfile } from "@/components/SmartMoneyProfile";
import { useDetailRouteParams } from "@/hooks/useDetailRouteParams";

/**
 * /smart-money 壳页：静态导出下 /smart-money/:chain/:address 没有构建产物，
 * 由 public/_redirects 重写到这里（开发环境由 next.config rewrites 对齐），
 * 浏览器地址保留原路径，参数由客户端解析（见 useDetailRouteParams）。
 */
function SmartMoneyGate() {
  const params = useDetailRouteParams("/smart-money");
  if (params.status === "ready") {
    return <SmartMoneyProfile chain={params.chain} address={params.address} />;
  }
  if (params.status === "invalid") {
    return <p className="p-6 text-sm text-muted-foreground">缺少 chain / address 参数</p>;
  }
  return null;
}

export default function SmartMoneyPage() {
  return (
    <Suspense fallback={null}>
      <SmartMoneyGate />
    </Suspense>
  );
}
