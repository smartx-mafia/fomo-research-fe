import {call} from './envelope';

export type LeaderboardMeta = {chains: string[]; windows: string[]; metrics: string[]};
export type LeaderboardQuery = {chain: string; window: string; metric: string};
export type LeaderboardEntry = {
  chain: string;
  rank: number; address: string; total_profit?: string; realized_profit?: string;
  unrealized_profit?: string; total_cost?: string; metric_value?: string;
  buy?: number; sell?: number; snapshot_at?: string;
};
export type LeaderboardReply = LeaderboardQuery & {updated_at?: string; count: number; list: LeaderboardEntry[]};

export async function getLeaderboardMeta(signal?: AbortSignal): Promise<LeaderboardMeta> {
  const response = await call<LeaderboardMeta>('/v1/leaderboard/meta', {signal});
  return {chains: response.data.chains ?? [], windows: response.data.windows ?? [], metrics: response.data.metrics ?? []};
}

export async function getLeaderboard(query: LeaderboardQuery, signal?: AbortSignal): Promise<LeaderboardReply> {
  const params = new URLSearchParams(query);
  const response = await call<LeaderboardReply>(`/v1/leaderboard?${params}`, {signal});
  const list = (response.data.list ?? []).map((entry) => {
    const chain = entry.chain || (query.chain !== 'all' ? query.chain : undefined);
    if (!chain || chain === 'all') throw new Error('Leaderboard returned a wallet without its chain.');
    return {...entry, chain};
  });
  return {...response.data, list, count: response.data.count ?? 0};
}
