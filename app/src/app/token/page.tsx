"use client";

import { Suspense } from "react";
import TokenDetailClient from "@/components/TokenDetailClient";
import { useDetailRouteParams } from "@/hooks/useDetailRouteParams";

/**
 * /token 壳页：静态导出下 /token/:chain/:address 没有构建产物，由
 * public/_redirects 重写到到这里（开发环境由 next.config rewrites 对齐），
 * 浏览器地址保留原路径，参数由客户端解析（见 useDetailRouteParams）。
 */
function TokenDetailGate() {
  const params = useDetailRouteParams("/token");
  if (params.status === "ready") {
    return <TokenDetailClient chain={params.chain} address={params.address} />;
  }
  if (params.status === "invalid") {
    return <p className="p-6 text-sm text-muted-foreground">缺少 chain / address 参数</p>;
  }
  return null;
}

export default function TokenPage() {
  return (
    <Suspense fallback={null}>
      <TokenDetailGate />
    </Suspense>
  );
}
