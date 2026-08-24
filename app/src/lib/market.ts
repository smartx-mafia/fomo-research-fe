/**
 * SmartX 行情 API 客户端（HTTP 面）。前端直连后端，无 BFF 中转。
 *
 * - 同构：Server Component（SSR 首屏兜底）和浏览器（SWR 轮询三 tab）共用。
 * - HTTP 状态码恒 200，成败看 body.code === 200（§1），失败抛 MarketApiError。
 * - WS 面见 ws.ts；两边共用这里的 normalize*() 做数值归一
 *   （WS 帧内 int64 是字符串，HTTP 是数字，统一 Number 一次，§3.5）。
 */

import { num } from "./format";
import type {
  BoardData,
  BoardName,
  HolderItem,
  OhlcvBar,
  OhlcvPeriod,
  TokenMarket,
  TradeItem,
} from "./types";

// 测试期地址会变，通过 env 覆盖，不要写死进业务代码
const API_BASE = process.env.NEXT_PUBLIC_MARKET_API_BASE || "http://13.52.177.63:8080";

/**
 * HTTP 面：SSR 直连后端；浏览器端走同源 /market-api（next.config.ts 的
 * rewrite 透明转发），因为后端 HTTP 面暂无 CORS 头。WS 不受 CORS 约束，
 * 浏览器直连 WS_URL。
 */
const HTTP_BASE = typeof window === "undefined" ? API_BASE : "/market-api";

export const WS_URL =
  process.env.NEXT_PUBLIC_MARKET_WS_URL || `${API_BASE.replace(/^http/, "ws")}/ws`;

export class MarketApiError extends Error {
  constructor(
    public code: number,
    msg: string,
    public errorTag?: string,
    public traceId?: string,
    public actionType?: string
  ) {
    // 报障要带 trace_id，后端靠它定位那次请求的完整链路
    super(traceId ? `${msg} (code=${code}, trace_id=${traceId})` : `${msg} (code=${code})`);
    this.name = "MarketApiError";
  }
  /** token 无效/过期，应引导重新登录而不是重试 */
  get needsSignIn(): boolean {
    return this.code === 400000 || this.actionType === "ACTION_TYPE_SIGN_IN";
  }
}

interface Envelope {
  code?: number;
  msg?: string;
  error?: string;
  trace_id?: string;
  action?: { type?: string };
  data?: unknown;
}

async function marketFetch<T>(
  path: string,
  query: Record<string, string | number | undefined> = {},
  opts: { revalidate?: number; timeoutMs?: number } = {}
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === "") continue;
    qs.set(k, String(v));
  }
  const url = `${HTTP_BASE}${path}${qs.toString() ? `?${qs}` : ""}`;

  // 服务端走 Next 请求级缓存；浏览器端 fetch 会忽略 next 字段。
  // 超时兜底：后端不可达时不能挂死 SSR（榜单页拿不到兜底数据就交给 WS）
  const res = await fetch(url, {
    next: { revalidate: opts.revalidate ?? 5 },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
  });
  if (!res.ok) {
    // 协议上恒 200，非 200 说明根本没到业务层（网关/网络）
    throw new Error(`market API ${path} → HTTP ${res.status}`);
  }
  const body = (await res.json()) as Envelope;
  if (body.code !== 200) {
    throw new MarketApiError(
      body.code ?? -1,
      body.msg || "market API request failed",
      body.error,
      body.trace_id,
      body.action?.type
    );
  }
  return body.data as T;
}

// ---- 数值归一（HTTP number / WS int64-string 统一成 number） ----

const TOKEN_NUM_FIELDS = [
  "price",
  "market_cap",
  "market_cap_diluted",
  "liquidity",
  "volume_1h",
  "volume_24h",
  "price_change_5min",
  "price_change_1h",
  "price_change_24h",
  "trades_1h",
  "trades_24h",
  "buyers_24h",
  "holders_count",
  "bonding_percentage",
  "security_score",
  "updated_at",
] as const;

const TOKEN_STR_FIELDS = ["symbol", "name", "logo", "created_at"] as const;

export function normalizeTokenMarket(raw: unknown): TokenMarket {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out: TokenMarket = {
    chain: typeof r.chain === "string" ? r.chain : "",
    address: typeof r.address === "string" ? r.address : "",
  };
  for (const f of TOKEN_STR_FIELDS) {
    if (typeof r[f] === "string" && r[f] !== "") out[f] = r[f] as string;
  }
  for (const f of TOKEN_NUM_FIELDS) {
    const n = num(r[f]);
    if (n !== undefined) out[f] = n;
  }
  if (typeof r.bonded === "boolean") out.bonded = r.bonded;
  return out;
}

export function normalizeBoard(raw: unknown): BoardData {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    seq: num(r.seq),
    updated_at: num(r.updated_at),
    items: Array.isArray(r.items) ? r.items.map(normalizeTokenMarket) : [],
  };
}

function normalizeTrade(raw: unknown): TradeItem {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    type: typeof r.type === "string" ? r.type : undefined,
    date: num(r.date),
    // 精确金额保持字符串，不转 number（uint256 量级会丢精度）
    base_token_amount: typeof r.base_token_amount === "string" ? r.base_token_amount : undefined,
    base_token_amount_usd: num(r.base_token_amount_usd),
    quote_token_amount: typeof r.quote_token_amount === "string" ? r.quote_token_amount : undefined,
    price_usd: num(r.price_usd),
    tx_hash: typeof r.tx_hash === "string" ? r.tx_hash : undefined,
    sender: typeof r.sender === "string" ? r.sender : undefined,
    labels: Array.isArray(r.labels) ? (r.labels as string[]) : undefined,
    platform_name: typeof r.platform_name === "string" ? r.platform_name : undefined,
  };
}

function normalizeHolder(raw: unknown): HolderItem {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    wallet_address: typeof r.wallet_address === "string" ? r.wallet_address : undefined,
    token_amount: typeof r.token_amount === "string" ? r.token_amount : undefined,
    token_amount_usd: num(r.token_amount_usd),
    percentage_of_total_supply: num(r.percentage_of_total_supply),
    realized_pnl_usd: num(r.realized_pnl_usd),
    unrealized_pnl_usd: num(r.unrealized_pnl_usd),
    total_pnl_usd: num(r.total_pnl_usd),
    avg_buy_price_usd: num(r.avg_buy_price_usd),
    buys: num(r.buys),
    sells: num(r.sells),
    labels: Array.isArray(r.labels) ? (r.labels as string[]) : undefined,
    platform_name: typeof r.platform_name === "string" ? r.platform_name : undefined,
  };
}

// ---- 端点封装 ----

/** 榜单快照（每榜 ≤60 条，按名次有序）。榜单页主数据走 WS，这里只做 SSR 首屏兜底，超时给短 */
export async function fetchBoard(board: BoardName, revalidate = 3): Promise<BoardData> {
  const data = await marketFetch<unknown>(`/v1/boards/${board}`, {}, { revalidate, timeoutMs: 3000 });
  return normalizeBoard(data);
}

/** 单币行情。榜外冷币也能查，首查稍慢（500304 = 管线暂无数据，稍后重试） */
export async function fetchTokenMarket(
  chain: string,
  address: string,
  revalidate = 5
): Promise<TokenMarket> {
  const data = await marketFetch<unknown>(`/v1/tokens/${chain}/${address}/market`, {}, { revalidate });
  return normalizeTokenMarket(data);
}

export async function fetchOhlcv(
  chain: string,
  address: string,
  opts: { period?: OhlcvPeriod; from?: number; to?: number } = {}
): Promise<OhlcvBar[]> {
  const { period = "5m", from, to } = opts;
  const data = await marketFetch<{ bars?: OhlcvBar[] }>(
    `/v1/tokens/${chain}/${address}/ohlcv`,
    { period, from, to },
    { revalidate: 10 }
  );
  return Array.isArray(data?.bars) ? data.bars : [];
}

export async function fetchTrades(
  chain: string,
  address: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<TradeItem[]> {
  const { limit = 20, offset = 0 } = opts;
  const data = await marketFetch<{ items?: unknown[] }>(
    `/v1/tokens/${chain}/${address}/trades`,
    { limit, offset },
    { revalidate: 4 }
  );
  return Array.isArray(data?.items) ? data.items.map(normalizeTrade) : [];
}

export async function fetchHolders(
  chain: string,
  address: string,
  opts: { limit?: number; offset?: number; label?: string } = {}
): Promise<HolderItem[]> {
  const { limit = 20, offset = 0, label } = opts;
  const data = await marketFetch<{ items?: unknown[] }>(
    `/v1/tokens/${chain}/${address}/holders`,
    { limit, offset, label },
    { revalidate: 8 }
  );
  return Array.isArray(data?.items) ? data.items.map(normalizeHolder) : [];
}
