import {call} from './envelope';
import type {SmartMoneyHolding, SmartMoneyPnlWindow} from './smartmoney';

export type PlatformHolding = SmartMoneyHolding & {
  chain: string; token_address: string; symbol: string; name: string; logo: string;
  balance: string; usd_value: string; cost: string; realized_profit: string; unrealized_profit: string;
  avg_cost_price: string; roi: string; wallet_count: number; snapshot_at: number;
  /**
   * 仓位身份 `chain:token_address`，由后端给出。单仓位交易接口要求原样传回，
   * 所以这里保留字段而不是在前端按 `chain:token_address` 重拼 —— 重拼在今天的
   * 格式下等价，但格式属于后端，前端不该复制这份知识。
   */
  position_id?: string;
};
export type PlatformHoldings = {
  platform: string; user_id: string; chain: string; list: PlatformHolding[];
  open: PlatformHolding[]; closed: PlatformHolding[];
  realized_profit?: string; total_profit?: string; total_profit_ratio?: string;
  wallets: {chain: string; address: string; coverage: string; snapshot_at: number; stale: boolean}[];
  coverage: string; stale: boolean; mapping_version: string;
  pnl_windows: (SmartMoneyPnlWindow & {username?: string; avatar_url?: string; coverage?: string})[];
};

export async function getPlatformHoldings(platform: 'fomo' | 'pump', userID: string) {
  if (!userID.trim()) throw new Error('A platform user ID is required.');
  return (await call<PlatformHoldings>(`/v1/smartmoney/platforms/${platform}/users/${encodeURIComponent(userID)}/holdings?chain=all`, {preserveInt64Fields: ['mapping_version']})).data;
}
