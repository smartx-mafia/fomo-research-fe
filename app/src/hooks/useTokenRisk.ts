'use client';

import {useCallback} from 'react';
import useSWR, {useSWRConfig} from 'swr';
import {getTokenRisk, type GetRiskReply} from '@/api/token-risk';
import {normalizeTokenRef} from '@/api/token-metadata';

type RiskSnapshot = GetRiskReply & {refreshError?: unknown};

/** Shared anonymous cache for banner and trading surfaces. Errors retain the last snapshot. */
export function useTokenRisk(chain: string, address: string) {
  const ref = normalizeTokenRef(chain, address);
  const normalizedChain = ref?.chain ?? chain;
  const normalizedAddress = ref?.address ?? address;
  const {mutate} = useSWRConfig();
  const {data, error, isLoading} = useSWR<RiskSnapshot>(
    ['token-risk', normalizedChain, normalizedAddress],
    () => getTokenRisk(normalizedChain, normalizedAddress),
    {refreshInterval: 30_000, shouldRetryOnError: false, keepPreviousData: false},
  );
  const refresh = useCallback(async (signal?: AbortSignal) => {
    // Return THIS validated RPC result. React/SWR state may still contain the previous render.
    const request = getTokenRisk(normalizedChain, normalizedAddress, undefined, signal);
    // Capture the identity before awaiting. SWR's bound mutate follows a hook's
    // CURRENT key after navigation, which would publish a late A response to B.
    // Register the promise now so SWR also rejects out-of-order publications.
    const publication = mutate<RiskSnapshot>(['token-risk', normalizedChain, normalizedAddress], async (current) => {
      try { return await request; }
      catch (refreshError) {
        // SWR mutations do not publish failures as the shared query error. Keep
        // the snapshot AND an error marker for legacy-deadline display fallback.
        return current ? {...current, refreshError} : undefined;
      }
    }, {revalidate: false});
    const [reply] = await Promise.all([request, publication]);
    return reply;
  }, [mutate, normalizedAddress, normalizedChain]);
  return {risk: data?.risk.assessment, error: data?.refreshError ?? error, isLoading, refresh};
}
