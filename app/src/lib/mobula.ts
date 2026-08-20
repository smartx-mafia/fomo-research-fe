import "server-only";
import type { PulseResponse, TokenDetails, Trade, HolderPosition, OhlcvBar } from "./types";

const HOST = process.env.MOBULA_API_HOST || "demo-api.mobula.io";
const KEY = process.env.MOBULA_API_KEY || "";

/** 上游路径白名单：BFF 只转发这些前缀，防止被当开放代理用 */
export const ALLOWED_PATH_PREFIXES = ["pulse", "token/", "market/", "system-metadata"];

export function isAllowedPath(path: string): boolean {
  return ALLOWED_PATH_PREFIXES.some((p) => path === p || path.startsWith(p));
}

interface FetchOpts {
  revalidate?: number; // 秒；Next.js 请求级缓存，多个请求共享同一份上游响应
  method?: "GET" | "POST";
  body?: unknown;
}

/**
 * 统一的 Mobula 请求函数。Server Component 和 BFF route 都走这里，
 * 保证服务端直连和浏览器轮询用同一套 base url / key / 缓存逻辑。
 */
export async function mobulaFetch<T>(path: string, query: Record<string, string | string[] | undefined> = {}, opts: FetchOpts = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((item) => qs.append(k, item));
    else qs.set(k, v);
  }
  const url = `https://${HOST}/api/2/${path}${qs.toString() ? `?${qs}` : ""}`;
  const { revalidate = 5, method = "GET", body } = opts;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(KEY ? { Authorization: KEY } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    next: { revalidate },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Mobula ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ---- 类型化便捷封装（Server Component 直调用这些） ----

export interface PulseView {
  name: string;
  model?: "new" | "bonding" | "bonded";
  chainId?: string[];
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  limit?: number;
  filters?: Record<string, { gte?: number; lte?: number; gt?: number; lt?: number; equals?: unknown; in?: unknown[] }>;
}

export function fetchPulse(views: PulseView[], opts: { assetMode?: boolean; filterQuotes?: boolean; revalidate?: number } = {}): Promise<PulseResponse> {
  const { assetMode = true, filterQuotes = true, revalidate = 4 } = opts;
  return mobulaFetch<PulseResponse>("pulse", {}, { method: "POST", revalidate, body: { assetMode, filterQuotes, views } });
}

export function fetchTokenDetails(blockchain: string, address: string, revalidate = 8): Promise<{ data: TokenDetails }> {
  return mobulaFetch<{ data: TokenDetails }>("token/details", { blockchain, address }, { revalidate });
}

export function fetchTokenTrades(
  blockchain: string,
  address: string,
  opts: { limit?: number; offset?: number; mode?: "asset" | "pair" } = {},
  revalidate = 4
): Promise<{ data: Trade[] }> {
  const { limit = 20, offset = 0, mode = "asset" } = opts;
  return mobulaFetch<{ data: Trade[] }>(
    "token/trades",
    { blockchain, address, mode, limit: String(limit), offset: String(offset) },
    { revalidate }
  );
}

export function fetchHolderPositions(
  blockchain: string,
  address: string,
  opts: { limit?: number; offset?: number; label?: string } = {},
  revalidate = 10
): Promise<{ data: HolderPosition[] }> {
  const { limit = 20, offset = 0, label } = opts;
  return mobulaFetch<{ data: HolderPosition[] }>(
    "token/holder-positions",
    { blockchain, address, limit: String(limit), offset: String(offset), label },
    { revalidate }
  );
}

export function fetchOhlcv(
  chainId: string,
  address: string,
  opts: { period?: string; from?: number; to?: number } = {},
  revalidate = 15
): Promise<{ data: OhlcvBar[] }> {
  const { period = "5m", from, to } = opts;
  return mobulaFetch<{ data: OhlcvBar[] }>(
    "token/ohlcv-history",
    { chainId, address, period, usd: "true", from: from ? String(from) : undefined, to: to ? String(to) : undefined },
    { revalidate }
  );
}
