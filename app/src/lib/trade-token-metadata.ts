import {normalizeTokenRef, tokenKey} from '@/api/token-metadata';

export type TradeTokenMetadata = {
  chain: string; address: string; name?: string; symbol?: string; logo?: string;
  refresh_state: 'ready' | 'pending' | 'partial' | 'not_found' | 'unavailable';
  retry_after_ms?: number | string;
};

export function overlayTradeMetadata<T extends {chain?: string; token_address?: string; token_name?: string; token_symbol?: string; token_logo?: string}>(
  rows: T[], metadata: TradeTokenMetadata[] = [],
): T[] {
  const byKey = new Map(metadata.flatMap((item) => {
    const ref = normalizeTokenRef(item.chain, item.address);
    return ref ? [[tokenKey(ref.chain, ref.address), item] as const] : [];
  }));
  return rows.map((row) => {
    const item = byKey.get(tokenKey(row.chain ?? '', row.token_address ?? ''));
    if (!item) return row;
    return {...row, token_name: item.name || row.token_name, token_symbol: item.symbol || row.token_symbol,
      // An explicit empty logo may be a moderation decision; never resurrect it.
      token_logo: item.logo === undefined ? row.token_logo : item.logo};
  });
}

// A fixed caller-owned start time prevents repeated partial replies renewing the budget.
export function metadataRetryMs(metadata: TradeTokenMetadata[] | undefined, startedAt: number, now: number): number {
  if (now - startedAt >= 30_000) return 0;
  const pending = metadata?.filter((row) => row.refresh_state === 'pending') ?? [];
  if (!pending.length) return 0;
  const delay = Math.max(2_000, Math.min(...pending.map((row) => {
    const value = Number(row.retry_after_ms);
    return Number.isFinite(value) && value > 0 ? value : 2_000;
  })));
  return now + delay <= startedAt + 30_000 ? delay : 0;
}
