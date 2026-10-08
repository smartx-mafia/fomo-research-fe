import {call} from './envelope';
import {assertProviderSnapshotMeta, type SourceMeta, type FomoAccounting} from './smartmoney-source';
import {isExternalSubjectId} from '@/lib/smartmoney-identity';

export type UnifiedLeaderboardWindow = '1d' | '7d' | '30d' | 'all';
export type UnifiedLeaderboardIdentity =
  | {type: 'external_user'; id: `subject:${string}`; user_type: 2; namespace?: ''; address?: ''}
  | {type: 'wallet'; id?: ''; user_type: 2; namespace: 'evm' | 'solana'; address: string};

export type UnifiedLeaderboardEntry = {
  rank: number;
  accounting?: FomoAccounting;
  ranking_basis_id?: string; ranking_eligible?: boolean; ranking_reason?: string; cohort_rank?: number;
  identity: UnifiedLeaderboardIdentity;
  profile: {display_name?: string; username?: string; avatar_url?: string; x_handle?: string};
  platforms: string[];
  source_tags?: {code: string; logo_url?: string}[];
  dimension: 'Global';
  pnl_basis: string;
  total_profit_usd: string;
  snapshot_at: number | string;
  chains: string[];
  identity_revision: string;
};

export type UnifiedLeaderboardMeta = {windows: UnifiedLeaderboardWindow[]; dimensions: string[]};
export type UnifiedLeaderboardReply = {
  window: UnifiedLeaderboardWindow;
  dimension: 'Global';
  updated_at: number | string;
  stale: boolean;
  count: number;
  list: UnifiedLeaderboardEntry[];
  ranking_cohorts?: {basis_id: string; count: number; ranking_eligible: boolean; reason?: string}[];
  meta: SourceMeta;
};

const windows = new Set<UnifiedLeaderboardWindow>(['1d', '7d', '30d', 'all']);

function validateMeta(value: UnifiedLeaderboardMeta): UnifiedLeaderboardMeta {
  if (!Array.isArray(value.windows) || !Array.isArray(value.dimensions) || !value.dimensions.includes('Global')) {
    throw new Error('Unified leaderboard metadata is invalid.');
  }
  return {...value, windows: value.windows.filter((window): window is UnifiedLeaderboardWindow => windows.has(window))};
}

function validateIdentity(identity: UnifiedLeaderboardIdentity): void {
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

export async function getUnifiedLeaderboard(window: UnifiedLeaderboardWindow, bearer?: string, signal?: AbortSignal): Promise<UnifiedLeaderboardReply> {
  const params = new URLSearchParams({window, dimension: 'Global'});
  const response = await call<{meta: SourceMeta; snapshot: Omit<UnifiedLeaderboardReply, 'meta'>}>(`/v2/smartmoney/leaderboard?${params}`, {
    signal,
    bearer,
    preserveInt64Fields: ['updated_at', 'snapshot_at'],
  });
  assertProviderSnapshotMeta(response.data.meta);
  if (response.data.meta.coverage !== 'ranked_selection') throw new Error('Unified Global leaderboard lacks ranked-selection coverage.');
  const data = response.data.snapshot;
  if (data.window !== window || data.dimension !== 'Global' || !Array.isArray(data.list)) throw new Error('Unified Global leaderboard returned an invalid response.');
  const list = data.list.map((entry) => {
    validateIdentity(entry.identity);
    if (entry.dimension !== 'Global') throw new Error('Unified Global leaderboard returned a row outside Global.');
    if (typeof entry.total_profit_usd !== 'string') throw new Error('Unified leaderboard returned a non-decimal PnL value.');
    return {...entry, profile: entry.profile ?? {}, platforms: entry.platforms ?? [], chains: entry.chains ?? [], source_tags: entry.source_tags ?? []};
  });
  return {...data, meta: response.data.meta, list, count: data.count ?? list.length};
}
