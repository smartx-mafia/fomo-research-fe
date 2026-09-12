import {call} from './envelope';

export type ProtoTimestamp = {seconds: number | string; nanos?: number};

export type PortfolioAsset = {
  chain: string;
  chain_id: number | string;
  kind: string;
  token_address: string;
};

/** Current positions are Trade ledger shares, never on-chain spendable balances. */
export type PortfolioPosition = {
  asset: PortfolioAsset;
  symbol?: string;
  logo?: string;
  decimals?: number;
  shares_raw: string;
  price_usd?: string;
  price_as_of?: ProtoTimestamp;
  opened_entry_id: string;
  opened_at?: ProtoTimestamp;
  cycle_status: 'ready' | 'pending' | 'unavailable';
  cost_basis_usd?: string;
  buy_amount_raw?: string;
  sell_amount_raw?: string;
  buy_value_usd?: string;
  sell_value_usd?: string;
  realized_pnl_usd?: string;
  market_value_usd?: string;
  unrealized_pnl_usd?: string;
  total_pnl_usd?: string;
  pnl_ratio?: string;
  avg_buy_price_usd?: string;
  avg_sell_price_usd?: string;
};

export class PortfolioDataError extends Error {
  constructor(message: string, readonly traceID?: string) {
    super(message);
    this.name = 'PortfolioDataError';
  }
}

export type PnlPoint = {at: string; pnl_usd: string};
export type WindowPnl = {
  amount_usd?: string;
  baseline_as_of?: string;
  curve?: PnlPoint[];
  simulated?: boolean;
};
export type PortfolioPnl = {
  d1?: WindowPnl;
  d7?: WindowPnl;
  d30?: WindowPnl;
  all_usd?: string;
  all?: WindowPnl;
};

export type PortfolioPartialError = {
  chain?: string;
  token_address?: string;
  reason: string;
  retryable?: boolean;
};

export type PortfolioCashBalance = {
  chain: string; chain_id: string; wallet_address: string; address_format: 'evm' | 'base58';
  token: {symbol: string; address: string; decimals: number};
  amount_raw?: string; deposit_mode: 'direct' | 'sweep'; deposit_enabled: boolean;
  min_sweep_amount?: string; balance_meets_minimum: boolean;
};

export type PortfolioReply = {
  total_value_usd?: string;
  cash_balance_usd?: string;
  total_assets_usd?: string;
  cash_observed_at?: ProtoTimestamp;
  cash_balances?: PortfolioCashBalance[];
  pnl?: PortfolioPnl;
  positions: PortfolioPosition[];
  partial_errors: PortfolioPartialError[];
  observed_at?: ProtoTimestamp;
};

export type PortfolioTrade = {
  trade_id: string;
  side: 'buy' | 'sell';
  chain: string;
  token: string;
  quote_token: string;
  amount_in_actual?: string;
  amount_out?: string;
  status: string;
  lifecycle: string;
  tx_hash?: string;
  created_at: string;
  confirmed_at?: string;
  fee_app?: string;
  fee_currency?: string;
  tx_chain?: string;
  cycle_opened_entry_id: string;
  cycle_key?: string;
  logo?: string;
  symbol?: string;
  name?: string;
  token_amount?: string;
  trade_value_usd?: string;
  execution_price_usd?: string;
  asset_decimals?: number;
};

export type PortfolioTradePage = {trades: PortfolioTrade[]; next_cursor?: string};

export type PortfolioBalanceCurve = {points: {at: string; balance_usd: string}[]; now_usd?: string; as_of?: string; simulated: boolean};
export async function getPortfolioBalanceCurve(bearer: string, window: '1d' | '7d' | '30d' | 'all', signal?: AbortSignal): Promise<PortfolioBalanceCurve> {
  const response = await call<unknown>(`/v1/portfolio/balance/curve?window=${window}`, {
    bearer, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  try {
    const row = object(response.data);
    if (!row || !Array.isArray(row.points)) throw new Error('Invalid total-assets curve.');
    const points = row.points.map((value) => {
      const point = object(value);
      if (!point) throw new Error('Invalid total-assets sample.');
      const balance = optionalDecimal(point.balance_usd, 'balance_usd');
      if (balance === undefined) throw new Error('Missing total-assets sample value.');
      return {at: rfc3339(point.at, 'balance.at', true)!, balance_usd: balance};
    });
    return {points, now_usd: optionalDecimal(row.now_usd, 'now_usd'), as_of: rfc3339(row.as_of, 'balance.as_of'), simulated: row.simulated === true};
  } catch (error) {
    throw new PortfolioDataError(error instanceof Error ? error.message : 'Invalid total-assets curve.', response.traceID);
  }
}

export type PortfolioCycleScope = {chain: string; asset: string; opened_entry_id: string};
export type PortfolioClosedPosition = {
  asset: PortfolioAsset;
  opened_entry_id: string;
  closed_entry_id: string;
  opened_at?: ProtoTimestamp;
  closed_at?: ProtoTimestamp;
  status: 'closed';
  symbol?: string;
  logo?: string;
  decimals?: number;
  buy_amount_raw?: string;
  sell_amount_raw?: string;
  buy_value_usd?: string;
  sell_value_usd?: string;
  realized_pnl_usd?: string;
  pnl_ratio?: string;
  avg_buy_price_usd?: string;
  avg_sell_price_usd?: string;
};
export type PortfolioClosedPage = {items: PortfolioClosedPosition[]; next_cursor?: string};

export function normalizePortfolioClosedPage(value: unknown): PortfolioClosedPage {
  const row = object(value);
  if (!row || (row.items !== undefined && !Array.isArray(row.items))) throw new Error('Portfolio closed positions must be an array.');
  const items = (row.items as unknown[] | undefined ?? []).map((value): PortfolioClosedPosition => {
    const item = object(value), asset = object(item?.asset);
    if (!item || !asset || item.status !== 'closed') throw new Error('Portfolio returned an invalid closed position.');
    const opened = nonnegativeIntegerString(item.opened_entry_id, 'opened_entry_id');
    const closed = nonnegativeIntegerString(item.closed_entry_id, 'closed_entry_id');
    const chainID = nonnegativeIntegerString(asset.chain_id, 'asset.chain_id');
    if (opened === '0' || closed === '0' || chainID === '0') throw new Error('Portfolio returned an invalid closed cycle identity.');
    return {
      asset: {chain: requiredString(asset.chain, 'asset.chain'), chain_id: chainID, kind: requiredString(asset.kind, 'asset.kind'), token_address: requiredString(asset.token_address, 'asset.token_address')},
      opened_entry_id: opened, closed_entry_id: closed, opened_at: timestamp(item.opened_at), closed_at: timestamp(item.closed_at), status: 'closed',
      symbol: optionalString(item.symbol),
      logo: optionalString(item.logo),
      decimals: typeof item.decimals === 'number' && Number.isInteger(item.decimals) && item.decimals >= 0 && item.decimals <= 255 ? item.decimals : undefined,
      buy_amount_raw: optionalUnsignedAmount(item.buy_amount_raw, 'buy_amount_raw'), sell_amount_raw: optionalUnsignedAmount(item.sell_amount_raw, 'sell_amount_raw'),
      buy_value_usd: optionalDecimal(item.buy_value_usd, 'buy_value_usd'), sell_value_usd: optionalDecimal(item.sell_value_usd, 'sell_value_usd'),
      realized_pnl_usd: optionalDecimal(item.realized_pnl_usd, 'realized_pnl_usd'), pnl_ratio: optionalDecimal(item.pnl_ratio, 'pnl_ratio'),
      avg_buy_price_usd: optionalDecimal(item.avg_buy_price_usd, 'avg_buy_price_usd'), avg_sell_price_usd: optionalDecimal(item.avg_sell_price_usd, 'avg_sell_price_usd'),
    };
  });
  if (row.next_cursor != null && typeof row.next_cursor !== 'string') throw new Error('Invalid closed history cursor.');
  return {items, next_cursor: optionalString(row.next_cursor)};
}

export async function getClosedPortfolioPositions(bearer: string, cursor = '', signal?: AbortSignal): Promise<PortfolioClosedPage> {
  const query = new URLSearchParams({status: 'closed', limit: '20'});
  if (cursor) query.set('cursor', cursor);
  const response = await call<unknown>(`/v1/portfolio/history?${query}`, {
    bearer, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    preserveInt64Fields: ['chain_id', 'opened_entry_id', 'closed_entry_id'],
  });
  try {return normalizePortfolioClosedPage(response.data);} catch (error) {
    throw new PortfolioDataError(error instanceof Error ? error.message : 'Invalid closed positions.', response.traceID);
  }
}

/** Complete scope is mandatory: partial parameters must never fall through to global trades. */
export async function getPortfolioCycleTrades(bearer: string, scope: PortfolioCycleScope, beforeID = '0', signal?: AbortSignal): Promise<PortfolioTradePage> {
  const chain = requiredString(scope.chain, 'scope.chain'), asset = requiredString(scope.asset, 'scope.asset');
  const opened = nonnegativeIntegerString(scope.opened_entry_id, 'scope.opened_entry_id');
  const cursor = nonnegativeIntegerString(beforeID, 'before_id');
  if (!chain.trim() || !asset.trim() || opened === '0') throw new Error('A complete positive cycle identity is required.');
  const query = new URLSearchParams({chain, asset, opened_entry_id: opened, limit: '50'});
  if (cursor !== '0') query.set('before_id', cursor);
  const response = await call<unknown>(`/v1/portfolio/position/trades?${query}`, {
    bearer, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    preserveInt64Fields: ['next_cursor', 'cycle_opened_entry_id'],
  });
  try {
    const page = normalizePortfolioTradePage(response.data);
    if (page.trades.some((trade) => trade.chain !== chain || trade.cycle_opened_entry_id !== opened ||
      (chain === 'solana' ? trade.token !== asset : trade.token.toLowerCase() !== asset.toLowerCase()))) throw new Error('Portfolio returned trades from another cycle.');
    return page;
  } catch (error) {
    throw new PortfolioDataError(error instanceof Error ? error.message : 'Invalid cycle trades.', response.traceID);
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function requiredString(value: unknown, field: string): string {
  const output = optionalString(value);
  if (!output) throw new Error(`Portfolio returned an invalid ${field}.`);
  return output;
}

function nonnegativeIntegerString(value: unknown, field: string): string {
  const validNumber = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const validString = typeof value === 'string' && /^\d+$/.test(value);
  if (!validNumber && !validString) throw new Error(`Portfolio returned an invalid ${field}.`);
  return BigInt(value as number | string).toString();
}

function optionalUnsignedAmount(value: unknown, field: string): string | undefined {
  const output = optionalString(value);
  if (output !== undefined && !/^\d+$/.test(output)) throw new Error(`Portfolio returned an invalid ${field}.`);
  return output;
}

function rfc3339(value: unknown, field: string, required = false): string | undefined {
  const output = optionalString(value);
  if (!output) {
    if (required) throw new Error(`Portfolio returned an invalid ${field}.`);
    return undefined;
  }
  if (!Number.isFinite(Date.parse(output))) throw new Error(`Portfolio returned an invalid ${field}.`);
  return output;
}

function optionalDecimal(value: unknown, field: string): string | undefined {
  const output = optionalString(value);
  if ((value != null && value !== '' && typeof value !== 'string') || (output !== undefined && (output.length > 256 || !/^-?\d+(?:\.\d+)?$/.test(output)))) {
    throw new Error(`Portfolio returned an invalid decimal for ${field}.`);
  }
  return output;
}

function timestamp(value: unknown): ProtoTimestamp | undefined {
  const row = object(value);
  if (!row || (typeof row.seconds !== 'number' && typeof row.seconds !== 'string')) return undefined;
  // 线格式规则 10：未设置的时间对象是全零展开（{"seconds":0}），不是 1970 年。
  if (row.seconds === 0 || row.seconds === '0') return undefined;
  return {seconds: row.seconds, ...(typeof row.nanos === 'number' ? {nanos: row.nanos} : {})};
}

export function normalizePortfolioPosition(value: unknown, allowClosed = false): PortfolioPosition {
  const row = object(value);
  const asset = object(row?.asset);
  if (!row || !asset) throw new Error('Portfolio returned an invalid position identity.');
  const chain = requiredString(asset.chain, 'asset.chain');
  const kind = requiredString(asset.kind, 'asset.kind');
  const tokenAddress = requiredString(asset.token_address, 'asset.token_address');
  const chainID = nonnegativeIntegerString(asset.chain_id, 'asset.chain_id');
  if (chainID === '0') throw new Error('Portfolio returned an invalid asset.chain_id.');
  const shares = requiredString(row.shares_raw, 'shares_raw');
  if (!/^\d+$/.test(shares) || shares.length > 256 || (!allowClosed && BigInt(shares) === BigInt(0))) {
    throw new Error('Portfolio returned invalid Trade ledger shares_raw.');
  }
  const entry = nonnegativeIntegerString(row.opened_entry_id ?? 0, 'opened_entry_id');
  const status = row.cycle_status === 'ready' || row.cycle_status === 'pending' || row.cycle_status === 'unavailable'
    ? row.cycle_status : 'unavailable';
  const ready = status === 'ready' && entry !== '0';
  const decimalFields = ['price_usd', 'cost_basis_usd', 'buy_value_usd', 'sell_value_usd',
    'realized_pnl_usd', 'market_value_usd', 'unrealized_pnl_usd', 'total_pnl_usd',
    'pnl_ratio', 'avg_buy_price_usd', 'avg_sell_price_usd'] as const;
  const money: Partial<Record<typeof decimalFields[number], string>> = {};
  for (const field of decimalFields) money[field] = optionalDecimal(row[field], field);
  // Pending/unavailable cycles retain shares, quote, market value and remaining cost.
  // Untrusted cycle aggregates must not become zero PnL or a publishable Opinion.
  if (!ready) {
    for (const field of ['buy_value_usd', 'sell_value_usd', 'realized_pnl_usd',
      'unrealized_pnl_usd', 'total_pnl_usd', 'pnl_ratio', 'avg_buy_price_usd', 'avg_sell_price_usd'] as const) {
      money[field] = undefined;
    }
  }
  return {
    asset: {chain, chain_id: chainID, kind, token_address: tokenAddress},
    symbol: optionalString(row.symbol),
    logo: optionalString(row.logo),
    decimals: typeof row.decimals === 'number' && Number.isInteger(row.decimals) && row.decimals >= 0 && row.decimals <= 255 ? row.decimals : undefined,
    shares_raw: shares,
    opened_entry_id: entry,
    opened_at: timestamp(row.opened_at),
    cycle_status: ready ? 'ready' : status === 'ready' ? 'unavailable' : status,
    price_as_of: timestamp(row.price_as_of),
    buy_amount_raw: ready ? optionalUnsignedAmount(row.buy_amount_raw, 'buy_amount_raw') : undefined,
    sell_amount_raw: ready ? optionalUnsignedAmount(row.sell_amount_raw, 'sell_amount_raw') : undefined,
    ...money,
  };
}

function windowPnl(value: unknown): WindowPnl | undefined {
  const row = object(value);
  if (!row) return undefined;
  const curve = Array.isArray(row.curve) ? row.curve.flatMap((item) => {
    const point = object(item);
    if (!point || typeof point.at !== 'string') return [];
    const pnlUsd = optionalDecimal(point.pnl_usd, 'pnl.curve.pnl_usd');
    return pnlUsd === undefined ? [] : [{at: point.at, pnl_usd: pnlUsd}];
  }) : undefined;
  const amountUsd = optionalDecimal(row.amount_usd, 'pnl.amount_usd');
  const baselineAsOf = optionalString(row.baseline_as_of);
  const simulated = row.simulated === true || undefined;
  // 规则 10 的全零展开（无金额、无曲线）折叠回 undefined，等价于旧的"缺席"。
  if (amountUsd === undefined && baselineAsOf === undefined && (!curve || curve.length === 0) && !simulated) return undefined;
  return {
    amount_usd: amountUsd,
    baseline_as_of: baselineAsOf,
    curve,
    simulated,
  };
}

function pnlSummary(value: unknown): PortfolioPnl | undefined {
  const row = object(value);
  if (!row) return undefined;
  const parsed = {
    d1: windowPnl(row.d1),
    d7: windowPnl(row.d7),
    d30: windowPnl(row.d30),
    all_usd: optionalDecimal(row.all_usd, 'pnl.all_usd'),
    all: windowPnl(row.all),
  };
  // 规则 10：未设置的 pnl 是全零对象，四个窗口与总额全空 = 没有盈亏数据。
  if (parsed.d1 === undefined && parsed.d7 === undefined && parsed.d30 === undefined && parsed.all === undefined && parsed.all_usd === undefined) {
    return undefined;
  }
  return parsed;
}

export function normalizePortfolio(value: unknown): PortfolioReply {
  const row = object(value);
  if (!row) throw new Error('Portfolio response is not an object.');
  if (row.positions !== undefined && !Array.isArray(row.positions)) {
    throw new Error('Portfolio positions must be an array when present.');
  }
  if (row.partial_errors !== undefined && !Array.isArray(row.partial_errors)) {
    throw new Error('Portfolio partial_errors must be an array when present.');
  }
  const pnl = pnlSummary(row.pnl);
  if (row.cash_balances !== undefined && !Array.isArray(row.cash_balances)) throw new Error('Portfolio cash_balances must be an array.');
  const cashBalances = ((row.cash_balances ?? []) as unknown[]).map((value): PortfolioCashBalance => {
    const cash = object(value), token = object(cash?.token);
    if (!cash || !token || (cash.address_format !== 'evm' && cash.address_format !== 'base58') ||
        (cash.deposit_mode !== 'direct' && cash.deposit_mode !== 'sweep') || typeof cash.deposit_enabled !== 'boolean' ||
        typeof cash.balance_meets_minimum !== 'boolean' || typeof token.decimals !== 'number' || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255) {
      throw new Error('Portfolio returned an invalid cash balance route.');
    }
    return {chain: requiredString(cash.chain, 'cash.chain'), chain_id: nonnegativeIntegerString(cash.chain_id, 'cash.chain_id'),
      wallet_address: optionalString(cash.wallet_address) ?? '', address_format: cash.address_format,
      token: {symbol: requiredString(token.symbol, 'cash.token.symbol'), address: requiredString(token.address, 'cash.token.address'), decimals: token.decimals},
      amount_raw: optionalUnsignedAmount(cash.amount_raw, 'cash.amount_raw'), deposit_mode: cash.deposit_mode,
      deposit_enabled: cash.deposit_enabled, min_sweep_amount: optionalUnsignedAmount(cash.min_sweep_amount, 'cash.min_sweep_amount'), balance_meets_minimum: cash.balance_meets_minimum};
  });
  const errors = Array.isArray(row.partial_errors) ? row.partial_errors.map((item) => {
    const error = object(item);
    if (!error || typeof error.reason !== 'string' || error.reason === '') {
      throw new Error('Portfolio returned an invalid partial error.');
    }
    return {
      chain: optionalString(error.chain),
      token_address: optionalString(error.token_address),
      reason: error.reason,
      retryable: error.retryable === true || undefined,
    };
  }) : [];
  return {
    total_value_usd: optionalDecimal(row.total_value_usd, 'total_value_usd'),
    cash_balance_usd: optionalDecimal(row.cash_balance_usd, 'cash_balance_usd'),
    total_assets_usd: optionalDecimal(row.total_assets_usd, 'total_assets_usd'),
    cash_observed_at: timestamp(row.cash_observed_at),
    cash_balances: cashBalances,
    pnl,
    positions: Array.isArray(row.positions) ? row.positions.map((item) => normalizePortfolioPosition(item)) : [],
    partial_errors: errors,
    observed_at: timestamp(row.observed_at),
  };
}

export async function getPortfolio(bearer: string, signal?: AbortSignal, forceRefresh = false): Promise<PortfolioReply> {
  const response = await call<unknown>(forceRefresh ? '/v1/portfolio?force_refresh=true' : '/v1/portfolio', {
    bearer, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    preserveInt64Fields: ['opened_entry_id', 'chain_id'],
  });
  try {
    return normalizePortfolio(response.data);
  } catch (error) {
    throw new PortfolioDataError(error instanceof Error ? error.message : 'Invalid Portfolio response.', response.traceID);
  }
}

export function normalizePortfolioTradePage(value: unknown): PortfolioTradePage {
  const row = object(value);
  if (!row || (row.trades !== undefined && !Array.isArray(row.trades))) throw new Error('Portfolio trade history response is invalid.');
  const trades = (row.trades as unknown[] | undefined ?? []).map((item) => {
    const trade = object(item);
    if (!trade || (trade.side !== 'buy' && trade.side !== 'sell')) throw new Error('Portfolio returned an invalid trade side.');
    const feeApp = optionalUnsignedAmount(trade.fee_app, 'trade.fee_app');
    const feeCurrency = optionalString(trade.fee_currency);
    if ((feeApp === undefined) !== (feeCurrency === undefined)) throw new Error('Portfolio returned an incomplete trade fee.');
    return {
      trade_id: requiredString(trade.trade_id, 'trade.trade_id'),
      side: trade.side,
      chain: requiredString(trade.chain, 'trade.chain'),
      token: requiredString(trade.token, 'trade.token'),
      quote_token: requiredString(trade.quote_token, 'trade.quote_token'),
      amount_in_actual: optionalUnsignedAmount(trade.amount_in_actual, 'trade.amount_in_actual'),
      amount_out: optionalUnsignedAmount(trade.amount_out, 'trade.amount_out'),
      status: requiredString(trade.status, 'trade.status'),
      lifecycle: requiredString(trade.lifecycle, 'trade.lifecycle'),
      tx_hash: optionalString(trade.tx_hash),
      created_at: rfc3339(trade.created_at, 'trade.created_at', true)!,
      confirmed_at: rfc3339(trade.confirmed_at, 'trade.confirmed_at'),
      fee_app: feeApp,
      fee_currency: feeCurrency,
      tx_chain: optionalString(trade.tx_chain),
      cycle_opened_entry_id: nonnegativeIntegerString(trade.cycle_opened_entry_id, 'trade.cycle_opened_entry_id'),
      cycle_key: optionalString(trade.cycle_key),
      logo: optionalString(trade.logo),
      symbol: optionalString(trade.symbol),
      name: optionalString(trade.name),
      token_amount: optionalDecimal(trade.token_amount, 'trade.token_amount'),
      trade_value_usd: optionalDecimal(trade.trade_value_usd, 'trade.trade_value_usd'),
      execution_price_usd: optionalDecimal(trade.execution_price_usd, 'trade.execution_price_usd'),
      asset_decimals: trade.asset_decimals == null ? undefined
        : typeof trade.asset_decimals === 'number' && Number.isInteger(trade.asset_decimals) && trade.asset_decimals >= 0 && trade.asset_decimals <= 255
          ? trade.asset_decimals : (() => {throw new Error('Portfolio returned an invalid trade.asset_decimals.');})(),
    } satisfies PortfolioTrade;
  });
  const cursor = nonnegativeIntegerString(row.next_cursor ?? 0, 'trade next_cursor');
  return {trades, next_cursor: cursor === '0' ? undefined : cursor};
}

/** Global mode: intentionally omit chain/asset/opened_entry_id. */
export async function getGlobalPortfolioTrades(bearer: string, beforeID = '0', limit = 50, signal?: AbortSignal): Promise<PortfolioTradePage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Portfolio trade history limit must be between 1 and 200.');
  if (!/^\d+$/.test(beforeID)) throw new Error('Portfolio trade history cursor is invalid.');
  const cursor = BigInt(beforeID).toString();
  const query = new URLSearchParams({limit: String(limit)});
  if (cursor !== '0') query.set('before_id', cursor);
  const response = await call<unknown>(`/v1/portfolio/position/trades?${query}`, {
    bearer,
    signal,
    preserveInt64Fields: ['next_cursor', 'cycle_opened_entry_id'],
  });
  return normalizePortfolioTradePage(response.data);
}

/**
 * POSITION target_id (`chain_id:kind:token_address:opened_entry_id`, social.md §3.1).
 * The fourth segment is the trade-ledger round identity (opened_entry_id) —
 * stable across ledger replays; the display-only `round` ordinal must not be
 * used here. undefined means the current cycle is not ready or a segment is
 * ambiguous — callers must disable publishing instead of eating a
 * 100102/200103 rejection.
 */
export function positionTargetID(position: PortfolioPosition): string | undefined {
  const entry = position.opened_entry_id;
  if (position.cycle_status !== 'ready' || !entry || entry === '0') return undefined;
  const kind = position.asset.kind;
  const tokenAddress = position.asset.token_address;
  if (kind === '' || kind.includes(':') || tokenAddress === '' || tokenAddress.includes(':')) return undefined;
  try {
    const chainID = BigInt(String(position.asset.chain_id)).toString();
    const entryID = BigInt(entry).toString();
    if (BigInt(entryID) < BigInt(1)) return undefined;
    return `${chainID}:${kind}:${tokenAddress}:${entryID}`;
  } catch {
    return undefined;
  }
}

// ── 客态 Portfolio（portfolio.md 第一部分：/v1/users/{id}/portfolio，2026-09） ──
//
// 看别人的总览 / closed / 流水。四个接口均为 **Optional 档**：匿名可看、
// 带有效 JWT 放行、**带坏 JWT 一律 400000 拒绝（不降级成匿名）** —— 未登录就
// 不传 bearer，绝不要把过期 token 传进来。回包类型与主态共用（契约原文：
// 「与旧主态总览共用返回类型和计算逻辑」），归一化直接复用上面的函数。
// 目标不存在/受限按不存在处理（不是空账户）；切换用户时调用方要清空旧游标、
// 丢弃上一用户的迟到响应。

/** 客态总览：open 持仓、账户 PnL、现金、总资产及曲线。 */
export async function getUserPortfolio(userIdentifier: string, bearer?: string, signal?: AbortSignal): Promise<PortfolioReply> {
  const response = await call<unknown>(`/v1/users/${encodeURIComponent(userIdentifier)}/portfolio`, {
    bearer,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    preserveInt64Fields: ['opened_entry_id', 'chain_id'],
  });
  try {
    return normalizePortfolio(response.data);
  } catch (error) {
    throw new PortfolioDataError(error instanceof Error ? error.message : 'Invalid viewer Portfolio response.', response.traceID);
  }
}

/** 客态 closed 轮次列表：limit 上限 20；条目比主态多 cycle_key / ending_* / valuation_status（此处宽容忽略）。 */
export async function getUserClosedPositions(userIdentifier: string, cursor = '', bearer?: string, signal?: AbortSignal): Promise<PortfolioClosedPage> {
  const query = new URLSearchParams({limit: '20'});
  if (cursor) query.set('cursor', cursor);
  const response = await call<unknown>(`/v1/users/${encodeURIComponent(userIdentifier)}/portfolio/closed?${query}`, {
    bearer,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    preserveInt64Fields: ['chain_id', 'opened_entry_id', 'closed_entry_id'],
  });
  try {
    return normalizePortfolioClosedPage(response.data);
  } catch (error) {
    throw new PortfolioDataError(error instanceof Error ? error.message : 'Invalid viewer closed positions.', response.traceID);
  }
}

/** 客态跨币流水：默认 50、上限 200；before_id 游标与主态同语义。 */
export async function getUserPortfolioTrades(userIdentifier: string, beforeID = '0', limit = 50, bearer?: string, signal?: AbortSignal): Promise<PortfolioTradePage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Viewer trade history limit must be between 1 and 200.');
  if (!/^\d+$/.test(beforeID)) throw new Error('Viewer trade history cursor is invalid.');
  const cursor = BigInt(beforeID).toString();
  const query = new URLSearchParams({limit: String(limit)});
  if (cursor !== '0') query.set('before_id', cursor);
  const response = await call<unknown>(`/v1/users/${encodeURIComponent(userIdentifier)}/portfolio/trades?${query}`, {
    bearer,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    preserveInt64Fields: ['next_cursor', 'cycle_opened_entry_id'],
  });
  try {
    return normalizePortfolioTradePage(response.data);
  } catch (error) {
    throw new PortfolioDataError(error instanceof Error ? error.message : 'Invalid viewer trade history.', response.traceID);
  }
}
