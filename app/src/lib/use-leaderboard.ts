'use client';

import {useCallback, useEffect, useMemo, useState} from 'react';
import useSWR from 'swr';
import {getUnifiedLeaderboard, type UnifiedLeaderboardQuery} from '@/api/leaderboard-new';
import {BUSINESS_API_BASE} from '@/config';
import {useSession, type SiteSession} from '@/session/storage';
import {createLeaderboardRequests} from './leaderboard-requests';
import {LEADERBOARD_META_KEY, LEADERBOARD_META_TTL_MS, loadLeaderboardMeta, readLeaderboardMeta} from './leaderboard-meta';

const requests = createLeaderboardRequests();
const scopes = new WeakMap<SiteSession, string>();
let nextScope = 0;
function sessionScope(session: SiteSession | null) {
  if (!session) return 'anonymous';
  let scope = scopes.get(session);
  if (!scope) {scope = `session-${++nextScope}`; scopes.set(session, scope);}
  return scope;
}

// Remount the SWR consumer when identity changes so its previous-data buffer
// cannot carry private rows from another account. Filter state stays outside.
export function useLeaderboardScope() {return sessionScope(useSession());}

export function useLeaderboard(selection: UnifiedLeaderboardQuery) {
  const session = useSession();
  const scope = sessionScope(session);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const update = () => setActive(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  // Read browser storage only after hydration. A fresh public options cache
  // removes the meta network waterfall; a truly cold visit still validates it.
  const cachedMeta = useMemo(() => active ? readLeaderboardMeta() : undefined, [active]);
  const meta = useSWR(active ? LEADERBOARD_META_KEY : null, () => loadLeaderboardMeta(true), {
    fallbackData: cachedMeta, revalidateOnMount: !cachedMeta,
    shouldRetryOnError: false, revalidateOnFocus: false, revalidateOnReconnect: false, dedupingInterval: LEADERBOARD_META_TTL_MS,
  });
  // Resolve unavailable defaults before issuing any request (e.g. meta only exposes all).
  const window = meta.data?.windows.includes(selection.window) ? selection.window : meta.data?.windows[0];
  const dimension = meta.data?.dimensions.includes(selection.dimension) ? selection.dimension : meta.data?.dimensions[0];
  const key = active && window && dimension
    ? JSON.stringify([BUSINESS_API_BASE, 'leaderboard-new-v1', scope, window, dimension, 'total_profit']) : null;
  const board = useSWR(key, () => requests.run(key!, (signal) => getUnifiedLeaderboard({window: window!, dimension: dimension!}, session?.jwt, signal)), {
    // The effect below owns activation, selection, focus and reconnect reads.
    revalidateOnMount: false, revalidateIfStale: false, revalidateOnFocus: false,
    revalidateOnReconnect: false, shouldRetryOnError: false, dedupingInterval: 0, keepPreviousData: true,
  });
  const {mutate} = board;
  const refresh = useCallback(() => {
    if (key) void mutate().catch(() => {});
  }, [key, mutate]);
  useEffect(() => {
    if (!key) return;
    const release = requests.retain(key);
    refresh();
    const onWake = () => {if (document.visibilityState !== 'hidden') refresh();};
    globalThis.addEventListener('focus', onWake);
    globalThis.addEventListener('online', onWake);
    return () => {
      globalThis.removeEventListener('focus', onWake);
      globalThis.removeEventListener('online', onWake);
      release();
    };
  }, [key, refresh]);
  const error = board.error instanceof Error && board.error.name === 'AbortError' ? undefined : board.error;
  return {meta, board: {...board, error}, refresh, window, dimension, authenticated: !!session};
}
