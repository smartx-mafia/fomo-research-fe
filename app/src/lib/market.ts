/**
 * SmartX 行情 API 客户端（HTTP 面）。前端直连后端，无 BFF 中转。
 *
 * - 浏览器侧统一使用绝对 URL，便于在 DevTools 直接查看真实后端请求。
 * - HTTP 状态码恒 200，成败看 body.code === 200（§1），失败抛 MarketApiError。
 * - WS 面见 ws.ts；两边共用这里的 normalize*() 做数值归一
 *   （WS 帧内 int64 是字符串，HTTP 是数字，统一 Number 一次，§3.5）。
 */

import { num } from "./format";
import {normalizeTokenOverview, type TokenOverview} from './token-overview';
import {normalizeChartBars} from './chart-data';
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
// 临时联调：sm-test 环境域名（HTTPS + 域名路由）
export const MARKET_API_BASE = (
  process.env.NEXT_PUBLIC_MARKET_API_BASE || "https://sm-test-api.smartx.io"
).replace(/\/+$/, "");

/**
 * HTTP 面始终使用真实后端绝对地址。当前页面数据均由 Client Component 发起，
 * 因而这些请求会直接出现在浏览器 DevTools Network 中。
 */
const HTTP_BASE = MARKET_API_BASE;

/**
 * WS 连接地址。优先 env 覆盖。
 * 浏览器直接连接行情 WS。测试环境已允许浏览器 Origin；如环境地址不同，
 * 用 NEXT_PUBLIC_MARKET_WS_URL 显式覆盖。
 */
export function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_MARKET_WS_URL) return process.env.NEXT_PUBLIC_MARKET_WS_URL;
  return `${MARKET_API_BASE.replace(/^http/, "ws")}/ws`;
}

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
  opts: { revalidate?: number; timeoutMs?: number; signal?: AbortSignal; cache?: RequestCache } = {}
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === "") continue;
    qs.set(k, String(v));
  }
  const url = `${HTTP_BASE}${path}${qs.toString() ? `?${qs}` : ""}`;

  // 超时避免浏览器请求长期挂起；失败由页面或 WS 数据源接管展示。
  const res = await fetch(url, {
    cache: opts.cache,
    next: { revalidate: opts.revalidate ?? 5 },
    signal: opts.signal
      ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs ?? 10_000)])
      : AbortSignal.timeout(opts.timeoutMs ?? 10_000),
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
  "held_by_accounts",
  "held_value_usd",
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

/**
 * 榜单快照。五榜均为跨链聚合榜（2026-09 起），?chain= 参数已废弃，传了回 100303。
 * 五榜均为跨链聚合榜，每榜至多 100 条；most_held 的条目额外带两个持有指标。
 * 榜单页主数据走 WS；这个 HTTP helper 供直连诊断和显式快照请求使用。
 */
export async function fetchBoard(
  board: BoardName,
  opts: { revalidate?: number } = {}
): Promise<BoardData> {
  const data = await marketFetch<unknown>(`/v1/boards/${board}`, {}, {
    revalidate: opts.revalidate ?? 3,
    timeoutMs: 3000,
  });
  return normalizeBoard(data);
}

/** 单币行情。榜外冷币也能查，首查稍慢（500304 = 管线暂无数据，稍后重试） */
export async function fetchTokenMarket(
  chain: string,
  address: string,
  revalidate = 5,
  signal?: AbortSignal,
): Promise<TokenMarket> {
  const data = await marketFetch<unknown>(`/v1/tokens/${encodeURIComponent(chain)}/${encodeURIComponent(address)}/market`, {}, { revalidate, signal });
  return normalizeTokenMarket(data);
}

/** Optional public snapshot: no fallback to /market, /holders, bars or trading endpoints. */
export async function fetchTokenOverview(chain: string, address: string, signal?: AbortSignal): Promise<TokenOverview> {
  const data = await marketFetch<unknown>(
    `/v1/tokens/${encodeURIComponent(chain)}/${encodeURIComponent(address)}/overview`,
    {}, {revalidate: 0, timeoutMs: 8_000, signal, cache: 'no-store'},
  );
  return normalizeTokenOverview(data, chain, address);
}

export async function fetchOhlcv(
  chain: string,
  address: string,
  opts: { period?: OhlcvPeriod; from?: number; to?: number; signal?: AbortSignal } = {}
): Promise<OhlcvBar[]> {
  const { period = "5m", from, to } = opts;
  const data = await marketFetch<{ bars?: unknown }>(
    `/v1/tokens/${encodeURIComponent(chain)}/${encodeURIComponent(address)}/ohlcv`,
    { period, from, to },
    { revalidate: 0, signal: opts.signal, cache: 'no-store' }
  );
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Missing chart response.');
  return normalizeChartBars(data.bars, period);
}

export async function fetchTrades(
  chain: string,
  address: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<TradeItem[]> {
  // 2026-09 起 limit 上限 200（超出服务端静默截断）；服务端缓存 30s，轮询间隔应 ≥ 30s
  const { limit: rawLimit = 20, offset = 0 } = opts;
  const limit = Math.min(200, Math.max(1, rawLimit));
  const data = await marketFetch<{ items?: unknown[] }>(
    `/v1/tokens/${chain}/${address}/trades`,
    { limit, offset },
    { revalidate: 30 }
  );
  return Array.isArray(data?.items) ? data.items.map(normalizeTrade) : [];
}

/**
 * 持仓者列表（2026-09 口径）：
 * - label 过滤已暂停（只接受空串，非空值回 100307）——调用方不要再传 label；
 * - 500097 = 上游档位未开通，调用方必须走"功能暂不可用"分支，不要重试、不要渲染成空列表；
 * - 服务端缓存 300s、上游 6 小时刷新一次——不要轮询；
 * - 只含经 DEX 建仓的钱包，与 holders_count 本来就对不上，不要做一致性校验；
 * - PnL / buys / sells 均为近 1 年窗口，不是全期。
 */
export async function fetchHolders(
  chain: string,
  address: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<HolderItem[]> {
  const { limit = 20, offset = 0 } = opts;
  const data = await marketFetch<{ items?: unknown[] }>(
    `/v1/tokens/${chain}/${address}/holders`,
    { limit, offset },
    { revalidate: 300 }
  );
  return Array.isArray(data?.items) ? data.items.map(normalizeHolder) : [];
}
