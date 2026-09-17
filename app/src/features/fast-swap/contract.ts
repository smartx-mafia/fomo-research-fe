import {FAST_SWAP_CONTRACT_VERSION} from './config';

export const Side = {BUY: 1, SELL: 2, SWAP: 3} as const;
export const FeePolicy = {PLATFORM_SPONSORED: 1} as const;
export const PreparationStatus = {PREPARING: 1, READY: 2, REFRESHING: 3, EXPIRED: 4, BLOCKED: 5} as const;
export const ExecutionStatus = {NOT_REPORTED: 1, REPORTED: 2, ACCEPTED: 3, UNKNOWN: 4, FAILED: 5} as const;
export const ChainLegStatus = {NOT_SEEN: 1, OBSERVED: 2, CONFIRMED: 3, REORGED: 4} as const;
export const RelayStatus = {PENDING: 1, FILLED: 2, REFUNDING: 3, REFUNDED: 4, FAILED: 5} as const;
export const AccountingStatus = {PENDING: 1, POSTED: 2, REVERSAL_PENDING: 3, REVERSED: 4} as const;
export const Outcome = {
  PENDING: 1, COMPLETED: 2, CANCEL_PENDING: 3, CANCELLED: 4, EXPIRED_UNEXECUTED: 5,
  FAILED_NO_DEBIT: 6, REFUNDING: 7, REFUNDED: 8, ATTENTION_REQUIRED: 9,
} as const;
export const FastFillStatus = {DISABLED: 1, ELIGIBLE: 2, REQUESTED: 3, ACCEPTED: 4, UNKNOWN: 5, REJECTED: 6, RELEASED: 7, LOSS: 8} as const;
export const SwapEventType = {PREPARATION_UPDATED: 1, EXECUTION_UPDATED: 2, SETTLEMENT_UPDATED: 3, AVAILABILITY_UPDATED: 4} as const;
export const SigningKind = {SOLANA_TRANSACTION: 1, EVM_CALIBUR: 2, EVM_PERMIT: 3} as const;
export const BroadcastMode = {GATEWAY: 1, JITO_DIRECT: 2} as const;
export const EvmSigningMethod = {ETH_SIGN_TYPED_DATA_V4: 1, EIP7702_AUTHORIZATION: 2} as const;

export type CreateIntent = {
  client_intent_id: string;
  origin_chain: string;
  destination_chain: string;
  origin_asset: string;
  destination_asset: string;
  amount_in_raw: string;
  slippage_bps: number;
  side: number;
  source_wallet_id: string;
  destination_wallet_id: string;
  fee_policy: number;
};

export type AssetRef = {chain: string; address: string; decimals: number};
export type RevisionFee = {chain: string; asset: string; amount_raw: string; payer: number; kind: number};
export type LookupTable = {address: string; addresses: string[]; last_extended_slot: string; observed_slot: string};
export type SolanaSigning = {
  kind: number;
  transaction_base64: string;
  message_hash: string;
  fee_payer_address: string;
  user_signer_address: string;
  blockhash: string;
  last_valid_block_height: string;
  lookup_tables: LookupTable[];
  execution_guard: {program_id: string; group_id: string};
  broadcast: {mode: number; endpoint_id: string; backup_endpoint_id: string | null};
};
export type Eip712TypedData = {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primary_type: string;
  message: Record<string, unknown>;
};
export type Eip7702Authorization = {chain_id: string; address: string; nonce: string};
export type EvmSignRequest = {
  request_id: string;
  method: number;
  typed_data: Eip712TypedData | null;
  authorization: Eip7702Authorization | null;
};
export type EvmSigning = {
  kind: number;
  chain: string;
  signer_address: string;
  execution_digest: string;
  nonce: string;
  deadline: string;
  requests: EvmSignRequest[];
};
export type PreparedRevision = {
  revision: string;
  intent_hash: string;
  created_at: string;
  quote_valid_until: string;
  safe_sign_before: string;
  safe_broadcast_before: string;
  assets: {origin: AssetRef; destination: AssetRef};
  expected_out_raw: string;
  min_out_raw: string;
  fees: RevisionFee[];
  relay_request_id: string;
  solana: SolanaSigning | null;
  evm: EvmSigning | null;
};
export type Availability = {
  asset: string;
  chain: string;
  wallet_id: string;
  balance_raw: string | null;
  reserved_raw: string | null;
  spendable_raw: string | null;
  can_execute: boolean;
  reason_code: string | null;
  observed_block: string | null;
  observed_at: string | null;
};
export type SwapSnapshot = {
  swap_id: string;
  execution_group_id: string;
  event_version: string;
  intent: CreateIntent;
  intent_hash: string;
  preparation: {status: number; current_revision: string | null; retry_after_ms: number | null; reason_code: string | null};
  revision: PreparedRevision;
  execution: {
    status: number; artifact_hash: string | null; origin_tx_hash: string | null;
    relay_request_id: string | null; relay_execution_id: string | null; user_operation_hash: string | null;
  };
  settlement: {
    source: number; destination: number; relay: number; accounting: number; outcome: number;
    amount_in_actual_raw: string | null; amount_out_actual_raw: string | null;
    amount_refunded_raw: string | null; destination_tx_hash: string | null;
    destination_observed_at: string | null; destination_finalized_at: string | null;
    refund_fee_delta_raw: string | null;
  };
  fast_fill: {status: number; reason_code: string | null};
  availability: Availability;
};
export type SwapRoute = {
  route_id: string; origin_chain: string; destination_chain: string; side: number; enabled: boolean;
  signing_kinds: number[]; broadcast_modes: number[]; sponsorship_available: boolean;
  fast_fill_available: boolean; multi_revision_safe: boolean; unavailable_reason: string | null;
};
export type SwapEvent = {
  swap_id: string; event_version: string; type: number; occurred_at: string; trace_id: string;
  snapshot: SwapSnapshot | null;
};

type Row = Record<string, unknown>;
function row(value: unknown, label: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Row;
}
function string(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value === '')) throw new Error(`${label} must be a string.`);
  return value;
}
function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label} must be an integer.`);
  return value;
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  return value;
}
function optionalString(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : string(value, label, true);
}
function optionalInteger(value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : integer(value, label);
}
function decimal(value: unknown, label: string, allowZero = true): string {
  const result = string(value, label);
  if (!/^\d+$/.test(result) || (!allowZero && BigInt(result) === BigInt(0))) throw new Error(`${label} must be an unsigned decimal string.`);
  return result;
}
function records(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}
function protoStructValue(value: unknown, label: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => protoStructValue(item, `${label}[${index}]`));
  const source = row(value, label);
  const keys = Object.keys(source);
  // wirejson intentionally walks protobuf descriptors. google.protobuf.Struct
  // therefore appears as Struct/Value/ListValue messages instead of protojson's
  // ordinary JSON object. Accept both public wire shapes and normalize before
  // validating the EIP-712 allowlist.
  if (keys.length === 1 && keys[0] === 'fields') {
    const fields = row(source.fields, `${label}.fields`);
    return Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, protoWireValue(item, `${label}.${key}`)]));
  }
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, protoStructValue(item, `${label}.${key}`)]));
}
function protoWireValue(value: unknown, label: string): unknown {
  const wire = row(value, label);
  const kinds = ['null_value', 'number_value', 'string_value', 'bool_value', 'struct_value', 'list_value'] as const;
  const selected = kinds.filter((kind) => wire[kind] !== null && wire[kind] !== undefined);
  if (selected.length !== 1) throw new Error(`${label} must select exactly one protobuf Value kind.`);
  switch (selected[0]) {
    case 'null_value': return null;
    case 'number_value': return protoStructValue(wire.number_value, `${label}.number_value`);
    case 'string_value': return string(wire.string_value, `${label}.string_value`, true);
    case 'bool_value': return bool(wire.bool_value, `${label}.bool_value`);
    case 'struct_value': return protoStructValue(wire.struct_value, `${label}.struct_value`);
    case 'list_value': {
      const list = row(wire.list_value, `${label}.list_value`);
      return records(list.values, `${label}.list_value.values`).map((item, index) => protoWireValue(item, `${label}[${index}]`));
    }
  }
}
function objectValue(value: unknown, label: string): Record<string, unknown> {
  return row(protoStructValue(value, label), label);
}

export function parseCreateIntent(value: unknown, label = 'intent'): CreateIntent {
  const v = row(value, label);
  return {
    client_intent_id: string(v.client_intent_id, `${label}.client_intent_id`),
    origin_chain: string(v.origin_chain, `${label}.origin_chain`),
    destination_chain: string(v.destination_chain, `${label}.destination_chain`),
    origin_asset: string(v.origin_asset, `${label}.origin_asset`),
    destination_asset: string(v.destination_asset, `${label}.destination_asset`),
    amount_in_raw: decimal(v.amount_in_raw, `${label}.amount_in_raw`, false),
    slippage_bps: integer(v.slippage_bps, `${label}.slippage_bps`),
    side: integer(v.side, `${label}.side`),
    source_wallet_id: string(v.source_wallet_id, `${label}.source_wallet_id`),
    destination_wallet_id: string(v.destination_wallet_id, `${label}.destination_wallet_id`),
    fee_policy: integer(v.fee_policy, `${label}.fee_policy`),
  };
}

function parseAsset(value: unknown, label: string): AssetRef {
  const v = row(value, label);
  return {chain: string(v.chain, `${label}.chain`, true), address: string(v.address, `${label}.address`, true), decimals: integer(v.decimals, `${label}.decimals`)};
}
function parseAvailability(value: unknown, label: string): Availability {
  const v = row(value, label);
  return {
    asset: string(v.asset, `${label}.asset`, true), chain: string(v.chain, `${label}.chain`, true),
    wallet_id: string(v.wallet_id, `${label}.wallet_id`, true),
    balance_raw: optionalString(v.balance_raw, `${label}.balance_raw`),
    reserved_raw: optionalString(v.reserved_raw, `${label}.reserved_raw`),
    spendable_raw: optionalString(v.spendable_raw, `${label}.spendable_raw`),
    can_execute: bool(v.can_execute, `${label}.can_execute`),
    reason_code: optionalString(v.reason_code, `${label}.reason_code`),
    observed_block: optionalString(v.observed_block, `${label}.observed_block`),
    observed_at: optionalString(v.observed_at, `${label}.observed_at`),
  };
}
function parseRevision(value: unknown, label: string): PreparedRevision {
  const v = row(value, label);
  const assets = row(v.assets, `${label}.assets`);
  const fees = records(v.fees, `${label}.fees`).map((item, index) => {
    const fee = row(item, `${label}.fees[${index}]`);
    return {
      chain: string(fee.chain, 'fee.chain'), asset: string(fee.asset, 'fee.asset'),
      amount_raw: decimal(fee.amount_raw, 'fee.amount_raw'), payer: integer(fee.payer, 'fee.payer'), kind: integer(fee.kind, 'fee.kind'),
    };
  });
  let solana: SolanaSigning | null = null;
  if (v.solana !== null && v.solana !== undefined) {
    const s = row(v.solana, `${label}.solana`); const guard = row(s.execution_guard, 'solana.execution_guard'); const broadcast = row(s.broadcast, 'solana.broadcast');
    solana = {
      kind: integer(s.kind, 'solana.kind'), transaction_base64: string(s.transaction_base64, 'solana.transaction_base64'),
      message_hash: string(s.message_hash, 'solana.message_hash'), fee_payer_address: string(s.fee_payer_address, 'solana.fee_payer_address'),
      user_signer_address: string(s.user_signer_address, 'solana.user_signer_address'), blockhash: string(s.blockhash, 'solana.blockhash'),
      last_valid_block_height: decimal(s.last_valid_block_height, 'solana.last_valid_block_height', false),
      lookup_tables: records(s.lookup_tables, 'solana.lookup_tables').map((item) => { const t = row(item, 'lookup_table'); return {address: string(t.address, 'lookup_table.address'), addresses: records(t.addresses, 'lookup_table.addresses').map((a) => string(a, 'lookup_table.address')), last_extended_slot: decimal(t.last_extended_slot, 'lookup_table.last_extended_slot'), observed_slot: decimal(t.observed_slot, 'lookup_table.observed_slot')}; }),
      execution_guard: {program_id: string(guard.program_id, 'execution_guard.program_id', true), group_id: string(guard.group_id, 'execution_guard.group_id', true)},
      broadcast: {mode: integer(broadcast.mode, 'broadcast.mode'), endpoint_id: string(broadcast.endpoint_id, 'broadcast.endpoint_id'), backup_endpoint_id: optionalString(broadcast.backup_endpoint_id, 'broadcast.backup_endpoint_id')},
    };
  }
  let evm: EvmSigning | null = null;
  if (v.evm !== null && v.evm !== undefined) {
    const e = row(v.evm, `${label}.evm`);
    evm = {
      kind: integer(e.kind, 'evm.kind'), chain: string(e.chain, 'evm.chain'), signer_address: string(e.signer_address, 'evm.signer_address'),
      execution_digest: string(e.execution_digest, 'evm.execution_digest'), nonce: decimal(e.nonce, 'evm.nonce', false), deadline: string(e.deadline, 'evm.deadline'),
      requests: records(e.requests, 'evm.requests').map((item, index) => { const q = row(item, `evm.requests[${index}]`); const td = q.typed_data === null || q.typed_data === undefined ? null : row(q.typed_data, 'typed_data'); const auth = q.authorization === null || q.authorization === undefined ? null : row(q.authorization, 'authorization'); return {
        request_id: string(q.request_id, 'request_id'), method: integer(q.method, 'method'),
        typed_data: td ? {domain: objectValue(td.domain, 'typed_data.domain'), types: objectValue(td.types, 'typed_data.types'), primary_type: string(td.primary_type, 'typed_data.primary_type'), message: objectValue(td.message, 'typed_data.message')} : null,
        authorization: auth ? {chain_id: decimal(auth.chain_id, 'authorization.chain_id'), address: string(auth.address, 'authorization.address'), nonce: decimal(auth.nonce, 'authorization.nonce')} : null,
      }; }),
    };
  }
  return {
    revision: string(v.revision, `${label}.revision`, true), intent_hash: string(v.intent_hash, `${label}.intent_hash`, true),
    created_at: string(v.created_at, `${label}.created_at`, true), quote_valid_until: string(v.quote_valid_until, `${label}.quote_valid_until`, true),
    safe_sign_before: string(v.safe_sign_before, `${label}.safe_sign_before`, true), safe_broadcast_before: string(v.safe_broadcast_before, `${label}.safe_broadcast_before`, true),
    assets: {origin: parseAsset(assets.origin, 'assets.origin'), destination: parseAsset(assets.destination, 'assets.destination')},
    expected_out_raw: string(v.expected_out_raw, `${label}.expected_out_raw`, true), min_out_raw: string(v.min_out_raw, `${label}.min_out_raw`, true),
    fees, relay_request_id: string(v.relay_request_id, `${label}.relay_request_id`, true), solana, evm,
  };
}

export function parseSwapSnapshot(value: unknown, label = 'swap'): SwapSnapshot {
  const v = row(value, label); const prep = row(v.preparation, `${label}.preparation`); const execution = row(v.execution, `${label}.execution`); const settlement = row(v.settlement, `${label}.settlement`); const fill = row(v.fast_fill, `${label}.fast_fill`);
  return {
    swap_id: string(v.swap_id, `${label}.swap_id`), execution_group_id: string(v.execution_group_id, `${label}.execution_group_id`),
    event_version: decimal(v.event_version, `${label}.event_version`), intent: parseCreateIntent(v.intent, `${label}.intent`), intent_hash: string(v.intent_hash, `${label}.intent_hash`),
    preparation: {status: integer(prep.status, 'preparation.status'), current_revision: optionalString(prep.current_revision, 'preparation.current_revision'), retry_after_ms: optionalInteger(prep.retry_after_ms, 'preparation.retry_after_ms'), reason_code: optionalString(prep.reason_code, 'preparation.reason_code')},
    revision: parseRevision(v.revision, `${label}.revision`),
    execution: {status: integer(execution.status, 'execution.status'), artifact_hash: optionalString(execution.artifact_hash, 'execution.artifact_hash'), origin_tx_hash: optionalString(execution.origin_tx_hash, 'execution.origin_tx_hash'), relay_request_id: optionalString(execution.relay_request_id, 'execution.relay_request_id'), relay_execution_id: optionalString(execution.relay_execution_id, 'execution.relay_execution_id'), user_operation_hash: optionalString(execution.user_operation_hash, 'execution.user_operation_hash')},
    settlement: {source: integer(settlement.source, 'settlement.source'), destination: integer(settlement.destination, 'settlement.destination'), relay: integer(settlement.relay, 'settlement.relay'), accounting: integer(settlement.accounting, 'settlement.accounting'), outcome: integer(settlement.outcome, 'settlement.outcome'), amount_in_actual_raw: optionalString(settlement.amount_in_actual_raw, 'settlement.amount_in_actual_raw'), amount_out_actual_raw: optionalString(settlement.amount_out_actual_raw, 'settlement.amount_out_actual_raw'), amount_refunded_raw: optionalString(settlement.amount_refunded_raw, 'settlement.amount_refunded_raw'), destination_tx_hash: optionalString(settlement.destination_tx_hash, 'settlement.destination_tx_hash'), destination_observed_at: optionalString(settlement.destination_observed_at, 'settlement.destination_observed_at'), destination_finalized_at: optionalString(settlement.destination_finalized_at, 'settlement.destination_finalized_at'), refund_fee_delta_raw: optionalString(settlement.refund_fee_delta_raw, 'settlement.refund_fee_delta_raw')},
    fast_fill: {status: integer(fill.status, 'fast_fill.status'), reason_code: optionalString(fill.reason_code, 'fast_fill.reason_code')},
    availability: parseAvailability(v.availability, `${label}.availability`),
  };
}

export function parseContractData<T>(value: unknown, parse: (payload: Row) => T): T {
  const data = row(value, 'data');
  if (data.contract_version !== FAST_SWAP_CONTRACT_VERSION) throw new Error(`Unsupported Fast Swap contract: ${String(data.contract_version)}.`);
  return parse(data);
}
export const parseSwapReply = (value: unknown) => parseContractData(value, (data) => parseSwapSnapshot(data.swap));
export function parseCapabilities(value: unknown): {routes: SwapRoute[]; server_time: string} {
  return parseContractData(value, (data) => ({
    server_time: string(data.server_time, 'server_time'),
    routes: records(data.routes, 'routes').map((item) => { const v = row(item, 'route'); return {route_id: string(v.route_id, 'route.route_id'), origin_chain: string(v.origin_chain, 'route.origin_chain'), destination_chain: string(v.destination_chain, 'route.destination_chain'), side: integer(v.side, 'route.side'), enabled: bool(v.enabled, 'route.enabled'), signing_kinds: records(v.signing_kinds, 'route.signing_kinds').map((x) => integer(x, 'signing_kind')), broadcast_modes: records(v.broadcast_modes, 'route.broadcast_modes').map((x) => integer(x, 'broadcast_mode')), sponsorship_available: bool(v.sponsorship_available, 'route.sponsorship_available'), fast_fill_available: bool(v.fast_fill_available, 'route.fast_fill_available'), multi_revision_safe: bool(v.multi_revision_safe, 'route.multi_revision_safe'), unavailable_reason: optionalString(v.unavailable_reason, 'route.unavailable_reason')}; }),
  }));
}
export function parseActiveSwaps(value: unknown): {items: SwapSnapshot[]; next_cursor: string | null} {
  return parseContractData(value, (data) => ({items: records(data.items, 'items').map((item) => parseSwapSnapshot(item)), next_cursor: optionalString(data.next_cursor, 'next_cursor')}));
}
export function parseEvents(value: unknown): {items: SwapEvent[]; next_version: string; reset_required: boolean} {
  return parseContractData(value, (data) => ({items: records(data.items, 'items').map(parseSwapEvent), next_version: decimal(data.next_version, 'next_version'), reset_required: bool(data.reset_required, 'reset_required')}));
}
export function parseSwapEvent(value: unknown): SwapEvent {
  const v = row(value, 'event');
  return {swap_id: string(v.swap_id, 'event.swap_id'), event_version: decimal(v.event_version, 'event.event_version'), type: integer(v.type, 'event.type'), occurred_at: string(v.occurred_at, 'event.occurred_at'), trace_id: string(v.trace_id, 'event.trace_id'), snapshot: v.snapshot === null || v.snapshot === undefined ? null : parseSwapSnapshot(v.snapshot)};
}
export const parseAvailabilityReply = (value: unknown) => parseContractData(value, (data) => parseAvailability(data.availability, 'availability'));
export function parseStreamTicket(value: unknown): {ticket: string; expires_at: string; websocket_url: string} {
  return parseContractData(value, (data) => ({ticket: string(data.ticket, 'ticket'), expires_at: string(data.expires_at, 'expires_at'), websocket_url: string(data.websocket_url, 'websocket_url')}));
}

export function isReady(snapshot: SwapSnapshot): boolean {
  return snapshot.preparation.status === PreparationStatus.READY && snapshot.preparation.current_revision !== null && snapshot.revision.revision === snapshot.preparation.current_revision && snapshot.revision.intent_hash === snapshot.intent_hash && ((snapshot.revision.solana !== null) !== (snapshot.revision.evm !== null));
}
export function serverAllowsSigning(snapshot: SwapSnapshot): boolean {
  return isReady(snapshot) && snapshot.execution.status === ExecutionStatus.NOT_REPORTED;
}
export function isTerminal(snapshot: SwapSnapshot): boolean {
  return [Outcome.COMPLETED, Outcome.CANCELLED, Outcome.EXPIRED_UNEXECUTED, Outcome.FAILED_NO_DEBIT, Outcome.REFUNDED].includes(snapshot.settlement.outcome as never);
}
export function newerSnapshot(current: SwapSnapshot | undefined, next: SwapSnapshot): SwapSnapshot {
  if (!current || current.swap_id !== next.swap_id) return next;
  if (BigInt(next.event_version) < BigInt(current.event_version)) return current;
  // Ordinary snapshots explicitly carry "not measured", not a new zero balance.
  // Preserve the last measured result only for the same destination identity.
  if (!next.availability.observed_at && current.availability.observed_at &&
      next.settlement.destination !== ChainLegStatus.REORGED &&
      current.availability.wallet_id === next.intent.destination_wallet_id &&
      current.availability.chain === next.intent.destination_chain &&
      current.availability.asset === next.intent.destination_asset) {
    return {...next, availability:current.availability};
  }
  return next;
}
