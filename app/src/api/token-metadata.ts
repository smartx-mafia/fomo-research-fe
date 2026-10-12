import {call, type CallResult} from './envelope';
import {normalizeTokenRisk, type TokenRisk} from '@/lib/token-risk';

export const TOKEN_META_STATUS_OK = 1;
export const TOKEN_META_STATUS_MISS = 2;
export const TOKEN_META_STATUS_INVALID = 3;
export const TOKEN_META_STATUS_NOT_FOUND = 4;
export const TOKEN_META_STATUS_UNAVAILABLE = 5;

const TOKEN_CHAINS = new Set(['bsc', 'solana', 'base', 'robinhood', 'ethereum', 'arc']);

export type TokenRef = {chain: string; address: string};

export type TokenPersonal = {
  is_favorited: boolean;
  /** Smallest-unit decimal string. Never coerce through Number/parseFloat. */
  position_amount: string;
};

/** The only frontend representation of tokendata.v1.TokenInfo. */
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

// Display identity remains usable while precision is unknown. Never use this type for amount conversion.
export type TokenDisplayInfo = Omit<TokenInfo, 'decimals'> & {decimals?: number};

export type TokenMetaResult = {
  presentation?: TokenDisplayInfo;
  chain: string;
  address: string;
  status: number;
  source: number;
  risk: TokenRisk;
  info?: TokenInfo;
  message?: string;
  personal: TokenPersonal;
};

export type BatchTokenMetadataReply = {results: TokenMetaResult[]};

/** GET /v1/tokens/{chain}/{address}: dynamic fields stay beside static TokenInfo. */
export type GetTokenReply = {info: TokenInfo; personal: TokenPersonal; risk: TokenRisk};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function normalizeTokenPersonal(value: unknown): TokenPersonal {
  const raw = record(value);
  const amount = raw?.position_amount;
  return {
    is_favorited: raw?.is_favorited === true,
    position_amount: typeof amount === 'string' && (amount === '' || /^\d+$/.test(amount)) ? amount : '',
  };
}

export function tokenApiChain(chain: string): string | undefined {
  const lowered = chain.toLowerCase();
  const caip = lowered.startsWith('eip155:') ? lowered.slice(7) : lowered;
  const normalized = caip === 'sol' || caip === 'solana:mainnet' ? 'solana'
    : caip === '56' ? 'bsc'
      : caip === '8453' ? 'base'
        : caip === '4663' ? 'robinhood'
          : caip === '1' ? 'ethereum'
            : caip === '5042' ? 'arc'
              : caip;
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

export function normalizeTokenPresentation(value: unknown): TokenDisplayInfo | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const ref = normalizeTokenRef(typeof raw.chain === 'string' ? raw.chain : '', typeof raw.address === 'string' ? raw.address : '');
  if (!ref) return undefined;
  return {...ref, symbol: optionalString(raw.symbol), name: optionalString(raw.name), logo: optionalString(raw.logo),
    launchpad: optionalString(raw.launchpad), launchpad_name: optionalString(raw.launchpad_name),
    launchpad_logo: optionalString(raw.launchpad_logo), is_verify: raw.is_verify === true};
}

export function normalizeGetToken(value: unknown): GetTokenReply | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const info = normalizeTokenInfo(raw.info);
  return info ? {info, personal: normalizeTokenPersonal(raw.personal), risk: normalizeTokenRisk(raw.risk)} : undefined;
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
      let status = typeof row.status === 'number' && Number.isInteger(row.status) ? row.status : 0;
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
      // The backend uses -1 for unknown precision. Keep the strict TokenInfo
      // contract for amounts, but do not let one such item discard every other
      // token's valid image/metadata in this batch. Identity checks still apply.
      const rawInfo = record(row.info);
      const unknownPrecision = status === TOKEN_META_STATUS_OK && rawInfo?.decimals === -1;
      if (unknownPrecision) {
        const infoRef = normalizeTokenRef(
          typeof rawInfo.chain === 'string' ? rawInfo.chain : '',
          typeof rawInfo.address === 'string' ? rawInfo.address : '',
        );
        if (!infoRef || tokenKey(infoRef.chain, infoRef.address) !== tokenKey(echoed.chain, echoed.address)) {
          throw new Error(`Token metadata item ${index} has an invalid or mismatched info object.`);
        }
        status = TOKEN_META_STATUS_UNAVAILABLE;
      }
      const info = status === TOKEN_META_STATUS_OK ? normalizeTokenInfo(row.info) : undefined;
      if (status === TOKEN_META_STATUS_OK && (!info || tokenKey(info.chain, info.address) !== tokenKey(echoed.chain, echoed.address))) {
        throw new Error(`Token metadata item ${index} has an invalid or mismatched info object.`);
      }
      return {
        ...echoed,
        status,
        source,
        risk: normalizeTokenRisk(row.risk),
        ...(info ? {info} : {}),
        ...((info || unknownPrecision) ? {presentation: normalizeTokenPresentation(row.info)} : {}),
        message: optionalString(row.message) ?? (unknownPrecision ? 'Token precision is not available.' : undefined),
        personal: normalizeTokenPersonal(personal),
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
