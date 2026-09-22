import {call} from './envelope';
import type {LeaderboardIdentity, LeaderboardSourceTag} from './leaderboard-new';

export type FollowingNewQuery = {
  window: string;
  dimension: string;
  limit?: number;
  cursor?: string;
};

export type FollowingNewEntry = {
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
  followed_at?: {seconds: number; nanos?: number};
  remark?: string;
};

export type FollowingNewReply = FollowingNewQuery & {
  updated_at: number;
  count: number;
  total: number;
  list: FollowingNewEntry[];
  next_cursor: string;
  stale: boolean;
};

export async function getFollowingNew(bearer: string, query: FollowingNewQuery) {
  const params = new URLSearchParams({
    window: query.window,
    dimension: query.dimension,
    limit: String(query.limit ?? 20),
    cursor: query.cursor ?? '',
  });
  return (await call<FollowingNewReply>(`/v1/social/following-new?${params}`, {bearer})).data;
}
