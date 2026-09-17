'use client';

import {usePrivy, useWallets as useEvmWallets} from '@privy-io/react-auth';
import {useSignMessage as useSolanaSignMessage, useSignTransaction, useWallets as useSolanaWallets} from '@privy-io/react-auth/solana';
import {AlertTriangle, ArrowRight, CheckCircle2, Clock3, LoaderCircle, RefreshCw, ShieldCheck, WalletCards} from 'lucide-react';
import {useSearchParams} from 'next/navigation';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {TokenAvatar} from '@/components/TokenAvatar';
import {SOLANA_RPC_URL} from '@/config';
import {useSession} from '@/session/storage';

import {
  cancelSwap, createSwap, FastSwapApiError, getCapabilities, getLatestFastSwapTrace, getSwap, getSwapAvailability,
  listActiveSwaps, listSwapEvents, refreshSwap, reportEvmExecution, reportSolanaExecution, reportTelemetry,
  subscribeFastSwapTrace, type RequestTimingReporter,
} from './api';
import {formatUnits, shortAddress} from './amount';
import {
  AccountingStatus, ChainLegStatus, ExecutionStatus, FastFillStatus, FeePolicy, isReady, isTerminal, serverAllowsSigning,
  newerSnapshot, Outcome, PreparationStatus, RelayStatus, Side, SigningKind, BroadcastMode,
  type CreateIntent, type SwapRoute, type SwapSnapshot,
} from './contract';
import {clearPendingExecutionIfMatch, readPendingExecution, writePendingExecution, type PendingExecution} from './pending-execution';
import {decideCreateRecovery} from './idempotency';
import {clearRecovery, readRecovery, writeRecovery, type FastSwapRecovery} from './recovery';
import {signEvmRevision, signSolanaRevision, verifySolanaChainState} from './signing';
import {watchSwap} from './stream';
import {draftKey, signingDeadline, unsignedQuote, validDraft, type QuoteDraft} from './auto-quote';
import {useAutoQuote} from './useAutoQuote';
import {solanaRevisionExpired} from './signing';
import {
  beginSignAttempt, finishSignAttempt, flushTimingEvidence, getTimingExperimentGroup, markSwapTiming,
  observeBrowserDiagnostics, recordDiagnosticOverhead, recordHttpAttemptEvent, recordPageTiming, recordSnapshotTiming,
  scheduleTimingFlush, setTimingActor, setTimingExperimentGroup, startTimingRun, timingEvidence, timingRunOptions,
} from './timing';
import {fastSwapWallets, signerByAddress, walletForChain} from './wallets';

type TimingRow = {name: string; duration: number; at: string};
type PrewarmState = {key: string; status: 'idle' | 'running' | 'succeeded' | 'failed'; durationMS: number | null};

const inputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent';
const labelClass = 'space-y-1 text-xs text-muted';
const RECOMMENDED_SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RECOMMENDED_WSOL = 'So11111111111111111111111111111111111111112';
const PRIVY_PREWARM_SESSION_TIMEOUT_MS = 4000;

function chainQuery(value: string | null): string {
  const known: Record<string, string> = {solana: 'solana:mainnet', base: 'eip155:8453', ethereum: 'eip155:1', bsc: 'eip155:56', robinhood: 'eip155:4663'};
  return value ? known[value.toLowerCase()] ?? value : '';
}
function metadataAssetAddress(chain: string | undefined, address: string): string {
  const candidate = address.trim();
  if (!chain) return '';
  if (chain.startsWith('eip155:')) return /^0x[0-9a-f]{40}$/i.test(candidate) ? candidate : '';
  if (chain === 'solana:mainnet') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(candidate) ? candidate : '';
  return '';
}
function sideQuery(value: string | null): number | undefined {
  return value === 'buy' ? Side.BUY : value === 'sell' ? Side.SELL : value === 'swap' ? Side.SWAP : undefined;
}
function uuid(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error('This browser cannot create secure request identifiers.');
  return crypto.randomUUID();
}
function errorText(error: unknown): string {
  if (!(error instanceof FastSwapApiError)) return error instanceof Error ? error.message : String(error);
  const map: Record<number, string> = {
    100601: '交易参数不合法，请检查链、资产、原子金额与滑点。',
    400602: '选择的钱包不属于当前账号，或与目标链不匹配。',
    420603: '该钱包已有交易正在处理中，请先恢复原交易。',
    430604: '当前报价已过期，请刷新同一笔交易。',
    420605: '交易版本已在另一页面更新，正在恢复最新状态。',
    420606: '同一个幂等键对应了不同请求，请停止操作并联系支持。',
    100607: '钱包签名未通过服务端验证。',
    100608: '签名内容与服务端准备的交易不一致。',
    500609: '平台代付暂时不可用。',
    430611: '当前部署不支持这条兑换路线。',
    430614: '这笔交易需要先恢复状态，不能继续普通操作。',
    200616: '找不到这笔交易，或它不属于当前账号。',
    420000: '请求过于频繁，请稍后重试。',
    400000: '登录已失效，请重新登录后恢复同一笔交易。',
  };
  if (error.code === 100601 && /too many active swaps/i.test(error.message)) {
    return `同时在途交易已达到上限，请先从右侧列表取消不需要的交易。${error.traceID ? ` trace=${error.traceID}` : ''}`;
  }
  const trace = error.traceID ? ` trace=${error.traceID}` : '';
  return `${map[error.code] ?? 'Fast Swap 请求失败，请按当前交易状态恢复。'}${trace}`;
}
function clearDefinitiveCreateFailure(actor: string, error: unknown): boolean {
  if (decideCreateRecovery(error).kind !== 'change_input') return false;
  clearRecovery(actor);
  return true;
}
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, {once: true});
  });
}
async function createWithRecovery(
  bearer: string,
  original: FastSwapRecovery,
  signal?: AbortSignal,
): Promise<{snapshot: SwapSnapshot; recovery: FastSwapRecovery}> {
  let recovery = original;
  let lastError: unknown;
  if (recovery.create_recovery_action === 'retry_same_request' && recovery.create_retry_after_at) {
    const remaining = Date.parse(recovery.create_retry_after_at) - Date.now();
    if (Number.isFinite(remaining) && remaining > 0) await delay(remaining, signal);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Aborted','AbortError');
    try { return {snapshot: await createSwap(bearer, recovery.intent, recovery.create_idempotency_key, signal), recovery}; }
    catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      const decision = decideCreateRecovery(error);
      if (decision.kind === 'retry_new_key') {
        recovery = {...recovery, create_idempotency_key: uuid(), create_recovery_action: 'new_idempotency_key', create_retry_after_at: undefined, create_related_swap_id: undefined, last_trace_id: error instanceof FastSwapApiError ? error.traceID : getLatestFastSwapTrace(), updated_at: new Date().toISOString()};
        if (!writeRecovery(recovery)) throw new Error('Cannot persist the replacement Idempotency-Key; request was not retried.');
        continue;
      }
      if (decision.kind === 'retry_same_key') {
        const retryAt = new Date(Date.now() + decision.delayMS).toISOString();
        recovery = {...recovery, create_recovery_action: 'retry_same_request', create_retry_after_at: retryAt, create_related_swap_id: undefined, last_trace_id: error instanceof FastSwapApiError ? error.traceID : getLatestFastSwapTrace(), updated_at: new Date().toISOString()};
        if (!writeRecovery(recovery)) throw new Error('Cannot persist the retry schedule; request was not retried.');
        await delay(decision.delayMS, signal);
        continue;
      }
      const action = decision.kind === 'get_snapshot' ? 'get_snapshot' : decision.kind;
      recovery = {...recovery, create_recovery_action: action, create_retry_after_at: undefined, create_related_swap_id: decision.kind === 'get_snapshot' ? decision.relatedSwapID : undefined, last_trace_id: error instanceof FastSwapApiError ? error.traceID : getLatestFastSwapTrace(), updated_at: new Date().toISOString()};
      writeRecovery(recovery);
      throw error;
    }
  }
  throw lastError;
}
async function findCreateSnapshot(
  bearer: string,
  intent: CreateIntent,
  relatedSwapID?: string,
  signal?: AbortSignal,
): Promise<SwapSnapshot | undefined> {
  if (relatedSwapID) return getSwap(bearer, relatedSwapID, signal);
  const active = await listActiveSwaps(bearer, '', 20, signal);
  return active.items.find((item) => item.intent.client_intent_id === intent.client_intent_id);
}
async function recoverCreateSnapshot(
  bearer: string,
  error: unknown,
  intent: CreateIntent,
  signal?: AbortSignal,
): Promise<SwapSnapshot | undefined> {
  const decision = decideCreateRecovery(error);
  if (decision.kind !== 'get_snapshot') return undefined;
  return findCreateSnapshot(bearer, intent, decision.relatedSwapID, signal);
}
async function submitExecutionWithRecovery(
  bearer: string,
  original: PendingExecution,
  update: (pending: PendingExecution) => void,
  timing?: RequestTimingReporter,
): Promise<{snapshot: SwapSnapshot; pending: PendingExecution}> {
  let pending = original;
  let lastError: unknown;
  if (pending.recoveryAction === 'retry_same_request' && pending.retryAfterAt) {
    const remaining = Date.parse(pending.retryAfterAt) - Date.now();
    if (Number.isFinite(remaining) && remaining > 0) await delay(remaining);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const snapshot = pending.kind === 'solana'
        ? await reportSolanaExecution(bearer, pending.swapID, pending.revision, pending.intentHash, pending.signed, pending.idempotencyKey, undefined, timing)
        : await reportEvmExecution(bearer, pending.swapID, pending.revision, pending.intentHash, pending.signatures, pending.idempotencyKey, undefined, timing);
      return {snapshot, pending};
    } catch (error) {
      lastError = error;
      const decision = decideCreateRecovery(error);
      if (decision.kind === 'retry_new_key') {
        pending = {...pending, idempotencyKey: uuid(), recoveryAction: 'new_idempotency_key', retryAfterAt: undefined, lastTraceID: error instanceof FastSwapApiError ? error.traceID : getLatestFastSwapTrace(), savedAt: new Date().toISOString()};
        if (!await writePendingExecution(pending)) throw new Error('Cannot persist the replacement execution Idempotency-Key; request was not retried.');
        update(pending);
        continue;
      }
      if (decision.kind === 'retry_same_key') {
        pending = {...pending, recoveryAction: 'retry_same_request', retryAfterAt: new Date(Date.now() + decision.delayMS).toISOString(), lastTraceID: error instanceof FastSwapApiError ? error.traceID : getLatestFastSwapTrace(), savedAt: new Date().toISOString()};
        if (!await writePendingExecution(pending)) throw new Error('Cannot persist the execution retry schedule; request was not retried.');
        update(pending);
        await delay(decision.delayMS);
        continue;
      }
      const recoveryAction = decision.kind === 'contact_support' ? 'contact_support' : decision.kind === 'do_not_retry' ? 'do_not_retry' : 'get_snapshot';
      pending = {...pending, recoveryAction, retryAfterAt: undefined, lastTraceID: error instanceof FastSwapApiError ? error.traceID : getLatestFastSwapTrace(), savedAt: new Date().toISOString()};
      await writePendingExecution(pending);
      update(pending);
      throw error;
    }
  }
  throw lastError;
}
function statusLabel(value: number, labels: Record<number, string>): string { return labels[value] ?? '未知'; }
const sourceLabels = {0: '未知', 1: '未发现', 2: '已观察', 3: '已确认', 4: '发生重组'};
const relayLabels = {0: '未知', 1: '处理中', 2: '已交付', 3: '退款中', 4: '已退款', 5: '失败'};
const accountingLabels = {0: '未知', 1: '处理中', 2: '已入账', 3: '冲正中', 4: '已冲正'};
const fastFillLabels = {0: '未知', 1: '未启用', 2: '可加速', 3: '已请求', 4: '已接受', 5: '结果未知', 6: '已拒绝', 7: '额度已释放', 8: '平台损失'};
function outcomeLabel(value: number): string {
  return statusLabel(value, {0: '未知', 1: '处理中', 2: '交易完成', 3: '取消核实中', 4: '已取消', 5: '未执行并已过期', 6: '失败且未扣款', 7: '退款中', 8: '已退款', 9: '需要人工核实'});
}
function routeLabel(route: SwapRoute): string {
  const side = route.side === Side.BUY ? '买入' : route.side === Side.SELL ? '卖出' : '兑换';
  return `${side} · ${route.origin_chain} → ${route.destination_chain}${route.fast_fill_available ? ' · Fast Fill' : ''}`;
}
function supportsRoute(route: SwapRoute): boolean {
  return route.signing_kinds.length === 1 &&
    [SigningKind.SOLANA_TRANSACTION, SigningKind.EVM_CALIBUR].includes(route.signing_kinds[0] as never) &&
    route.broadcast_modes.includes(BroadcastMode.GATEWAY);
}
function preparationLabel(snapshot: SwapSnapshot): string {
  if (isTerminal(snapshot)) return '已收尾';
  if (snapshot.execution.status !== ExecutionStatus.NOT_REPORTED) return '已提交，禁止重签';
  return statusLabel(snapshot.preparation.status, {0: '未知', 1: '正在准备', 2: '可以签名', 3: '正在刷新', 4: '报价已过期', 5: '暂不可执行'});
}
function mutationSatisfied(operation: NonNullable<FastSwapRecovery['pending_operation']>, snapshot: SwapSnapshot): boolean {
  if (operation.kind === 'cancel') return [Outcome.CANCEL_PENDING, Outcome.CANCELLED, Outcome.EXPIRED_UNEXECUTED].includes(snapshot.settlement.outcome as never);
  return snapshot.preparation.current_revision !== operation.expected_revision || snapshot.preparation.status === PreparationStatus.REFRESHING;
}

export default function FastSwapPage() {
  const params = useSearchParams();
  const session = useSession();
  const {ready: privyReady, authenticated, user, getAccessToken} = usePrivy();
  const {wallets: evmSigners, ready: evmReady} = useEvmWallets();
  const {wallets: solanaSigners, ready: solanaReady} = useSolanaWallets();
  const {signMessage: signSolanaWarmupMessage} = useSolanaSignMessage();
  const {signTransaction} = useSignTransaction();
  const managedWallets = useMemo(() => fastSwapWallets(user?.linkedAccounts ?? []), [user?.linkedAccounts]);

  const [routes, setRoutes] = useState<SwapRoute[]>([]);
  const [routeID, setRouteID] = useState('');
  const [sourceAsset, setSourceAsset] = useState(() => params.get('source_asset') ?? RECOMMENDED_SOLANA_USDC);
  const [destinationAsset, setDestinationAsset] = useState(() => params.get('address') ?? params.get('destination_asset') ?? RECOMMENDED_WSOL);
  const [amountRaw, setAmountRaw] = useState(() => params.get('amount_raw') ?? '');
  const [slippage, setSlippage] = useState(() => params.get('slippage_bps') ?? '300');
  const [snapshotState, setSnapshot] = useState<SwapSnapshot>();
  const [activeState, setActive] = useState<SwapSnapshot[]>([]);
  const [busy, setBusy] = useState<'loading' | 'preparing' | 'signing' | 'reporting' | 'refreshing' | 'cancelling' | null>('loading');
  const [error, setError] = useState<string>();
  const [streamStatus, setStreamStatus] = useState('idle');
  const [pendingExecutionState, setPendingExecution] = useState<PendingExecution>();
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [pendingDurable, setPendingDurable] = useState(false);
  const [unresolvedArtifact, setUnresolvedArtifact] = useState(false);
  const [timings, setTimings] = useState<TimingRow[]>([]);
  const [evidence, setEvidence] = useState('');
  const [evidenceRunID, setEvidenceRunID] = useState('');
  const [experimentGroup, setExperimentGroup] = useState<'A' | 'B'>(() => getTimingExperimentGroup() === 'B' ? 'B' : 'A');
  const [latestTrace, setLatestTrace] = useState(() => getLatestFastSwapTrace());
  const [serverOffset, setServerOffset] = useState(0);
  const [readyUntil, setReadyUntil] = useState(0);
  const [blockedRetryUntil, setBlockedRetryUntil] = useState(0);
  const [solanaVerifiedRevision, setSolanaVerifiedRevision] = useState<string>();
  const [prewarmState, setPrewarmState] = useState<PrewarmState>({key:'',status:'idle',durationMS:null});
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== 'hidden');
  const [now, setNow] = useState(() => performance.now());
  const readyClock = useRef({key:'',until:0});
  const readyDeadlines = useRef(new Map<string, number>());
  const [autoRequested, setAutoRequested] = useState(() => Boolean(params.get('amount_raw')));
  const [inputVersion, setInputVersion] = useState(0);
  const formEdited = useRef(Boolean(params.get('amount_raw')));
  const generationRef = useRef(0);
  const eventVersionRef = useRef('0');
  const executionLockRef = useRef(false);
  const selectedSwapIDRef = useRef<string | undefined>(undefined);
  const pendingSwapIDRef = useRef<string | undefined>(undefined);
  const sessionJWTRef = useRef<string | undefined>(undefined);
  const signerContextRef = useRef('');
  const pendingDurableRef = useRef(false);
  const prewarmInFlightRef = useRef(false);
  const prewarmDesiredKeyRef = useRef('');
  const warmedPrewarmKeysRef = useRef(new Set<string>());
  const authScopeRef = useRef('');
  const readinessRef = useRef({privy: false, authenticated: false, evm: false, solana: false});
  const actor = session?.user?.identifier;
  const currentAuthScope = `${actor ?? ''}\u0000${session?.jwt ?? ''}`;
  useEffect(() => {
    setTimingActor(actor); setEvidence(''); setEvidenceRunID('');
    if (actor) {
      observeBrowserDiagnostics();
      recordPageTiming('fast_swap_page_mounted', {development_mode: process.env.NODE_ENV === 'development'});
    }
    return () => setTimingActor(undefined);
  }, [actor]);
  useEffect(() => {
    if (!actor) return;
    const previous = readinessRef.current;
    recordPageTiming('privy_readiness', {previous_ready: previous.privy, ready: privyReady, authenticated, elapsed_from_navigation_ms: performance.now()});
    readinessRef.current = {...previous, privy: privyReady, authenticated};
    scheduleTimingFlush();
  }, [actor, authenticated, privyReady]);
  useEffect(() => {
    if (!actor) return;
    const previous = readinessRef.current;
    recordPageTiming('wallet_readiness', {previous_evm_ready: previous.evm, evm_ready: evmReady, previous_solana_ready: previous.solana, solana_ready: solanaReady, elapsed_from_navigation_ms: performance.now()});
    readinessRef.current = {...previous, evm: evmReady, solana: solanaReady};
    scheduleTimingFlush();
  }, [actor, evmReady, solanaReady]);
  useEffect(() => { setTimingExperimentGroup(experimentGroup); }, [experimentGroup]);
  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);
  // Hide the previous actor's private snapshot on the first render of an auth switch,
  // before cleanup effects get a chance to run.
  const snapshot = authScopeRef.current === '' || authScopeRef.current === currentAuthScope ? snapshotState : undefined;
  const active = authScopeRef.current === '' || authScopeRef.current === currentAuthScope ? activeState : [];
  const pendingExecution = pendingExecutionState?.actor === actor ? pendingExecutionState : undefined;
  const selectedRoute = routes.find((route) => route.route_id === routeID);
  const sourceMetadataAddress = metadataAssetAddress(selectedRoute?.origin_chain, sourceAsset);
  const destinationMetadataAddress = metadataAssetAddress(selectedRoute?.destination_chain, destinationAsset);
  const sourceWallet = selectedRoute ? walletForChain(managedWallets, selectedRoute.origin_chain) : undefined;
  const destinationWallet = selectedRoute ? walletForChain(managedWallets, selectedRoute.destination_chain) : undefined;
  selectedSwapIDRef.current = snapshot?.swap_id;
  pendingSwapIDRef.current = pendingExecution?.swapID;
  pendingDurableRef.current = pendingDurable;
  sessionJWTRef.current = session?.jwt;
  signerContextRef.current = JSON.stringify([user?.id ?? '', ...evmSigners.map((wallet) => `e:${wallet.address.toLowerCase()}`).toSorted(), ...solanaSigners.map((wallet) => `s:${wallet.address}`).toSorted()]);

  const applySnapshot = useCallback((next: SwapSnapshot) => {
    recordSnapshotTiming(next);
    setSnapshot((current) => newerSnapshot(current, next));
    eventVersionRef.current = BigInt(next.event_version) > BigInt(eventVersionRef.current) ? next.event_version : eventVersionRef.current;
    setActive((items) => {
      const found = items.some((item) => item.swap_id === next.swap_id);
      const updated = found ? items.map((item) => item.swap_id === next.swap_id ? newerSnapshot(item, next) : item) : [next, ...items];
      return isTerminal(next) ? updated.filter((item) => item.swap_id !== next.swap_id) : updated;
    });
    if (actor && (next.execution.status !== ExecutionStatus.NOT_REPORTED || isTerminal(next))) {
      setPendingExecution((pending) => {
        if (pending?.swapID !== next.swap_id) return pending;
        void clearPendingExecutionIfMatch(pending);
        return undefined;
      });
    }
    if (actor && next.execution.status !== ExecutionStatus.NOT_REPORTED) {
      const stored = readRecovery(actor);
      if (stored?.swap_id === next.swap_id) {
        setUnresolvedArtifact(false);
        setPendingDurable(false); pendingDurableRef.current = false;
        writeRecovery({...stored, execution_idempotency_key: null, updated_at: new Date().toISOString()});
      }
    }
    if (actor && isTerminal(next)) {
      const stored = readRecovery(actor);
      if (stored?.swap_id === next.swap_id) clearRecovery(actor);
    }
  }, [actor]);

  useEffect(() => {
    if (!actor) { setPendingExecution(undefined); setPendingDurable(false); setPendingLoaded(true); setUnresolvedArtifact(false); return; }
    let active = true; setPendingExecution(undefined); setPendingDurable(false); pendingDurableRef.current = false; setUnresolvedArtifact(false); setPendingLoaded(false);
    readPendingExecution(actor).then((pending) => {
      if (!active) return;
      setPendingExecution(pending ?? undefined);
      setPendingDurable(Boolean(pending)); pendingDurableRef.current = Boolean(pending);
      if (pending?.lastTraceID) setLatestTrace(pending.lastTraceID);
      const marker = readRecovery(actor);
      setUnresolvedArtifact(Boolean(marker?.execution_idempotency_key && !pending));
    }).finally(() => { if (active) setPendingLoaded(true); });
    return () => { active = false; };
  }, [actor]);

  // A terminal snapshot can arrive before IndexedDB finishes loading. In that
  // order applySnapshot cannot see the pending artifact, and the later storage
  // callback would resurrect it and keep "new test" disabled forever. Reconcile
  // both arrival orders against the authoritative terminal server state.
  useEffect(() => {
    if (!actor || !pendingExecution || !snapshot || pendingExecution.swapID !== snapshot.swap_id || !isTerminal(snapshot)) return;
    void clearPendingExecutionIfMatch(pendingExecution);
    setPendingExecution(undefined);
    setPendingDurable(false); pendingDurableRef.current = false;
    setUnresolvedArtifact(false);
    const stored = readRecovery(actor);
    if (stored?.swap_id === snapshot.swap_id) clearRecovery(actor);
  }, [actor, pendingExecution, snapshot]);

  useEffect(() => {
    const scope = currentAuthScope;
    if (scope === authScopeRef.current) return;
    authScopeRef.current = scope;
    generationRef.current += 1;
    selectedSwapIDRef.current = undefined; eventVersionRef.current = '0';
    readyDeadlines.current.clear(); readyClock.current = {key:'',until:0}; setReadyUntil(0);
    setSnapshot(undefined); setActive([]); setRoutes([]); setRouteID(''); setStreamStatus('idle'); setError(undefined);
    formEdited.current = Boolean(params.get('amount_raw'));
    setAutoRequested(Boolean(params.get('amount_raw'))); setInputVersion(n=>n+1);
    return () => { generationRef.current += 1; };
  }, [currentAuthScope]);

  useEffect(() => {
    // Only the accepted snapshot may update the clock; rejected late revisions
    // must not extend the current transaction's signing window.
    if (snapshot?.preparation.status === PreparationStatus.READY && snapshot.preparation.retry_after_ms !== null) {
      readyClock.current = signingDeadline(readyDeadlines.current,snapshot,performance.now());
      setReadyUntil(readyClock.current.until);
    }
    if (snapshot?.preparation.status === PreparationStatus.BLOCKED && snapshot.preparation.retry_after_ms !== null) {
      setBlockedRetryUntil(performance.now() + snapshot.preparation.retry_after_ms);
    }
  }, [snapshot?.swap_id, snapshot?.event_version, snapshot?.preparation.current_revision, snapshot?.preparation.status, snapshot?.preparation.retry_after_ms]);

  useEffect(() => {
    const signing = snapshot?.revision.solana;
    if (!snapshot || !serverAllowsSigning(snapshot) || !signing) { setSolanaVerifiedRevision(undefined); return; }
    let active = true;
    setSolanaVerifiedRevision(undefined);
    verifySolanaChainState(signing, SOLANA_RPC_URL)
      .then(() => { if (active) setSolanaVerifiedRevision(snapshot.revision.revision); })
      .catch((reason) => { if (active) setError(errorText(reason)); });
    return () => { active = false; };
  }, [snapshot?.revision.revision, snapshot?.swap_id, snapshot?.preparation.status, snapshot?.execution.status]);

  useEffect(() => { const timer = setInterval(() => setNow(performance.now()), 250); return () => clearInterval(timer); }, []);
  useEffect(() => subscribeFastSwapTrace(setLatestTrace), []);

  useEffect(() => {
    if (!snapshot || formEdited.current) return;
    const intent = snapshot.intent;
    setSourceAsset(intent.origin_asset); setDestinationAsset(intent.destination_asset);
    setAmountRaw(intent.amount_in_raw); setSlippage(String(intent.slippage_bps));
    const route = routes.find(item => item.origin_chain === intent.origin_chain && item.destination_chain === intent.destination_chain && item.side === intent.side);
    if (route) setRouteID(route.route_id);
  }, [snapshot?.swap_id, routes]);

  useEffect(() => {
    if (!session?.jwt || !actor) { setBusy(null); setRoutes([]); setActive([]); return; }
    const controller = new AbortController(); const capturedActor = actor; const capturedJWT = session.jwt;
    setBusy('loading'); setError(undefined);
    Promise.all([getCapabilities(session.jwt, controller.signal), listActiveSwaps(session.jwt, '', 20, controller.signal)])
      .then(([capabilities, list]) => {
        if (sessionJWTRef.current !== capturedJWT || capturedActor !== actor) return;
        const serverAtReceive = Date.parse(capabilities.server_time);
        if (Number.isFinite(serverAtReceive)) setServerOffset(serverAtReceive - Date.now());
        setRoutes(capabilities.routes);
        for (const item of list.items) signingDeadline(readyDeadlines.current,item,performance.now());
        setActive(list.items);
        const wantedChain = chainQuery(params.get('chain') ?? params.get('destination_chain'));
        const wantedSide = sideQuery(params.get('side'));
        const requested = wantedChain || wantedSide
          ? capabilities.routes.find((route) => route.enabled && supportsRoute(route) && (!wantedChain || route.destination_chain === wantedChain) && (!wantedSide || route.side === wantedSide))
          : undefined;
        const first = requested ??
          capabilities.routes.find((route) => route.enabled && supportsRoute(route) && route.origin_chain === 'solana:mainnet' && route.destination_chain === 'solana:mainnet' && route.side === Side.SWAP) ??
          capabilities.routes.find((route) => route.enabled && supportsRoute(route)) ?? capabilities.routes[0];
        if (first) setRouteID((current) => current || first.route_id);
        const stored = readRecovery(actor);
        if (stored?.last_trace_id) setLatestTrace(stored.last_trace_id);
        const recovered = stored?.swap_id ? list.items.find((item) => item.swap_id === stored.swap_id) : undefined;
        if (recovered) { setSnapshot(recovered); eventVersionRef.current = recovered.event_version; }
        else if (stored?.swap_id) {
          return getSwap(capturedJWT, stored.swap_id, controller.signal).then((item) => {
            if (sessionJWTRef.current !== capturedJWT) return;
            setSnapshot(item); eventVersionRef.current = item.event_version;
          }).catch(() => undefined);
        } else if (stored) {
          if (stored.create_recovery_action === 'contact_support' || stored.create_recovery_action === 'do_not_retry') {
            setError(stored.create_recovery_action === 'contact_support' ? '上一笔 Create 存在幂等冲突，请携带原 trace_id 联系支持，不要继续重试。' : '上一笔 Create 已明确不可原样重试，请修改输入后重新开始。');
            return;
          }
          if (stored.create_recovery_action === 'get_snapshot') {
            return findCreateSnapshot(capturedJWT, stored.intent, stored.create_related_swap_id, controller.signal).then((item) => {
              if (sessionJWTRef.current !== capturedJWT) return;
              if (!item) {
                clearRecovery(capturedActor);
                setError('上一笔 Create 没有对应的活动交易，本地恢复标记已清除；可以重新获取报价。');
                return;
              }
              applySnapshot(item);
              writeRecovery({...stored, swap_id: item.swap_id, revision: item.preparation.current_revision, create_recovery_action: undefined, create_related_swap_id: undefined, updated_at: new Date().toISOString()});
            }).catch(() => setError('快照恢复失败，已停止原样重试。'));
          }
          if (stored.create_recovery_action === 'change_input') {
            clearRecovery(capturedActor);
            return;
          }
          // Create may have reached the server even when its response did not reach this browser.
          // Recover it with the exact same intent and idempotency key before allowing a new intent.
          setBusy('preparing');
          return createWithRecovery(capturedJWT, stored, controller.signal)
            .then(({snapshot: item, recovery}) => {
              if (sessionJWTRef.current !== capturedJWT) return;
              applySnapshot(item);
              writeRecovery({...recovery, swap_id: item.swap_id, revision: item.preparation.current_revision, create_recovery_action: undefined, create_retry_after_at: undefined, create_related_swap_id: undefined, updated_at: new Date().toISOString()});
            })
            .catch(async (reason) => {
              if (sessionJWTRef.current !== capturedJWT) return;
              try {
                const recovered = await recoverCreateSnapshot(capturedJWT, reason, stored.intent, controller.signal);
                if (recovered && sessionJWTRef.current === capturedJWT) {
                  applySnapshot(recovered);
                  writeRecovery({...stored, swap_id: recovered.swap_id, revision: recovered.preparation.current_revision, updated_at: new Date().toISOString()});
                  return;
                }
              } catch { /* preserve the original error and trace */ }
              clearDefinitiveCreateFailure(capturedActor, reason);
              setError(`正在恢复上一次报价请求。${errorText(reason)}`);
            });
        } else if (list.items[0]) { setSnapshot(list.items[0]); eventVersionRef.current = list.items[0].event_version; }
      })
      .catch((reason) => { if (sessionJWTRef.current === capturedJWT) setError(errorText(reason)); })
      .finally(() => { if (sessionJWTRef.current === capturedJWT) setBusy(null); });
    return () => controller.abort();
  }, [actor, applySnapshot, params, session?.jwt]);

  useEffect(() => {
    if (!session?.jwt || !snapshot || isTerminal(snapshot)) return;
    const expectedSwapID = snapshot.swap_id;
    eventVersionRef.current = snapshot.event_version;
    const applyExpected = (next: SwapSnapshot) => { if (selectedSwapIDRef.current === expectedSwapID && next.swap_id === expectedSwapID) applySnapshot(next); };
    const stopWS = watchSwap({bearer: session.jwt, swapID: expectedSwapID, afterVersion: snapshot.event_version, onSnapshot: applyExpected, onStatus: setStreamStatus});
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const events = await listSwapEvents(session.jwt, expectedSwapID, eventVersionRef.current, controller.signal);
        if (stopped || selectedSwapIDRef.current !== expectedSwapID) return;
        if (events.reset_required) applyExpected(await getSwap(session.jwt, expectedSwapID, controller.signal));
        else {
          for (const event of events.items) if (event.snapshot) applyExpected(event.snapshot);
          eventVersionRef.current = BigInt(events.next_version) > BigInt(eventVersionRef.current) ? events.next_version : eventVersionRef.current;
        }
      } catch { /* WS and the next poll still have the same authoritative recovery path. */ }
      if (!stopped) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 400);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); stopWS(); };
  }, [applySnapshot, session?.jwt, snapshot?.swap_id, snapshot?.settlement.outcome]);

  useEffect(() => {
    if (!session?.jwt || !snapshot || snapshot.settlement.destination < ChainLegStatus.OBSERVED) return;
    const controller = new AbortController();
    getSwapAvailability(session.jwt, snapshot.swap_id, controller.signal)
      .then((availability) => {
        markSwapTiming('availability_received', {can_execute:availability.can_execute, spendable_raw:availability.spendable_raw}, snapshot.intent.client_intent_id);
        setSnapshot((current) => current?.swap_id === snapshot.swap_id ? {...current, availability} : current);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [session?.jwt, snapshot?.settlement.destination, snapshot?.swap_id]);

  const prepare = async (signal?: AbortSignal) => {
    if (!session?.jwt || !actor || !selectedRoute || !sourceWallet || !destinationWallet || busy) return;
    if (snapshot && !isTerminal(snapshot)) { setError('当前已有一笔未收尾交易。请先恢复或停止它，不能创建第二笔。'); return; }
    if (!selectedRoute.enabled || !selectedRoute.sponsorship_available || !supportsRoute(selectedRoute)) { setError(selectedRoute.unavailable_reason ?? '这条路线当前未开通，或客户端不支持其签名/广播模式。'); return; }
    if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= BigInt(0) || !sourceAsset.trim() || !destinationAsset.trim()) { setError('请填写源资产、目标资产和正整数原子金额。'); return; }
    const slippageBps = Number(slippage);
    if (!Number.isSafeInteger(slippageBps) || slippageBps < 1 || slippageBps > 10_000) { setError('滑点必须是 1–10000 的整数基点。'); return; }
    const existing = readRecovery(actor);
    if (existing && !existing.swap_id) {
      if (existing.execution_idempotency_key) { setError('存在未决签名执行，不能创建新意图。'); return; }
      if (existing.create_recovery_action === 'contact_support' || existing.create_recovery_action === 'do_not_retry') { setError(existing.create_recovery_action === 'contact_support' ? '上一次请求发生幂等冲突，请联系支持，不要继续重试。' : '上一次请求不可原样重试，请修改输入后重新开始。'); return; }
      if (existing.create_recovery_action === 'get_snapshot') {
        setBusy('preparing'); setError(undefined);
        let recoveryFailed = false;
        try {
          const recovered = await findCreateSnapshot(session.jwt, existing.intent, existing.create_related_swap_id);
          if (recovered) {
            applySnapshot(recovered);
            writeRecovery({...existing, swap_id: recovered.swap_id, revision: recovered.preparation.current_revision, create_recovery_action: undefined, create_related_swap_id: undefined, updated_at: new Date().toISOString()});
            return;
          }
          // ListActiveSwaps is authoritative for recoverable in-flight intent.
          // If the related/matching swap is no longer active, this failed Create
          // produced nothing left to recover. Clear the stale marker and let the
          // same click continue below with a fresh client intent and key.
          clearRecovery(actor);
        } catch { recoveryFailed = true; setError('快照恢复失败，已停止原样重试。'); }
        finally { setBusy(null); }
        if (recoveryFailed) return;
      }
      setBusy('preparing'); setError(undefined);
      const bearer = session.jwt; const recoveryGeneration = generationRef.current;
      try {
        const result = await createWithRecovery(bearer, existing, signal);
        const recovered = result.snapshot;
        if (sessionJWTRef.current !== bearer || generationRef.current !== recoveryGeneration) return;
        applySnapshot(recovered);
        writeRecovery({...result.recovery, swap_id: recovered.swap_id, revision: recovered.preparation.current_revision, create_recovery_action: undefined, create_retry_after_at: undefined, create_related_swap_id: undefined, updated_at: new Date().toISOString()});
      } catch (reason) {
        if (sessionJWTRef.current !== bearer || generationRef.current !== recoveryGeneration) return;
        try {
          const recovered = await recoverCreateSnapshot(bearer, reason, existing.intent);
          if (recovered && sessionJWTRef.current === bearer && generationRef.current === recoveryGeneration) {
            applySnapshot(recovered);
            writeRecovery({...existing, swap_id: recovered.swap_id, revision: recovered.preparation.current_revision, updated_at: new Date().toISOString()});
            return;
          }
        } catch { /* preserve the original error and trace */ }
        const definitive = clearDefinitiveCreateFailure(actor, reason);
        setError(`${definitive ? '上一次请求已被明确拒绝，可以修改输入。' : '上一次 Create 结果仍未知，继续使用同一幂等键恢复。'}${errorText(reason)}`);
      }
      finally { if (sessionJWTRef.current === bearer && generationRef.current === recoveryGeneration) setBusy(null); }
      return;
    }
    const generation = ++generationRef.current;
    const clientIntentID = uuid(); const createKey = uuid();
    startTimingRun(clientIntentID, actor);
    setEvidenceRunID(clientIntentID);
    const intent: CreateIntent = {client_intent_id: clientIntentID, origin_chain: selectedRoute.origin_chain, destination_chain: selectedRoute.destination_chain, origin_asset: sourceAsset.trim(), destination_asset: destinationAsset.trim(), amount_in_raw: amountRaw, slippage_bps: slippageBps, side: selectedRoute.side, source_wallet_id: sourceWallet.id, destination_wallet_id: destinationWallet.id, fee_policy: FeePolicy.PLATFORM_SPONSORED};
    const recovery: FastSwapRecovery = {actor, client_intent_id: clientIntentID, create_idempotency_key: createKey, execution_idempotency_key: null, swap_id: null, revision: null, intent, updated_at: new Date().toISOString()};
    if (!writeRecovery(recovery)) { setError('浏览器无法保存恢复信息，因此没有发送请求。请允许本地存储后重试。'); return; }
    const bearer = session.jwt; const started = performance.now(); setBusy('preparing'); setError(undefined); setPendingExecution(undefined);
    try {
      const result = await createWithRecovery(bearer, recovery, signal);
      const next = result.snapshot;
      markSwapTiming('create_response', {trace_id:getLatestFastSwapTrace(), status:next.preparation.status}, clientIntentID);
      if (generation !== generationRef.current || sessionJWTRef.current !== bearer) return;
      applySnapshot(next);
      writeRecovery({...result.recovery, swap_id: next.swap_id, revision: next.preparation.current_revision, create_recovery_action: undefined, create_retry_after_at: undefined, create_related_swap_id: undefined, updated_at: new Date().toISOString()});
      setTimings((rows) => [{name: 'prepare_ms', duration: performance.now() - started, at: new Date().toISOString()}, ...rows].slice(0, 12));
    } catch (reason) {
      if (generation !== generationRef.current || sessionJWTRef.current !== bearer) return;
      try {
        const related = await recoverCreateSnapshot(bearer, reason, intent);
        if (related && generation === generationRef.current && sessionJWTRef.current === bearer) {
          applySnapshot(related);
          writeRecovery({...recovery, swap_id: related.swap_id, revision: related.preparation.current_revision, intent: related.intent, client_intent_id: related.intent.client_intent_id, updated_at: new Date().toISOString()});
          return;
        }
      } catch { /* retain the original diagnostic */ }
      clearDefinitiveCreateFailure(actor, reason);
      setError(errorText(reason));
    } finally { if (generation === generationRef.current) setBusy(null); }
  };

  const reportPending = useCallback(async (pending: PendingExecution, ownsLock = false, signingFlowStarted?: number) => {
    if (!session?.jwt || pending.actor !== actor || !pendingDurableRef.current || !ownsLock && executionLockRef.current) return;
    if (!ownsLock) executionLockRef.current = true;
    const bearer = session.jwt; let submissionMayHaveStarted = pending.submissionState === 'submission_unknown'; setBusy('reporting'); const started = performance.now();
    let executionTrace = pending.lastTraceID ?? '';
    let executionIntentID = snapshot?.swap_id === pending.swapID ? snapshot.intent.client_intent_id : '';
    let firstRequestMarked = false;
    const httpStarts = new Map<string, number>();
    const timingReporter: RequestTimingReporter = (event) => {
      recordHttpAttemptEvent(executionIntentID, event.attemptID, {
        stage: event.stage, monotonic_ms: event.monotonicMS, at: event.at, details: event.details,
      }, pending.signAttemptID);
      const trace = event.details.trace_id;
      if (typeof trace === 'string') { executionTrace = trace; setLatestTrace(trace); }
      if (event.stage === 'request_start') {
        httpStarts.set(event.attemptID, event.monotonicMS);
        if (!firstRequestMarked && signingFlowStarted !== undefined) {
          firstRequestMarked = true;
          setTimings((rows) => [{name:'click_to_execution_request_ms',duration:event.monotonicMS - signingFlowStarted,at:event.at},...rows].slice(0,12));
        }
      }
      if (event.stage === 'parse_done' || event.stage === 'request_error') {
        const requestStarted = httpStarts.get(event.attemptID);
        if (requestStarted !== undefined) setTimings((rows) => [{name:'execution_http_ms',duration:event.monotonicMS - requestStarted,at:event.at},...rows].slice(0,12));
      }
    };
    try {
      const target = snapshot?.swap_id === pending.swapID ? snapshot : await getSwap(bearer, pending.swapID);
      executionIntentID = target.intent.client_intent_id;
      if (target.intent_hash !== pending.intentHash) throw new Error('Saved execution artifact does not match the server intent.');
      if (pending.lastTraceID) setLatestTrace(pending.lastTraceID);
      if (pending.recoveryAction === 'contact_support' || pending.recoveryAction === 'do_not_retry') {
        setError(`这次执行已明确不可原样重试，请联系支持。${pending.lastTraceID ? ` trace=${pending.lastTraceID}` : ''}`);
        return;
      }
      if (pending.recoveryAction === 'get_snapshot') {
        applySnapshot(target);
        if (target.execution.status !== ExecutionStatus.NOT_REPORTED) {
          setPendingExecution(undefined); setPendingDurable(false); pendingDurableRef.current = false; setUnresolvedArtifact(false); await clearPendingExecutionIfMatch(pending);
          return;
        }
        // The snapshot proves no execution row exists, but it cannot tell whether
        // the previous Idempotency-Key is replayable or was invalidated before a
        // side effect. Probe that exact key once: the server will either replay it
        // or explicitly answer new_idempotency_key, which the loop below persists
        // before retrying the same signed artifact. Never sign a replacement.
        pending = {...pending, recoveryAction: undefined, retryAfterAt: undefined, savedAt:new Date().toISOString()};
        if (!await writePendingExecution(pending)) throw new Error('Cannot persist execution recovery before probing the original Idempotency-Key.');
        setPendingExecution(pending);
      }
      let report = pending;
      if (pending.submissionState === 'signed_unsent') {
        if (Date.now() + serverOffset >= Date.parse(pending.safeBroadcastBefore)) {
          setUnresolvedArtifact(true);
          throw new Error('This signed artifact was never submitted and is now outside safe_broadcast_before. It remains blocked.');
        }
        report = {...pending, submissionState: 'submission_unknown', savedAt: new Date().toISOString()};
        const submissionPersistStarted = performance.now();
        markSwapTiming('submission_unknown_persist_start', {revision:report.revision}, target.intent.client_intent_id, report.signAttemptID);
        const submissionPersisted = await writePendingExecution(report);
        const submissionPersistDuration = performance.now() - submissionPersistStarted;
        markSwapTiming('submission_unknown_persist_done', {duration_ms:submissionPersistDuration, saved:submissionPersisted}, target.intent.client_intent_id, report.signAttemptID);
        setTimings((rows) => [{name:'submission_unknown_persist_ms',duration:submissionPersistDuration,at:new Date().toISOString()},...rows].slice(0,12));
        if (!submissionPersisted) throw new Error('Could not persist the submission recovery barrier; no execution request was sent.');
        setPendingExecution(report);
      }
      submissionMayHaveStarted = true;
      const clickToDispatchMS = signingFlowStarted === undefined ? null : performance.now() - signingFlowStarted;
      markSwapTiming('execution_dispatch', {revision:report.revision, click_to_dispatch_ms:clickToDispatchMS}, target.intent.client_intent_id, report.signAttemptID);
      if (clickToDispatchMS !== null) setTimings((rows) => [{name:'click_to_dispatch_ms',duration:clickToDispatchMS,at:new Date().toISOString()},...rows].slice(0,12));
      const result = await submitExecutionWithRecovery(bearer, report, (updated) => {
        setPendingExecution(updated);
        const stored = readRecovery(updated.actor);
        if (stored?.swap_id === updated.swapID) writeRecovery({...stored, execution_idempotency_key: updated.idempotencyKey, last_trace_id: updated.lastTraceID, updated_at: new Date().toISOString()});
      }, timingReporter);
      report = result.pending;
      const next = result.snapshot;
      markSwapTiming('execution_response', {trace_id:executionTrace || null, execution:next.execution.status}, next.intent.client_intent_id, report.signAttemptID);
      if (sessionJWTRef.current !== bearer) return;
      selectedSwapIDRef.current = next.swap_id; applySnapshot(next);
      if (next.execution.status !== ExecutionStatus.NOT_REPORTED) { setPendingExecution(undefined); setPendingDurable(false); pendingDurableRef.current = false; setUnresolvedArtifact(false); await clearPendingExecutionIfMatch(report); }
      setError(undefined);
      const duration = performance.now() - started;
      markSwapTiming('execution_report_done', {duration_ms:duration, includes_local_recovery:true, trace_id:executionTrace || null}, next.intent.client_intent_id, report.signAttemptID);
      setTimings((rows) => [{name: 'execution_report_ms_including_local_recovery', duration, at: new Date().toISOString()}, ...rows].slice(0, 12));
      void reportTelemetry(bearer, [{client_attempt_id: pending.idempotencyKey, swap_id: pending.swapID, revision: pending.revision, name: 'broadcast_ms', monotonic_ms: Math.round(duration), wall_time: new Date().toISOString(), attributes: {route: selectedRoute?.route_id ?? 'other', wallet_type: pending.kind === 'solana' ? 'embedded_solana' : 'embedded_evm', cold_start: 'false', channel: 'gateway'}}], uuid());
    } catch (reason) {
      if (!submissionMayHaveStarted) {
        setError(`签名产物尚未提交，且不会自动越过安全发送时间。${errorText(reason)}`);
        return;
      }
      try {
        const recovered = await getSwap(bearer, pending.swapID);
        if (sessionJWTRef.current !== bearer) return;
        selectedSwapIDRef.current = recovered.swap_id; applySnapshot(recovered);
        if (recovered.execution.status !== ExecutionStatus.NOT_REPORTED) { setPendingExecution(undefined); setPendingDurable(false); pendingDurableRef.current = false; setUnresolvedArtifact(false); await clearPendingExecutionIfMatch(pending); }
      } catch { /* retain the same signed artifact in memory for an idempotent retry */ }
      setError(`执行上报结果未完全确认。不会重新签名；请恢复同一笔交易。${errorText(reason)}`);
    } finally { setBusy(null); executionLockRef.current = false; }
  }, [actor, applySnapshot, selectedRoute?.route_id, serverOffset, session?.jwt, snapshot]);

  const execute = async () => {
    if (!snapshot || !session?.jwt || !actor || executionLockRef.current || busy || pendingExecution || unresolvedArtifact || !pendingLoaded) return;
    if (!matchesInput || autoQuote.debouncing || autoQuote.inFlight || document.visibilityState === 'hidden') return;
    if (!isReady(snapshot) || snapshot.execution.status !== ExecutionStatus.NOT_REPORTED || snapshot.preparation.retry_after_ms === null || snapshot.preparation.retry_after_ms <= 0 || performance.now() >= readyUntil) { setError('当前版本不能再次签名；请恢复同一笔交易的服务端状态。'); return; }
    executionLockRef.current = true; setBusy('signing'); setError(undefined);
    setAutoRequested(false);
    const key = uuid(); const started = performance.now(); const bearer = session.jwt; const signerContext = signerContextRef.current;
    const signAttemptID = beginSignAttempt(snapshot.intent.client_intent_id, snapshot.revision.revision);
    let failureStage = 'sign_flow_start';
    let signatureProduced = false;
    markSwapTiming('confirm_click', {revision:snapshot.revision.revision}, snapshot.intent.client_intent_id, signAttemptID);
    markSwapTiming('sign_flow_start', {revision:snapshot.revision.revision}, snapshot.intent.client_intent_id, signAttemptID);
    try {
      let pending: PendingExecution;
      if (snapshot.revision.solana) {
        failureStage = 'wallet_selection';
        if (!solanaReady) throw new Error('Solana wallet is still loading.');
        if (solanaVerifiedRevision !== snapshot.revision.revision) throw new Error('Solana blockheight and lookup tables are still being verified.');
        const wallet = signerByAddress(solanaSigners, snapshot.revision.solana.user_signer_address, false);
        if (!wallet) throw new Error(`Privy 中没有后端指定的 Solana 钱包 ${snapshot.revision.solana.user_signer_address}.`);
        markSwapTiming('wallet_selected', {wallet_type:'embedded_solana'}, snapshot.intent.client_intent_id, signAttemptID);
        const signed = await signSolanaRevision(snapshot.revision.solana, wallet, signTransaction as never, (stage, details = {}) => {
          const callbackStarted = performance.now();
          try {
            failureStage = stage;
            if (stage === 'privy_sign_done') signatureProduced = true;
            markSwapTiming(stage, details, snapshot.intent.client_intent_id, signAttemptID);
            const duration = details.duration_ms;
            const metric = stage === 'solana_precheck_done' ? 'solana_precheck_ms' : stage === 'privy_sign_done' || stage === 'privy_sign_error' ? 'privy_sign_ms' : stage === 'solana_postcheck_done' || stage === 'solana_postcheck_error' ? 'solana_postcheck_ms' : stage === 'solana_base64_done' || stage === 'solana_base64_error' ? 'solana_base64_ms' : null;
            if (metric && typeof duration === 'number') setTimings((rows) => [{name:metric,duration,at:new Date().toISOString()},...rows].slice(0,12));
          } finally {
            recordDiagnosticOverhead('solana_signing_callback', performance.now() - callbackStarted, snapshot.intent.client_intent_id, signAttemptID);
          }
        });
        signatureProduced = true;
        pending = {actor, swapID: snapshot.swap_id, kind: 'solana', signed, idempotencyKey: key, revision: snapshot.revision.revision, intentHash: snapshot.intent_hash, safeBroadcastBefore: snapshot.revision.safe_broadcast_before, savedAt: new Date().toISOString(), submissionState: 'signed_unsent', signAttemptID};
      } else if (snapshot.revision.evm) {
        failureStage = 'evm_sign';
        if (!evmReady) throw new Error('EVM wallet is still loading.');
        const wallet = signerByAddress(evmSigners, snapshot.revision.evm.signer_address, true);
        if (!wallet) throw new Error(`Privy 中没有后端指定的 EVM 钱包 ${snapshot.revision.evm.signer_address}.`);
        markSwapTiming('wallet_selected', {wallet_type:'embedded_evm'}, snapshot.intent.client_intent_id, signAttemptID);
        const signatures = await signEvmRevision(snapshot.revision.evm, wallet, snapshot.intent, (stage, details = {}) => {
          const callbackStarted = performance.now();
          try {
            failureStage = stage;
            if (stage === 'privy_sign_done') signatureProduced = true;
            markSwapTiming(stage, details, snapshot.intent.client_intent_id, signAttemptID);
            const duration = details.duration_ms;
            const requestID = typeof details.request_id === 'string' ? details.request_id : null;
            const metric = stage === 'evm_precheck_done' || stage === 'evm_precheck_error' ? 'evm_precheck_ms' : stage === 'evm_provider_done' || stage === 'evm_provider_error' ? 'evm_provider_ms' : stage === 'privy_sign_done' || stage === 'privy_sign_error' ? `privy_sign_${requestID ?? 'unknown'}_ms` : stage === 'evm_postcheck_done' || stage === 'evm_postcheck_error' ? `evm_postcheck_${requestID ?? 'unknown'}_ms` : null;
            if (metric && typeof duration === 'number') setTimings((rows) => [{name:metric,duration,at:new Date().toISOString()},...rows].slice(0,12));
          } finally {
            recordDiagnosticOverhead('evm_signing_callback', performance.now() - callbackStarted, snapshot.intent.client_intent_id, signAttemptID);
          }
        });
        signatureProduced = true;
        pending = {actor, swapID: snapshot.swap_id, kind: 'evm', signatures, idempotencyKey: key, revision: snapshot.revision.revision, intentHash: snapshot.intent_hash, safeBroadcastBefore: snapshot.revision.safe_broadcast_before, savedAt: new Date().toISOString(), submissionState: 'signed_unsent', signAttemptID};
      } else throw new Error('当前版本没有受支持的签名材料。');
      failureStage = 'signer_context_check';
      if (sessionJWTRef.current !== bearer || signerContextRef.current !== signerContext) throw new Error('登录或签名钱包在签名期间发生变化；没有发送产物。');
      setPendingExecution(pending);
      markSwapTiming('sign_verified', {fee_payer_signature_preserved:pending.kind === 'solana'}, snapshot.intent.client_intent_id, signAttemptID);
      const recovery = readRecovery(actor);
      const markerStarted = performance.now();
      const markerSaved = writeRecovery({
        actor,
        client_intent_id: snapshot.intent.client_intent_id,
        create_idempotency_key: recovery?.swap_id === snapshot.swap_id ? recovery.create_idempotency_key : uuid(),
        execution_idempotency_key: key,
        swap_id: snapshot.swap_id,
        revision: pending.revision,
        intent: snapshot.intent,
        updated_at: new Date().toISOString(),
      });
      const markerDuration = performance.now() - markerStarted;
      markSwapTiming('recovery_marker_done', {duration_ms:markerDuration,saved:markerSaved}, snapshot.intent.client_intent_id, signAttemptID);
      setTimings((rows) => [{name:'recovery_marker_ms',duration:markerDuration,at:new Date().toISOString()},...rows].slice(0,12));
      const artifactPersistStarted = performance.now();
      failureStage = 'artifact_persist';
      markSwapTiming('artifact_persist_start', {}, snapshot.intent.client_intent_id, signAttemptID);
      const artifactSaved = await writePendingExecution(pending);
      const artifactPersistDuration = performance.now() - artifactPersistStarted;
      markSwapTiming('artifact_persist_done', {duration_ms:artifactPersistDuration,saved:artifactSaved}, snapshot.intent.client_intent_id, signAttemptID);
      setTimings((rows) => [{name:'artifact_persist_ms',duration:artifactPersistDuration,at:new Date().toISOString()},...rows].slice(0,12));
      setPendingDurable(artifactSaved); pendingDurableRef.current = artifactSaved;
      if (!artifactSaved) {
        setUnresolvedArtifact(true);
        throw new Error('签名已经完成，但浏览器无法保存完整恢复材料。没有提交；请保留页面并重试保存。');
      }
      if (!markerSaved) {
        setError('本地定位标记写入失败，但完整签名已安全保存；将继续上报同一签名。');
      }
      if (Date.now() + serverOffset >= Date.parse(snapshot.revision.safe_broadcast_before)) {
        failureStage = 'safe_broadcast_deadline';
        setUnresolvedArtifact(true);
        throw new Error('签名完成时已经超过安全广播时间；已保存原签名并停止发送，不能再次签名。');
      }
      const duration = performance.now() - started;
      markSwapTiming('sign_flow_done', {duration_ms:duration}, snapshot.intent.client_intent_id, signAttemptID);
      finishSignAttempt(snapshot.intent.client_intent_id, 'signed', null);
      setTimings((rows) => [{name: 'sign_ms', duration, at: new Date().toISOString()}, ...rows].slice(0, 12));
      setBusy(null);
      await reportPending(pending, true, started);
    } catch (reason) {
      markSwapTiming('sign_flow_error', {failure_stage:failureStage, signature_produced:signatureProduced}, snapshot.intent.client_intent_id, signAttemptID);
      finishSignAttempt(snapshot.intent.client_intent_id, 'failed', failureStage);
      setError(errorText(reason)); setBusy(null); executionLockRef.current = false;
    }
  };

  const mutateSwap = async (kind: 'refresh' | 'cancel', signal?: AbortSignal) => {
    if (!snapshot || !session?.jwt || !actor || busy || kind === 'refresh' && snapshot.execution.status !== ExecutionStatus.NOT_REPORTED) return;
    const bearer = session.jwt; const generation = generationRef.current;
    let recovery = readRecovery(actor) ?? {actor, client_intent_id: snapshot.intent.client_intent_id, create_idempotency_key: uuid(), execution_idempotency_key: null, swap_id: snapshot.swap_id, revision: snapshot.preparation.current_revision, intent: snapshot.intent, updated_at: new Date().toISOString()};
    if (recovery.pending_operation && (recovery.pending_operation.kind !== kind || recovery.pending_operation.swap_id !== snapshot.swap_id)) {
      const replaceFailedRefreshWithCancel = kind === 'cancel' && recovery.pending_operation.kind === 'refresh' &&
        recovery.pending_operation.swap_id === snapshot.swap_id && recovery.pending_operation.recovery_action === 'get_snapshot' && unsignedQuote(snapshot);
      if (!replaceFailedRefreshWithCancel) {
        setError(`已有 ${recovery.pending_operation.kind} 请求结果未知，请先恢复该请求，不能覆盖它的 Idempotency-Key。${recovery.pending_operation.last_trace_id ? ` trace=${recovery.pending_operation.last_trace_id}` : ''}`);
        return;
      }
      // A definitive refresh recovery can be superseded by cancellation only
      // while the authoritative snapshot still proves no execution or debit.
      recovery = {...recovery,pending_operation:undefined,updated_at:new Date().toISOString()};
    }
    let operation = recovery.pending_operation?.kind === kind && recovery.pending_operation.swap_id === snapshot.swap_id
      ? recovery.pending_operation
      : {kind, swap_id: snapshot.swap_id, expected_revision: snapshot.preparation.current_revision, idempotency_key: uuid()};
    if (operation.recovery_action === 'contact_support' || operation.recovery_action === 'do_not_retry') {
      setError(`这次 ${kind} 已明确不可原样重试，请联系支持。${operation.last_trace_id ? ` trace=${operation.last_trace_id}` : ''}`);
      return;
    }
    setBusy(kind === 'refresh' ? 'refreshing' : 'cancelling'); setError(undefined);
    try {
      if (operation.recovery_action === 'retry_same_request' && operation.retry_after_at) {
        const remaining = Date.parse(operation.retry_after_at) - Date.now();
        if (Number.isFinite(remaining) && remaining > 0) await delay(remaining,signal);
      }
      if (operation.recovery_action === 'get_snapshot') {
        const current = await getSwap(bearer, operation.swap_id,signal);
        if (sessionJWTRef.current !== bearer || generationRef.current !== generation) return;
        applySnapshot(current);
        if (mutationSatisfied(operation, current)) {
          recovery = {...recovery, pending_operation: undefined, updated_at: new Date().toISOString()}; writeRecovery(recovery); return;
        }
        const canRetryCancel = kind === 'cancel' && unsignedQuote(current);
        const canRetryRefresh = kind === 'refresh' && current.preparation.status === PreparationStatus.EXPIRED &&
          current.execution.status === ExecutionStatus.NOT_REPORTED && !pendingExecution && !unresolvedArtifact;
        if (!canRetryCancel && !canRetryRefresh) {
          throw new Error(`服务端快照尚未证明 ${kind} 已生效，停止原样重试。${operation.last_trace_id ? ` trace=${operation.last_trace_id}` : ''}`);
        }
        // A current unsigned snapshot can safely replace a stale mutation guard.
        // Keep the same swap and intent, but bind the new idempotency key to the
        // latest server revision before retrying refresh or cancellation.
        operation = {kind, swap_id:current.swap_id, expected_revision:current.preparation.current_revision, idempotency_key:uuid()};
      }
      if (!writeRecovery({...recovery, pending_operation: operation, updated_at: new Date().toISOString()})) throw new Error(`无法保存 ${kind} 的幂等恢复信息，因此没有发送请求。`);
      let result: SwapSnapshot | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (signal?.aborted || sessionJWTRef.current !== bearer || generationRef.current !== generation) return;
        try {
          result = kind === 'refresh'
            ? await refreshSwap(bearer, operation.swap_id, operation.expected_revision, operation.idempotency_key,signal)
            : await cancelSwap(bearer, operation.swap_id, operation.expected_revision, operation.idempotency_key,signal);
          break;
        } catch (reason) {
          lastError = reason;
          const decision = decideCreateRecovery(reason);
          const traceID = reason instanceof FastSwapApiError ? reason.traceID : getLatestFastSwapTrace();
          if (decision.kind === 'retry_new_key') operation = {...operation, idempotency_key: uuid(), recovery_action: 'new_idempotency_key', retry_after_at: undefined, last_trace_id: traceID};
          else if (decision.kind === 'retry_same_key') {
            operation = {...operation, recovery_action: 'retry_same_request', retry_after_at: new Date(Date.now() + decision.delayMS).toISOString(), last_trace_id: traceID};
            recovery = {...recovery, pending_operation: operation, last_trace_id: traceID, updated_at: new Date().toISOString()};
            if (!writeRecovery(recovery)) throw new Error(`无法保存 ${kind} 重试计划。`);
            await delay(decision.delayMS,signal);
            continue;
          } else {
            operation = {...operation, recovery_action: decision.kind === 'contact_support' ? 'contact_support' : decision.kind === 'do_not_retry' ? 'do_not_retry' : 'get_snapshot', retry_after_at: undefined, last_trace_id: traceID};
            recovery = {...recovery, pending_operation: operation, last_trace_id: traceID, updated_at: new Date().toISOString()};
            writeRecovery(recovery);
            const current = await getSwap(bearer, operation.swap_id);
            if (sessionJWTRef.current !== bearer || generationRef.current !== generation) return;
            applySnapshot(current);
            if (mutationSatisfied(operation, current)) { result = current; break; }
            throw reason;
          }
          recovery = {...recovery, pending_operation: operation, last_trace_id: traceID, updated_at: new Date().toISOString()};
          if (!writeRecovery(recovery)) throw new Error(`无法保存替换后的 ${kind} Idempotency-Key。`);
        }
      }
      if (!result) throw lastError;
      if (sessionJWTRef.current !== bearer || generationRef.current !== generation) return;
      applySnapshot(result);
      writeRecovery({...recovery, pending_operation: undefined, last_trace_id: getLatestFastSwapTrace(), updated_at: new Date().toISOString()});
    } catch (reason) {
      if (sessionJWTRef.current === bearer && generationRef.current === generation) setError(errorText(reason));
    } finally { if (sessionJWTRef.current === bearer && generationRef.current === generation) setBusy(null); }
  };
  const refresh = (signal?: AbortSignal) => mutateSwap('refresh',signal);
  const cancel = () => {setAutoRequested(false); return mutateSwap('cancel');};
  const selectActive = (item: SwapSnapshot) => {
    if (autoQuote.inFlight || busy) return;
    formEdited.current = false; setAutoRequested(false);
    selectedSwapIDRef.current = item.swap_id; setSnapshot(item); eventVersionRef.current = item.event_version; setError(undefined);
    if (actor) {
      const stored = readRecovery(actor);
      writeRecovery({actor, client_intent_id: item.intent.client_intent_id, create_idempotency_key: stored?.swap_id === item.swap_id ? stored.create_idempotency_key : uuid(), execution_idempotency_key: stored?.swap_id === item.swap_id ? stored.execution_idempotency_key : null, swap_id: item.swap_id, revision: item.preparation.current_revision, intent: item.intent, updated_at: new Date().toISOString()});
    }
  };
  const persistAndReport = async (pending: PendingExecution) => {
    setBusy('reporting');
    const saved = await writePendingExecution(pending);
    setPendingDurable(saved); pendingDurableRef.current = saved;
    if (!saved) { setBusy(null); setError('仍无法保存签名恢复材料，因此没有提交。请检查浏览器存储设置。'); return; }
    setUnresolvedArtifact(false); setBusy(null);
    await reportPending(pending);
  };
  const editIntent = (update: () => void) => {
    formEdited.current = true; setAutoRequested(true); setInputVersion(n=>n+1);
    if (actor) {
      const stored = readRecovery(actor);
      if (!stored?.swap_id && (stored?.create_recovery_action === 'do_not_retry' || stored?.create_recovery_action === 'change_input')) clearRecovery(actor);
    }
    update(); setError(undefined);
  };
  const startNextTest = () => {
    if (!snapshot || !isTerminal(snapshot) || busy || pendingExecution || unresolvedArtifact) return;
    generationRef.current += 1;
    selectedSwapIDRef.current = undefined; eventVersionRef.current = '0';
    readyDeadlines.current.clear(); readyClock.current = {key:'',until:0}; setReadyUntil(0);
    setSnapshot(undefined); setError(undefined); setTimings([]); setEvidence(''); setEvidenceRunID('');
    formEdited.current = true; setAutoRequested(true); setInputVersion((value) => value + 1);
  };

  const draft: QuoteDraft | undefined = selectedRoute && sourceWallet && destinationWallet ? {
    origin_chain:selectedRoute.origin_chain, destination_chain:selectedRoute.destination_chain,
    origin_asset:sourceAsset.trim(), destination_asset:destinationAsset.trim(), amount_in_raw:amountRaw,
    slippage_bps:slippage.trim() ? Number(slippage) : 0, side:selectedRoute.side,
    source_wallet_id:sourceWallet.id, destination_wallet_id:destinationWallet.id, fee_policy:FeePolicy.PLATFORM_SPONSORED,
  } : undefined;
  const inputKey = draft && validDraft(draft) && selectedRoute?.enabled && selectedRoute.sponsorship_available && supportsRoute(selectedRoute) ? draftKey(draft) : null;
  const matchesInput = Boolean(inputKey && snapshot && draftKey(snapshot.intent) === inputKey);
  const ready = Boolean(snapshot && matchesInput && serverAllowsSigning(snapshot) && !isTerminal(snapshot));
  const clockReady = readyClock.current.key === `${snapshot?.swap_id}:${snapshot?.preparation.current_revision}`;
  const safeRemaining = ready && clockReady ? Math.max(0, readyUntil - now) : 0;
  const blockedWait = snapshot?.preparation.status === PreparationStatus.BLOCKED && snapshot.preparation.retry_after_ms !== null ? Math.max(0, blockedRetryUntil - now) : 0;
  const refreshAllowed = Boolean(snapshot && snapshot.execution.status === ExecutionStatus.NOT_REPORTED && !pendingExecution && !unresolvedArtifact && (
    snapshot.preparation.status === PreparationStatus.EXPIRED ||
    snapshot.preparation.status === PreparationStatus.BLOCKED && snapshot.preparation.retry_after_ms !== null ||
    ready && safeRemaining <= 0
  ));
  const outputDecimals = snapshot?.revision.assets.destination.decimals ?? 0;
  const sourceDecimals = snapshot?.revision.assets.origin.decimals ?? 0;
  const hasSession = Boolean(session?.jwt && actor && privyReady && authenticated && user);
  const quoteOperationsAllowed = hasSession && pendingLoaded && !pendingExecution && !unresolvedArtifact &&
    busy !== 'loading' && busy !== 'signing' && busy !== 'reporting' && !executionLockRef.current;
  const autoQuote = useAutoQuote({
    scope:currentAuthScope, enabled:autoRequested && quoteOperationsAllowed,
    inputKey, inputVersion, snapshot, busy:busy !== null,
    expired:ready && clockReady && safeRemaining <= 0, blockedUntil:blockedRetryUntil,
    prepare, refresh, cancel:signal=>mutateSwap('cancel',signal),
    canRefresh:async current => {
      if (current.revision.solana) return solanaRevisionExpired(current.revision.solana,SOLANA_RPC_URL);
      if (current.revision.evm) return Date.now() + serverOffset >= Date.parse(current.revision.evm.deadline);
      return true;
    },
  });
  const prewarmSolanaWallet = selectedRoute?.origin_chain === 'solana:mainnet' && sourceWallet
    ? signerByAddress(solanaSigners, sourceWallet.address, false) : undefined;
  const prewarmEvmWallet = selectedRoute?.origin_chain.startsWith('eip155:') && sourceWallet
    ? signerByAddress(evmSigners, sourceWallet.address, true) : undefined;
  const prewarmWalletAddress = prewarmSolanaWallet?.address ?? prewarmEvmWallet?.address ?? '';
  const prewarmRequired = Boolean(experimentGroup === 'B' && autoRequested && inputKey && hasSession && prewarmWalletAddress &&
    snapshot && matchesInput && !isTerminal(snapshot) && unsignedQuote(snapshot) && snapshot.settlement.outcome === Outcome.PENDING);
  const prewarmKey = prewarmRequired ? `${currentAuthScope}\u0000${selectedRoute?.origin_chain ?? ''}\u0000${prewarmWalletAddress}` : '';
  prewarmDesiredKeyRef.current = prewarmKey;
  const prewarmSettled = !prewarmInFlightRef.current && (!prewarmRequired || warmedPrewarmKeysRef.current.has(prewarmKey));

  useEffect(() => {
    if (!prewarmRequired || !prewarmKey || !inputKey || !pageVisible || pendingExecution || unresolvedArtifact ||
        executionLockRef.current || prewarmInFlightRef.current || warmedPrewarmKeysRef.current.has(prewarmKey)) return;
    prewarmInFlightRef.current = true;
    setPrewarmState({key:prewarmKey,status:'running',durationMS:null});
    const started = performance.now();
    const signerContext = signerContextRef.current;
    const bearer = sessionJWTRef.current;
    recordPageTiming('privy_prewarm_start', {chain:selectedRoute?.origin_chain ?? '', wallet_type:prewarmSolanaWallet ? 'embedded_solana' : 'embedded_evm'});
    markSwapTiming('privy_prewarm_start', {chain:selectedRoute?.origin_chain ?? '', wallet_type:prewarmSolanaWallet ? 'embedded_solana' : 'embedded_evm'});
    void (async () => {
      let status: 'succeeded' | 'failed' = 'succeeded';
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const token = await Promise.race([
          getAccessToken(),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Privy signer warm-up session timed out.')), PRIVY_PREWARM_SESSION_TIMEOUT_MS); }),
        ]);
        if (timeout) { clearTimeout(timeout); timeout = undefined; }
        if (!token) throw new Error('Privy session is unavailable for signer warm-up.');
        if (prewarmDesiredKeyRef.current !== prewarmKey || sessionJWTRef.current !== bearer ||
            signerContextRef.current !== signerContext || document.visibilityState === 'hidden' || executionLockRef.current) {
          throw new DOMException('Signer warm-up context changed before signing.', 'AbortError');
        }
        if (prewarmSolanaWallet) {
          const message = new TextEncoder().encode([
            'SmartX Fast Swap signer warm-up',
            `origin:${location.origin}`,
            `wallet:${prewarmSolanaWallet.address}`,
            `nonce:${uuid()}`,
            'purpose:non-authorizing latency warm-up',
          ].join('\n'));
          // Privy does not expose cancellation for an in-flight wallet signature.
          // Keep the transaction gate closed until this call definitively settles.
          await signSolanaWarmupMessage({message, wallet:prewarmSolanaWallet as never, options:{uiOptions:{showWalletUIs:false}}});
        } else if (prewarmEvmWallet) {
          const provider = await prewarmEvmWallet.getEthereumProvider();
          await provider.request({method:'eth_chainId'});
        }
      } catch {
        status = 'failed';
      } finally {
        if (timeout) clearTimeout(timeout);
        const durationMS = performance.now() - started;
        recordPageTiming('privy_prewarm_done', {chain:selectedRoute?.origin_chain ?? '', status, duration_ms:durationMS});
        markSwapTiming('privy_prewarm_done', {chain:selectedRoute?.origin_chain ?? '', status, duration_ms:durationMS});
        scheduleTimingFlush();
        prewarmInFlightRef.current = false;
        if (prewarmDesiredKeyRef.current === prewarmKey) {
          warmedPrewarmKeysRef.current.add(prewarmKey);
          setPrewarmState({key:prewarmKey,status,durationMS});
          setTimings((rows) => [{name:'privy_prewarm_ms',duration:durationMS,at:new Date().toISOString()},...rows].slice(0,12));
        } else {
          setPrewarmState({key:'',status:'idle',durationMS:null});
        }
      }
    })();
  }, [currentAuthScope, experimentGroup, getAccessToken, hasSession, inputKey, pendingExecution, prewarmEvmWallet,
    prewarmKey, prewarmRequired, prewarmSolanaWallet, prewarmState.status, pageVisible, selectedRoute?.origin_chain, signSolanaWarmupMessage, unresolvedArtifact]);

  const canSign = Boolean(ready && !autoQuote.debouncing && !autoQuote.inFlight && pendingLoaded && !pendingExecution && !unresolvedArtifact && hasSession && prewarmSettled);
  const inputsLocked = busy === 'signing' || busy === 'reporting' || executionLockRef.current || Boolean(pendingExecution) || unresolvedArtifact || Boolean(snapshot && !isTerminal(snapshot) && !unsignedQuote(snapshot));
  const quoteButtonLabel = busy === 'signing' ? 'Privy 签名中' : busy === 'reporting' ? '服务端广播中' :
    !hasSession ? '请先登录' : !inputKey ? '请输入有效的交易金额和资产' : autoRequested && (autoQuote.debouncing || !ready || safeRemaining <= 0) ? autoQuote.phase || '正在获取报价' :
    snapshot?.revision.solana && solanaVerifiedRevision !== snapshot.revision.revision ? '正在校验交易' :
    !prewarmSettled ? 'Privy 预热中' : '确认、签名并执行';
  const timingOptions = timingRunOptions();

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-4">
        <header className="space-y-1">
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-accent" /><h1 className="text-xl font-semibold">Fast Swap</h1></div>
          <p className="text-sm text-muted">报价阶段生成完整交易，确认后只签名并通过平台代付通道执行。</p>
        </header>

        {!hasSession ? <Card><CardContent className="py-6 text-sm text-muted">请先完成 Privy 登录和 SmartX 会话登录，再打开 Fast Swap。</CardContent></Card> : null}
        {error ? <div role="alert" className="flex gap-2 rounded-lg border border-down/40 bg-down/10 p-3 text-sm text-down"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div> : null}

        <Card>
          <CardHeader><CardTitle>1 · 交易意图</CardTitle><CardDescription>资产填写链上地址；金额填写最小单位整数，避免前端猜测小数位。</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <label className={labelClass}>路线
              <select className={inputClass} value={routeID} onChange={(event) => editIntent(() => setRouteID(event.target.value))} disabled={inputsLocked}>
                <option value="">选择已部署路线</option>
                {routes.map((route) => <option key={route.route_id} value={route.route_id} disabled={!route.enabled || !supportsRoute(route)}>{routeLabel(route)}{route.enabled && supportsRoute(route) ? '' : ` · ${route.unavailable_reason ?? '客户端暂不支持'}`}</option>)}
              </select>
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className={labelClass}><span className="flex items-center gap-2"><TokenAvatar chain={selectedRoute?.origin_chain ?? ''} address={sourceMetadataAddress} size={28} /><span>源资产地址</span></span><input className={inputClass} value={sourceAsset} onChange={(event) => editIntent(() => setSourceAsset(event.target.value))} disabled={inputsLocked} placeholder="mint / 0x contract" /></label>
              <label className={labelClass}><span className="flex items-center gap-2"><TokenAvatar chain={selectedRoute?.destination_chain ?? ''} address={destinationMetadataAddress} size={28} /><span>目标资产地址</span></span><input className={inputClass} value={destinationAsset} onChange={(event) => editIntent(() => setDestinationAsset(event.target.value))} disabled={inputsLocked} placeholder="mint / 0x contract" /></label>
              <label className={labelClass}>投入原子金额<input className={inputClass} inputMode="numeric" value={amountRaw} onChange={(event) => editIntent(() => setAmountRaw(event.target.value))} disabled={inputsLocked} placeholder="输入金额后自动获取报价，如 2000000 = 2 USDC" /></label>
              <label className={labelClass}>滑点（bps）<input className={inputClass} inputMode="numeric" value={slippage} onChange={(event) => editIntent(() => setSlippage(event.target.value))} disabled={inputsLocked} /></label>
            </div>
            <p className="rounded border border-accent/30 bg-accent/5 p-2 text-xs text-muted">推荐首笔联调：Solana USDC → wSOL、side=swap、5 USDC（amount_raw=5000000）。跨链固定费用更高，Robinhood 小额交易通常无法覆盖约 $0.867 的执行费。</p>
            <div className="grid gap-2 text-xs text-muted sm:grid-cols-2">
              <div className="rounded border border-border p-2"><span className="block">出资钱包</span><span className="font-mono text-foreground">{sourceWallet ? `${shortAddress(sourceWallet.address)} · ${shortAddress(sourceWallet.id)}` : '不可用'}</span></div>
              <div className="rounded border border-border p-2"><span className="block">收款钱包</span><span className="font-mono text-foreground">{destinationWallet ? `${shortAddress(destinationWallet.address)} · ${shortAddress(destinationWallet.id)}` : '不可用'}</span></div>
            </div>
            <p role="status" className="text-xs text-muted">{autoRequested ? autoQuote.phase || (canSign ? '报价已就绪，可确认交易' : '等待报价和本地校验') : '输入完成后自动获取报价，确认后才签名执行。'}</p>
            <Button onClick={() => void execute()} disabled={!canSign || safeRemaining <= 0 || busy !== null || Boolean(snapshot?.revision.solana && solanaVerifiedRevision !== snapshot.revision.revision)} className="w-full">
              {quoteButtonLabel}
            </Button>
            {autoRequested && !canSign && !busy && !autoQuote.inFlight && inputKey ? <Button variant="outline" onClick={() => {setError(undefined); autoQuote.retry();}}>重新获取报价</Button> : null}
          </CardContent>
        </Card>

        {snapshot && (!formEdited.current || matchesInput) ? <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>2 · 报价与签名</CardTitle><span className="rounded-full border border-border px-2 py-1 text-xs text-muted">{preparationLabel(snapshot)}</span></div>
            <CardDescription>swap {shortAddress(snapshot.swap_id)} · revision {snapshot.preparation.current_revision ?? '—'} · {streamStatus}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="投入" value={`${formatUnits(snapshot.intent.amount_in_raw, sourceDecimals)} (${snapshot.intent.amount_in_raw} raw)`} />
              <Metric label="预计收到" value={`${formatUnits(snapshot.revision.expected_out_raw || null, outputDecimals)} (${snapshot.revision.expected_out_raw || '—'} raw)`} />
              <Metric label="最低收到" value={`${formatUnits(snapshot.revision.min_out_raw || null, outputDecimals)} (${snapshot.revision.min_out_raw || '—'} raw)`} />
            </div>
            {snapshot.revision.fees.length ? <div className="space-y-1 text-xs text-muted">{snapshot.revision.fees.map((fee, index) => <div key={`${fee.kind}:${fee.asset}:${index}`} className="flex justify-between"><span>费用类型 {fee.kind} · {shortAddress(fee.asset)}</span><span className="font-mono">{fee.amount_raw} raw · {fee.payer === 2 ? '平台支付' : '用户支付'}</span></div>)}</div> : null}
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2 p-3 text-sm"><span className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-accent" />安全签名窗口</span><span className="font-mono tabular">{ready ? `${Math.ceil(safeRemaining / 1000)}s` : '不可签'}</span></div>
            <div className="flex flex-wrap gap-2">
              {pendingExecution ? <Button variant="outline" onClick={() => void (pendingDurable ? reportPending(pendingExecution) : persistAndReport(pendingExecution))} disabled={busy !== null}>{pendingDurable ? '恢复并上报同一签名' : '保存恢复材料并继续'}</Button> : null}
              {unresolvedArtifact && !pendingExecution ? <p className="w-full text-xs text-down">检测到一次已签名但本机缺少完整产物的未决执行。禁止再次签名；请等待服务端恢复或联系支持。</p> : null}
              {refreshAllowed && !autoRequested ? <Button variant="outline" onClick={() => {setAutoRequested(true); autoQuote.retry();}} disabled={busy !== null || blockedWait > 0}><RefreshCw />{blockedWait > 0 ? `${Math.ceil(blockedWait / 1000)}s 后刷新` : '更新报价'}</Button> : null}
              {!isTerminal(snapshot) ? <Button variant="destructive" onClick={() => void cancel()} disabled={busy !== null}>停止准备</Button> : null}
            </div>
            {snapshot.preparation.reason_code ? <p className="text-xs text-muted">原因：{snapshot.preparation.reason_code}</p> : null}
            {snapshot.preparation.status === PreparationStatus.BLOCKED && snapshot.preparation.retry_after_ms === null ? <p className="text-xs text-down">这是永久 BLOCKED，轮询或重新 Create 不会改变结果。请停止这笔交易并修改路线、资产或金额。</p> : null}
          </CardContent>
        </Card> : null}

        {snapshot ? <Card>
          <CardHeader><CardTitle>3 · 到账与最终状态</CardTitle><CardDescription>{outcomeLabel(snapshot.settlement.outcome)}。目的链到账、可再次交易和最终完成分别核实。</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <StatusBox label="源链" value={statusLabel(snapshot.settlement.source, sourceLabels)} ok={snapshot.settlement.source === ChainLegStatus.CONFIRMED} />
              <StatusBox label="目的链" value={statusLabel(snapshot.settlement.destination, sourceLabels)} ok={snapshot.settlement.destination >= ChainLegStatus.OBSERVED && snapshot.settlement.destination !== ChainLegStatus.REORGED} />
              <StatusBox label="Relay" value={statusLabel(snapshot.settlement.relay, relayLabels)} ok={snapshot.settlement.relay === RelayStatus.FILLED} />
              <StatusBox label="账务" value={statusLabel(snapshot.settlement.accounting, accountingLabels)} ok={snapshot.settlement.accounting === AccountingStatus.POSTED} />
              <StatusBox label="Fast Fill" value={statusLabel(snapshot.fast_fill.status, fastFillLabels)} ok={[FastFillStatus.ACCEPTED, FastFillStatus.RELEASED].includes(snapshot.fast_fill.status as never)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="实际投入" value={formatUnits(snapshot.settlement.amount_in_actual_raw, sourceDecimals)} />
              <Metric label="实际到账" value={formatUnits(snapshot.settlement.amount_out_actual_raw, outputDecimals)} />
              <Metric label="最近实测可花" value={formatUnits(snapshot.availability.spendable_raw, outputDecimals)} />
            </div>
            <div className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center gap-2">{snapshot.availability.can_execute ? <CheckCircle2 className="h-4 w-4 text-up" /> : <Clock3 className="h-4 w-4 text-muted" />}<span>{snapshot.availability.can_execute ? '目的资产已经可以用于下一笔交易' : snapshot.availability.spendable_raw === null ? '可用余额尚未实测' : '目的资产暂不可执行'}</span></div>
              {snapshot.settlement.outcome === Outcome.REFUNDED ? <p className="mt-2 text-xs text-muted">已退款 {formatUnits(snapshot.settlement.amount_refunded_raw, sourceDecimals)}；退款费用差额 {formatUnits(snapshot.settlement.refund_fee_delta_raw, sourceDecimals)}。</p> : null}
              {snapshot.settlement.destination_tx_hash ? <p className="mt-2 break-all font-mono text-xs text-muted">destination tx: {snapshot.settlement.destination_tx_hash}</p> : null}
            </div>
            {isTerminal(snapshot) ? <Button variant="outline" onClick={startNextTest} disabled={busy !== null || Boolean(pendingExecution) || unresolvedArtifact}>新一笔测试（保留钱包连接）</Button> : null}
          </CardContent>
        </Card> : null}
      </section>

      <aside className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><WalletCards className="h-4 w-4" />未完成交易</CardTitle><CardDescription>来自服务端的恢复列表，刷新或换设备后仍可继续查看。</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {active.length === 0 ? <p className="text-xs text-muted">没有未完成的 Fast Swap。</p> : active.map((item) => <button type="button" key={item.swap_id} onClick={() => selectActive(item)} className={`w-full rounded-lg border p-3 text-left text-xs ${snapshot?.swap_id === item.swap_id ? 'border-accent bg-accent/5' : 'border-border'}`}><div className="flex justify-between gap-2"><span className="font-mono text-foreground">{shortAddress(item.swap_id)}</span><span>{outcomeLabel(item.settlement.outcome)}</span></div><div className="mt-1 flex items-center gap-1 text-muted"><span>{item.intent.origin_chain}</span><ArrowRight className="h-3 w-3" /><span>{item.intent.destination_chain}</span></div></button>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>前端时间</CardTitle><CardDescription>浏览器单调时钟；服务端与链上时间需用同一 swap/trace 合并分析。</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <label className={labelClass}>实验组（应用到下一笔）
              <select className={inputClass} value={experimentGroup} disabled={busy !== null || Boolean(snapshot && !isTerminal(snapshot))} onChange={(event) => {
                const group = event.target.value === 'B' ? 'B' : 'A'; setExperimentGroup(group); setTimingExperimentGroup(group);
              }}><option value="A">A</option><option value="B">B</option></select>
            </label>
            <label className={labelClass}>证据范围
              <select className={inputClass} value={evidenceRunID} disabled={busy === 'signing' || busy === 'reporting'} onChange={(event) => setEvidenceRunID(event.target.value)}>
                <option value="">全部测试</option>
                {timingOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <Button variant="outline" disabled={busy === 'signing' || busy === 'reporting'} onClick={() => {flushTimingEvidence(); setEvidence(timingEvidence(actor, evidenceRunID || undefined));}}>显示所选时间证据</Button>
            <Button variant="outline" onClick={() => {
              flushTimingEvidence();
              const url = URL.createObjectURL(new Blob([timingEvidence(actor, evidenceRunID || undefined)], {type:'application/json'}));
              const link = document.createElement('a'); link.href = url; link.download = `fastswap-timing-${new Date().toISOString().slice(0,10)}.json`; link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }} disabled={busy === 'signing' || busy === 'reporting'}>下载时间证据 JSON</Button>
            <p className="rounded border border-border p-2 text-muted">v3 仅在页面内采集 Long Task 与 Resource Timing；Privy 跨域 iframe 网络以单独的 CDP 脱敏文件为准。缺失项记为 unknown。</p>
            {evidence && authScopeRef.current === currentAuthScope ? <pre data-testid="fastswap-timing-evidence" className="max-h-80 overflow-auto whitespace-pre-wrap break-all">{evidence}</pre> : null}
            <div className="flex justify-between gap-3 border-b border-border pb-2"><span>最新 trace_id</span><span className="break-all text-right font-mono text-foreground">{latestTrace || '尚无请求'}</span></div>
            {timings.length === 0 ? <p className="text-muted">执行后显示 prepare、sign 和 report 分段。</p> : timings.map((row, index) => <div key={`${row.name}:${row.at}:${index}`} className="flex justify-between border-b border-border pb-2"><span>{row.name}</span><span className="font-mono tabular">{row.duration.toFixed(1)} ms</span></div>)}
          </CardContent>
        </Card>
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs leading-5 text-muted">
          后端契约标记端到端真链 B6 尚未完成。本页不会把接口 200、广播接受或 included 单独显示为最终到账。
        </div>
      </aside>
    </div>
  );
}

function Metric({label, value}: {label: string; value: string}) {
  return <div className="rounded-lg border border-border bg-surface-2 p-3"><p className="text-xs text-muted">{label}</p><p className="mt-1 break-all font-mono text-sm tabular text-foreground">{value}</p></div>;
}
function StatusBox({label, value, ok}: {label: string; value: string; ok: boolean}) {
  return <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">{label}</p><p className={`mt-1 text-sm ${ok ? 'text-up' : 'text-foreground'}`}>{value}</p></div>;
}
