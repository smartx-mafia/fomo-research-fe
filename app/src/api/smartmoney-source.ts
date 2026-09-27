import {call} from './envelope';

export type SourceIdentity =
  | {type: 'user'; userId: string}
  | {type: 'wallet'; namespace: 'evm' | 'solana'; address: string};

export type SourceMeta = {
  source: string;
  data_mode: 'provider_snapshot';
  data_provider: string;
  as_of: string;
  coverage: 'complete' | 'partial' | 'unknown' | 'ranked_selection';
  ledger_verified: false;
  pnl_basis?: string;
};

export type SourceSurface = {enabled: boolean; state: string; reason: string; poll_after_ms: number};
export type SourceCapabilities = {
  protocol_version: string;
  epoch: string;
  supported_chains: string[];
  surfaces: Record<string, SourceSurface>;
};

export type SourcePosition = {
  chain?: string;
  token_address?: string;
  symbol?: string;
  name?: string;
  balance?: string;
  usd_value?: string;
  cost?: string;
  accu_cost?: string;
  realized_profit?: string;
  unrealized_profit?: string;
  total_profit?: string;
};

type WalletPositions = {open: SourcePosition[]; closed: SourcePosition[]};
type UserPositions = {list: SourcePosition[]; open: SourcePosition[]; closed: SourcePosition[]};
export type SourcePositions = {
  meta: SourceMeta;
  snapshot: {wallet?: WalletPositions | null; user?: UserPositions | null};
};

export type SourceAction = {
  tx_hash?: string;
  event_type?: string;
  occurred_at?: string | number;
  chain?: string;
  wallet_address?: string;
  token_address?: string;
  token_symbol?: string;
  token_amount?: string;
  quote_amount?: string;
  quote_symbol?: string;
  cost_usd?: string;
  price_usd?: string;
};
export type SourceActions = {
  meta: SourceMeta;
  classification: 'provider_reported';
  snapshot: {list: SourceAction[]; next_cursor: string};
};

export type SourcePnLWindow = {
  window: string;
  realized_profit_usd: string;
  unrealized_profit_usd: string;
  total_profit_usd: string;
  realized_cost_usd: string;
  coverage: string;
  as_of: string;
  buy_count: string;
  sell_count: string;
};
export type SourcePnL = {meta: SourceMeta; windows: SourcePnLWindow[]};

const exactInt64Fields = ['fetched_at', 'occurred_at', 'snapshot_at', 'mapping_version'] as const;

function sourceParams(identity: SourceIdentity, chain?: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set('identity.type', identity.type);
  if (identity.type === 'user') {
    params.set('identity.user_id', identity.userId);
  } else {
    if (!chain || chain === 'all') throw new Error('A wallet source read requires one chain.');
    params.set('identity.namespace', identity.namespace);
    params.set('identity.address', identity.address);
  }
  if (chain) params.set('chain', chain);
  return params;
}

export function assertProviderSnapshotMeta(meta: SourceMeta | undefined): asserts meta is SourceMeta {
  if (!meta || meta.data_mode !== 'provider_snapshot' || meta.ledger_verified !== false) {
    throw new Error('Smart Money source response lacks provider-snapshot provenance.');
  }
}

export async function getSourceCapabilities(signal?: AbortSignal): Promise<SourceCapabilities> {
  const {data} = await call<SourceCapabilities>('/v2/smartmoney/capabilities', {signal});
  if (data.protocol_version !== '2' || data.epoch !== 'provider-snapshot-v1' ||
    !Array.isArray(data.supported_chains) || !data.surfaces || typeof data.surfaces !== 'object') {
    throw new Error('Smart Money source capabilities have an unsupported contract.');
  }
  return data;
}

export function sourceSurfaceReady(capabilities: SourceCapabilities, name: 'positions' | 'closed_positions' | 'actions' | 'pnl'): boolean {
  const surface = capabilities.surfaces[name];
  return surface?.enabled === true && surface.state === 'ready' &&
    surface.reason === 'data_mode=provider_snapshot;ledger_verified=false';
}

export function sourceRefreshMs(capabilities: SourceCapabilities | undefined, name: 'positions' | 'actions' | 'pnl'): number {
  if (!capabilities || !sourceSurfaceReady(capabilities, name)) return 0;
  const interval = capabilities.surfaces[name].poll_after_ms;
  return Number.isSafeInteger(interval) && interval > 0 ? interval : 0;
}

export async function getSourcePositions(identity: SourceIdentity, chain?: string, signal?: AbortSignal): Promise<SourcePositions> {
  const {data} = await call<SourcePositions>(`/v2/smartmoney/positions?${sourceParams(identity, chain)}`,
    {signal, preserveInt64Fields: exactInt64Fields});
  assertProviderSnapshotMeta(data.meta);
  const branch = identity.type === 'wallet' ? data.snapshot?.wallet : data.snapshot?.user;
  if (!branch || !Array.isArray(branch.open) || !Array.isArray(branch.closed)) {
    throw new Error('Smart Money positions snapshot does not match the requested identity.');
  }
  return data;
}

export async function getSourceActions(identity: SourceIdentity, chain?: string, cursor = '', signal?: AbortSignal): Promise<SourceActions> {
  const params = sourceParams(identity, chain);
  if (cursor) params.set('cursor', cursor);
  const {data} = await call<SourceActions>(`/v2/smartmoney/actions?${params}`,
    {signal, preserveInt64Fields: exactInt64Fields});
  assertProviderSnapshotMeta(data.meta);
  if (data.classification !== 'provider_reported' || !Array.isArray(data.snapshot?.list)) {
    throw new Error('Smart Money actions are not a provider-reported snapshot.');
  }
  return data;
}

export async function getSourcePnL(identity: SourceIdentity, chain?: string, signal?: AbortSignal): Promise<SourcePnL> {
  const {data} = await call<SourcePnL>(`/v2/smartmoney/pnl?${sourceParams(identity, chain)}`, {signal});
  assertProviderSnapshotMeta(data.meta);
  if (!Array.isArray(data.windows)) throw new Error('Smart Money PnL windows are unavailable.');
  return data;
}
