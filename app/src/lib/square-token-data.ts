import type {SquareFeedItem} from '@/api/social-content';
import {fetchTokenMarket} from './market';
import type {Chain, TokenMarket} from './types';

export type SquareTokenRef = {chain: Chain; address: string};
const CHAIN_IDS: Record<string, Chain> = {
  '1': 'ethereum', '56': 'bsc', '8453': 'base', '4663': 'robinhood', '792703809': 'solana',
};
export function squareTokenKey(ref: {chain: string; address: string}): string {
  return `${ref.chain}:${ref.chain === 'solana' ? ref.address : ref.address.toLowerCase()}`;
}
export function squareTokenRef(targetID: string): SquareTokenRef | undefined {
  const parts = targetID.split(':');
  if (parts.length !== 4) return;
  const [chainID, kind, address, cycle] = parts;
  const chain = CHAIN_IDS[chainID];
  if (!chain || kind !== (chain === 'solana' ? 'spl' : 'erc20') || !/^[1-9]\d*$/.test(cycle)) return;
  if (chain === 'solana' ? !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) : !/^0x[0-9a-fA-F]{40}$/.test(address)) return;
  return {chain, address: chain === 'solana' ? address : address.toLowerCase()};
}
export function collectSquareTokens(items: SquareFeedItem[]): SquareTokenRef[] {
  const refs = new Map<string, SquareTokenRef>();
  for (const item of items) {
    const ref = squareTokenRef(item.content.opinion.targetID);
    if (ref) refs.set(squareTokenKey(ref), ref);
  }
  return [...refs.values()].sort((a, b) => squareTokenKey(a).localeCompare(squareTokenKey(b)));
}

type TokenFetcher = (chain: string, address: string, revalidate?: number, signal?: AbortSignal) => Promise<TokenMarket>;
/** Public API has no multi-address market endpoint. Batch at the list boundary,
 * then use at most four existing HTTP reads concurrently, never a per-card effect.
 * Cache is owned by the mounted feed, shared by lanes/pages but not persisted. */
export function createSquareTokenLoader(fetcher: TokenFetcher = fetchTokenMarket, now = Date.now) {
  const cache = new Map<string, {expires: number; data?: TokenMarket}>();
  return async (refs: SquareTokenRef[], signal: AbortSignal): Promise<Record<string, TokenMarket>> => {
    const result: Record<string, TokenMarket> = {};
    const pending: SquareTokenRef[] = [];
    for (const ref of new Map(refs.map(ref => [squareTokenKey(ref), ref])).values()) {
      const cached = cache.get(squareTokenKey(ref));
      if (cached && cached.expires > now()) {
        if (cached.data) result[squareTokenKey(ref)] = cached.data;
      } else pending.push(ref);
    }
    let index = 0;
    await Promise.all(Array.from({length: Math.min(4, pending.length)}, async () => {
      while (!signal.aborted && index < pending.length) {
        const ref = pending[index++];
        const key = squareTokenKey(ref);
        let data: TokenMarket | undefined;
        try {
          const response = await fetcher(ref.chain, ref.address, 5, signal);
          if (response.chain === ref.chain && squareTokenKey(response) === key) data = response;
        } catch {
          // Optional display data: one missing token must not blank the feed.
        }
        if (signal.aborted) return;
        cache.delete(key);
        cache.set(key, {expires: now() + (data ? 300_000 : 30_000), data});
        if (data) result[key] = data;
        if (cache.size > 512) cache.delete(cache.keys().next().value!);
      }
    }));
    return result;
  };
}
