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

/**
 * 链标识（服务端词汇表，同时也是 /token/[chain]/[address] 的路径段）。
 * 2026-09 换源后 monad 已从合法链集合移除（错误码 100305）。
 */
export const CHAINS = ["bsc", "solana", "base", "robinhood", "ethereum"] as const;
export type Chain = (typeof CHAINS)[number];

/**
 * 榜单集合（2026-09 起）：五榜，全部是跨链聚合榜，没有链变体。
 * new / bonded 已退役；most_held 是候选池最多主体持有榜。
 */
export const BOARDS = ["trending", "bonding", "graduated", "crypto", "most_held"] as const;
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
  /** 新上游无此数据源，恒为 0——是"没有数据"，不是"安全分为 0"，UI 不要展示 */
  security_score?: number;
  /** 上游格式原样透传（秒/毫秒/ISO 均有可能），仅展示用，必须有解析兜底 */
  created_at?: string;
  /** unix 毫秒，服务端盖章——判断数据新鲜度用它 */
  updated_at?: number;
  /** 仅 most_held 榜及其 WS update 有值；达标 Account 主体数，不是全网 holders_count。 */
  held_by_accounts?: number;
  /** 仅 most_held 榜及其 WS update 有值；达标主体持仓价值之和（USD）。 */
  held_value_usd?: number;
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
  v: number | null;
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
  /** 2026-09 起恒为空串（无数据源），展示层显示 "—" */
  quote_token_amount?: string;
  price_usd?: number;
  tx_hash?: string;
  sender?: string;
  labels?: string[];
  /** 2026-09 起恒为空串（无数据源），展示层显示 "—"，不要渲染成 0 或空白 */
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
  /** 2026-09 起恒为空串（无数据源），展示层显示 "—" */
  platform_name?: string;
}

/**
 * 全站搜索（GET /v1/search）的结果条目：身份 + 可选行情。
 * market 缺席是诚实的答案（暂无该币行情/穿透配额打满），不要渲染成价格 0。
 * 注意：搜索路径的 market 只给 7 字段子集（logo/price/market_cap/liquidity/
 * volume_24h/price_change_24h/updated_at），别读其它行情字段。
 */
export interface SearchItem {
  chain: string;
  address: string;
  symbol?: string;
  name?: string;
  market?: TokenMarket;
}

/** 搜索范围（scope 参数）：Token 与 Account 两态，前端统一用字面名。 */
export type SearchScope = "SEARCH_SCOPE_TOKEN" | "SEARCH_SCOPE_ACCOUNT";

/** /v1/search scope=ACCOUNT 的用户条目。关注态不在搜索回包里。 */
export interface SearchPerson {
  identifier: string;
  /** handle，未设置缺席 */
  username?: string;
  /** 昵称原值，未设置缺席——不得用 identifier 伪造，空则回退 username/identifier 缩写 */
  nickname?: string;
  avatar_url?: string;
}

/** 聪明钱逐链快照；金额保持后端十进制字符串，缺席不等于 0。 */
export interface SearchSmartMoneyChain {
  chain: string;
  total_profit?: string;
  realized_profit?: string;
  buy?: number;
  sell?: number;
  /** unix 秒；缺席/0 表示没有快照。 */
  snapshot_at?: number;
}

/** ACCOUNT 搜索中的聪明钱结果：一个原始地址聚合多条链。 */
export interface SearchSmartMoney {
  address: string;
  chains: SearchSmartMoneyChain[];
}

/** ACCOUNT 搜索结果。两个子结构按 target_type 二选一。 */
export type SearchAccountEntry =
  | { target_type: "user"; user: SearchPerson; smart_money?: never }
  | { target_type: "smart_money"; smart_money: SearchSmartMoney; user?: never };

/** /v1/search 回包 data：tokens/accounts 按 scope 二选一出现，零值键整个缺席。 */
export interface SearchData {
  scope?: 1 | 4;
  tokens?: SearchItem[];
  accounts?: SearchAccountEntry[];
  /** 只有 ACCOUNT 给；只翻用户侧。缺席 = 到底了，与 phrase 绑定。 */
  next_cursor?: string;
}

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
