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
  SearchData,
  SearchItem,
  SearchPerson,
  SearchScope,
  TokenMarket,
  TradeItem,
} from "./types";

// 测试期地址会变，通过 env 覆盖，不要写死进业务代码
// 临时联调：直连 13.52.177.63:8080（HTTP，非 https）
const API_BASE = process.env.NEXT_PUBLIC_MARKET_API_BASE || "http://13.52.177.63:8080";

/**
 * HTTP 面：SSR 直连后端；浏览器端走同源 /market-api（next.config.ts 的
 * rewrite 透明转发），因为后端 HTTP 面暂无 CORS 头。WS 不受 CORS 约束，
 * 浏览器直连 WS_URL。
 */
const HTTP_BASE = typeof window === "undefined" ? API_BASE : "/market-api";

/**
 * WS 连接地址。优先 env 覆盖。
 * 浏览器默认走同源 /market-api/ws（与 HTTP 面同一转发层）：
 * 测试网关会拒绝所有带 Origin 头的直连 WS 握手（浏览器必带），403；
 * 经 Next 转发则不带 Origin，可以正常握手。SSR 侧不存在 WS 连接，
 * 这里只为类型完整给出直连地址。
 */
export function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_MARKET_WS_URL) return process.env.NEXT_PUBLIC_MARKET_WS_URL;
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/market-api/ws`;
  }
  return `${API_BASE.replace(/^http/, "ws")}/ws`;
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

function normalizeSearchItem(raw: unknown): SearchItem {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    chain: typeof r.chain === "string" ? r.chain : "",
    address: typeof r.address === "string" ? r.address : "",
    symbol: typeof r.symbol === "string" ? r.symbol : undefined,
    name: typeof r.name === "string" ? r.name : undefined,
    // market 缺席就保持 undefined——"暂无行情"是诚实答案，不要造一个价格 0
    market: r.market ? normalizeTokenMarket(r.market) : undefined,
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
 * 榜单快照。四榜均为跨链聚合榜（2026-09 起），?chain= 参数已废弃，传了回 100303。
 * 条数：trending/bonding/graduated ≤ 20，crypto ≤ 60。
 * 榜单页主数据走 WS，这里只做 SSR 首屏兜底，超时给短。
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

/**
 * 全站搜索（GET /v1/search，docs/contracts/search.md）。Token / People 两个范围
 * 独立请求、独立分页、独立失败：
 * - TOKEN：不翻页（带 cursor 回 100120）；market 是 7 字段子集，缺席 = "暂无行情"；
 * - PEOPLE：next_cursor 不透明回传翻页，与 phrase 绑定（换词丢弃）；
 * - 420000 = 限流/配额（退避、降频）；500097 = 上游不可用（按范围降级，另一边照常）；
 * - 100103 = cursor 失效，丢弃重拉首页；
 * - 空查询不要发请求（空态走本地 Recent/Viewed），发了会拿 100120。
 */
export async function fetchSearch(
  scope: SearchScope,
  phrase: string,
  opts: { limit?: number; cursor?: string } = {}
): Promise<SearchData> {
  const { limit = 20, cursor } = opts;
  let data: Record<string, unknown>;
  try {
    data = await marketFetch<Record<string, unknown>>(
      `/v1/search`,
      { scope, phrase, limit, cursor },
      { revalidate: 0 }
    );
  } catch (e) {
    // 过渡降级：测试服尚未部署 /v1/search（HTTP 404 = 路由不存在）。
    // Token 半边与旧 /v1/tokens/search 同源同配额，可安全回退；People 半边没有旧口，报不可用。
    if (e instanceof Error && e.message.includes("HTTP 404")) {
      if (scope !== "SEARCH_SCOPE_TOKEN") {
        throw new MarketApiError(500097, "search not deployed yet", "SYS_UPSTREAM_UNAVAILABLE");
      }
      const legacy = await marketFetch<{ results?: unknown[] }>(
        `/v1/tokens/search`,
        { phrase, limit },
        { revalidate: 0 }
      );
      return { tokens: Array.isArray(legacy?.results) ? legacy.results.map(normalizeSearchItem) : undefined };
    }
    throw e;
  }
  return {
    tokens: Array.isArray(data?.tokens) ? data.tokens.map(normalizeSearchItem) : undefined,
    people: Array.isArray(data?.people)
      ? (data.people as Record<string, unknown>[]).map((r) => ({
          identifier: typeof r.identifier === "string" ? r.identifier : "",
          username: typeof r.username === "string" && r.username ? r.username : undefined,
          nickname: typeof r.nickname === "string" && r.nickname ? r.nickname : undefined,
          avatar_url: typeof r.avatar_url === "string" && r.avatar_url ? r.avatar_url : undefined,
          follow_state: (r.follow_state === 1 || r.follow_state === 2 || r.follow_state === 3 || r.follow_state === 4
            ? r.follow_state
            : undefined) as SearchPerson["follow_state"],
        }))
      : undefined,
    next_cursor: typeof data?.next_cursor === "string" && data.next_cursor ? data.next_cursor : undefined,
  };
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
