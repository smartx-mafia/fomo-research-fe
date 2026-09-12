import {call, type CallResult} from './envelope';

export const TOKEN_META_STATUS_OK = 1;
export const TOKEN_META_STATUS_MISS = 2;
export const TOKEN_META_STATUS_INVALID = 3;
export const TOKEN_META_STATUS_NOT_FOUND = 4;
export const TOKEN_META_STATUS_UNAVAILABLE = 5;

const TOKEN_CHAINS = new Set(['bsc', 'solana', 'base', 'robinhood', 'ethereum']);

export type TokenRef = {chain: string; address: string};

/** The one frontend representation of tokendata.v1.TokenInfo. */
export type TokenInfo = {
  chain: string;
  address: string;
  symbol?: string;
  name?: string;
  decimals: number;
  logo?: string;
  creator?: string;
  twitter?: string;
  website?: string;
  launchpad?: string;
  launchpad_name?: string;
  launchpad_logo?: string;
  total_supply?: string;
  circulating_supply?: string;
  /** Missing on an older backend safely means not yet verified. */
  is_verify: boolean;
};

export type TokenMetaResult = {
  chain: string;
  address: string;
  status: number;
  source: number;
  info?: TokenInfo;
  message?: string;
  personal: {is_favorited: boolean};
};

export type BatchTokenMetadataReply = {results: TokenMetaResult[]};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function tokenApiChain(chain: string): string | undefined {
  const lowered = chain.toLowerCase();
  const normalized = lowered === 'sol' ? 'solana' : lowered;
  return TOKEN_CHAINS.has(normalized) ? normalized : undefined;
}

export function normalizeTokenRef(chain: string, address: string): TokenRef | undefined {
  const normalizedChain = tokenApiChain(chain);
  if (!normalizedChain || !address || address.length > 128 || address.includes(':')) return undefined;
  return {
    chain: normalizedChain,
    address: normalizedChain === 'solana' ? address : address.toLowerCase(),
  };
}

export function tokenKey(chain: string, address: string): string | undefined {
  const ref = normalizeTokenRef(chain, address);
  return ref ? `${ref.chain}:${ref.address}` : undefined;
}

export function normalizeTokenInfo(value: unknown): TokenInfo | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const ref = normalizeTokenRef(typeof raw.chain === 'string' ? raw.chain : '', typeof raw.address === 'string' ? raw.address : '');
  const decimals = raw.decimals;
  if (!ref || typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return undefined;
  return {
    ...ref,
    decimals,
    symbol: optionalString(raw.symbol),
    name: optionalString(raw.name),
    logo: optionalString(raw.logo),
    creator: optionalString(raw.creator),
    twitter: optionalString(raw.twitter),
    website: optionalString(raw.website),
    launchpad: optionalString(raw.launchpad),
    launchpad_name: optionalString(raw.launchpad_name),
    launchpad_logo: optionalString(raw.launchpad_logo),
    total_supply: optionalString(raw.total_supply),
    circulating_supply: optionalString(raw.circulating_supply),
    is_verify: raw.is_verify === true,
  };
}

export function normalizeBatchTokenMetadata(value: unknown, requested: TokenRef[]): BatchTokenMetadataReply {
  const raw = record(value);
  const rows = raw?.results;
  if (!Array.isArray(rows) || rows.length !== requested.length) {
    throw new Error('Token metadata response does not align with the request.');
  }
  return {
    results: rows.map((value, index) => {
      const row = record(value) ?? {};
      const status = typeof row.status === 'number' && Number.isInteger(row.status) ? row.status : 0;
      const source = typeof row.source === 'number' && Number.isInteger(row.source) ? row.source : 0;
      const echoed = normalizeTokenRef(
        typeof row.chain === 'string' ? row.chain : requested[index].chain,
        typeof row.address === 'string' && row.address ? row.address : requested[index].address,
      ) ?? requested[index];
      if (tokenKey(echoed.chain, echoed.address) !== tokenKey(requested[index].chain, requested[index].address)) {
        throw new Error(`Token metadata item ${index} does not match the requested token.`);
      }
      const personal = record(row.personal);
      if (!personal || typeof personal.is_favorited !== 'boolean') {
        throw new Error(`Token metadata item ${index} has an invalid personal object.`);
      }
      const info = status === TOKEN_META_STATUS_OK ? normalizeTokenInfo(row.info) : undefined;
      if (status === TOKEN_META_STATUS_OK && (!info || tokenKey(info.chain, info.address) !== tokenKey(echoed.chain, echoed.address))) {
        throw new Error(`Token metadata item ${index} has an invalid or mismatched info object.`);
      }
      return {
        ...echoed,
        status,
        source,
        ...(info ? {info} : {}),
        message: optionalString(row.message),
        personal: {is_favorited: personal.is_favorited},
      };
    }),
  };
}

export async function batchGetTokenMetadata(tokens: TokenRef[], bearer?: string, signal?: AbortSignal): Promise<CallResult<BatchTokenMetadataReply>> {
  const requested = tokens.map((token) => normalizeTokenRef(token.chain, token.address));
  if (requested.some((token) => token === undefined)) throw new Error('Token metadata request contains an invalid token reference.');
  const refs = requested as TokenRef[];
  if (refs.length === 0 || refs.length > 500) throw new Error('Token metadata batch must contain 1–500 tokens.');
  const response = await call<unknown>('/v1/tokens/metadata', {
    method: 'POST',
    bearer,
    signal,
    body: {tokens: refs},
  });
  return {...response, data: normalizeBatchTokenMetadata(response.data, refs)};
}
