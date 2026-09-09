'use client';

import {useEffect, useState, useSyncExternalStore} from 'react';
import useSWR from 'swr';
import {fetchTokenOverview, MarketApiError} from '@/lib/market';
import {createOverviewRequests} from '@/lib/overview-requests';
import {overviewIdentity, overviewPollDelay} from '@/lib/token-overview';

const requests = createOverviewRequests(fetchTokenOverview);
// Keep the function identity stable: the local 1s clock must not reset SWR's poll timer.
const refreshInterval = () => overviewPollDelay();
const isVisible = () => document.visibilityState === 'visible';
const isServerVisible = () => false;
const subscribeVisibility = (change: () => void) => {
  document.addEventListener('visibilitychange', change);
  return () => document.removeEventListener('visibilitychange', change);
};

function mayRetry(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') return false;
  return !(error instanceof MarketApiError) || [420000, 500301, 500097].includes(error.code);
}

export function useTokenOverview(chain: string, address: string) {
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, isServerVisible);
  const identity = overviewIdentity(chain, address);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!visible) return;
    return requests.retain(identity.chain, identity.address);
  }, [identity.chain, identity.address, visible]);

  const result = useSWR(
    visible ? ['token-overview', identity.chain, identity.address] : null,
    ([, requestedChain, requestedAddress]) => requests.run(requestedChain, requestedAddress),
    {
      keepPreviousData: false,
      dedupingInterval: 2_000,
      refreshInterval,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  const {error, isValidating, mutate} = result;
  useEffect(() => {
    if (!visible || !error || !mayRetry(error) || isValidating) return;
    // SWR polling skips errored keys. Resume transient failures at a lower rate,
    // with one cancellable timer only while this Overview is mounted and visible.
    const timer = window.setTimeout(() => {void mutate();}, 60_000 + Math.floor(Math.random() * 6_000));
    return () => window.clearTimeout(timer);
  }, [visible, error, isValidating, mutate]);

  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    // A local clock only, not a network poll. Stale values must expire during outages.
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [visible]);

  return {...result, now: visible ? Math.max(now, Date.now()) : now};
}
