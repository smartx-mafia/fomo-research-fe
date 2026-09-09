'use client';

import {useEffect, useRef, useState} from 'react';
import type {SquareFeedItem} from '@/api/social-content';
import {collectSquareTokens, createSquareTokenLoader, type SquareTokenRef} from '@/lib/square-token-data';
import type {TokenMarket} from '@/lib/types';

export function useSquareTokenData(items: SquareFeedItem[]) {
  const loader = useRef<ReturnType<typeof createSquareTokenLoader> | null>(null);
  if (!loader.current) loader.current = createSquareTokenLoader();
  const [data, setData] = useState<Record<string, TokenMarket>>({});
  // Likes, time ticks and duplicate opinions do not change this request key.
  const signature = JSON.stringify(collectSquareTokens(items));
  useEffect(() => {
    const controller = new AbortController();
    const refs: SquareTokenRef[] = JSON.parse(signature);
    let loading = false;
    const refresh = async () => {
      if (loading || controller.signal.aborted || document.visibilityState !== 'visible') return;
      loading = true;
      try {
        const result = await loader.current!(refs, controller.signal);
        if (!controller.signal.aborted) setData(result);
      } finally {
        loading = false;
      }
    };
    void refresh();
    // Expired/missing entries can recover without changing lanes; successful entries
    // still use their five-minute cache. Hidden pages do not start new batches.
    const timer = refs.length ? window.setInterval(() => void refresh(), 60_000) : undefined;
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [signature]);
  return data;
}
