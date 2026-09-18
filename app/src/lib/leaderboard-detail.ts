import type {UnifiedLeaderboardEntry} from '@/api/leaderboard-new';

export type LeaderboardDetailTarget =
  | {type: 'external_user'; id: string; platform: 'fomo' | 'pump'}
  | {type: 'wallet'; address: string; namespace: string; chains: string[]}
  | {type: 'smartx_user'; id: string};

export function leaderboardDetailHref(entry: UnifiedLeaderboardEntry) {
  const {identity} = entry;
  const query = new URLSearchParams({type: identity.type});
  if (identity.type === 'wallet') {
    query.set('address', identity.address);
    query.set('namespace', identity.namespace);
    entry.chains.filter((chain) => chain && chain !== 'all').forEach((chain) => query.append('chain', chain));
  } else {
    query.set('id', identity.id);
    if (identity.type === 'external_user') {
      const platforms = entry.platforms.map((platform) => platform.toLowerCase());
      const platform = platforms.includes('fomo') ? 'fomo' : platforms.includes('pump') ? 'pump' : undefined;
      if (!platform) return undefined;
      query.set('platform', platform);
    }
  }
  return `/leaderboard/detail?${query}`;
}

export function parseLeaderboardDetail(query: URLSearchParams): LeaderboardDetailTarget | null {
  const type = query.get('type');
  const id = query.get('id');
  if (type === 'smartx_user' && id?.trim()) return {type, id};
  const platform = query.get('platform');
  if (type === 'external_user' && id?.trim() && (platform === 'fomo' || platform === 'pump')) return {type, id, platform};
  const address = query.get('address');
  const namespace = query.get('namespace');
  const chains = [...new Set(query.getAll('chain').filter((chain) => chain.trim() && chain !== 'all'))];
  if (type === 'wallet' && address?.trim() && namespace?.trim() && chains.length) return {type, address, namespace, chains};
  return null;
}
