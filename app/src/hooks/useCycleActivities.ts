'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {ApiError} from '@/api/envelope';
import {getUserPortfolioPosition, type UserPortfolioPosition} from '@/api/user-portfolio';
import type {PortfolioCycleScope} from '@/api/portfolio';
import {clearSite, readSite} from '@/session/storage';

export function useCycleActivities(identifier: string, scope: PortfolioCycleScope, bearer?: string, refreshKey?: unknown) {
  const [data, setData] = useState<UserPortfolioPosition>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const active = useRef<AbortController | undefined>(undefined);
  const current = useRef<UserPortfolioPosition | undefined>(undefined);
  const failedCursor = useRef<string | undefined>(undefined);
  const load = useCallback(async (cursor?: string) => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setLoading(true); setError(undefined); failedCursor.current = cursor;
    let append = !!cursor;
    try {
      let page: UserPortfolioPosition;
      try {
        page = await getUserPortfolioPosition(identifier, scope, bearer, controller.signal, {cursor});
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.code !== 430122 || !cursor || controller.signal.aborted) throw cause;
        // A changed history snapshot invalidates every previously loaded page. Retry only once.
        current.current = undefined; setData(undefined); failedCursor.current = undefined;
        append = false;
        page = await getUserPortfolioPosition(identifier, scope, bearer, controller.signal);
      }
      if (controller.signal.aborted) return;
      if (page.activities_status === 'complete') {
        const seen = new Set<string>();
        page = {...page, activities: [...(append ? current.current?.activities ?? [] : []), ...(page.activities ?? [])].filter(row => {
          if (seen.has(row.record_id)) return false;
          seen.add(row.record_id); return true;
        })};
      }
      current.current = page; setData(page);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (bearer && cause instanceof ApiError && cause.code === 400000 && readSite()?.jwt === bearer) clearSite();
      setError(cause instanceof Error ? cause : new Error('Could not load cycle activity.'));
    } finally {if (!controller.signal.aborted) setLoading(false);}
  }, [identifier, scope.chain, scope.asset, scope.cycle_key, bearer]); // Scope identity determines the request.
  useEffect(() => {void load(); return () => active.current?.abort();}, [load, refreshKey]);
  return {data, error, isLoading: loading && !data, isValidating: loading,
    reset: () => void load(), retry: () => void load(failedCursor.current),
    more: () => {if (!loading && current.current?.next_activity_cursor) void load(current.current.next_activity_cursor);}};
}
