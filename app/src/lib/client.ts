"use client";

import useSWR, { SWRConfiguration } from "swr";

/** 拼 /api/mobula/<path>?<query> 供客户端 SWR 使用 */
export function mobulaUrl(path: string, query: Record<string, string | number | undefined> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === "") continue;
    qs.set(k, String(v));
  }
  const q = qs.toString();
  return `/api/mobula/${path}${q ? `?${q}` : ""}`;
}

export const swrFetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
};

/**
 * 统一的"实时数据"取数 hook。PoC 阶段用 SWR 轮询实现；
 * 后续接 WS/SSE 时只需替换本函数内部实现，调用方（页面组件）代码不变。
 */
export function useTokenStream<T>(url: string | null, opts: { intervalMs?: number; fallbackData?: T } & SWRConfiguration = {}) {
  const { intervalMs = 5000, fallbackData, ...swrOpts } = opts;
  return useSWR<T>(url, swrFetcher, {
    refreshInterval: intervalMs,
    revalidateOnFocus: true,
    dedupingInterval: Math.min(2000, intervalMs / 2),
    fallbackData,
    ...swrOpts,
  });
}
