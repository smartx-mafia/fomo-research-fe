import {call} from './envelope';
import type {SmartMoneyAccounting} from './smartmoney-accounting';
import {isExternalSubjectId} from '@/lib/smartmoney-identity';

export type UnifiedLeaderboardWindow = '1d' | '7d' | '30d' | 'all';
export type UnifiedLeaderboardDimension = 'ALL' | 'SmartX' | 'Global';
export type UnifiedLeaderboardQuery = {window: UnifiedLeaderboardWindow; dimension: UnifiedLeaderboardDimension};
export type UnifiedLeaderboardIdentity =
  | {type: 'smartx_user'; id: string; user_type: 1; namespace?: ''; address?: ''}
  | {type: 'external_user'; id: `subject:${string}`; user_type: 2; namespace?: ''; address?: ''}
  | {type: 'wallet'; id?: ''; user_type: 2; namespace: 'evm' | 'solana'; address: string};

export type UnifiedLeaderboardEntry = {
  rank: number;
  cohort_rank?: number;
  ranking_basis_id?: string;
  accounting?: SmartMoneyAccounting;
  identity: UnifiedLeaderboardIdentity;
  profile: {display_name?: string; username?: string; avatar_url?: string; x_handle?: string};
  platforms: string[];
  source_tags?: {code: string; logo_url?: string}[];
  dimension: 'SmartX' | 'Global';
  viewer?: {state: 'anonymous' | 'available' | 'unavailable'; following: boolean; remark: string};
  pnl_basis: string;
  total_profit_usd: string;
  snapshot_at: number | string;
  chains: string[];
  identity_revision: string;
};

export type UnifiedLeaderboardMeta = {windows: UnifiedLeaderboardWindow[]; dimensions: UnifiedLeaderboardDimension[]};
export type UnifiedLeaderboardReply = {
  window: UnifiedLeaderboardWindow;
  dimension: UnifiedLeaderboardDimension;
  pnl_metric?: 'total_profit';
  viewer_rank?: number;
  viewer_profit_usd?: string;
  participant_count?: number;
  updated_at: number | string;
  stale: boolean;
  count: number;
  list: UnifiedLeaderboardEntry[];
};

const windows = new Set<UnifiedLeaderboardWindow>(['1d', '7d', '30d', 'all']);

function validateMeta(value: UnifiedLeaderboardMeta): UnifiedLeaderboardMeta {
  if (!Array.isArray(value.windows) || !Array.isArray(value.dimensions)) {
    throw new Error('Unified leaderboard metadata is invalid.');
  }
  const result = {...value, windows: value.windows.filter((window) => windows.has(window)), dimensions: value.dimensions.filter((dimension) => ['ALL', 'SmartX', 'Global'].includes(dimension))};
  if (!result.windows.length || !result.dimensions.length) throw new Error('Unified leaderboard metadata has no supported filters.');
  return result;
}

function validateIdentity(identity: UnifiedLeaderboardIdentity): void {
  if (identity?.type === 'smartx_user' && identity.user_type === 1 && identity.id && !identity.namespace && !identity.address) return;
  if (!identity || identity.user_type !== 2) throw new Error('Unified Global leaderboard returned an invalid identity user_type.');
  if (identity.type === 'external_user') {
    if (!isExternalSubjectId(identity.id) || identity.namespace || identity.address) throw new Error('Unified leaderboard returned an invalid external subject id.');
    return;
  }
  if (identity.type === 'wallet' && !identity.id && identity.address && ['evm', 'solana'].includes(identity.namespace)) return;
  throw new Error('Unified Global leaderboard returned an unsupported identity.');
}

export async function getUnifiedLeaderboardMeta(signal?: AbortSignal): Promise<UnifiedLeaderboardMeta> {
  const response = await call<UnifiedLeaderboardMeta>('/v1/leaderboard-new/meta', {signal});
  return validateMeta(response.data);
}

export async function getUnifiedLeaderboard(query: UnifiedLeaderboardQuery, bearer?: string, signal?: AbortSignal): Promise<UnifiedLeaderboardReply> {
  const params = new URLSearchParams(query);
  const response = await call<UnifiedLeaderboardReply>(`/v1/leaderboard-new?${params}`, {
    signal,
    bearer,
    preserveInt64Fields: ['updated_at', 'snapshot_at'],
  });
  const data = response.data;
  if (data.window !== query.window || data.dimension !== query.dimension || (data.pnl_metric && data.pnl_metric !== 'total_profit') || !Array.isArray(data.list)) throw new Error('Unified leaderboard returned an invalid response.');
  const list = data.list.map((entry) => {
    validateIdentity(entry.identity);
    const dimension = entry.identity.type === 'smartx_user' ? 'SmartX' : 'Global';
    if (entry.dimension !== dimension || (query.dimension !== 'ALL' && entry.dimension !== query.dimension)) throw new Error('Unified leaderboard returned a row outside its dimension.');
    if (typeof entry.total_profit_usd !== 'string' || !/^-?\d+(\.\d+)?$/.test(entry.total_profit_usd)) throw new Error('Unified leaderboard returned a non-decimal PnL value.');
    return {...entry, profile: entry.profile ?? {}, platforms: entry.platforms ?? [], chains: entry.chains ?? [], source_tags: entry.source_tags ?? []};
  });
  return {...data, list, count: data.count ?? list.length};
}
