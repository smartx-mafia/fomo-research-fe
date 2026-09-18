/**
 * FOMO/PUMP 用户级交易接口（后端 docs/contracts/smartmoney-detail.md §4）。
 *
 * 两个接口都只读后端已落库的账本，不触发上游采集；用户模式固定展开该用户的
 * 全部有效钱包，因此禁止传 `chain` / `address`，链筛选只能在展示层做。
 */
import {ApiError, call} from './envelope';

/**
 * `100110 BIZ_SMDETAIL_INVALID_PARAM`（smartmoney-detail.md §6）。
 *
 * 这个码在交易分页上有两种来源，**前端只能靠"这次请求带没带游标"区分**：
 * ① 参数本身非法（user_id 空、用户模式混传 chain）—— 重拉首页也会再失败；
 * ② 游标绑定的钱包集合 revision 已过期（后端目录映射变化）—— 正是契约要求
 *    前端"重拉首页"的那种，第一页一定能成功。
 * 所以调用方必须再叠一个"当前不在第一页"的条件，不能见到 100110 就重置。
 */
export function isTradeCursorStale(error: unknown): boolean {
  return error instanceof ApiError && error.code === 100110;
}

/** 用户聚合覆盖到的单个钱包状态；`coverage` 为 complete / partial / unknown。 */
export type WalletTradeStatus = {chain: string; address: string; coverage: string; truncated: boolean};

/** new-trades 的一行：逐腿事实，同一 `tx_hash` 或 `tx_hash+event_type` 可重复。 */
export type PlatformTrade = {
  tx_hash?: string; event_type?: string; occurred_at?: number;
  token_address?: string; token_symbol?: string; token_logo?: string;
  token_amount?: string; quote_amount?: string; quote_symbol?: string;
  cost_usd?: string; price_usd?: string; chain?: string; wallet_address?: string;
};

export type PlatformTrades = {
  subject_type: string; user_id: string; address: string;
  identity_revision?: string; fetched_at?: number;
  list?: PlatformTrade[]; next_cursor?: string; count?: number;
  wallets?: WalletTradeStatus[];
};

/** new-position-trades 的一行：腿已在同一钱包内按 `tx_hash+event_type` 合并。 */
export type PlatformPositionTrade = {
  tx_hash?: string; event_type?: string; occurred_at?: number;
  token_amount?: string; cost_usd?: string; price_usd?: string;
  quote_amount?: string; quote_symbol?: string;
  legs?: number; round?: number; round_open?: boolean; round_close?: boolean;
  chain?: string; wallet_address?: string;
};

export type PlatformPositionTrades = {
  subject_type: string; user_id: string; address: string;
  identity_revision?: string; position_id: string;
  list?: PlatformPositionTrade[]; coverage?: string;
  wallets?: WalletTradeStatus[]; count?: number;
};

/**
 * 用户级最近交易，固定每页 50 条。
 *
 * 游标绑定用户钱包集合的 revision：映射变化后旧游标会被拒（参数错误），
 * 调用方需要回到首页重拉，不能把失败页当空页。
 */
export async function getPlatformUserTrades(userID: string, cursor = '', signal?: AbortSignal) {
  if (!userID.trim()) throw new Error('A platform user ID is required.');
  const params = new URLSearchParams({subject_type: 'external_user', user_id: userID});
  if (cursor) params.set('cursor', cursor);
  return (await call<PlatformTrades>(`/v1/smartmoney/new-trades?${params}`, {signal})).data;
}

/**
 * 用户级单仓位交易历史，不分页。
 *
 * `positionID` 是持仓行原样回传的仓位身份 `chain:token_address`，不是链筛选；
 * 响应体随新成交增长，没有静默截断。
 */
export async function getPlatformUserPositionTrades(userID: string, positionID: string, signal?: AbortSignal) {
  if (!userID.trim()) throw new Error('A platform user ID is required.');
  if (!positionID.trim()) throw new Error('A position ID is required.');
  const params = new URLSearchParams({subject_type: 'external_user', user_id: userID, position_id: positionID});
  return (await call<PlatformPositionTrades>(`/v1/smartmoney/new-position-trades?${params}`, {signal})).data;
}
