/**
 * 全站搜索（business GET /v1/search）。
 *
 * 2026-09-04 起只有 TOKEN / ACCOUNT 两个范围。ACCOUNT 把平台用户与聪明钱
 * 混在 accounts[] 中，关注态必须另走 social relations/batch。
 */
import {call} from './envelope';
import {normalizeTokenMarket} from '@/lib/market';
import type {
  SearchAccountEntry,
  SearchData,
  SearchItem,
  SearchPerson,
  SearchScope,
  SearchSmartMoney,
  SearchSmartMoneyChain,
} from '@/lib/types';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeToken(raw: unknown): SearchItem | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  const chain = optionalString(row.chain);
  const address = optionalString(row.address);
  if (!chain || !address) return null;
  return {
    chain,
    address,
    symbol: optionalString(row.symbol),
    name: optionalString(row.name),
    market: row.market ? normalizeTokenMarket(row.market) : undefined,
  };
}

function normalizePerson(raw: unknown): SearchPerson | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  const identifier = optionalString(row.identifier);
  if (!identifier) return null;
  return {
    identifier,
    username: optionalString(row.username),
    nickname: optionalString(row.nickname),
    avatar_url: optionalString(row.avatar_url),
  };
}

function normalizeSmartMoneyChain(raw: unknown): SearchSmartMoneyChain | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  const chain = optionalString(row.chain);
  if (!chain) return null;
  return {
    chain,
    total_profit: optionalString(row.total_profit),
    realized_profit: optionalString(row.realized_profit),
    buy: optionalNumber(row.buy),
    sell: optionalNumber(row.sell),
    snapshot_at: optionalNumber(row.snapshot_at),
  };
}

function normalizeSmartMoney(raw: unknown): SearchSmartMoney | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  const address = optionalString(row.address);
  if (!address) return null;
  return {
    address,
    chains: Array.isArray(row.chains)
      ? row.chains.map(normalizeSmartMoneyChain).filter((item): item is SearchSmartMoneyChain => item !== null)
      : [],
  };
}

function normalizeAccount(raw: unknown): SearchAccountEntry | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  if (row.target_type === 'user') {
    const user = normalizePerson(row.user);
    return user ? {target_type: 'user', user} : null;
  }
  if (row.target_type === 'smart_money') {
    const smartMoney = normalizeSmartMoney(row.smart_money);
    return smartMoney ? {target_type: 'smart_money', smart_money: smartMoney} : null;
  }
  return null;
}

function normalizeSearchData(raw: unknown): SearchData {
  const data = (raw ?? {}) as Record<string, unknown>;
  const scope = data.scope === 1 || data.scope === 4 ? data.scope : undefined;
  const tokens = Array.isArray(data.tokens)
    ? data.tokens.map(normalizeToken).filter((item): item is SearchItem => item !== null)
    : undefined;
  const accounts = Array.isArray(data.accounts)
    ? data.accounts.map(normalizeAccount).filter((item): item is SearchAccountEntry => item !== null)
    : undefined;
  return {
    scope,
    tokens,
    accounts,
    next_cursor: optionalString(data.next_cursor),
  };
}

export async function fetchSearch(
  scope: SearchScope,
  phrase: string,
  opts: {limit?: number; cursor?: string} = {},
): Promise<SearchData> {
  const params = new URLSearchParams({
    scope,
    phrase,
    limit: String(opts.limit ?? 20),
  });
  if (opts.cursor) params.set('cursor', opts.cursor);
  const response = await call<unknown>(`/v1/search?${params.toString()}`);
  return normalizeSearchData(response.data);
}
