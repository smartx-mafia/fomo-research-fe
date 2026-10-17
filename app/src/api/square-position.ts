import {call} from './envelope';
import {samePositionAsset, squareSmartMoneyChain, type SquarePositionTarget} from '@/lib/square-position';

export type SquarePositionObservation = {
  status?: string;
  boughtQuantity?: string; boughtUSD?: string; soldQuantity?: string; soldUSD?: string;
  coverage?: string;
};
export type SquareHolding = {
  state: 'open' | 'closed' | 'pending';
  observation?: SquarePositionObservation;
  quantity?: string; valueUSD?: string; pnlUSD?: string; ratio?: string;
  investedUSD?: string; avgBuyPrice?: string; avgSellPrice?: string; currentPrice?: string;
  transferIn?: string; transferOut?: string;
};
export type SquarePositionTrade = {
  event: string; at?: number | string; txHash?: string; chain?: string; wallet?: string;
  amountUSD?: string; priceUSD?: string; quantity?: string;
};
export type SquareSmartMoneySnapshot = {holding?: SquareHolding; coverage?: string; stale: boolean};
export type SquarePositionTrades = {list: SquarePositionTrade[]; coverage?: string};
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | undefined => typeof value === 'string' && value !== '' ? value : undefined;
function decimal(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 256 || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid position amount.');
  return value;
}

/** App capabilities is a best-effort guard: failure/missing surface must not
 * suppress otherwise readable positions. An explicit disabled surface does. */
export async function getSquarePositionCapability(signal?: AbortSignal): Promise<{ready: boolean; reason?: string}> {
  const {data} = await call<unknown>('/v2/smartmoney/capabilities', {signal});
  const surface = record(record(record(data).surfaces).positions);
  return {ready: Object.keys(surface).length === 0 || surface.enabled === true && surface.state === 'ready', reason: text(surface.reason)};
}

/** 单币筛选下推到服务端，避免其他币的交易占满观察读取上限。 */
export async function getSquareSmartMoneyPosition(target: SquarePositionTarget, signal?: AbortSignal): Promise<SquareSmartMoneySnapshot> {
  if (target.kind === 'user') throw new Error('Platform users require a portfolio cycle.');
  const chain = squareSmartMoneyChain(target);
  const query = target.kind === 'external_user'
    ? new URLSearchParams({'identity.type': 'user', 'identity.user_id': target.identifier, chain})
    : new URLSearchParams({'identity.type': 'wallet', 'identity.namespace': chain === 'sol' ? 'solana' : 'evm', 'identity.address': target.identifier, chain});
  query.set('token_address', target.address);
  query.set('status', 'all');
  query.set('include_details', 'true');
  query.set('limit', '100');
  const positions: Record<string, unknown>[] = [];
  const cursors = new Set<string>();
  const coverages: string[] = [];
  let snapshotID: string | undefined;
  let stale = false;
  for (let page = 0; page < 5; page++) {
    const {data} = await call<unknown>(`/v2/smartmoney/positions/page?${query}`, {signal, preserveInt64Fields: ['total', 'last_active_at', 'snapshot_at', 'first_observed_at', 'last_observed_at', 'start_holding_at', 'end_holding_at']});
    const raw = record(data), meta = record(raw.meta);
    if (!Array.isArray(raw.list)) throw new Error('Position page list is missing.');
    if (raw.list.length > 100) throw new Error('Position page exceeds the requested limit.');
    const revision = text(raw.snapshot_id);
    if (page === 0) snapshotID = revision;
    else if (!snapshotID || revision !== snapshotID) throw new Error('Position page changed while loading. Refresh and try again.');
    positions.push(...raw.list.map(record));
    const coverage = text(raw.coverage) || text(meta.coverage);
    if (coverage) coverages.push(coverage);
    stale ||= raw.stale === true;
    if (raw.next_cursor != null && typeof raw.next_cursor !== 'string') throw new Error('Position cursor is invalid.');
    const cursor = text(raw.next_cursor);
    if (!cursor) break;
    if (page === 4 || cursors.has(cursor)) throw new Error('Position history exceeds the detail limit. Refine the position before retrying.');
    cursors.add(cursor);
    query.set('cursor', cursor);
  }
  const matches = positions.filter((position) => {
    const asset = text(position.token_address), rowChain = text(position.chain);
    return asset && rowChain && samePositionAsset(rowChain, asset, target);
  });
  if (matches.some((row) => !['open', 'closed', 'pending'].includes(String(row.status)))) throw new Error('Position state is invalid.');
  let holding: SquareHolding | undefined;
  // 外部普通交易没有可靠轮次键，按契约状态优先级匹配；同状态多轮绝不任取。
  for (const state of ['open', 'closed', 'pending'] as const) {
    const candidates = matches.filter((position) => position.status === state);
    if (candidates.length > 1) throw new Error('Multiple position rounds match this asset. A specific round is required.');
    const row = candidates[0];
    if (!row) continue;
    const detail = record(row.detail);
    const itemObservation = record(row.observation);
    const observed = text(itemObservation.status) ? itemObservation : record(detail.observation);
    const observation = text(observed.status) ? {status: text(observed.status),
      boughtQuantity: decimal(observed.bought_amount), boughtUSD: decimal(observed.bought_usd),
      soldQuantity: decimal(observed.sold_amount), soldUSD: decimal(observed.sold_usd), coverage: text(observed.coverage)} : undefined;
    if (state === 'pending') {holding = {state, observation}; break;}
    holding = {state, observation, quantity: state === 'open' ? decimal(row.balance) : undefined,
      valueUSD: state === 'open' ? decimal(row.usd_value) : undefined,
      currentPrice: state === 'open' ? decimal(row.price) : undefined,
      pnlUSD: decimal(state === 'closed' ? row.realized_profit : row.total_profit),
      ratio: decimal(state === 'closed' ? row.realized_profit_pnl : row.total_profit_pnl),
      investedUSD: decimal(row.history_bought_cost), avgBuyPrice: decimal(detail.avg_bought_price), avgSellPrice: decimal(detail.avg_sold_price),
      transferIn: decimal(detail.transfer_in_quantity), transferOut: decimal(detail.transfer_out_quantity)};
    break;
  }
  return {holding, coverage: coverages.find((value) => value !== 'complete') || coverages[0], stale};
}

/** Single-position facts are not paginated or deduplicated by transaction hash:
 * one transaction may legitimately contain multiple legs or wallets. */
export async function getSquarePositionTrades(target: SquarePositionTarget, signal?: AbortSignal): Promise<SquarePositionTrades> {
  if (target.kind === 'user') throw new Error('Platform cycle trades come from the cycle detail.');
  const chain = squareSmartMoneyChain(target);
  const query = target.kind === 'external_user'
    ? new URLSearchParams({subject_type: 'external_user', user_id: target.identifier, position_id: `${chain}:${target.address}`})
    : new URLSearchParams({subject_type: 'address', chain, address: target.identifier, token_address: target.address});
  const {data} = await call<unknown>(`/v1/smartmoney/new-position-trades?${query}`, {signal, preserveInt64Fields: ['occurred_at', 'trade_revision', 'supply_as_of_ms', 'fetched_at_ms', 'price_effective_at_ms']});
  const raw = record(data);
  if (raw.list != null && !Array.isArray(raw.list)) throw new Error('Position trades list is invalid.');
  return {coverage: text(raw.coverage), list: ((raw.list ?? []) as unknown[]).map((value) => {
    const row = record(value), at = row.occurred_at;
    return {event: text(row.event_type) || 'unknown', txHash: text(row.tx_hash),
      at: typeof at === 'string' && /^\d+$/.test(at) || typeof at === 'number' && Number.isSafeInteger(at) ? at as string | number : undefined,
      chain: text(row.chain), wallet: text(row.wallet_address),
      amountUSD: decimal(row.cost_usd), priceUSD: decimal(row.price_usd), quantity: decimal(row.token_amount)};
  })};
}
