"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export type DetailRouteState =
  // SSR / 预渲染或客户端首帧，还不能判定参数
  | { status: "pending" }
  | { status: "ready"; chain: string; address: string }
  // 客户端挂载后仍拿不到参数（路径与查询串都缺失）
  | { status: "invalid" };

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 详情页参数解析，兼容两种来源：
 * 1. 查询参数 /token?chain=..&address=..（软导航 / 直接访问）
 * 2. 路径式 /token/:chain/:address —— 静态托管下由 Cloudflare _redirects
 *    重写到壳页，浏览器地址仍保留原路径，故挂载后从 pathname 解析。
 */
export function useDetailRouteParams(basePath: string): DetailRouteState {
  const searchParams = useSearchParams();
  const [pathParams, setPathParams] = useState<{ chain: string; address: string } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const baseLength = basePath.split("/").filter(Boolean).length;
    const rest = segments.slice(baseLength);
    setPathParams(
      rest.length >= 2
        ? { chain: safeDecode(rest[0]), address: safeDecode(rest[1]) }
        : null,
    );
    setMounted(true);
  }, [basePath]);

  const chain = searchParams.get("chain");
  const address = searchParams.get("address");
  if (chain && address) return { status: "ready", chain, address };
  if (pathParams) return { status: "ready", chain: pathParams.chain, address: pathParams.address };
  return { status: mounted ? "invalid" : "pending" };
}
