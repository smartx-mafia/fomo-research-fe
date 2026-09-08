/** 聪明钱详情公共接口（docs/contracts/smartmoney-detail.md）。 */
import {call} from './envelope';

export type SmartMoneyHolding = {
  token_address?: string;
  symbol?: string;
  name?: string;
  balance?: string;
  usd_value?: string;
  realized_profit?: string;
  unrealized_profit?: string;
  total_profit?: string;
  is_honeypot?: boolean;
  end_holding_at?: number;
};

export type SmartMoneyHoldings = {
  chain: string;
  address: string;
  total_profit?: string;
  total_profit_ratio?: string;
  open?: SmartMoneyHolding[];
  closed?: SmartMoneyHolding[];
};

export type SmartMoneyTrade = {
  tx_hash?: string;
  event_type?: string;
  occurred_at?: number;
  token_address?: string;
  token_symbol?: string;
  token_amount?: string;
  quote_amount?: string;
  quote_symbol?: string;
  cost_usd?: string;
  price_usd?: string;
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

export function getSmartMoneyHoldings(chain: string, address: string) {
  return call<SmartMoneyHoldings>(detailPath('holdings', chain, address));
}

export function getSmartMoneyTrades(chain: string, address: string) {
  return call<SmartMoneyTrades>(detailPath('trades', chain, address));
}
