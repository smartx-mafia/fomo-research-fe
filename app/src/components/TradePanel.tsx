'use client';

import {useWallets as useEvmWallets, usePrivy} from '@privy-io/react-auth';
import {useSignTransaction, useWallets as useSolanaWallets} from '@privy-io/react-auth/solana';
import {AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw} from 'lucide-react';
import Link from 'next/link';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {ApiError} from '@/api/envelope';
import {getPortfolio, type PortfolioPosition} from '@/api/portfolio';
import {
  CODE_DELEGATION_REQUIRED,
  CODE_PREPARED_SUPERSEDED,
  SIGN_KIND_EVM_7702_AUTHORIZATION,
  SIGN_KIND_EVM_CALIBUR_BATCH,
  SIGN_KIND_EVM_PERMIT_DIGEST,
  SIGN_KIND_EVM_USER_OPERATION,
  SIGN_KIND_SOLANA_TRANSACTION,
  TRADE_PHASE_FAILED,
  TRADE_PHASE_SUCCESS,
  createTrade,
  formatUnits,
  getTokenInfo,
  getTrade,
  listTradeChains,
  parseUnits,
  phaseOf,
  pollTrade,
  prepareDelegation,
  prepareTrade,
  previewTrade,
  submitDelegation,
  submitTrade,
  type MemeChain,
  type PrepareTradeReply,
  type TokenInfo,
  type TradeIntent,
  type TradePreview,
  type TradeReply,
  type TradeSide,
} from '@/api/trade';
import {SOLANA_RPC_URL} from '@/config';
import {
  assertRecoveredSigner,
  checkAuthorizationDigest,
  digestFromBase64,
  encodeCaliburSignatures,
  parseCaliburSignData,
} from '@/lib/trade-calibur';
import {assertPreparedTradeMatches, intentFingerprint, outputAmount, parseIntentFingerprint} from '@/lib/trade-execution';
import {assertSolanaRequiredSigner, extractSolanaSignature, fromBase64, signEvmDigest, toBase64} from '@/lib/trade-signature';
import {clearTradeRecovery, readTradeRecovery, tradeRecoveryStoragePrefix, writeTradeRecovery} from '@/lib/trade-recovery';
import {createTradeStopwatch, logTradeTiming, type TradeStopwatch} from '@/lib/trade-timing';
import {clearSite, useSession} from '@/session/storage';

type TradeStage =
  | 'idle'
  | 'creating'
  | 'preparing'
  | 'delegating'
  | 'signing'
  | 'submitting'
  | 'polling'
  | 'included'
  | 'confirmed'
  | 'failed'
  | 'uncertain';

type PendingSubmission = {
  tradeID: string;
  signature: string;
  expiresAt?: string;
  prepareID: string;
  fingerprint: string;
};

class UncertainTradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UncertainTradeError';
  }
}

const SIGN_TIMEOUT_MS = 45_000;

function pickWallet<T extends {address: string}>(wallets: readonly T[], wanted: string, evm: boolean): T {
  const normalize = (value: string) => evm ? value.toLowerCase() : value;
  const wallet = wallets.find((candidate) => normalize(candidate.address) === normalize(wanted));
  if (!wallet) {
    const available = wallets.map((candidate) => candidate.address).join(', ') || 'none';
    throw new Error(`Server selected wallet ${wanted}, but the browser has [${available}].`);
  }
  return wallet;
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not return within 45 seconds.`)), SIGN_TIMEOUT_MS);
    }),
  ]);
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, {once: true});
  });
}

function safeMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 400000) return 'Your session expired. Sign in again before trading.';
    if (error.code === 430114) return 'Complete invitation access before trading.';
    if (error.code === 430286 || error.code === 100286) return 'This launchpad token cannot be traded until it graduates.';
    if (error.code === 430295 || error.code === 100295) return 'No counterparty can fill this trade right now.';
    if (error.code === CODE_DELEGATION_REQUIRED || error.code === 100283) return 'This wallet needs one-time delegation before the trade can continue.';
    if (error.code === CODE_PREPARED_SUPERSEDED) return 'The signed quote was replaced. The current quote must be prepared and signed again.';
    if (error.code === 100282 || error.code === 430282) return 'The prepared transaction expired. Prepare and sign it again.';
    if (error.code === 420203 || error.code === 430267) return 'This wallet already has another on-chain action in progress.';
    if (error.code === 430296) return 'The dispatch queue is full. Try submitting again shortly.';
    if (error.code === 420000) return 'Trade requests are rate limited. Wait a moment and retry.';
    if (error.code === 500097) return 'The trade service is temporarily unavailable.';
    return `Trade request failed (code ${error.code}, trace ${error.traceID ?? 'unavailable'}).`;
  }
  return error instanceof Error ? error.message : 'Trade failed unexpectedly.';
}

function sameAsset(candidate: PortfolioPosition, chainInfo: MemeChain, token: string) {
  if (candidate.asset.chain !== chainInfo.chain) return false;
  return chainInfo.kind === 'evm'
    ? candidate.asset.token_address.toLowerCase() === token.toLowerCase()
    : candidate.asset.token_address === token;
}

function targetPositionMark(positions: PortfolioPosition[], chainInfo: MemeChain, token: string) {
  const position = positions.find((candidate) => sameAsset(candidate, chainInfo, token));
  return position ? `${position.shares_raw}@${position.opened_entry_id}` : 'missing';
}

function tokenInfoMatches(info: TokenInfo | undefined, chain: string, token: string) {
  if (!info || info.chain !== chain) return false;
  return /^0x[0-9a-f]{40}$/i.test(token)
    ? info.address.toLowerCase() === token.toLowerCase()
    : info.address === token;
}

function StagePill({stage}: {stage: TradeStage}) {
  const active = !['idle', 'included', 'confirmed', 'failed', 'uncertain'].includes(stage);
  const label: Record<TradeStage, string> = {
    idle: 'Ready', creating: 'Creating order', preparing: 'Preparing transaction', delegating: 'Authorizing wallet',
    signing: 'Signing', submitting: 'Submitting', polling: 'Confirming', included: 'Included', confirmed: 'Confirmed',
    failed: 'Failed', uncertain: 'Pending review',
  };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2 py-1 text-[11px] text-muted">
      {active ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
      {label[stage]}
    </span>
  );
}

export function TradePanel({chain, address, symbol}: {chain: string; address: string; symbol?: string}) {
  const session = useSession();
  const {ready: privyReady, authenticated, user: privyUser} = usePrivy();
  const {wallets: evmWallets} = useEvmWallets();
  const {wallets: solanaWallets} = useSolanaWallets();
  const {signTransaction} = useSignTransaction();

  const [side, setSide] = useState<TradeSide>('buy');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('300');
  const [chains, setChains] = useState<MemeChain[]>();
  const [chainsMessage, setChainsMessage] = useState<string>();
  const [tokenInfo, setTokenInfo] = useState<TokenInfo>();
  const [preview, setPreview] = useState<TradePreview>();
  const [previewMessage, setPreviewMessage] = useState<string>();
  const [previewBlocked, setPreviewBlocked] = useState(false);
  const [autoExecute, setAutoExecute] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [stage, setStage] = useState<TradeStage>('idle');
  const [trade, setTrade] = useState<TradeReply>();
  const [tradeOutputFormat, setTradeOutputFormat] = useState<{decimals?: number; unit: string}>();
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission>();
  const [position, setPosition] = useState<PortfolioPosition>();
  const [positionRefreshing, setPositionRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [recoveryIntent, setRecoveryIntent] = useState<TradeIntent>();
  const operationAbortRef = useRef<AbortController | null>(null);
  const finalityAbortRef = useRef<AbortController | null>(null);
  const operationLockRef = useRef(false);
  const reviewLockRef = useRef(false);
  const statusLockRef = useRef(false);
  const sessionJWTRef = useRef(session?.jwt);
  const previousSessionJWTRef = useRef<string | null | undefined>(undefined);
  const submitAttemptedRef = useRef(false);
  const tradeSessionJWTRef = useRef<string | undefined>(undefined);
  const previewGenerationRef = useRef(0);
  const previewFingerprintRef = useRef('');
  const currentTokenContextRef = useRef(`${chain}\u0000${address}`);
  const previousTokenContextRef = useRef<string | undefined>(undefined);
  const operationTokenContextRef = useRef<string | undefined>(undefined);
  const signerContextRef = useRef<string | undefined>(undefined);
  const operationSignerContextRef = useRef<string | undefined>(undefined);
  const tradeFingerprintRef = useRef<string | undefined>(undefined);
  const tradeRecoveryContextRef = useRef<{actorID: string; chain: string; token: string; fingerprint: string} | undefined>(undefined);
  const recoveryLoadedContextRef = useRef<string | undefined>(undefined);
  const [recoveryRevision, setRecoveryRevision] = useState(0);
  const autoExecutionFingerprintRef = useRef<string | undefined>(undefined);
  const autoExecuteArmedRef = useRef(false);
  const autoExecutionSessionRef = useRef<string | undefined>(undefined);
  const autoExecutionContextRef = useRef<string | undefined>(undefined);
  const executeTradeRef = useRef<(() => void) | null>(null);

  sessionJWTRef.current = session?.jwt;
  currentTokenContextRef.current = `${chain}\u0000${address}`;
  signerContextRef.current = privyReady && authenticated && privyUser
    ? JSON.stringify([
      privyUser.id,
      ...solanaWallets.map((wallet) => `solana:${wallet.address}`).sort(),
      ...evmWallets.map((wallet) => `evm:${wallet.address.toLowerCase()}`).sort(),
    ])
    : undefined;
  const actorID = session?.user?.identifier;

  const busy = !['idle', 'included', 'confirmed', 'failed', 'uncertain'].includes(stage);
  const hasUnresolvedSubmission = recoveryBlocked || submitAttemptedRef.current &&
    (stage === 'uncertain' || stage === 'included' || pendingSubmission !== undefined);
  const enabledChain = chains?.find((item) => item.chain === chain);
  const activeTokenInfo = tokenInfoMatches(tokenInfo, chain, address) ? tokenInfo : undefined;
  const requiresSolanaWallet = side === 'buy' || enabledChain?.kind === 'svm';
  const requiresEvmWallet = enabledChain?.kind === 'evm';
  const walletsReady = (!requiresSolanaWallet || solanaWallets.length > 0) && (!requiresEvmWallet || evmWallets.length > 0);

  const intentResult = useMemo(() => {
    try {
      if (!activeTokenInfo) return {error: 'Loading token decimals…'} as const;
      if (slippage.trim() === '') return {error: 'Enter slippage in basis points.'} as const;
      const slippageBps = Number(slippage);
      if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 10_000) {
        return {error: 'Slippage must be an integer from 1 to 10,000 bps.'} as const;
      }
      const decimals = side === 'buy' ? 6 : activeTokenInfo.decimals;
      const raw = parseUnits(amount, decimals);
      if (raw <= BigInt(0)) return {error: 'Amount must be greater than zero.'} as const;
      return {intent: {chain, side, token: address, amountIn: raw.toString(), slippageBps} satisfies TradeIntent} as const;
    } catch (error) {
      return {error: error instanceof Error ? error.message : String(error)} as const;
    }
  }, [activeTokenInfo, address, amount, chain, side, slippage]);

  useEffect(() => {
    const controller = new AbortController();
    setTokenInfo(undefined);
    getTokenInfo(chain, address, controller.signal).then(setTokenInfo).catch(() => setTokenInfo(undefined));
    return () => controller.abort();
  }, [address, chain]);

  useEffect(() => {
    if (!session?.jwt) {
      setChains(undefined);
      setChainsMessage(undefined);
      return;
    }
    const bearer = session.jwt;
    const controller = new AbortController();
    listTradeChains(bearer, controller.signal)
      .then((items) => {
        if (sessionJWTRef.current !== bearer) return;
        setChains(items);
        setChainsMessage(undefined);
      })
      .catch((error) => {
        if (sessionJWTRef.current !== bearer) return;
        if (error instanceof ApiError && error.code === 400000) clearSite();
        setChains([]);
        setChainsMessage(safeMessage(error));
      });
    return () => controller.abort();
  }, [session?.jwt]);

  useEffect(() => {
    const context = `${chain}\u0000${address}`;
    if (previousTokenContextRef.current === undefined) {
      previousTokenContextRef.current = context;
      return;
    }
    if (previousTokenContextRef.current === context) return;
    previousTokenContextRef.current = context;
    disarmAutoExecute();
    previewGenerationRef.current += 1;
    previewFingerprintRef.current = '';
    setPreview(undefined);
    setPreviewMessage(undefined);
    setPreviewBlocked(false);
    setReviewOpen(false);
    operationAbortRef.current?.abort();
    finalityAbortRef.current?.abort();
    if (operationLockRef.current) {
      if (submitAttemptedRef.current) {
        setStage('uncertain');
        setErrorMessage('The token page changed after Submit was attempted. Do not place the previous order again.');
      } else {
        setStage('failed');
        setTrade(undefined);
        setTradeOutputFormat(undefined);
        setPendingSubmission(undefined);
        setPosition(undefined);
        setRecoveryIntent(undefined);
        setErrorMessage('The token page changed before Submit. No funds were moved.');
        tradeSessionJWTRef.current = undefined;
        operationTokenContextRef.current = undefined;
        operationSignerContextRef.current = undefined;
      }
    } else if (!hasUnresolvedSubmission) {
      setStage('idle');
      setTrade(undefined);
      setTradeOutputFormat(undefined);
      setPendingSubmission(undefined);
      setPosition(undefined);
      setRecoveryIntent(undefined);
      setErrorMessage(undefined);
      submitAttemptedRef.current = false;
      tradeSessionJWTRef.current = undefined;
      operationTokenContextRef.current = undefined;
      operationSignerContextRef.current = undefined;
    }
  }, [address, chain, hasUnresolvedSubmission]);

  const loadPreview = useCallback(async (intent: TradeIntent, signal?: AbortSignal) => {
    const bearer = session?.jwt;
    if (!bearer) throw new Error('Sign in before requesting a trade preview.');
    const generation = ++previewGenerationRef.current;
    const fingerprint = intentFingerprint(intent);
    previewFingerprintRef.current = fingerprint;
    const startedAt = Date.now();
    try {
      const result = await previewTrade(bearer, intent, signal);
      if (
        sessionJWTRef.current !== bearer ||
        previewGenerationRef.current !== generation ||
        previewFingerprintRef.current !== fingerprint
      ) throw new DOMException('The trade preview is stale.', 'AbortError');
      if (result.amount_in && result.amount_in !== intent.amountIn) throw new Error('A stale preview was discarded.');
      setPreview(result);
      setPreviewMessage(undefined);
      setPreviewBlocked(false);
      logTradeTiming('preview', Date.now() - startedAt, `route=${result.route ?? '-'}`);
      return result;
    } catch (error) {
      if (
        sessionJWTRef.current !== bearer ||
        previewGenerationRef.current !== generation ||
        previewFingerprintRef.current !== fingerprint
      ) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      const blocked = error instanceof ApiError && [430286, 430295, 100286, 100295].includes(error.code);
      if (error instanceof ApiError && error.code === 400000 && sessionJWTRef.current === bearer) clearSite();
      if (blocked) setPreview(undefined);
      setPreviewBlocked(blocked);
      setPreviewMessage(safeMessage(error));
      logTradeTiming('preview', Date.now() - startedAt, `outcome=${blocked ? 'blocked' : 'unavailable'}`);
      throw error;
    }
  }, [session?.jwt]);

  useEffect(() => {
    if (!intentResult.intent || !session?.jwt || !enabledChain || busy) {
      setPreview(undefined);
      setPreviewMessage(undefined);
      setPreviewBlocked(false);
      return;
    }
    const controller = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      await loadPreview(intentResult.intent, controller.signal).catch(() => undefined);
      if (!stopped && !controller.signal.aborted) timer = setTimeout(() => void refresh(), 300);
    };
    timer = setTimeout(() => void refresh(), 600);
    return () => {
      stopped = true;
      previewGenerationRef.current += 1;
      clearTimeout(timer);
      controller.abort();
    };
  }, [busy, enabledChain, intentResult.intent, loadPreview, session?.jwt]);

  useEffect(() => {
    const bearer = session?.jwt;
    if (!actorID || !bearer) return;
    const context = `${actorID}\u0000${bearer}\u0000${chain}\u0000${address}`;
    if (recoveryLoadedContextRef.current === context) return;
    recoveryLoadedContextRef.current = context;
    let marker: ReturnType<typeof readTradeRecovery>;
    try {
      marker = readTradeRecovery(actorID, chain, address);
    } catch {
      setRecoveryBlocked(true);
      setStage('uncertain');
      setErrorMessage('Trade recovery storage is unavailable or corrupt. New orders are blocked in this tab until it is repaired.');
      return;
    }
    if (!marker) {
      setRecoveryBlocked(false);
      setRecoveryIntent(undefined);
      return;
    }
    if (operationLockRef.current) {
      operationAbortRef.current?.abort();
      recoveryLoadedContextRef.current = undefined;
      const timer = setTimeout(() => setRecoveryRevision((revision) => revision + 1), 0);
      return () => clearTimeout(timer);
    }

    const storedIntent = parseIntentFingerprint(marker.fingerprint);
    if (!storedIntent || storedIntent.chain !== chain || intentFingerprint(storedIntent) !== marker.fingerprint) {
      setRecoveryBlocked(true);
      setStage('uncertain');
      setErrorMessage('The stored trade intent is invalid. New orders remain blocked until the original trade is reconciled.');
      return;
    }
    const recovered: TradeReply = {trade_id: marker.tradeID, side: marker.side, token: marker.token};
    submitAttemptedRef.current = true;
    tradeSessionJWTRef.current = bearer;
    operationTokenContextRef.current = currentTokenContextRef.current;
    tradeFingerprintRef.current = marker.fingerprint;
    tradeRecoveryContextRef.current = {actorID, chain, token: address, fingerprint: marker.fingerprint};
    setTrade(recovered);
    setRecoveryIntent(storedIntent);
    setTradeOutputFormat({unit: marker.side === 'buy' ? (symbol ?? 'tokens') : 'USDC'});
    setStage('polling');
    setErrorMessage('Recovering the existing trade. A new order remains blocked until its status is known.');

    const controller = new AbortController();
    void getTrade(bearer, marker.tradeID, controller.signal)
      .then((latest) => {
        if (controller.signal.aborted || sessionJWTRef.current !== bearer) return;
        setTrade(latest);
        const phase = phaseOf(latest);
        if (phase === TRADE_PHASE_FAILED && !latest.deadline_at) {
          const cleared = clearTradeRecovery(actorID, chain, address, marker.fingerprint);
          if (cleared) {
            submitAttemptedRef.current = false;
            tradeRecoveryContextRef.current = undefined;
            tradeFingerprintRef.current = undefined;
            setRecoveryIntent(undefined);
          } else setRecoveryBlocked(true);
          setStage('failed');
          setErrorMessage(cleared
            ? 'The recovered trade reached a failed terminal state.'
            : 'The recovered trade is terminal, but its recovery marker could not be removed. New orders remain blocked in this tab.');
        } else if (phase === TRADE_PHASE_SUCCESS && !latest.deadline_at) {
          const confirmed = latest.lifecycle === 'confirmed';
          const cleared = !confirmed || clearTradeRecovery(actorID, chain, address, marker.fingerprint);
          if (confirmed && cleared) {
            submitAttemptedRef.current = false;
            tradeRecoveryContextRef.current = undefined;
            tradeFingerprintRef.current = undefined;
            setRecoveryIntent(undefined);
          } else if (confirmed) setRecoveryBlocked(true);
          setStage(latest.lifecycle === 'confirmed' ? 'confirmed' : 'included');
          setErrorMessage(confirmed && !cleared
            ? 'The recovered trade is terminal, but its recovery marker could not be removed. New orders remain blocked in this tab.'
            : undefined);
          if (enabledChain) void refreshPosition(bearer, undefined, enabledChain, controller.signal);
          startFinalityRecheck(bearer, latest);
        } else {
          setStage('uncertain');
          setErrorMessage('The recovered trade is still pending. Check this same trade again; do not create another order.');
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setStage('uncertain');
          setErrorMessage(`The original trade could not be recovered yet: ${safeMessage(error)}`);
        }
      });
    return () => controller.abort();
  }, [actorID, address, chain, recoveryRevision, session?.jwt, symbol]);

  useEffect(() => {
    if (!actorID) return;
    const prefix = tradeRecoveryStoragePrefix(actorID, chain, address);
    const onStorage = (event: StorageEvent) => {
      if (!event.key?.startsWith(prefix)) return;
      operationAbortRef.current?.abort();
      finalityAbortRef.current?.abort();
      recoveryLoadedContextRef.current = undefined;
      setRecoveryRevision((revision) => revision + 1);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [actorID, address, chain]);

  useEffect(() => {
    if (!autoExecute || !autoExecuteArmedRef.current || !preview || !intentResult.intent || !session?.jwt || !enabledChain ||
      !privyReady || !authenticated || !walletsReady || previewBlocked || busy ||
      hasUnresolvedSubmission || operationLockRef.current ||
      (requiresSolanaWallet && !SOLANA_RPC_URL) ||
      autoExecutionSessionRef.current !== session.jwt ||
      autoExecutionContextRef.current !== currentTokenContextRef.current) return;
    const fingerprint = intentFingerprint(intentResult.intent);
    if (previewFingerprintRef.current !== fingerprint) return;
    if (autoExecutionFingerprintRef.current === fingerprint) return;
    autoExecutionFingerprintRef.current = fingerprint;
    autoExecuteArmedRef.current = false;
    setAutoExecute(false);
    setReviewOpen(false);
    void executeTradeRef.current?.();
  }, [
    authenticated,
    autoExecute,
    busy,
    enabledChain,
    hasUnresolvedSubmission,
    intentResult.intent,
    preview,
    previewBlocked,
    privyReady,
    requiresSolanaWallet,
    session?.jwt,
    walletsReady,
  ]);

  useEffect(() => () => {
    operationAbortRef.current?.abort();
    finalityAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    const current = session?.jwt ?? null;
    if (previousSessionJWTRef.current === undefined) {
      previousSessionJWTRef.current = current;
      return;
    }
    if (previousSessionJWTRef.current === current) return;
    previousSessionJWTRef.current = current;
    recoveryLoadedContextRef.current = undefined;
    setRecoveryRevision((revision) => revision + 1);
    disarmAutoExecute();
    operationAbortRef.current?.abort();
    finalityAbortRef.current?.abort();
    if (operationLockRef.current) {
      if (submitAttemptedRef.current) {
        setStage('uncertain');
        setErrorMessage(
          current === tradeSessionJWTRef.current
            ? 'The original session was restored. Check the existing trade ID before placing another order.'
            : 'The session changed after Submit. Switch back to the original session to recover the existing trade.',
        );
      } else {
        setStage('failed');
        setTrade(undefined);
        setTradeOutputFormat(undefined);
        setPendingSubmission(undefined);
        setPosition(undefined);
        setRecoveryIntent(undefined);
        setErrorMessage('The session changed before Submit. This order did not move funds.');
        tradeSessionJWTRef.current = undefined;
        operationTokenContextRef.current = undefined;
        operationSignerContextRef.current = undefined;
      }
    } else if (hasUnresolvedSubmission) {
      setStage('uncertain');
      setErrorMessage(
        current === tradeSessionJWTRef.current
          ? 'The original session was restored. Check the existing trade ID before placing another order.'
          : 'Switch back to the original session to recover the unresolved trade.',
      );
    } else {
      setStage('idle');
      setTrade(undefined);
      setTradeOutputFormat(undefined);
      setPendingSubmission(undefined);
      setPosition(undefined);
      setRecoveryIntent(undefined);
      setErrorMessage(undefined);
      submitAttemptedRef.current = false;
      tradeSessionJWTRef.current = undefined;
      operationTokenContextRef.current = undefined;
      operationSignerContextRef.current = undefined;
    }
  }, [hasUnresolvedSubmission, session?.jwt]);

  async function signPrepared(
    prepared: PrepareTradeReply,
    assertActive: () => void = () => undefined,
    requireExpiry = true,
  ): Promise<string> {
    assertActive();
    if (requireExpiry) {
      const expiresAt = prepared.expires_at ? Date.parse(prepared.expires_at) : Number.NaN;
      if (!Number.isFinite(expiresAt) || expiresAt - Date.now() <= 5_000) {
        throw new Error('The prepared transaction is expired or has less than five seconds remaining.');
      }
    }
    if (prepared.sign_kind === SIGN_KIND_SOLANA_TRANSACTION) {
      if (!SOLANA_RPC_URL) throw new Error('NEXT_PUBLIC_SOLANA_RPC_URL is required for Solana signing.');
      const wallet = pickWallet(solanaWallets, prepared.wallet_address, false);
      const wireTransaction = fromBase64(prepared.sign_data);
      assertSolanaRequiredSigner(wireTransaction, prepared.wallet_address);
      const result = await withTimeout(
        signTransaction({transaction: wireTransaction, wallet}),
        'Solana wallet signature',
      );
      assertActive();
      return toBase64(extractSolanaSignature(result.signedTransaction, prepared.wallet_address, wireTransaction));
    }
    const wallet = pickWallet(evmWallets, prepared.wallet_address, true);
    if (
      prepared.sign_kind === SIGN_KIND_EVM_USER_OPERATION ||
      prepared.sign_kind === SIGN_KIND_EVM_7702_AUTHORIZATION ||
      prepared.sign_kind === SIGN_KIND_EVM_PERMIT_DIGEST
    ) {
      const digest = fromBase64(prepared.sign_data);
      const signature = await withTimeout(
        signEvmDigest(wallet, digest, assertActive),
        'EVM wallet signature',
      );
      assertActive();
      await assertRecoveredSigner(digest, signature, prepared.wallet_address);
      assertActive();
      return toBase64(signature);
    }
    if (prepared.sign_kind === SIGN_KIND_EVM_CALIBUR_BATCH) {
      const envelope = parseCaliburSignData(fromBase64(prepared.sign_data));
      if (envelope.authorization) {
        if (enabledChain && envelope.authorization.chain_id !== enabledChain.chain_id) {
          throw new Error('The EIP-7702 authorization chain does not match the selected trade chain.');
        }
        checkAuthorizationDigest(envelope.authorization);
      }
      const batchDigest = digestFromBase64(envelope.batch_digest, 'Calibur batch digest');
      const batchSignature = await withTimeout(signEvmDigest(wallet, batchDigest, assertActive), 'Calibur batch signature');
      assertActive();
      await assertRecoveredSigner(batchDigest, batchSignature, prepared.wallet_address);
      assertActive();
      let authorizationSignature: Uint8Array | undefined;
      if (envelope.authorization) {
        const digest = digestFromBase64(envelope.authorization.digest, 'Authorization digest');
        authorizationSignature = await withTimeout(signEvmDigest(wallet, digest, assertActive), 'Calibur authorization signature');
        assertActive();
        await assertRecoveredSigner(digest, authorizationSignature, prepared.wallet_address);
        assertActive();
      }
      return encodeCaliburSignatures(batchSignature, authorizationSignature);
    }
    throw new Error(`Unsupported sign_kind=${prepared.sign_kind}.`);
  }

  function assertCurrentOperation(bearer: string, controller: AbortController, requireSigner = true) {
    if (
      controller.signal.aborted ||
      sessionJWTRef.current !== bearer ||
      operationTokenContextRef.current !== currentTokenContextRef.current ||
      requireSigner && operationSignerContextRef.current !== signerContextRef.current
    ) {
      controller.abort();
      throw new DOMException('The trading session changed.', 'AbortError');
    }
  }

  function persistTradeRecoveryMarker(current: TradeReply, fingerprint: string, alreadySubmitted = false) {
    if (!actorID || !writeTradeRecovery(actorID, chain, address, fingerprint, current)) {
      setRecoveryBlocked(true);
      throw new Error(alreadySubmitted
        ? 'Recovery storage is unavailable for the existing submitted trade. Do not place another order.'
        : 'Recovery storage is unavailable. Submit was not sent, so no funds were moved.');
    }
    tradeFingerprintRef.current = fingerprint;
    tradeRecoveryContextRef.current = {actorID, chain, token: address, fingerprint};
  }

  function clearCurrentTradeRecovery(): boolean {
    const context = tradeRecoveryContextRef.current;
    if (!context) return true;
    if (!clearTradeRecovery(context.actorID, context.chain, context.token, context.fingerprint)) {
      setRecoveryBlocked(true);
      setErrorMessage('The trade is terminal, but its recovery marker could not be removed. New orders remain blocked in this tab.');
      return false;
    }
    tradeRecoveryContextRef.current = undefined;
    tradeFingerprintRef.current = undefined;
    setRecoveryIntent(undefined);
    setRecoveryBlocked(false);
    return true;
  }

  async function runDelegation(bearer: string, controller: AbortController) {
    setStage('delegating');
    let prepared;
    try {
      prepared = await prepareDelegation(bearer, chain, controller.signal);
      assertCurrentOperation(bearer, controller);
    } catch (error) {
      // On this endpoint 430283 means delegation is already installed.
      if (error instanceof ApiError && error.code === CODE_DELEGATION_REQUIRED) return;
      throw error;
    }
    if (prepared.sign_kind !== SIGN_KIND_EVM_7702_AUTHORIZATION) {
      throw new Error(`Delegation returned unexpected sign_kind=${prepared.sign_kind}.`);
    }
    const signature = await signPrepared(
      {...prepared, prepare_id: '', trade: {trade_id: '', side, token: address}},
      () => assertCurrentOperation(bearer, controller),
      false,
    );
    assertCurrentOperation(bearer, controller);
    await submitDelegation(bearer, chain, prepared.nonce ?? 0, signature, controller.signal);
    assertCurrentOperation(bearer, controller);
  }

  async function prepareAndSign(
    bearer: string,
    tradeID: string,
    intent: TradeIntent,
    controller: AbortController,
    timing?: TradeStopwatch,
  ): Promise<{prepared: PrepareTradeReply; signature: string}> {
    let delegationAttempted = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assertCurrentOperation(bearer, controller);
      setStage('preparing');
      let prepared: PrepareTradeReply;
      try {
        prepared = await prepareTrade(bearer, tradeID, controller.signal);
        assertCurrentOperation(bearer, controller);
      } catch (error) {
        if (error instanceof ApiError && error.code === CODE_DELEGATION_REQUIRED && !delegationAttempted) {
          delegationAttempted = true;
          timing?.mark('prepare.delegation-required');
          await runDelegation(bearer, controller);
          setStage('preparing');
          prepared = await prepareTrade(bearer, tradeID, controller.signal);
          assertCurrentOperation(bearer, controller);
        } else {
          throw error;
        }
      }
      assertPreparedTradeMatches(prepared, intent, tradeID);
      timing?.mark(`prepare.done#${attempt + 1}`, `sign_kind=${prepared.sign_kind} prepare_id=${prepared.prepare_id ? 'on' : 'absent'}`);
      setStage('signing');
      const signature = await signPrepared(prepared, () => assertCurrentOperation(bearer, controller));
      assertCurrentOperation(bearer, controller);
      timing?.mark(`sign.done#${attempt + 1}`);
      const expiresAt = prepared.expires_at ? Date.parse(prepared.expires_at) : Number.NaN;
      if (!Number.isFinite(expiresAt) || expiresAt - Date.now() < 5_000) continue;
      return {prepared, signature};
    }
    throw new Error('Prepared transaction expired repeatedly before it could be submitted.');
  }

  async function refreshPosition(
    bearer: string,
    baseline: PortfolioPosition[] | undefined,
    chainInfo: MemeChain,
    signal: AbortSignal,
  ) {
    setPositionRefreshing(true);
    let baselineMark = baseline ? targetPositionMark(baseline, chainInfo, address) : undefined;
    try {
      // Match the RN execution path: refresh every 300ms for at most 40 seconds.
      for (let elapsed = 0; elapsed <= 40_000; elapsed += 300) {
        if (elapsed > 0) await abortableDelay(300, signal);
        signal.throwIfAborted();
        const positions = (await getPortfolio(bearer, signal, true)).positions;
        const match = positions.find((candidate) => sameAsset(candidate, chainInfo, address));
        if (match) setPosition(match);
        const mark = targetPositionMark(positions, chainInfo, address);
        if (baselineMark === undefined) baselineMark = mark;
        else if (mark !== baselineMark) return;
      }
    } catch {
      // Position projection is eventual and must not change the trade outcome.
    } finally {
      setPositionRefreshing(false);
    }
  }

  async function submitWithRecovery(
    bearer: string,
    initial: TradeReply,
    initialPayload: PendingSubmission,
    intent: TradeIntent,
    controller: AbortController,
    timing?: TradeStopwatch,
  ): Promise<TradeReply> {
    let current = initial;
    let payload = initialPayload;
    let supersededRetried = false;
    let queueRetries = 0;
    let reprepareRetries = 0;
    persistTradeRecoveryMarker(current, payload.fingerprint);
    setPendingSubmission(payload);
    submitAttemptedRef.current = true;

    for (;;) {
      assertCurrentOperation(bearer, controller);
      setStage('submitting');
      try {
        current = await submitTrade(bearer, current.trade_id, payload.signature, payload.prepareID, controller.signal);
        assertCurrentOperation(bearer, controller);
        timing?.mark('submit.done', `lifecycle=${current.lifecycle ?? '-'}`);
        setPendingSubmission(undefined);
        return current;
      } catch (submitError) {
        if (controller.signal.aborted || sessionJWTRef.current !== bearer) {
          throw new UncertainTradeError('The session changed after Submit was attempted.');
        }

        if (submitError instanceof ApiError && submitError.code === CODE_PREPARED_SUPERSEDED && !supersededRetried) {
          supersededRetried = true;
          reprepareRetries += 1;
          timing?.mark('submit.superseded');
          const next = await prepareAndSign(bearer, current.trade_id, intent, controller, timing);
          payload = {
            tradeID: current.trade_id,
            signature: next.signature,
            expiresAt: next.prepared.expires_at,
            prepareID: next.prepared.prepare_id,
            fingerprint: payload.fingerprint,
          };
          setPendingSubmission(payload);
          continue;
        }

        let recovered: TradeReply;
        try {
          recovered = await getTrade(bearer, current.trade_id, controller.signal);
          assertCurrentOperation(bearer, controller);
        } catch {
          throw new UncertainTradeError('Submit returned no answer and trade status could not be recovered.');
        }
        current = recovered;
        setTrade(recovered);

        const recoveredPhase = phaseOf(recovered);
        if (
          ['signed', 'submitted', 'included', 'confirmed', 'failed'].includes(recovered.lifecycle ?? '') ||
          ((recoveredPhase === TRADE_PHASE_SUCCESS || recoveredPhase === TRADE_PHASE_FAILED) && !recovered.deadline_at)
        ) {
          setPendingSubmission(undefined);
          return recovered;
        }
        if (recovered.lifecycle === 'awaiting_signature') {
          if (submitError instanceof ApiError && submitError.code === 430296) {
            if (queueRetries < 1) {
              queueRetries += 1;
              timing?.mark('submit.queue-retry');
              continue;
            }
            throw new UncertainTradeError('The dispatch queue remains full. Keep this trade ID and resume the same order later.');
          }
          if (reprepareRetries < 1) {
            reprepareRetries += 1;
            if (submitError instanceof ApiError && [420203, 430267].includes(submitError.code)) {
              await abortableDelay(300, controller.signal);
            }
            timing?.mark('submit.reprepare', `code=${submitError instanceof ApiError ? submitError.code : 'unknown'}`);
            const next = await prepareAndSign(bearer, current.trade_id, intent, controller, timing);
            payload = {
              tradeID: current.trade_id,
              signature: next.signature,
              expiresAt: next.prepared.expires_at,
              prepareID: next.prepared.prepare_id,
              fingerprint: payload.fingerprint,
            };
            setPendingSubmission(payload);
            continue;
          }
        }
        throw new UncertainTradeError(
          `Submit did not return cleanly and the original trade is ${recovered.lifecycle ?? 'unknown'}.`,
        );
      }
    }
  }

  async function enrichTradeOutput(bearer: string, current: TradeReply, signal: AbortSignal): Promise<TradeReply> {
    if (outputAmount(current)) return current;
    let latest = current;
    for (let attempt = 0; attempt < 2 && !outputAmount(latest); attempt += 1) {
      await abortableDelay(1_500, signal);
      try {
        const fresh = await getTrade(bearer, latest.trade_id, signal);
        if (fresh.trade_id === latest.trade_id) latest = fresh;
      } catch {
        // Missing settlement enrichment never changes a successful trade result.
      }
    }
    return latest;
  }

  function startFinalityRecheck(bearer: string, initial: TradeReply) {
    if (initial.lifecycle === 'confirmed') return;
    finalityAbortRef.current?.abort();
    const controller = new AbortController();
    finalityAbortRef.current = controller;
    const startedAt = Date.now();
    void (async () => {
      while (!controller.signal.aborted && Date.now() - startedAt < 120_000) {
        await abortableDelay(300, controller.signal);
        let latest: TradeReply;
        try {
          latest = await getTrade(bearer, initial.trade_id, controller.signal);
        } catch {
          continue;
        }
        if (
          sessionJWTRef.current !== bearer ||
          operationTokenContextRef.current !== currentTokenContextRef.current ||
          latest.trade_id !== initial.trade_id
        ) return;
        setTrade(latest);
        if (latest.lifecycle === 'failed') {
          setStage('failed');
          if (clearCurrentTradeRecovery()) {
            submitAttemptedRef.current = false;
            setErrorMessage('The optimistic trade result was reversed to failed during finality verification.');
          }
          return;
        }
        if (latest.lifecycle === 'confirmed') {
          setStage('confirmed');
          if (clearCurrentTradeRecovery()) {
            submitAttemptedRef.current = false;
            setErrorMessage(undefined);
          }
          return;
        }
      }
    })().catch(() => undefined);
  }

  async function executeTrade() {
    if (!session?.jwt || !actorID || !intentResult.intent || operationLockRef.current || hasUnresolvedSubmission) return;
    try {
      const stored = readTradeRecovery(actorID, chain, address);
      if (stored) {
        const storedIntent = parseIntentFingerprint(stored.fingerprint);
        if (!storedIntent || storedIntent.chain !== chain || intentFingerprint(storedIntent) !== stored.fingerprint) {
          throw new Error('invalid stored intent');
        }
        submitAttemptedRef.current = true;
        tradeSessionJWTRef.current = session.jwt;
        operationTokenContextRef.current = currentTokenContextRef.current;
        tradeFingerprintRef.current = stored.fingerprint;
        tradeRecoveryContextRef.current = {actorID, chain, token: address, fingerprint: stored.fingerprint};
        setTrade({trade_id: stored.tradeID, side: stored.side, token: stored.token});
        setRecoveryIntent(storedIntent);
        setStage('uncertain');
        setErrorMessage('An existing trade must be recovered before another order can be created.');
        return;
      }
    } catch {
      setRecoveryBlocked(true);
      setStage('uncertain');
      setErrorMessage('Trade recovery storage is unavailable or needs reconciliation. New orders remain blocked.');
      return;
    }
    operationLockRef.current = true;
    submitAttemptedRef.current = false;
    const bearer = session.jwt;
    tradeSessionJWTRef.current = bearer;
    operationTokenContextRef.current = currentTokenContextRef.current;
    operationSignerContextRef.current = signerContextRef.current;
    const controller = new AbortController();
    operationAbortRef.current?.abort();
    finalityAbortRef.current?.abort();
    operationAbortRef.current = controller;
    setReviewOpen(false);
    setErrorMessage(undefined);
    setTrade(undefined);
    setTradeOutputFormat({
      decimals: intentResult.intent.side === 'buy' ? activeTokenInfo?.decimals : 6,
      unit: intentResult.intent.side === 'buy' ? (symbol ?? activeTokenInfo?.symbol ?? 'tokens') : 'USDC',
    });
    setPendingSubmission(undefined);
    setPosition(undefined);
    const intent = intentResult.intent;
    setRecoveryIntent(intent);
    const fingerprint = intentFingerprint(intent);
    const timing = createTradeStopwatch(`execute chain=${intent.chain} side=${intent.side}`);
    tradeFingerprintRef.current = fingerprint;
    try {
      setStage('creating');
      // The baseline is independent from Create. Start it early without placing it
      // on the signing critical path.
      const baselinePromise = getPortfolio(bearer, controller.signal)
        .then((portfolio) => portfolio.positions)
        .catch(() => undefined);
      let current = await createTrade(bearer, intent, controller.signal);
      assertCurrentOperation(bearer, controller);
      timing.mark('create.done', `duplicate=${current.duplicate === true}`);
      setTrade(current);
      const initialPhase = phaseOf(current);
      const alreadySubmitted = ['signed', 'submitted', 'included', 'confirmed', 'failed'].includes(current.lifecycle ?? '') ||
        initialPhase === TRADE_PHASE_SUCCESS || initialPhase === TRADE_PHASE_FAILED;
      if (alreadySubmitted) {
        submitAttemptedRef.current = true;
        persistTradeRecoveryMarker(current, fingerprint, true);
      } else {
        const signed = await prepareAndSign(bearer, current.trade_id, intent, controller, timing);
        const payload: PendingSubmission = {
          tradeID: current.trade_id,
          signature: signed.signature,
          expiresAt: signed.prepared.expires_at,
          prepareID: signed.prepared.prepare_id,
          fingerprint,
        };
        current = await submitWithRecovery(bearer, current, payload, intent, controller, timing);
      }
      setTrade(current);
      setStage('polling');
      const currentPhase = phaseOf(current);
      const result = (currentPhase === TRADE_PHASE_SUCCESS || currentPhase === TRADE_PHASE_FAILED) && !current.deadline_at
        ? {trade: current, stop: 'settled' as const, rounds: 0}
        : await pollTrade(bearer, current.trade_id, {
          signal: controller.signal,
          onTick: (latest, round) => {
            setTrade(latest);
            timing.mark('poll.tick', `round=${round} lifecycle=${latest.lifecycle ?? '-'}`);
          },
        });
      timing.mark('poll.stop', `stop=${result.stop} rounds=${result.rounds}`);
      setTrade(result.trade);
      if (result.stop !== 'settled') {
        setStage('uncertain');
        setErrorMessage('The trade has no final answer yet. Do not place it again; check this trade ID later.');
        return;
      }
      const phase = phaseOf(result.trade);
      if (phase === TRADE_PHASE_FAILED) {
        setStage('failed');
        if (clearCurrentTradeRecovery()) {
          submitAttemptedRef.current = false;
          setErrorMessage('The trade reached a failed terminal state. Review its transaction hash before retrying.');
        }
        return;
      }
      if (phase === TRADE_PHASE_SUCCESS) {
        const baseline = await baselinePromise;
        assertCurrentOperation(bearer, controller);
        const enriched = await enrichTradeOutput(bearer, result.trade, controller.signal);
        assertCurrentOperation(bearer, controller);
        setTrade(enriched);
        if (enriched.lifecycle === 'failed' || phaseOf(enriched) === TRADE_PHASE_FAILED) {
          setStage('failed');
          if (clearCurrentTradeRecovery()) {
            submitAttemptedRef.current = false;
            setErrorMessage('The trade changed to failed while its settlement was being refreshed.');
          }
          return;
        }
        setStage(enriched.lifecycle === 'confirmed' ? 'confirmed' : 'included');
        if (enriched.lifecycle === 'confirmed' && clearCurrentTradeRecovery()) submitAttemptedRef.current = false;
        if (enabledChain) void refreshPosition(bearer, baseline, enabledChain, controller.signal);
        startFinalityRecheck(bearer, enriched);
      }
    } catch (error) {
      if (submitAttemptedRef.current || error instanceof UncertainTradeError) {
        setStage('uncertain');
        setErrorMessage(`${error instanceof Error ? error.message : 'Trade status is unknown.'} Do not place this order again.`);
      } else {
        if (error instanceof ApiError && error.code === 400000 && sessionJWTRef.current === bearer) clearSite();
        setStage('failed');
        setErrorMessage(
          controller.signal.aborted
            ? 'The operation stopped before Submit. No funds were moved.'
            : safeMessage(error),
        );
      }
    } finally {
      if (operationAbortRef.current === controller) operationLockRef.current = false;
    }
  }

  executeTradeRef.current = executeTrade;

  async function resumeRecoveredTrade() {
    if (
      !trade || trade.lifecycle !== 'awaiting_signature' || !recoveryIntent || !session?.jwt || !actorID ||
      !signerContextRef.current || operationLockRef.current ||
      operationTokenContextRef.current !== currentTokenContextRef.current
    ) return;
    const fingerprint = intentFingerprint(recoveryIntent);
    try {
      const stored = readTradeRecovery(actorID, chain, address);
      if (!stored || stored.tradeID !== trade.trade_id || stored.fingerprint !== fingerprint) {
        throw new Error('The durable recovery marker does not match this trade.');
      }
    } catch (error) {
      setRecoveryBlocked(true);
      setStage('uncertain');
      setErrorMessage(error instanceof Error ? error.message : 'The original trade cannot be resumed safely.');
      return;
    }

    operationLockRef.current = true;
    const bearer = session.jwt;
    tradeSessionJWTRef.current = bearer;
    operationTokenContextRef.current = currentTokenContextRef.current;
    operationSignerContextRef.current = signerContextRef.current;
    const controller = new AbortController();
    operationAbortRef.current?.abort();
    finalityAbortRef.current?.abort();
    operationAbortRef.current = controller;
    setErrorMessage(undefined);
    setPendingSubmission(undefined);
    const timing = createTradeStopwatch(`resume chain=${recoveryIntent.chain} side=${recoveryIntent.side}`);
    try {
      const signed = await prepareAndSign(bearer, trade.trade_id, recoveryIntent, controller, timing);
      const payload: PendingSubmission = {
        tradeID: trade.trade_id,
        signature: signed.signature,
        expiresAt: signed.prepared.expires_at,
        prepareID: signed.prepared.prepare_id,
        fingerprint,
      };
      let current = await submitWithRecovery(bearer, signed.prepared.trade, payload, recoveryIntent, controller, timing);
      setTrade(current);
      setStage('polling');
      const currentPhase = phaseOf(current);
      const result = (currentPhase === TRADE_PHASE_SUCCESS || currentPhase === TRADE_PHASE_FAILED) && !current.deadline_at
        ? {trade: current, stop: 'settled' as const, rounds: 0}
        : await pollTrade(bearer, current.trade_id, {
          signal: controller.signal,
          onTick: (latest, round) => {
            setTrade(latest);
            timing.mark('poll.tick', `round=${round} lifecycle=${latest.lifecycle ?? '-'}`);
          },
        });
      current = result.trade;
      setTrade(current);
      timing.mark('poll.stop', `stop=${result.stop} rounds=${result.rounds}`);
      if (result.stop !== 'settled') {
        setStage('uncertain');
        setErrorMessage('The original trade is still pending. Keep this trade ID and check it again.');
        return;
      }
      if (phaseOf(current) === TRADE_PHASE_FAILED) {
        setStage('failed');
        if (clearCurrentTradeRecovery()) {
          submitAttemptedRef.current = false;
          setErrorMessage('The original trade reached a failed terminal state.');
        }
        return;
      }
      const enriched = await enrichTradeOutput(bearer, current, controller.signal);
      assertCurrentOperation(bearer, controller);
      setTrade(enriched);
      if (enriched.lifecycle === 'failed' || phaseOf(enriched) === TRADE_PHASE_FAILED) {
        setStage('failed');
        if (clearCurrentTradeRecovery()) {
          submitAttemptedRef.current = false;
          setErrorMessage('The original trade changed to failed while its settlement was being refreshed.');
        }
        return;
      }
      setStage(enriched.lifecycle === 'confirmed' ? 'confirmed' : 'included');
      if (enriched.lifecycle === 'confirmed' && clearCurrentTradeRecovery()) submitAttemptedRef.current = false;
      if (enabledChain) void refreshPosition(bearer, undefined, enabledChain, controller.signal);
      startFinalityRecheck(bearer, enriched);
    } catch (error) {
      setStage('uncertain');
      setErrorMessage(`${safeMessage(error)} The original trade remains recoverable; do not create another order.`);
    } finally {
      if (operationAbortRef.current === controller) operationLockRef.current = false;
    }
  }

  async function openReview() {
    if (!intentResult.intent || !session?.jwt || reviewLockRef.current || hasUnresolvedSubmission) return;
    reviewLockRef.current = true;
    const bearer = session.jwt;
    setReviewing(true);
    setErrorMessage(undefined);
    try {
      await loadPreview(intentResult.intent);
      if (sessionJWTRef.current !== bearer) return;
      setReviewOpen(true);
    } catch (error) {
      if (sessionJWTRef.current === bearer && !(error instanceof ApiError && [430286, 430295, 100286, 100295].includes(error.code))) {
        // Preview outages do not gate trading; the confirmation explicitly shows it as unavailable.
        setReviewOpen(true);
      }
    } finally {
      reviewLockRef.current = false;
      setReviewing(false);
    }
  }

  async function checkStatus() {
    if (
      !trade?.trade_id || !session?.jwt ||
      session.jwt !== tradeSessionJWTRef.current ||
      operationTokenContextRef.current !== currentTokenContextRef.current ||
      statusLockRef.current || operationLockRef.current
    ) return;
    statusLockRef.current = true;
    operationLockRef.current = true;
    const bearer = session.jwt;
    operationTokenContextRef.current = currentTokenContextRef.current;
    const controller = new AbortController();
    operationAbortRef.current?.abort();
    finalityAbortRef.current?.abort();
    operationAbortRef.current = controller;
    setStage('polling');
    setErrorMessage(undefined);
    try {
      const result = await pollTrade(bearer, trade.trade_id, {signal: controller.signal, onTick: setTrade, budgetMs: 45_000});
      assertCurrentOperation(bearer, controller, false);
      setTrade(result.trade);
      if (result.stop !== 'settled') {
        setStage('uncertain');
        setErrorMessage('Still pending. Do not place another order.');
      } else if (phaseOf(result.trade) === TRADE_PHASE_FAILED) {
        setStage('failed');
        if (clearCurrentTradeRecovery()) {
          submitAttemptedRef.current = false;
          setErrorMessage('The trade reached a failed terminal state.');
        }
      } else {
        const enriched = await enrichTradeOutput(bearer, result.trade, controller.signal);
        setTrade(enriched);
        if (enriched.lifecycle === 'failed' || phaseOf(enriched) === TRADE_PHASE_FAILED) {
          setStage('failed');
          if (clearCurrentTradeRecovery()) {
            submitAttemptedRef.current = false;
            setErrorMessage('The trade changed to failed while its settlement was being refreshed.');
          }
          return;
        }
        setStage(enriched.lifecycle === 'confirmed' ? 'confirmed' : 'included');
        if (enriched.lifecycle === 'confirmed' && clearCurrentTradeRecovery()) submitAttemptedRef.current = false;
        if (enabledChain) void refreshPosition(bearer, undefined, enabledChain, controller.signal);
        startFinalityRecheck(bearer, enriched);
      }
    } catch (error) {
      setStage('uncertain');
      setErrorMessage(`${safeMessage(error)} Do not place another order.`);
    } finally {
      statusLockRef.current = false;
      if (operationAbortRef.current === controller) operationLockRef.current = false;
    }
  }

  const unresolved = stage === 'uncertain' || stage === 'included';
  const sameTradeSession = !!session?.jwt && session.jwt === tradeSessionJWTRef.current;
  const sameTradeContext = operationTokenContextRef.current === currentTokenContextRef.current;
  const unresolvedForeignContext = hasUnresolvedSubmission && !sameTradeContext;
  const unresolvedForeignSession = hasUnresolvedSubmission && !sameTradeSession;
  const canReview = !!session?.jwt && !!actorID && privyReady && authenticated && !!enabledChain && walletsReady && !!intentResult.intent && !previewBlocked && !busy && !unresolved && !hasUnresolvedSubmission;
  const inputUnit = side === 'buy' ? 'USDC' : (symbol ?? activeTokenInfo?.symbol ?? 'token');
  const outputDecimals = side === 'buy' ? activeTokenInfo?.decimals : 6;

  function disarmAutoExecute() {
    autoExecuteArmedRef.current = false;
    autoExecutionFingerprintRef.current = undefined;
    autoExecutionSessionRef.current = undefined;
    autoExecutionContextRef.current = undefined;
    setAutoExecute(false);
  }

  function invalidateIntentInput() {
    previewGenerationRef.current += 1;
    previewFingerprintRef.current = '';
    setPreview(undefined);
    setPreviewMessage(undefined);
    setPreviewBlocked(false);
    setReviewOpen(false);
    disarmAutoExecute();
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Trade</h2>
          <p className="text-xs text-muted">Embedded-wallet execution · {chain}</p>
        </div>
        <StagePill stage={stage} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <div className="space-y-3">
          <div className="grid grid-cols-2 rounded-lg bg-surface-2 p-1">
            {(['buy', 'sell'] as const).map((value) => (
              <button key={value} type="button" disabled={busy} onClick={() => {if (side !== value) invalidateIntentInput(); setSide(value);}}
                className={`rounded-md px-3 py-2 text-sm font-medium capitalize ${side === value ? 'bg-surface text-foreground shadow' : 'text-muted'}`}>
                {value}
              </button>
            ))}
          </div>
          <label className="block text-xs text-muted">
            Amount ({inputUnit})
            <input value={amount} onChange={(event) => {invalidateIntentInput(); setAmount(event.target.value);}} disabled={busy}
              inputMode="decimal" placeholder="0.0"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground outline-none focus:border-accent" />
          </label>
          <label className="block text-xs text-muted">
            Slippage (bps)
            <input value={slippage} onChange={(event) => {invalidateIntentInput(); setSlippage(event.target.value);}} disabled={busy}
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent" />
            <span className="mt-1 block">300 = 3%. Valid range: 1–10,000 bps.</span>
          </label>

          {!session ? <p className="text-xs text-muted"><Link href="/login" className="text-accent hover:underline">Sign in</Link> to trade.</p> : null}
          {session && !authenticated ? <p className="text-xs text-muted">Restore the Privy session before signing.</p> : null}
          {session && chains === undefined ? <p className="text-xs text-muted">Loading enabled chains…</p> : null}
          {session && chainsMessage ? <p className="text-xs text-down">{chainsMessage}</p> : null}
          {session && chains && !chainsMessage && !enabledChain ? <p className="text-xs text-down">Trading is not enabled for {chain} in this environment.</p> : null}
          {session && !walletsReady ? <p className="text-xs text-muted">Create the required embedded wallet on the <Link href="/login" className="text-accent hover:underline">Login</Link> page.</p> : null}
          {requiresSolanaWallet && !SOLANA_RPC_URL ? <p className="text-xs text-down">Configure NEXT_PUBLIC_SOLANA_RPC_URL before Solana-funded trades.</p> : null}
          {unresolvedForeignContext ? <p className="text-xs text-accent">A previous trade is unresolved. Return to its token page to check the same trade ID before placing another order.</p> : null}
          {unresolvedForeignSession ? <p className="text-xs text-accent">An unresolved trade belongs to the previous session. Switch back to that session to recover it.</p> : null}
          {intentResult.error && amount ? <p className="text-xs text-down">{intentResult.error}</p> : null}

          <button type="button" onClick={() => void openReview()} disabled={!canReview || reviewing || (requiresSolanaWallet && !SOLANA_RPC_URL)}
            className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
            {reviewing ? 'Refreshing preview…' : `Review ${side}`}
          </button>
          <label className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={autoExecute}
              disabled={!canReview || reviewing || busy || hasUnresolvedSubmission || (requiresSolanaWallet && !SOLANA_RPC_URL)}
              onChange={(event) => {
                const checked = event.target.checked;
                autoExecuteArmedRef.current = checked;
                autoExecutionFingerprintRef.current = undefined;
                autoExecutionSessionRef.current = checked ? sessionJWTRef.current : undefined;
                autoExecutionContextRef.current = checked ? currentTokenContextRef.current : undefined;
                setAutoExecute(checked);
              }}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              <span className="font-medium text-foreground">Auto execute after quote</span>
              <span className="mt-0.5 block">Once enabled, this exact token/side/amount/slippage intent signs, submits, and tracks automatically. The wallet may still require its own security approval.</span>
            </span>
          </label>
        </div>

        <div className="rounded-lg border border-border bg-background p-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Preview</p>
          {preview ? (
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-3"><dt className="text-muted">Route</dt><dd>{preview.route ?? '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Input value</dt><dd>{preview.amount_in_usd ? `$${preview.amount_in_usd}` : '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Estimated output</dt><dd>{preview.amount_out && outputDecimals !== undefined ? formatUnits(preview.amount_out, outputDecimals) : 'Unavailable on this route'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Output value</dt><dd>{preview.amount_out_usd ? `$${preview.amount_out_usd}` : '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Total loss / impact</dt><dd>{preview.total_cost_bps !== undefined ? `${(preview.total_cost_bps / 100).toFixed(2)}%` : '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">App fee</dt><dd>{preview.app_fee_usd ? `$${preview.app_fee_usd}` : preview.app_fee_bps ? `${preview.app_fee_bps} bps` : '—'}</dd></div>
            </dl>
          ) : <p className="mt-3 text-xs text-muted">Enter an amount to request a non-binding estimate.</p>}
          {previewMessage ? <p className={`mt-3 text-xs ${previewBlocked ? 'text-down' : 'text-muted'}`}>{previewMessage}</p> : null}
        </div>
      </div>

      {reviewOpen && intentResult.intent ? (
        <div className="mt-4 rounded-lg border border-accent/40 bg-accent/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><AlertTriangle className="h-4 w-4 text-accent" />Confirm trade</div>
          <p className="mt-2 text-sm text-muted">
            {side === 'buy' ? 'Spend' : 'Sell'} {amount} {inputUnit} for {symbol ?? activeTokenInfo?.symbol ?? address} on {chain}, with {intentResult.intent.slippageBps} bps slippage.
          </p>
          {!preview ? <p className="mt-2 text-xs text-muted">The preview is unavailable. The actual executable quote is created during Prepare.</p> : null}
          <p className="mt-2 text-xs text-muted">After Submit, do not place the order again while its final status is unknown.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setReviewOpen(false)} className="rounded-md border border-border px-3 py-2 text-sm text-muted">Cancel</button>
            {!autoExecute ? (
              <button type="button" disabled={busy || hasUnresolvedSubmission} onClick={() => void executeTrade()} className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Confirm & sign</button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 px-3 py-2 text-sm text-accent">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Auto execution armed
              </span>
            )}
          </div>
        </div>
      ) : null}

      {trade && sameTradeContext && sameTradeSession ? (
        <div className="mt-4 rounded-lg border border-border bg-background p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-foreground">Trade {trade.trade_id}</span>
            <span className="text-muted">{trade.lifecycle ?? String(trade.status ?? 'unknown')}</span>
          </div>
          {trade.tx_hash ? <p className="mt-2 break-all text-muted">Tx: {trade.tx_hash}</p> : null}
          {outputAmount(trade) ? (
            <p className="mt-1 text-muted">
              Output: {tradeOutputFormat?.decimals !== undefined ? formatUnits(outputAmount(trade)!, tradeOutputFormat.decimals) : `${outputAmount(trade)} smallest units`} {tradeOutputFormat?.unit ?? ''}
              {trade.amount_out ? '' : trade.amount_out_observed ? ' (observed, pending settlement)' : ' (quoted)'}
            </p>
          ) : null}
          {trade.sellable_after_graduation ? <p className="mt-2 text-accent">This purchase cannot be sold until the token graduates.</p> : null}
          {(stage === 'uncertain' || stage === 'included') && sameTradeSession && sameTradeContext ? (
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" onClick={() => void checkStatus()} className="inline-flex items-center gap-1.5 text-accent hover:underline">
                <RefreshCw className="h-3.5 w-3.5" /> Check status again
              </button>
              {trade.lifecycle === 'awaiting_signature' && recoveryIntent && privyReady && authenticated && walletsReady ? (
                <button type="button" onClick={() => void resumeRecoveredTrade()} className="text-accent hover:underline">
                  Resume this same order
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {position && sameTradeContext && sameTradeSession ? (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted">
          <CheckCircle2 className="h-4 w-4 text-up" />
          Position: {position.decimals !== undefined ? formatUnits(position.shares_raw, position.decimals) : position.shares_raw} {symbol ?? activeTokenInfo?.symbol ?? 'tokens'}
          {positionRefreshing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
        </div>
      ) : null}
      {errorMessage ? <p className={`mt-3 text-sm ${stage === 'uncertain' ? 'text-accent' : 'text-down'}`}>{errorMessage}</p> : null}
    </section>
  );
}
