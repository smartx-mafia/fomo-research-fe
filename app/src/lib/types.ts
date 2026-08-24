/**
 * SmartX 行情 API 类型定义（smartx-backend docs/api/market.md）。
 *
 * 命名约定：HTTP 回包与 WS 帧的 data 字段名完全一致（snake_case），
 * 唯一差异是 WS 按 protobuf JSON 编码，int64 字段是字符串
 * （"updated_at":"1787…"、"trades_24h":"1234"）。所以所有数值字段
 * 进入渲染层前都过一遍 market.ts 的 normalize*()，统一成 number。
 *
 * 所有非主键字段一律 optional：缺字段不能让页面崩。
 */

/** 链标识（服务端词汇表，同时也是 /token/[chain]/[address] 的路径段） */
export const CHAINS = ["bsc", "solana", "base", "monad", "robinhood"] as const;
export type Chain = (typeof CHAINS)[number];

export const BOARDS = ["trending", "new", "bonding", "bonded"] as const;
export type BoardName = (typeof BOARDS)[number];

/**
 * TokenMarket：榜单条目 / 单币行情 / WS 推送共用同一形状（§2.2）。
 * 经 normalizeTokenMarket() 之后数值字段保证是 number。
 */
export interface TokenMarket {
  chain: string;
  address: string;
  symbol?: string;
  name?: string;
  logo?: string;
  price?: number;
  market_cap?: number;
  market_cap_diluted?: number;
  liquidity?: number;
  volume_1h?: number;
  volume_24h?: number;
  /** 百分比数值（已乘 100，直接 toFixed 展示） */
  price_change_5min?: number;
  price_change_1h?: number;
  price_change_24h?: number;
  trades_1h?: number;
  trades_24h?: number;
  buyers_24h?: number;
  holders_count?: number;
  bonded?: boolean;
  bonding_percentage?: number; // 0–100
  security_score?: number;
  /** 上游格式原样透传，仅展示用 */
  created_at?: string;
  /** unix 毫秒，服务端盖章——判断数据新鲜度用它 */
  updated_at?: number;
}

/** /v1/boards/{board} 回包 data（§2.1），WS snapshot 帧的 data 同形 */
export interface BoardData {
  /** 榜单版本号，单调递增，与 WS 帧的 seq 同一体系 */
  seq?: number;
  /** unix 毫秒 */
  updated_at?: number;
  items: TokenMarket[];
}

/** /v1/tokens/{chain}/{address}/ohlcv 的 data.bars[]，t 是 unix 毫秒 */
export interface OhlcvBar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number;
}

export type OhlcvPeriod = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/**
 * /v1/tokens/{chain}/{address}/trades 的 data.items[]（§2.3）。
 * base_token_amount / quote_token_amount 是链上最小单位的精确字符串，
 * 不要 parseFloat 后存储——展示转换可以，比较/累计用 BigInt。
 */
export interface TradeItem {
  type?: "buy" | "sell" | "deposit" | "withdrawal" | string;
  /** unix 毫秒 */
  date?: number;
  base_token_amount?: string;
  base_token_amount_usd?: number;
  quote_token_amount?: string;
  price_usd?: number;
  tx_hash?: string;
  sender?: string;
  labels?: string[];
  platform_name?: string;
}

/** /v1/tokens/{chain}/{address}/holders 的 data.items[]（§2.3）。token_amount 同上是精确字符串 */
export interface HolderItem {
  wallet_address?: string;
  token_amount?: string;
  token_amount_usd?: number;
  percentage_of_total_supply?: number;
  realized_pnl_usd?: number;
  unrealized_pnl_usd?: number;
  total_pnl_usd?: number;
  avg_buy_price_usd?: number;
  buys?: number;
  sells?: number;
  labels?: string[];
  platform_name?: string;
}

/** holders 接口的 label 过滤白名单 */
export const HOLDER_LABELS = [
  "sniper",
  "insider",
  "bundler",
  "proTrader",
  "smartTrader",
  "freshTrader",
  "dev",
  "liquidityPool",
  "locker",
] as const;

// ---- WebSocket 帧（§3.2） ----

/** 服务端 → 客户端。op 帧与 topic 帧共用一个宽松形状，收帧后按字段判别 */
export interface WsFrame {
  op?: "pong" | "error";
  topic?: string;
  kind?: "snapshot" | "update" | "remove" | "error";
  /** 帧外层 seq 恒为数字；token topic 恒 0 */
  seq?: number;
  reason?: string;
  data?: unknown;
}
