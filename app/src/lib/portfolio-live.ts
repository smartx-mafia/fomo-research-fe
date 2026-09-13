import type {PortfolioReply, ProtoTimestamp} from '@/api/portfolio';
import {addDecimalStrings, subtractDecimalStrings, marketValueFromBaseUnits, parseExactDecimal} from './exact-decimal';

export type PortfolioQuote = {price: string; at: number};
export const portfolioAssetKey = (chain: string, address: string) => `${chain}:${chain === 'solana' ? address : address.toLowerCase()}`;
function milliseconds(at?: ProtoTimestamp) {return at ? Number(at.seconds) * 1000 + (at.nanos ?? 0) / 1e6 : 0;}
function divide(a: string, b: string): string | undefined {
  const x = parseExactDecimal(a), y = parseExactDecimal(b);
  if (y.coefficient <= BigInt(0)) return undefined;
  const units = x.coefficient * BigInt(10) ** BigInt(y.scale + 12) / (y.coefficient * BigInt(10) ** BigInt(x.scale));
  const digits = (units < BigInt(0) ? -units : units).toString().padStart(13, '0');
  return `${units < BigInt(0) ? '-' : ''}${digits.slice(0, -12)}.${digits.slice(-12)}`;
}
export function revaluePortfolio(snapshot: PortfolioReply, quotes: Record<string, PortfolioQuote>): PortfolioReply {
  let delta = '0', deltaKnown = true, changed = false;
  const positions = snapshot.positions.map((position) => {
    const quote = quotes[portfolioAssetKey(position.asset.chain, position.asset.token_address)];
    if (!quote || quote.at <= milliseconds(position.price_as_of) || position.decimals === undefined || position.quantity_status === 'pending') return position;
    changed = true;
    const value = marketValueFromBaseUnits(position.shares_raw, position.decimals, quote.price);
    if (position.market_value_usd === undefined) deltaKnown = false;
    else delta = addDecimalStrings(delta, subtractDecimalStrings(value, position.market_value_usd));
    const unrealized = position.cycle_status === 'ready' && position.cost_basis_usd !== undefined ? subtractDecimalStrings(value, position.cost_basis_usd) : undefined;
    const total = unrealized !== undefined && position.realized_pnl_usd !== undefined ? addDecimalStrings(unrealized, position.realized_pnl_usd) : undefined;
    return {...position, price_usd: quote.price, price_as_of: {seconds: Math.floor(quote.at / 1000), nanos: (quote.at % 1000) * 1e6}, market_value_usd: value, unrealized_pnl_usd: unrealized, total_pnl_usd: total, pnl_ratio: total !== undefined && position.buy_value_usd !== undefined ? divide(total, position.buy_value_usd) : undefined};
  });
  if (!changed) return snapshot;
  const complete = snapshot.quantity_completeness === 'complete' || (!snapshot.quantity_completeness && snapshot.completeness !== 'partial');
  const valuesKnown = complete && positions.every((p) => p.quantity_status !== 'pending' && p.market_value_usd !== undefined);
  const total = valuesKnown ? positions.reduce((sum, p) => addDecimalStrings(sum, p.market_value_usd!), '0') : undefined;
  const assets = total !== undefined && snapshot.cash_balance_usd !== undefined ? addDecimalStrings(total, snapshot.cash_balance_usd) : undefined;
  const pnl = snapshot.pnl ? {...snapshot.pnl} : undefined;
  if (pnl && deltaKnown) {
    for (const key of ['d1', 'd7', 'd30', 'all'] as const) {
      const window = pnl[key];
      if (window?.amount_usd !== undefined) pnl[key] = {...window, amount_usd: addDecimalStrings(window.amount_usd, delta)};
    }
    if (pnl.all_usd !== undefined) pnl.all_usd = addDecimalStrings(pnl.all_usd, delta);
  }
  const balance = snapshot.balance ? {...snapshot.balance, all_usd: assets} : undefined;
  if (balance) for (const key of ['d1', 'd7', 'd30', 'all'] as const) if (balance[key]) balance[key] = {...balance[key]!, amount_usd: assets};
  return {...snapshot, positions, total_value_usd: total, total_assets_usd: assets, pnl, balance};
}
