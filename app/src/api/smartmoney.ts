/** 聪明钱详情公共接口（docs/contracts/smartmoney-detail.md）。 */
import {call} from './envelope';

export type SmartMoneyHolding = {
  chain?: string;
  launchpad?: string;
  /** Average holding cost × collected total supply (FDV), decimal USD; empty means unavailable. */
  avg_cost_market_cap_usd?: string;
  token_address?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  logo?: string;
  price?: string;
  balance?: string;
  usd_value?: string;
  accu_cost?: string;
  accu_amount?: string;
  history_bought_amount?: string;
  history_bought_cost?: string;
  history_sold_amount?: string;
  history_sold_income?: string;
  avg_bought_price?: string;
  avg_cost_price?: string;
  realized_profit?: string;
  realized_profit_pnl?: string;
  unrealized_profit?: string;
  unrealized_profit_pnl?: string;
  total_profit?: string;
  total_profit_pnl?: string;
  is_honeypot?: boolean;
  start_holding_at?: number;
  last_active_at?: number;
  end_holding_at?: number;
};

export type SmartMoneyHoldings = {
  chain: string;
  address: string;
  total_profit?: string;
  total_profit_ratio?: string;
  realized_profit?: string;
  pnl_windows?: SmartMoneyPnlWindow[];
  open?: SmartMoneyHolding[];
  closed?: SmartMoneyHolding[];
};

export type SmartMoneyPnlWindow = {
  window: string;
  total_profit?: string;
  realized_profit?: string;
};

export type SmartMoneyTrade = {
  tx_hash?: string;
  event_type?: string;
  occurred_at?: number;
  token_address?: string;
  token_symbol?: string;
  token_logo?: string;
  token_amount?: string;
  quote_amount?: string;
  quote_symbol?: string;
  cost_usd?: string;
  price_usd?: string;
};

export type SmartMoneyTokenTrade = {
  tx_hash?: string; event_type?: string; occurred_at?: number; token_amount?: string;
  quote_amount?: string; quote_symbol?: string; cost_usd?: string; price_usd?: string;
  legs?: number; round?: number;
};
export type SmartMoneyTokenTrades = {
  chain: string; address: string; token_address: string; list?: SmartMoneyTokenTrade[];
  next_cursor?: string; complete?: boolean;
};

export type SmartMoneyTrades = {
  chain: string;
  address: string;
  fetched_at?: number;
  list?: SmartMoneyTrade[];
};

function detailPath(path: 'holdings' | 'trades', chain: string, address: string) {
  const params = new URLSearchParams({chain, address});
  return `/v1/smartmoney/${path}?${params.toString()}`;
}

export function getSmartMoneyTokenTrades(chain: string, address: string, tokenAddress: string, cursor = '', signal?: AbortSignal) {
  const params = new URLSearchParams({chain, address, token_address: tokenAddress, limit: '50'});
  if (cursor) params.set('cursor', cursor);
  return call<SmartMoneyTokenTrades>(`/v1/smartmoney/token-trades?${params}`, {signal});
}

export function getSmartMoneyHoldings(chain: string, address: string, signal?: AbortSignal) {
  return call<SmartMoneyHoldings>(detailPath('holdings', chain, address), {signal});
}

export function getSmartMoneyTrades(chain: string, address: string, signal?: AbortSignal) {
  return call<SmartMoneyTrades>(detailPath('trades', chain, address), {signal});
}
