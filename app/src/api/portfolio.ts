import {call} from './envelope';

export type ProtoTimestamp = {seconds: number | string; nanos?: number};

export type PortfolioAsset = {
  chain: string;
  chain_id: number | string;
  kind: string;
  token_address: string;
};

export type TradeBasis = {
  status: number;
  ledger_amount_raw?: string;
  cost_basis_usd?: string;
  realized_pnl_usd?: string;
};

export type SweepCapability = {status: number; min_amount_raw?: string};

export type PortfolioCurrentCycle = {
  opened_entry_id: number | string;
  realized_pnl_usd?: string;
  buy_value_usd?: string;
  /** Cycle round number starting at 1; undefined = the cycle is not ready yet (protojson omits zero), never render it as 0. */
  round?: number;
};

export type PortfolioPosition = {
  asset: PortfolioAsset;
  symbol?: string;
  decimals?: number;
  amount_raw: string;
  price_usd?: string;
  price_as_of?: ProtoTimestamp;
  trade_basis?: TradeBasis;
  sweep?: SweepCapability;
  current_cycle?: PortfolioCurrentCycle;
};

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

export type PortfolioReply = {
  total_value_usd?: string;
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
};

export type PortfolioTradePage = {trades: PortfolioTrade[]; next_cursor?: string};

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
  if (output !== undefined && !/^-?\d+(?:\.\d+)?$/.test(output)) {
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

function position(value: unknown): PortfolioPosition {
  const row = object(value);
  const asset = object(row?.asset);
  const amountRaw = optionalString(row?.amount_raw);
  if (
    !row || !asset || typeof asset.chain !== 'string' || asset.chain === '' ||
    (typeof asset.chain_id !== 'number' && typeof asset.chain_id !== 'string') ||
    typeof asset.kind !== 'string' || asset.kind === '' ||
    typeof asset.token_address !== 'string' || asset.token_address === '' ||
    !amountRaw || !/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= BigInt(0)
  ) throw new Error('Portfolio returned an invalid position identity or balance.');

  const basis = object(row.trade_basis);
  const sweep = object(row.sweep);
  const cycle = object(row.current_cycle);
  let currentCycle: PortfolioCurrentCycle | undefined;
  if (cycle) {
    const openedEntryID = cycle.opened_entry_id;
    // 线格式规则 10：未设置的 current_cycle 是全零对象（opened_entry_id 为
    // 0/缺失）—— 那是"无开放轮/周期未就绪"，折叠成 undefined；其余垃圾值仍抛。
    if (openedEntryID !== undefined && openedEntryID !== null && openedEntryID !== 0 && openedEntryID !== '0') {
      const validNumber = typeof openedEntryID === 'number' && Number.isSafeInteger(openedEntryID) && openedEntryID > 0;
      const validString = typeof openedEntryID === 'string' && /^\d+$/.test(openedEntryID) && BigInt(openedEntryID) > BigInt(0);
      if (!validNumber && !validString) throw new Error('Portfolio returned an invalid current-cycle identity.');
      const rawRound = cycle.round;
      if (rawRound !== undefined && rawRound !== null && (typeof rawRound !== 'number' || !Number.isSafeInteger(rawRound) || rawRound < 0)) {
        throw new Error('Portfolio returned an invalid current-cycle round.');
      }
      currentCycle = {
        opened_entry_id: openedEntryID as number | string,
        realized_pnl_usd: optionalDecimal(cycle.realized_pnl_usd, 'current_cycle.realized_pnl_usd'),
        buy_value_usd: optionalDecimal(cycle.buy_value_usd, 'current_cycle.buy_value_usd'),
        round: rawRound === 0 || rawRound === null ? undefined : rawRound,
      };
    }
  }
  return {
    asset: {
      chain: asset.chain,
      chain_id: asset.chain_id,
      kind: asset.kind,
      token_address: asset.token_address,
    },
    symbol: optionalString(row.symbol),
    decimals: typeof row.decimals === 'number' && Number.isInteger(row.decimals) && row.decimals >= 0 && row.decimals <= 255
      ? row.decimals : undefined,
    amount_raw: amountRaw,
    price_usd: optionalDecimal(row.price_usd, 'price_usd'),
    price_as_of: timestamp(row.price_as_of),
    trade_basis: basis && typeof basis.status === 'number' && basis.status > 0 ? {
      status: basis.status,
      ledger_amount_raw: optionalString(basis.ledger_amount_raw),
      cost_basis_usd: optionalDecimal(basis.cost_basis_usd, 'trade_basis.cost_basis_usd'),
      realized_pnl_usd: optionalDecimal(basis.realized_pnl_usd, 'trade_basis.realized_pnl_usd'),
    } : undefined,
    sweep: sweep && typeof sweep.status === 'number' && sweep.status > 0 ? {
      status: sweep.status,
      min_amount_raw: optionalString(sweep.min_amount_raw),
    } : undefined,
    current_cycle: currentCycle,
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
    pnl,
    positions: Array.isArray(row.positions) ? row.positions.map(position) : [],
    partial_errors: errors,
    observed_at: timestamp(row.observed_at),
  };
}

export async function getPortfolio(bearer: string, signal?: AbortSignal): Promise<PortfolioReply> {
  const response = await call<unknown>('/v1/portfolio', {bearer, signal});
  return normalizePortfolio(response.data);
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
  const entry = position.current_cycle?.opened_entry_id;
  if (entry === undefined) return undefined;
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
