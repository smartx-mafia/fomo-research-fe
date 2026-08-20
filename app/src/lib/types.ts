/**
 * Mobula API 类型定义。
 *
 * 重要：Mobula 三个端点用了三套命名约定，不要混用。
 *   - /api/2/pulse                  → snake_case  (price_change_24h, volume_24h, market_cap)
 *   - /api/2/token/details          → camelCase   (priceChange24hPercentage, volume24hUSD, marketCapUSD)
 *   - /api/2/token/holder-positions → camelCase，但数值全是 string
 *
 * 所有字段一律 optional：pulse 不在官方 OpenAPI 里，字段随时可能变，缺字段不能让页面崩。
 */

export type ChainId = string; // "solana:solana" | "evm:56" | "evm:8453" ...

export interface Exchange {
  name?: string;
  logo?: string;
}

export interface Socials {
  twitter?: string;
  telegram?: string;
  website?: string;
  uri?: string;
  [k: string]: string | undefined;
}

export interface Security {
  buyTax?: number;
  sellTax?: number;
  isHoneypot?: boolean;
  isMintable?: boolean;
  isBlacklisted?: boolean;
  isNotOpenSource?: boolean;
  renounced?: boolean;
  locked?: boolean;
  burnRate?: number;
  liquidityBurnPercentage?: number;
  noMintAuthority?: boolean;
  isProxy?: boolean;
  lowLiquidity?: boolean;
  [k: string]: unknown;
}

/** /api/2/pulse 列表项（snake_case 计量字段） */
export interface PulseToken {
  address?: string;
  chainId?: ChainId;
  symbol?: string;
  name?: string;
  decimals?: number;
  logo?: string;
  price?: number;
  marketCap?: number;
  marketCapDiluted?: number;
  liquidity?: number;
  totalSupply?: number;
  circulatingSupply?: number;
  holdersCount?: number;
  createdAt?: string;
  bonded?: boolean;
  bondingPercentage?: number;
  poolAddress?: string;
  deployer?: string;
  blockchain?: string;
  exchange?: Exchange;
  source?: string;
  socials?: Socials;
  security?: Security;
  securityScore?: number;
  is_spam?: boolean;
  description?: string;

  // snake_case 计量字段
  price_change_5min?: number;
  price_change_1h?: number;
  price_change_6h?: number;
  price_change_24h?: number;
  volume_5min?: number;
  volume_1h?: number;
  volume_6h?: number;
  volume_24h?: number;
  trades_1h?: number;
  trades_24h?: number;
  buys_24h?: number;
  sells_24h?: number;
  buyers_24h?: number;
  sellers_24h?: number;
  fees_paid_5min?: number;
  fees_paid_1h?: number;
  trendingScore1h?: number;
  trendingScore24h?: number;
  market_cap?: number;
  created_at?: string;

  // 风控
  top10Holdings?: number;
  devHoldings?: number;
  snipersHoldings?: number;
  insidersHoldings?: number;

  [k: string]: unknown;
}

/** POST /api/2/pulse 响应：按 view 名分组 */
export type PulseResponse = Record<string, { data?: PulseToken[] } | undefined>;

/** /api/2/token/details（camelCase） */
export interface TokenDetails {
  address?: string;
  chainId?: ChainId;
  symbol?: string;
  name?: string;
  decimals?: number;
  logo?: string;
  priceUSD?: number;
  marketCapUSD?: number;
  marketCapDilutedUSD?: number;
  liquidityUSD?: number;
  liquidityMaxUSD?: number;
  totalSupply?: number;
  circulatingSupply?: number;
  holdersCount?: number;
  createdAt?: string;
  bonded?: boolean;
  bondedAt?: string;
  bondingPercentage?: number;
  poolAddress?: string;
  deployer?: string;
  blockchain?: string;
  exchange?: Exchange;
  source?: string;
  socials?: Socials;
  security?: Security;
  securityScore?: number;
  description?: string;
  athUSD?: number;
  atlUSD?: number;
  athDate?: string;
  atlDate?: string;

  // 涨跌幅
  priceChange5minPercentage?: number;
  priceChange1hPercentage?: number;
  priceChange6hPercentage?: number;
  priceChange24hPercentage?: number;

  // 交易量
  volume5minUSD?: number;
  volume1hUSD?: number;
  volume6hUSD?: number;
  volume24hUSD?: number;
  volumeBuy24hUSD?: number;
  volumeSell24hUSD?: number;

  // 笔数 / 人数
  trades24h?: number;
  buys24h?: number;
  sells24h?: number;
  buyers24h?: number;
  sellers24h?: number;
  traders24h?: number;

  // 持仓分布
  top10HoldingsPercentage?: number;
  top50HoldingsPercentage?: number;
  top100HoldingsPercentage?: number;
  devHoldingsPercentage?: number;
  insidersHoldingsPercentage?: number;
  bundlersHoldingsPercentage?: number;
  snipersHoldingsPercentage?: number;
  proTradersHoldingsPercentage?: number;
  smartTradersHoldingsPercentage?: number;

  totalFeesPaidUSD?: number;
  [k: string]: unknown;
}

/** /api/2/token/trades */
export interface Trade {
  id?: string;
  type?: "buy" | "sell" | string;
  operation?: string;
  date?: number; // ms
  baseTokenAmount?: number;
  baseTokenAmountUSD?: number;
  quoteTokenAmount?: number;
  baseTokenPriceUSD?: number;
  transactionHash?: string;
  swapSenderAddress?: string;
  swapRecipient?: string;
  transactionSenderAddress?: string;
  marketAddress?: string;
  blockchain?: string;
  labels?: string[];
  platform?: { id?: string; name?: string; logo?: string };
  baseToken?: { name?: string; symbol?: string; logo?: string };
  quoteToken?: { name?: string; symbol?: string; logo?: string };
  totalFeesUSD?: number;
  [k: string]: unknown;
}

/**
 * /api/2/token/holder-positions
 * 注意：数值字段是 string，渲染前一律用 format.ts 的 num() 转换。
 */
export interface HolderPosition {
  chainId?: ChainId;
  walletAddress?: string;
  tokenAddress?: string;
  tokenAmount?: string | number;
  tokenAmountUSD?: string | number;
  percentageOfTotalSupply?: string | number;
  realizedPnlUSD?: string | number;
  unrealizedPnlUSD?: string | number;
  totalPnlUSD?: string | number;
  avgBuyPriceUSD?: string | number;
  avgSellPriceUSD?: string | number;
  volumeBuyUSD?: string | number;
  volumeSellUSD?: string | number;
  buys?: number;
  sells?: number;
  firstTradeAt?: string | number;
  lastTradeAt?: string | number;
  labels?: string[];
  platform?: string | { name?: string };
  walletMetadata?: { entityName?: string; [k: string]: unknown };
  [k: string]: unknown;
}

/** /api/2/token/ohlcv-history */
export interface OhlcvBar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number; // ms
}

export type OhlcvPeriod = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
