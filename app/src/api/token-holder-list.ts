import {call} from './envelope';
import {parseExactDecimal} from '@/lib/exact-decimal';
import {normalizeActor, actorKey, type ActorView, type ActorIdentity} from './actor';

export type HolderSource = 'all' | 'smartx' | 'smart_money' | 'onchain';
export type HolderScope = 'all' | 'following';
export type HolderIdentity = ActorIdentity;
export type TokenHolder = ActorView & {
  key: string;
  basis: 'onchain' | 'platform_ledger' | 'external_snapshot';
  balance?: string;
  valueUSD?: string;
  costUSD?: string;
  pnlPercent?: string;
  walletAddress?: string;
  freshness?: string;
  coverage?: string;
};
export type TokenHolderPage = {items: TokenHolder[]; total: number; totalIsExact: boolean; nextCursor?: string; coverage: string[]};
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const string = (v: unknown): string | undefined => typeof v === 'string' && v !== '' ? v : undefined;
function strings(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new TypeError('Invalid holder string list');
  return v;
}
function decimal(v: unknown): string | undefined {
  if (v === '' || v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new TypeError('Holder amounts must be exact strings');
  parseExactDecimal(v);
  return v;
}
export function holderKey(id: HolderIdentity): string {
  return actorKey(id);
}
export function normalizeHolder(value: unknown): TokenHolder {
  const row = record(value), position = record(row.position);
  const actor = normalizeActor(value);
  if (!['onchain', 'platform_ledger', 'external_snapshot'].includes(String(position.basis))) throw new TypeError('Missing holder position basis');
  return {
    ...actor, key: holderKey(actor.identity),
    basis: position.basis as TokenHolder['basis'], balance: decimal(position.balance), valueUSD: decimal(position.value_usd),
    costUSD: decimal(position.cost_usd), pnlPercent: decimal(position.pnl_percent),
    freshness: string(row.freshness), coverage: string(row.coverage),
  };
}
export function normalizeHolderPage(value: unknown): TokenHolderPage {
  const row = record(value);
  if (!Array.isArray(row.items)) throw new TypeError('Missing holder list');
  const total = typeof row.total === 'string' && /^\d+$/.test(row.total) ? Number(row.total) : row.total;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) throw new TypeError('Invalid holder count');
  return {items: row.items.map((value) => {
    const item = record(value), holder = normalizeHolder(item.holder);
    if (holder.basis === 'onchain') {
      const address = string(item.wallet_address);
      if (!address) throw new TypeError('On-chain holder needs its wallet row key');
      return {...holder, walletAddress: address, key: `onchain:${address.startsWith('0x') ? address.toLowerCase() : address}`};
    }
    return holder;
  }), total, totalIsExact: row.total_is_exact === true, nextCursor: string(row.next_cursor), coverage: strings(row.coverage)};
}
export async function fetchHolderList(chain: string, address: string, options: {source: HolderSource; scope: HolderScope; bearer?: string; cursor?: string; signal?: AbortSignal}): Promise<TokenHolderPage> {
  if (options.scope === 'following' && !options.bearer) throw new Error('Following holders requires sign in');
  const query = new URLSearchParams({source: options.source, scope: options.scope, limit: '20'});
  if (options.cursor) query.set('cursor', options.cursor);
  const result = await call<unknown>(`/v1/tokens/${encodeURIComponent(chain)}/${encodeURIComponent(address)}/holders?${query}`, {bearer: options.bearer, signal: options.signal});
  const row = record(result.data);
  // An old server may silently ignore new query parameters. Never present that
  // onchain slice as the user's complete followed or platform holder list.
  if (row.source !== options.source || row.scope !== options.scope) throw new TypeError('Holder source was not applied by the server');
  return normalizeHolderPage(row);
}
export async function fetchFollowedHolderList(bearer: string, chain: string, address: string, cursor?: string): Promise<TokenHolderPage> {
  const query = new URLSearchParams({chain, address, limit: '20'});
  if (cursor) query.set('cursor', cursor);
  const result = await call<unknown>(`/v1/social/token-follow-holders?${query}`, {bearer});
  return normalizeHolderPage(result.data);
}
