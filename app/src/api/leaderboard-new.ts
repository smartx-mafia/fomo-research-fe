import {call} from './envelope';

export type UnifiedLeaderboardQuery = {window: string; dimension: string};
export type UnifiedLeaderboardMeta = {windows: string[]; dimensions: string[]};
export type LeaderboardIdentity =
  | {type: 'smartx_user' | 'external_user'; id: string; namespace?: string; address?: string}
  | {type: 'wallet'; id?: string; namespace: string; address: string};
export type LeaderboardSourceTag = {code: string; logo_url: string};
export type UnifiedLeaderboardEntry = {
  rank: number;
  identity: LeaderboardIdentity;
  profile: {display_name: string; username: string; avatar_url: string; x_handle: string};
  platforms: string[];
  source_tags?: LeaderboardSourceTag[];
  dimension: string;
  pnl_basis: string;
  total_profit_usd: string;
  snapshot_at: number;
  chains: string[];
  identity_revision: string;
};
export type UnifiedLeaderboardReply = UnifiedLeaderboardQuery & {
  updated_at: number; count: number; list: UnifiedLeaderboardEntry[]; stale: boolean;
  /** 当前登录用户在该榜的名次；未登录或未上榜为 0（Optional 档，带 bearer 才有值）。 */
  viewer_rank?: number;
  /** 当前登录用户的窗口盈亏（USD 十进制字符串）；空串表示不可用。 */
  viewer_profit_usd?: string;
  /** 本期参与排名的总人数，可能大于 count（count 上限 100）。目前仅 SmartX 维度返回非零。 */
  participant_count?: number;
};

export function leaderboardIdentityKey(identity: LeaderboardIdentity) {
  return JSON.stringify(identity.type === 'wallet' ? [identity.type, identity.namespace, identity.address] : [identity.type, identity.id]);
}

export async function getUnifiedLeaderboardMeta() {
  return (await call<UnifiedLeaderboardMeta>('/v1/leaderboard-new/meta')).data;
}

export async function getUnifiedLeaderboard({window, dimension}: UnifiedLeaderboardQuery, bearer?: string) {
  // Explicitly whitelist parameters: the new API rejects legacy filters and pagination.
  const params = new URLSearchParams({window, dimension});
  return (await call<UnifiedLeaderboardReply>(`/v1/leaderboard-new?${params}`, bearer ? {bearer} : undefined)).data;
}
