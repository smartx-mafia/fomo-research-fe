import {getUnifiedLeaderboardMeta, type UnifiedLeaderboardMeta} from '@/api/leaderboard-new';
import {BUSINESS_API_BASE} from '@/config';
import {withRequestDeadline} from './request-deadline';

export const LEADERBOARD_META_TTL_MS = 300_000;
export const LEADERBOARD_META_KEY = [BUSINESS_API_BASE, 'leaderboard-new-meta-v1'] as const;
const storageKey = `smartx.leaderboard-meta.v1:${BUSINESS_API_BASE}`;
let inFlight: Promise<UnifiedLeaderboardMeta> | undefined;

// Only public, successfully fetched filter options are persisted. Never board
// results, account information or tokens. Expiry and API origin are mandatory.
export function readLeaderboardMeta(): UnifiedLeaderboardMeta | undefined {
  if (typeof window === 'undefined') return;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (typeof saved?.at !== 'number') return;
    const age = Date.now() - saved?.at;
    const value = saved?.data;
    if (!Number.isFinite(age) || age < 0 || age >= LEADERBOARD_META_TTL_MS) return;
    if (!Array.isArray(value?.windows) || !value.windows.length
      || !value.windows.every((v: unknown) => ['1d', '7d', '30d', 'all'].includes(v as string))
      || !Array.isArray(value.dimensions) || !value.dimensions.length
      || !value.dimensions.every((v: unknown) => ['ALL', 'SmartX', 'Global'].includes(v as string))) return;
    return {windows: value.windows, dimensions: value.dimensions};
  } catch {return;}
}

export function loadLeaderboardMeta(force = false): Promise<UnifiedLeaderboardMeta> {
  if (!force) {
    const cached = readLeaderboardMeta();
    if (cached) return Promise.resolve(cached);
  }
  if (inFlight) return inFlight;
  const request = withRequestDeadline((signal) => getUnifiedLeaderboardMeta(signal)).then((data) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({at: Date.now(), data: {windows: data.windows, dimensions: data.dimensions}}));
    } catch { /* Storage is optional; a valid response remains usable. */ }
    return data;
  }).finally(() => {if (inFlight === request) inFlight = undefined;});
  inFlight = request;
  return request;
}
