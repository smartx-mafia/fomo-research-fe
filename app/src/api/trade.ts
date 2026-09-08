/** Browser-side client for docs/contracts/meme.md. Amounts stay exact decimal strings. */
import {call} from './envelope';

export type TradeSide = 'buy' | 'sell';

export type MemeChain = {
  chain: string;
  chain_id: number;
  kind: 'evm' | 'svm' | string;
};

export type TokenInfo = {
  chain: string;
  address: string;
  symbol?: string;
  name?: string;
  decimals: number;
};

export type TradeIntent = {
  chain: string;
  side: TradeSide;
  token: string;
  amountIn: string;
  slippageBps: number;
};

export type TradePreview = {
  route?: string;
  amount_in?: string;
  amount_out?: string;
  min_amount_out?: string;
  price_usd?: string;
  amount_in_usd?: string;
  amount_out_usd?: string;
  app_fee_bps?: number;
  app_fee_usd?: string;
  third_party_cost_usd?: string;
  total_cost_bps?: number;
  fee_scheme?: string;
  slippage_bps?: number;
  quoted_at?: string;
};

export type TradeReply = {
  trade_id: string;
  status?: number | string;
  side: string;
  token: string;
  quote_token?: string;
  amount_in?: string;
  min_received?: string;
  amount_out?: string;
  route?: string;
  platform?: string;
  tx_hash?: string;
  request_id?: string;
  block_number?: number;
  confirmations?: number;
  slippage_bps?: number;
  requested_slippage_bps?: number;
  channel?: string;
  duplicate?: boolean;
  amount_in_actual?: string;
  fee_execution?: string;
  fee_platform?: string;
  fee_app?: string;
  fee_currency?: string;
  gas_fee?: string;
  error_class?: string;
  error_code?: string;
  lifecycle?: string;
  deadline_at?: string;
  sellable_after_graduation?: boolean;
};

export type PrepareTradeReply = {
  trade: TradeReply;
  sign_kind: number;
  sign_data: string;
  expires_at?: string;
  wallet_address: string;
  fee_bps?: number;
  fee_scheme?: string;
};

export type PrepareDelegationReply = {
  sign_kind: number;
  sign_data: string;
  nonce?: number;
  wallet_address: string;
};

export type Position = {
  asset_chain_id: number;
  asset_kind: string;
  asset: string;
  quote_chain_id: number;
  quote_asset_kind: string;
  quote_asset: string;
  shares: string;
  cost_basis: string;
  total_buy_shares?: string;
  total_buy_quote?: string;
  total_sell_shares?: string;
  total_sell_quote?: string;
  total_realized_pnl?: string;
  current_realized_pnl?: string;
  current_buy_shares?: string;
  current_sell_shares?: string;
  current_buy_quote?: string;
  current_sell_quote?: string;
  current_cycle_opened_at?: string;
  current_cycle_opened_entry_id?: number;
  cycle_count?: number;
  cycles_ready?: boolean;
  holding_avg_cost_usd?: string;
  asset_decimals?: number;
  quote_decimals?: number;
  updated_at: string;
};

export const SIGN_KIND_SOLANA_TRANSACTION = 1;
export const SIGN_KIND_EVM_USER_OPERATION = 2;
export const SIGN_KIND_EVM_7702_AUTHORIZATION = 3;
export const SIGN_KIND_EVM_PERMIT_DIGEST = 4;
export const SIGN_KIND_EVM_CALIBUR_BATCH = 5;
export const CODE_DELEGATION_REQUIRED = 100283;

export const TRADE_PHASE_UNSPECIFIED = 0;
export const TRADE_PHASE_PENDING = 1;
export const TRADE_PHASE_SUCCESS = 2;
export const TRADE_PHASE_FAILED = 3;

function validateIntent(intent: TradeIntent) {
  if (!intent.chain || !intent.token) throw new Error('Chain and token are required.');
  if (!/^\d+$/.test(intent.amountIn) || BigInt(intent.amountIn) <= BigInt(0)) {
    throw new Error('Trade amount must be a positive integer in smallest units.');
  }
  if (!Number.isInteger(intent.slippageBps) || intent.slippageBps < 0 || intent.slippageBps > 10_000) {
    throw new Error('Slippage must be between 0 and 10,000 bps.');
  }
}

function requestBody(intent: TradeIntent) {
  validateIntent(intent);
  return {
    wallet: {chain: intent.chain},
    side: intent.side,
    token: intent.token,
    amount_in: intent.amountIn,
    slippage_bps: intent.slippageBps,
    ...(intent.side === 'buy' && intent.chain !== 'solana' ? {funding: {chain: 'solana'}} : {}),
  };
}

export async function listTradeChains(bearer: string, signal?: AbortSignal) {
  const response = await call<{chains?: MemeChain[]}>('/v1/meme/chains', {bearer, signal});
  return response.data.chains ?? [];
}

export async function getTokenInfo(chain: string, address: string, signal?: AbortSignal): Promise<TokenInfo> {
  const response = await call<{info?: TokenInfo}>(
    `/v1/tokens/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`,
    {signal},
  );
  if (!response.data.info || !Number.isInteger(response.data.info.decimals) || response.data.info.decimals < 0) {
    throw new Error('Token metadata is unavailable.');
  }
  const info = response.data.info;
  const evmAddress = /^0x[0-9a-f]{40}$/i.test(address);
  const addressMatches = evmAddress
    ? info.address.toLowerCase() === address.toLowerCase()
    : info.address === address;
  if (info.chain !== chain || !addressMatches) {
    throw new Error('Token metadata identity does not match the requested token.');
  }
  return info;
}

export async function previewTrade(bearer: string, intent: TradeIntent, signal?: AbortSignal) {
  const response = await call<TradePreview>('/v1/meme/trades/preview', {
    method: 'POST', bearer, body: requestBody(intent), signal,
  });
  return response.data;
}

export async function createTrade(bearer: string, intent: TradeIntent, signal?: AbortSignal) {
  const response = await call<TradeReply>('/v1/meme/trades', {
    method: 'POST', bearer, body: requestBody(intent), signal,
  });
  return response.data;
}

export async function prepareTrade(bearer: string, tradeID: string, signal?: AbortSignal) {
  const response = await call<PrepareTradeReply>(`/v1/meme/trades/${encodeURIComponent(tradeID)}/prepare`, {
    method: 'POST', bearer, signal,
  });
  return response.data;
}

export async function submitTrade(bearer: string, tradeID: string, signature: string, signal?: AbortSignal) {
  const response = await call<TradeReply>(`/v1/meme/trades/${encodeURIComponent(tradeID)}/submit`, {
    method: 'POST', bearer, body: {signature}, signal,
  });
  return response.data;
}

export async function getTrade(bearer: string, tradeID: string, signal?: AbortSignal) {
  const response = await call<TradeReply>(`/v1/meme/trades/${encodeURIComponent(tradeID)}`, {bearer, signal});
  return response.data;
}

export async function prepareDelegation(bearer: string, chain: string, signal?: AbortSignal) {
  const response = await call<PrepareDelegationReply>('/v1/meme/wallets/delegation/prepare', {
    method: 'POST', bearer, body: {chain}, signal,
  });
  return response.data;
}

export async function submitDelegation(
  bearer: string,
  chain: string,
  nonce: number,
  signature: string,
  signal?: AbortSignal,
) {
  const response = await call<{wallet_address: string}>('/v1/meme/wallets/delegation/submit', {
    method: 'POST', bearer, body: {chain, nonce, signature}, signal,
  });
  return response.data;
}

export async function listPositions(bearer: string, signal?: AbortSignal) {
  const response = await call<{positions?: Position[]}>('/v1/meme/positions', {bearer, signal});
  return response.data.positions ?? [];
}

export function phaseOf(trade: Pick<TradeReply, 'status'>): number {
  switch (trade.status) {
    case 1:
    case 'PENDING':
    case 'TRADE_PHASE_PENDING':
      return TRADE_PHASE_PENDING;
    case 2:
    case 'SUCCESS':
    case 'TRADE_PHASE_SUCCESS':
      return TRADE_PHASE_SUCCESS;
    case 3:
    case 'FAILED':
    case 'TRADE_PHASE_FAILED':
      return TRADE_PHASE_FAILED;
    default:
      return TRADE_PHASE_UNSPECIFIED;
  }
}

export type PollStop = 'settled' | 'deadline' | 'budget';

export async function pollTrade(
  bearer: string,
  tradeID: string,
  options: {
    signal?: AbortSignal;
    onTick?: (trade: TradeReply, round: number) => void;
    intervalMs?: number;
    budgetMs?: number;
  } = {},
): Promise<{trade: TradeReply; stop: PollStop; rounds: number}> {
  const startedAt = Date.now();
  const interval = options.intervalMs ?? 1_500;
  const budget = options.budgetMs ?? 90_000;
  for (let rounds = 1; ; rounds += 1) {
    options.signal?.throwIfAborted();
    const trade = await getTrade(bearer, tradeID, options.signal);
    options.onTick?.(trade, rounds);
    const phase = phaseOf(trade);
    if (phase === TRADE_PHASE_UNSPECIFIED) throw new Error(`Unknown trade status: ${String(trade.status)}`);
    if (phase !== TRADE_PHASE_PENDING) return {trade, stop: 'settled', rounds};
    const deadline = trade.deadline_at ? Date.parse(trade.deadline_at) : Number.NaN;
    if (Number.isFinite(deadline) && Date.now() >= deadline) return {trade, stop: 'deadline', rounds};
    if (Date.now() - startedAt >= budget) return {trade, stop: 'budget', rounds};
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        options.signal?.removeEventListener('abort', onAbort);
        resolve();
      }, interval);
      options.signal?.addEventListener('abort', onAbort, {once: true});
    });
  }
}

export function parseUnits(input: string, decimals: number): bigint {
  const value = input.trim();
  if (!/^\d*\.?\d*$/.test(value) || !/\d/.test(value)) throw new Error('Enter a plain decimal amount.');
  const [integer, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error(`This asset supports at most ${decimals} decimal places.`);
  return BigInt((integer || '0') + fraction.padEnd(decimals, '0'));
}

export function formatUnits(raw: string | bigint, decimals: number): string {
  const value = typeof raw === 'bigint' ? raw : BigInt(raw);
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const base = BigInt(10) ** BigInt(decimals);
  const integer = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}
