import { call } from './envelope';
import { normalizeTokenInfo, type TokenInfo } from './token-metadata';
import {normalizeActor, type ActorView} from './actor';

export type TokenTradeBoardSource = 'platform' | 'smart-money';
export type TokenTradeScope = 'all' | 'following';

export type TokenTradeUser = {
  identifier: string;
  username?: string;
  nickname?: string;
  avatarURL?: string;
};

export type TokenTradeSmartMoney = {
  address: string;
  chains: string[];
  displayName?: string;
  avatarURL?: string;
  handle?: string;
  xHandle?: string;
  source?: string;
  sourceURL?: string;
};

/** Common row shape for the three token-detail trade boards. */
export type TokenTradeBoardItem = {
  side: 'buy' | 'sell';
  /** Unix seconds. */
  occurredAt: number;
  /** This endpoint already returns human-readable token quantity. */
  tokenAmount?: string;
  /** Business board values are exact decimal strings; on-chain values may be display numbers. */
  usd?: string | number;
  executionPriceUSD?: string | number;
  /** Historical,采集期固化市值 for platform / smart money. */
  marketCapUSDAtTrade?: string;
  /** Current-supply estimate for the on-chain board only. */
  marketCapUSDEstimated?: string;
  txHash?: string;
  txChain?: string;
  actorType?: 'user' | 'smart_money';
  actorID?: string;
  user?: TokenTradeUser;
  smartMoney?: TokenTradeSmartMoney;
  actor?: ActorView;
  /** On-chain sender is only a display identity; never use it to infer platform ownership. */
  sender?: string;
};

export type TokenTradeBoardPage = {
  token?: TokenInfo;
  items: TokenTradeBoardItem[];
  coverage: string[];
};

class TokenTradeBoardShapeError extends TypeError {
  constructor(detail: string) {
    super(`Token trade board response has an invalid shape: ${detail}`);
    this.name = 'TokenTradeBoardShapeError';
  }
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function safeInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TokenTradeBoardShapeError(`${field} is not a safe unix timestamp`);
  return parsed;
}

function normalizeUser(value: unknown): TokenTradeUser | undefined {
  const row = record(value);
  const identifier = nonEmptyString(row?.identifier);
  if (!identifier) return undefined;
  return {
    identifier,
    username: nonEmptyString(row?.username),
    nickname: nonEmptyString(row?.nickname),
    avatarURL: nonEmptyString(row?.avatar_url),
  };
}

function normalizeSmartMoney(value: unknown): TokenTradeSmartMoney | undefined {
  const row = record(value);
  const address = nonEmptyString(row?.address);
  if (!address) return undefined;
  const chains = row?.chains;
  if (chains !== undefined && (!Array.isArray(chains) || chains.some((chain) => typeof chain !== 'string'))) {
    throw new TokenTradeBoardShapeError('smart_money.chains is invalid');
  }
  return {
    address,
    chains: (chains as string[] | undefined) ?? [],
    displayName: nonEmptyString(row?.display_name),
    avatarURL: nonEmptyString(row?.avatar_url),
    handle: nonEmptyString(row?.handle),
    xHandle: nonEmptyString(row?.x_handle),
    source: nonEmptyString(row?.source),
    sourceURL: nonEmptyString(row?.source_url),
  };
}

function normalizeBusinessTrade(value: unknown, index: number): TokenTradeBoardItem {
  const row = record(value);
  if (!row) throw new TokenTradeBoardShapeError(`items[${index}] is not an object`);
  if (row.side !== 'buy' && row.side !== 'sell') throw new TokenTradeBoardShapeError(`items[${index}].side is invalid`);
  const actorType = row.actor_type === 'user' || row.actor_type === 'smart_money' ? row.actor_type : undefined;
  return {
    side: row.side,
    occurredAt: safeInteger(row.occurred_at, `items[${index}].occurred_at`),
    tokenAmount: typeof row.token_amount === 'string' && row.token_amount !== '' ? row.token_amount : undefined,
    usd: typeof row.usd === 'string' && row.usd !== '' ? row.usd : undefined,
    executionPriceUSD: typeof row.execution_price_usd === 'string' && row.execution_price_usd !== '' ? row.execution_price_usd : undefined,
    marketCapUSDAtTrade: typeof row.market_cap_usd_at_trade === 'string' && row.market_cap_usd_at_trade !== '' ? row.market_cap_usd_at_trade : undefined,
    txHash: nonEmptyString(row.tx_hash),
    txChain: nonEmptyString(row.tx_chain),
    ...(actorType ? {actorType} : {}),
    actorID: nonEmptyString(row.actor_id),
    user: normalizeUser(row.user),
    smartMoney: normalizeSmartMoney(row.smart_money),
    actor: record(row.actor)?.identity && record(record(row.actor)?.identity)?.type ? normalizeActor(row.actor) : undefined,
  };
}

export function normalizeTokenTradeBoard(value: unknown): TokenTradeBoardPage {
  const row = record(value);
  if (!row) throw new TokenTradeBoardShapeError('data is not an object');
  if (row.items !== undefined && !Array.isArray(row.items)) throw new TokenTradeBoardShapeError('items is not an array');
  const coverage = row.coverage;
  if (coverage !== undefined && (!Array.isArray(coverage) || coverage.some((item) => typeof item !== 'string'))) {
    throw new TokenTradeBoardShapeError('coverage is not an array of strings');
  }
  const token = normalizeTokenInfo(row.token);
  return {
    ...(token ? {token} : {}),
    items: (row.items ?? []).map(normalizeBusinessTrade),
    coverage: (coverage as string[] | undefined) ?? [],
  };
}

export async function fetchTokenTradeBoard(
  source: TokenTradeBoardSource,
  chain: string,
  address: string,
  options: { scope?: TokenTradeScope; limit?: number; bearer?: string; signal?: AbortSignal } = {},
): Promise<TokenTradeBoardPage> {
  const scope = options.scope ?? 'all';
  const requestedLimit = options.limit ?? 50;
  const limit = requestedLimit === 0 ? 50 : Math.min(200, Math.max(1, requestedLimit));
  const query = new URLSearchParams({scope, limit: String(limit)});
  const path = source === 'platform' ? 'platform-trades' : 'smart-money-trades';
  const response = await call<unknown>(`/v1/tokens/${encodeURIComponent(chain)}/${encodeURIComponent(address)}/${path}?${query.toString()}`, {
    bearer: options.bearer,
    signal: options.signal,
    preserveInt64Fields: ['occurred_at'],
  });
  return normalizeTokenTradeBoard(response.data);
}
