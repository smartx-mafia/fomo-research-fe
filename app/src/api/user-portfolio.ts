import {call} from './envelope';
import {normalizePortfolio, normalizePortfolioClosedPage, normalizePortfolioPosition, normalizePortfolioTradePage, PortfolioDataError, type PortfolioCycleScope, type PortfolioPosition, type ProtoTimestamp} from './portfolio';

function path(identifier: string) {
  if (!identifier.trim()) throw new Error('A platform user identifier is required.');
  return `/v1/users/${encodeURIComponent(identifier)}/portfolio`;
}
async function read<T>(url: string, parse: (value: unknown) => T, bearer?: string, signal?: AbortSignal): Promise<T> {
  const fields = ['chain_id', 'opened_entry_id', 'closed_entry_id', 'cycle_opened_entry_id'];
  if (url.includes('/trades?')) fields.push('next_cursor');
  const response = await call<unknown>(url, {bearer, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), preserveInt64Fields: fields});
  try {return parse(response.data);} catch (error) {
    throw new PortfolioDataError(error instanceof Error ? error.message : 'Invalid portfolio response.', response.traceID);
  }
}
export function getUserPortfolio(identifier: string, bearer?: string, forceRefresh = false, signal?: AbortSignal) {
  return read(`${path(identifier)}${forceRefresh ? '?force_refresh=true' : ''}`, normalizePortfolio, bearer, signal);
}
export function getUserClosedPositions(identifier: string, cursor = '', bearer?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({limit: '20'});
  if (cursor) query.set('cursor', cursor);
  return read(`${path(identifier)}/closed?${query}`, normalizePortfolioClosedPage, bearer, signal);
}
export function getUserPortfolioTrades(identifier: string, cursor = '0', bearer?: string, signal?: AbortSignal) {
  if (!/^\d+$/.test(cursor)) throw new Error('Invalid trade cursor.');
  return read(`${path(identifier)}/trades?${new URLSearchParams({before_id: cursor, limit: '50'})}`, normalizePortfolioTradePage, bearer, signal);
}
export type UserPortfolioPosition = {status: 'open' | 'closed'; position: PortfolioPosition; trades: ReturnType<typeof normalizePortfolioTradePage>['trades']; closed_at?: ProtoTimestamp; history_epoch?: string; completeness?: string};
export function getUserPortfolioPosition(identifier: string, scope: PortfolioCycleScope, bearer?: string, signal?: AbortSignal) {
  if (!scope.chain.trim() || !scope.asset.trim() || !scope.cycle_key?.trim()) throw new Error('A complete chain, asset and cycle_key are required.');
  const query = new URLSearchParams({chain: scope.chain, asset: scope.asset, cycle_key: scope.cycle_key});
  return read(`${path(identifier)}/position?${query}`, (value): UserPortfolioPosition => {
    const row = value as Partial<UserPortfolioPosition> | null;
    if (!row || (row.status !== 'open' && row.status !== 'closed') || !Array.isArray(row.trades)) throw new Error('Invalid cycle detail.');
    const position = normalizePortfolioPosition(row.position, true);
    const sameAddress = (a: string, b: string) => scope.chain === 'solana' ? a === b : a.toLowerCase() === b.toLowerCase();
    if (position.asset.chain !== scope.chain || !sameAddress(position.asset.token_address, scope.asset) || position.cycle_key !== scope.cycle_key) throw new Error('Cycle detail identity mismatch. Refresh positions and select the cycle again.');
    const trades = normalizePortfolioTradePage({trades: row.trades}).trades;
    if (trades.length > 2000 || new Set(trades.map((trade) => trade.trade_id)).size !== trades.length || trades.some((trade) => trade.chain !== scope.chain || !sameAddress(trade.token, scope.asset) || trade.cycle_key !== scope.cycle_key)) throw new Error('Invalid or mismatched cycle trades.');
    if (row.status === 'closed') {position.market_value_usd = undefined; position.price_usd = undefined; position.unrealized_pnl_usd = undefined;}
    return {status: row.status, position, trades, closed_at: row.closed_at, history_epoch: row.history_epoch, completeness: row.completeness};
  }, bearer, signal);
}
