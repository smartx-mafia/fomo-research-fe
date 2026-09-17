// Fast Swap v2（`/v2/swaps`）的线格式。
//
// 真值：后端仓 `api/fastswap/v1/fastswap.proto` 与 `docs/contracts/fastswap.md`。
// 术语见本仓 `CONTEXT.md`。三条线格式纪律全部做进类型：
//   ① 枚举在线上是**数字**；0 与认不出的值一律当「未知」，不近似成已知值（§4）
//   ② 大数（原子金额、revision、event_version、nonce、块高）一律**十进制字符串**
//   ③ 字段恒在场；只有未选中的 oneof 与未设置的 optional 是 `null`（§0）——
//      所以 `revision` 恒是一个对象，**能不能签只看 `preparation.status`**

export const CONTRACT_VERSION = 'fast-swap.v1';

export const Side = {BUY: 1, SELL: 2, SWAP: 3} as const;
export const FeePolicy = {PLATFORM_SPONSORED: 1} as const;
export const PreparationStatus = {PREPARING: 1, READY: 2, REFRESHING: 3, EXPIRED: 4, BLOCKED: 5} as const;
export const ExecutionStatus = {NOT_REPORTED: 1, REPORTED: 2, ACCEPTED: 3, UNKNOWN: 4, FAILED: 5} as const;
export const ChainLegStatus = {NOT_SEEN: 1, OBSERVED: 2, CONFIRMED: 3, REORGED: 4} as const;
export const RelayStatus = {PENDING: 1, FILLED: 2, REFUNDING: 3, REFUNDED: 4, FAILED: 5} as const;
export const AccountingStatus = {PENDING: 1, POSTED: 2, REVERSAL_PENDING: 3, REVERSED: 4} as const;
export const Outcome = {
  PENDING: 1,
  COMPLETED: 2,
  CANCEL_PENDING: 3,
  CANCELLED: 4,
  EXPIRED_UNEXECUTED: 5,
  FAILED_NO_DEBIT: 6,
  REFUNDING: 7,
  REFUNDED: 8,
  ATTENTION_REQUIRED: 9,
} as const;
export const SigningKind = {SOLANA_TRANSACTION: 1, EVM_CALIBUR: 2, EVM_PERMIT: 3} as const;
export const EvmSigningMethod = {SIGN_TYPED_DATA_V4: 1, EIP7702_AUTHORIZATION: 2} as const;
export const BroadcastResult = {ACCEPTED: 1, UNKNOWN: 2, REJECTED: 3} as const;

/** 数字枚举 → 给人看的名字。认不出的值显示成「未知(n)」，不猜。 */
function labeler(names: Record<number, string>) {
  return (v: number | null | undefined): string =>
    v != null && names[v] !== undefined ? names[v]! : `未知(${v ?? 'null'})`;
}

export const sideLabel = labeler({1: 'buy', 2: 'sell', 3: 'swap'});
export const preparationLabel = labeler({1: '准备中', 2: '可签', 3: '刷新中', 4: '已过期', 5: '受阻'});
export const executionLabel = labeler({1: '未上报', 2: '已上报', 3: '出口已接受', 4: '结果未知', 5: '出口拒绝'});
export const chainLegLabel = labeler({1: '未见', 2: '已观察', 3: '已确认', 4: '重组'});
export const relayLabel = labeler({1: '处理中', 2: '已成交', 3: '退款中', 4: '已退款', 5: '失败'});
export const accountingLabel = labeler({1: '待入账', 2: '已入账', 3: '冲正中', 4: '已冲正'});
export const outcomeLabel = labeler({
  1: '进行中',
  2: '完成',
  3: '取消中',
  4: '已取消',
  5: '过期未执行',
  6: '失败·未扣款',
  7: '退款中',
  8: '已退款',
  9: '需人工核实',
});

/**
 * 徽章颜色：**灰=还没发生，黄=进行中，绿=这一档走完，红=出事**。
 *
 * 一个值映射一种颜色，而不是在 UI 里写一串三目：漏一个分支不会报错，
 * 只表现为"某个状态永远是灰的"，而那正好与「还没发生」同形，看不出来。
 * 认不出的值给灰 —— 不假装它是成功。
 */
export type Tone = 'off' | 'run' | 'ok' | 'err';

function toner(map: Record<number, Tone>) {
  return (v: number | null | undefined): Tone => (v != null && map[v] !== undefined ? map[v]! : 'off');
}

export const preparationTone = toner({1: 'run', 2: 'ok', 3: 'run', 4: 'err', 5: 'err'});
/** 未上报=灰；已上报=黄；出口已接受=绿；结果未知=黄（**不是失败，禁止重签**）；出口拒绝=红。 */
export const executionTone = toner({1: 'off', 2: 'run', 3: 'ok', 4: 'run', 5: 'err'});
export const chainLegTone = toner({1: 'off', 2: 'run', 3: 'ok', 4: 'err'});
/** 退款中 / 已退款都不是绿：钱回来了，但这笔交易没做成。 */
export const relayTone = toner({1: 'run', 2: 'ok', 3: 'run', 4: 'err', 5: 'err'});
export const accountingTone = toner({1: 'off', 2: 'ok', 3: 'run', 4: 'err'});
/** 只有「完成」是绿（契约 §5：两条链确认 + Relay 成交 + 账务入账 + 有实际到手）。 */
export const outcomeTone = toner({
  1: 'run',
  2: 'ok',
  3: 'run',
  4: 'off',
  5: 'off',
  6: 'err',
  7: 'run',
  8: 'err',
  9: 'err',
});

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

/** 展示报价的请求体 = CreateIntent 去掉 client_intent_id。 */
export type QuoteRequest = Omit<CreateIntent, 'client_intent_id'>;

export type AssetRef = {chain: string; address: string; decimals: number};
export type RevisionAssets = {origin: AssetRef; destination: AssetRef};
export type RevisionFee = {chain: string; asset: string; amount_raw: string; payer: number; kind: number};

export type SolanaSigning = {
  kind: number;
  transaction_base64: string;
  /** sha256(message 字节) 的小写 hex。 */
  message_hash: string;
  fee_payer_address: string;
  user_signer_address: string;
  blockhash: string;
  last_valid_block_height: string;
  lookup_tables: {address: string; addresses: string[]; last_extended_slot: string; observed_slot: string}[];
  broadcast: {mode: number; endpoint_id: string; backup_endpoint_id: string | null};
};

export type Eip712TypedData = {
  domain: Record<string, unknown>;
  types: Record<string, {name: string; type: string}[]>;
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
  /** Calibur 批次的 EIP-712 摘要，0x hex。 */
  execution_digest: string;
  nonce: string;
  /** RFC3339 串，**不是**链上的秒数。 */
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
  assets: RevisionAssets;
  expected_out_raw: string;
  min_out_raw: string;
  fees: RevisionFee[];
  relay_request_id: string;
  solana: SolanaSigning | null;
  evm: EvmSigning | null;
};

export type SwapSnapshot = {
  swap_id: string;
  execution_group_id: string;
  event_version: string;
  intent: CreateIntent;
  intent_hash: string;
  preparation: {
    status: number;
    current_revision: string | null;
    retry_after_ms: number | null;
    reason_code: string | null;
  };
  revision: PreparedRevision;
  execution: {
    status: number;
    artifact_hash: string | null;
    origin_tx_hash: string | null;
    relay_request_id: string | null;
    relay_execution_id: string | null;
    user_operation_hash: string | null;
    /** 预检 / 模拟被拒的成因（slippage / insufficient_funds / unknown）。只在 FAILED 且来自 Solana 预检时有值（fastswap.md §5.1）。 */
    failure_cause: string | null;
    /** 与 failure_cause 成对：adjust_slippage / change_input / refresh_quote —— 都意味着建一笔**新**意图。 */
    recovery_action: string | null;
  };
  settlement: {
    source: number;
    destination: number;
    relay: number;
    accounting: number;
    outcome: number;
    amount_in_actual_raw: string | null;
    amount_out_actual_raw: string | null;
    amount_refunded_raw: string | null;
    destination_tx_hash: string | null;
    destination_observed_at: string | null;
    destination_finalized_at: string | null;
    refund_fee_delta_raw: string | null;
  };
  fast_fill: {status: number; reason_code: string | null};
  availability: {
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
};

export type SwapRoute = {
  route_id: string;
  origin_chain: string;
  destination_chain: string;
  side: number;
  enabled: boolean;
  signing_kinds: number[];
  broadcast_modes: number[];
  sponsorship_available: boolean;
  fast_fill_available: boolean;
  multi_revision_safe: boolean;
  unavailable_reason: string | null;
};

export type CapabilitiesReply = {contract_version: string; routes: SwapRoute[]; server_time: string};
export type SwapReply = {contract_version: string; swap: SwapSnapshot};
export type ActiveReply = {contract_version: string; items: SwapSnapshot[]; next_cursor: string | null};

export type QuoteReply = {
  contract_version: string;
  route_id: string;
  signing_kind: number;
  assets: RevisionAssets;
  expected_out_raw: string;
  min_out_raw: string;
  /** true = `min_out_raw` 是本地推算的，前端要标「约」。 */
  estimate: boolean;
  fees: RevisionFee[];
  quoted_at: string;
};

export type SwapEvent = {
  swap_id: string;
  event_version: string;
  type: number;
  occurred_at: string;
  trace_id: string;
  snapshot: SwapSnapshot | null;
};

export type EventsReply = {
  contract_version: string;
  items: SwapEvent[];
  next_version: string;
  reset_required: boolean;
  /** `null` = 终态，停止轮询（§7）。判停**只**看它 `=== null`。 */
  poll_after_ms: number | null;
};

export type ExecutionReport = {
  revision: string;
  intent_hash: string;
  solana_transaction: {signed_transaction_base64: string} | null;
  evm_signatures: {signatures: {request_id: string; signature: string}[]} | null;
};

export type TelemetryEvent = {
  client_attempt_id?: string;
  swap_id?: string;
  revision?: string;
  name: string;
  monotonic_ms: number;
  wall_time: string;
  attributes?: Record<string, string>;
};

export type TelemetryReply = {contract_version: string; accepted_count: number; rejected_count: number};

/** 契约 §9 metadata.recovery_action 的已知取值；认不得的按 `get_snapshot` 处理。 */
export type RecoveryAction =
  | 'change_input'
  | 'get_snapshot'
  | 'refresh_quote'
  | 'retry_same_request'
  | 'new_idempotency_key'
  | 'contact_support'
  | 'adjust_slippage';

const KNOWN_RECOVERY: readonly string[] = [
  'change_input',
  'get_snapshot',
  'refresh_quote',
  'retry_same_request',
  'new_idempotency_key',
  'contact_support',
  'adjust_slippage',
];

export function recoveryActionOf(raw: string | undefined): RecoveryAction {
  return raw && KNOWN_RECOVERY.includes(raw) ? (raw as RecoveryAction) : 'get_snapshot';
}
