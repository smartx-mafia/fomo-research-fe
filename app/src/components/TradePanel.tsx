'use client';

import {useWallets as useEvmWallets, usePrivy} from '@privy-io/react-auth';
import {useSignTransaction, useWallets as useSolanaWallets} from '@privy-io/react-auth/solana';
import {AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw} from 'lucide-react';
import Link from 'next/link';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {ApiError} from '@/api/envelope';
import {
  CODE_DELEGATION_REQUIRED,
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
  listPositions,
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
  type Position,
  type PrepareTradeReply,
  type TokenInfo,
  type TradeIntent,
  type TradePreview,
  type TradeReply,
  type TradeSide,
} from '@/api/trade';
import {SOLANA_RPC_URL} from '@/config';
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

function safeMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 400000) return 'Your session expired. Sign in again before trading.';
    if (error.code === 430114) return 'Complete invitation access before trading.';
    if (error.code === 100286) return 'This launchpad token cannot be traded until it graduates.';
    if (error.code === 100295) return 'No counterparty can fill this trade right now.';
    if (error.code === 100283) return 'This wallet needs one-time delegation before the trade can continue.';
    if (error.code === 100282 || error.code === 430282) return 'The prepared transaction expired. Prepare and sign it again.';
    if (error.code === 430267) return 'This wallet already has another on-chain action in progress.';
    if (error.code === 430296) return 'The dispatch queue is full. Try submitting again shortly.';
    if (error.code === 420000) return 'Trade requests are rate limited. Wait a moment and retry.';
    if (error.code === 500097) return 'The trade service is temporarily unavailable.';
    return `Trade request failed (code ${error.code}, trace ${error.traceID ?? 'unavailable'}).`;
  }
  return error instanceof Error ? error.message : 'Trade failed unexpectedly.';
}

function sameAsset(candidate: Position, chainInfo: MemeChain, token: string) {
  if (candidate.asset_chain_id !== chainInfo.chain_id) return false;
  return chainInfo.kind === 'evm'
    ? candidate.asset.toLowerCase() === token.toLowerCase()
    : candidate.asset === token;
}

function targetPositionMark(positions: Position[], chainInfo: MemeChain, token: string) {
  const position = positions.find((candidate) => sameAsset(candidate, chainInfo, token));
  return position ? `${position.shares}@${position.updated_at}` : 'missing';
}

function tokenInfoMatches(info: TokenInfo | undefined, chain: string, token: string) {
  if (!info || info.chain !== chain) return false;
  return /^0x[0-9a-f]{40}$/i.test(token)
    ? info.address.toLowerCase() === token.toLowerCase()
    : info.address === token;
}

function intentFingerprint(intent: TradeIntent) {
  return `${intent.chain}\u0000${intent.side}\u0000${intent.token}\u0000${intent.amountIn}\u0000${intent.slippageBps}`;
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
  const {ready: privyReady, authenticated} = usePrivy();
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [stage, setStage] = useState<TradeStage>('idle');
  const [trade, setTrade] = useState<TradeReply>();
  const [tradeOutputFormat, setTradeOutputFormat] = useState<{decimals?: number; unit: string}>();
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission>();
  const [position, setPosition] = useState<Position>();
  const [positionRefreshing, setPositionRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const operationAbortRef = useRef<AbortController | null>(null);
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

  sessionJWTRef.current = session?.jwt;
  currentTokenContextRef.current = `${chain}\u0000${address}`;

  const busy = !['idle', 'included', 'confirmed', 'failed', 'uncertain'].includes(stage);
  const hasUnresolvedSubmission = submitAttemptedRef.current &&
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
      if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
        return {error: 'Slippage must be an integer from 0 to 10,000 bps.'} as const;
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
    previewGenerationRef.current += 1;
    previewFingerprintRef.current = '';
    setPreview(undefined);
    setPreviewMessage(undefined);
    setPreviewBlocked(false);
    setReviewOpen(false);
    operationAbortRef.current?.abort();
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
        setErrorMessage('The token page changed before Submit. No funds were moved.');
        tradeSessionJWTRef.current = undefined;
        operationTokenContextRef.current = undefined;
      }
    } else if (!hasUnresolvedSubmission) {
      setStage('idle');
      setTrade(undefined);
      setTradeOutputFormat(undefined);
      setPendingSubmission(undefined);
      setPosition(undefined);
      setErrorMessage(undefined);
      submitAttemptedRef.current = false;
      tradeSessionJWTRef.current = undefined;
      operationTokenContextRef.current = undefined;
    }
  }, [address, chain, hasUnresolvedSubmission]);

  const loadPreview = useCallback(async (intent: TradeIntent, signal?: AbortSignal) => {
    const bearer = session?.jwt;
    if (!bearer) throw new Error('Sign in before requesting a trade preview.');
    const generation = ++previewGenerationRef.current;
    const fingerprint = intentFingerprint(intent);
    previewFingerprintRef.current = fingerprint;
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
      return result;
    } catch (error) {
      if (
        sessionJWTRef.current !== bearer ||
        previewGenerationRef.current !== generation ||
        previewFingerprintRef.current !== fingerprint
      ) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      const blocked = error instanceof ApiError && (error.code === 100286 || error.code === 100295);
      if (error instanceof ApiError && error.code === 400000 && sessionJWTRef.current === bearer) clearSite();
      setPreview(undefined);
      setPreviewBlocked(blocked);
      setPreviewMessage(safeMessage(error));
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
    let interval: ReturnType<typeof setInterval> | undefined;
    const timer = setTimeout(() => {
      void loadPreview(intentResult.intent, controller.signal).catch(() => undefined);
      interval = setInterval(() => {
        void loadPreview(intentResult.intent, controller.signal).catch(() => undefined);
      }, 15_000);
    }, 500);
    return () => {
      previewGenerationRef.current += 1;
      clearTimeout(timer);
      if (interval) clearInterval(interval);
      controller.abort();
    };
  }, [busy, enabledChain, intentResult.intent, loadPreview, session?.jwt]);

  useEffect(() => () => operationAbortRef.current?.abort(), []);

  useEffect(() => {
    const current = session?.jwt ?? null;
    if (previousSessionJWTRef.current === undefined) {
      previousSessionJWTRef.current = current;
      return;
    }
    if (previousSessionJWTRef.current === current) return;
    previousSessionJWTRef.current = current;
    operationAbortRef.current?.abort();
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
        setErrorMessage('The session changed before Submit. This order did not move funds.');
        tradeSessionJWTRef.current = undefined;
        operationTokenContextRef.current = undefined;
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
      setErrorMessage(undefined);
      submitAttemptedRef.current = false;
      tradeSessionJWTRef.current = undefined;
      operationTokenContextRef.current = undefined;
    }
  }, [hasUnresolvedSubmission, session?.jwt]);

  async function signPrepared(prepared: PrepareTradeReply): Promise<string> {
    const signatures = await import('@/lib/trade-signature');
    if (prepared.sign_kind === SIGN_KIND_SOLANA_TRANSACTION) {
      if (!SOLANA_RPC_URL) throw new Error('NEXT_PUBLIC_SOLANA_RPC_URL is required for Solana signing.');
      const wallet = pickWallet(solanaWallets, prepared.wallet_address, false);
      const result = await withTimeout(
        signTransaction({transaction: signatures.fromBase64(prepared.sign_data), wallet}),
        'Solana wallet signature',
      );
      return signatures.toBase64(signatures.extractSolanaSignature(result.signedTransaction, prepared.wallet_address));
    }
    const wallet = pickWallet(evmWallets, prepared.wallet_address, true);
    if (
      prepared.sign_kind === SIGN_KIND_EVM_USER_OPERATION ||
      prepared.sign_kind === SIGN_KIND_EVM_7702_AUTHORIZATION ||
      prepared.sign_kind === SIGN_KIND_EVM_PERMIT_DIGEST
    ) {
      return signatures.toBase64(await withTimeout(
        signatures.signEvmDigest(wallet, signatures.fromBase64(prepared.sign_data)),
        'EVM wallet signature',
      ));
    }
    if (prepared.sign_kind === SIGN_KIND_EVM_CALIBUR_BATCH) {
      const calibur = await import('@/lib/trade-calibur');
      const envelope = calibur.parseCaliburSignData(signatures.fromBase64(prepared.sign_data));
      const batchDigest = calibur.digestFromBase64(envelope.batch_digest, 'Calibur batch digest');
      const batchSignature = await withTimeout(signatures.signEvmDigest(wallet, batchDigest), 'Calibur batch signature');
      await calibur.assertRecoveredSigner(batchDigest, batchSignature, prepared.wallet_address);
      let authorizationSignature: Uint8Array | undefined;
      if (envelope.authorization) {
        calibur.checkAuthorizationDigest(envelope.authorization);
        const digest = calibur.digestFromBase64(envelope.authorization.digest, 'Authorization digest');
        authorizationSignature = await withTimeout(signatures.signEvmDigest(wallet, digest), 'Calibur authorization signature');
        await calibur.assertRecoveredSigner(digest, authorizationSignature, prepared.wallet_address);
      }
      return calibur.encodeCaliburSignatures(batchSignature, authorizationSignature);
    }
    throw new Error(`Unsupported sign_kind=${prepared.sign_kind}.`);
  }

  function assertCurrentOperation(bearer: string, controller: AbortController) {
    if (
      controller.signal.aborted ||
      sessionJWTRef.current !== bearer ||
      operationTokenContextRef.current !== currentTokenContextRef.current
    ) {
      controller.abort();
      throw new DOMException('The trading session changed.', 'AbortError');
    }
  }

  async function runDelegation(bearer: string, controller: AbortController) {
    setStage('delegating');
    let prepared;
    try {
      prepared = await prepareDelegation(bearer, chain, controller.signal);
      assertCurrentOperation(bearer, controller);
    } catch (error) {
      // On this endpoint 100283 means delegation is already installed.
      if (error instanceof ApiError && error.code === CODE_DELEGATION_REQUIRED) return;
      throw error;
    }
    if (prepared.sign_kind !== SIGN_KIND_EVM_7702_AUTHORIZATION) {
      throw new Error(`Delegation returned unexpected sign_kind=${prepared.sign_kind}.`);
    }
    const signature = await signPrepared({...prepared, trade: {trade_id: '', side, token: address}});
    assertCurrentOperation(bearer, controller);
    await submitDelegation(bearer, chain, prepared.nonce ?? 0, signature, controller.signal);
    assertCurrentOperation(bearer, controller);
  }

  async function prepareAndSign(
    bearer: string,
    tradeID: string,
    controller: AbortController,
  ): Promise<{prepared: PrepareTradeReply; signature: string}> {
    let delegationAttempted = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assertCurrentOperation(bearer, controller);
      setStage('preparing');
      let prepared: PrepareTradeReply;
      try {
        prepared = await prepareTrade(bearer, tradeID, controller.signal);
        assertCurrentOperation(bearer, controller);
      } catch (error) {
        if (error instanceof ApiError && error.code === CODE_DELEGATION_REQUIRED && !delegationAttempted) {
          delegationAttempted = true;
          await runDelegation(bearer, controller);
          continue;
        }
        throw error;
      }
      setStage('signing');
      const signature = await signPrepared(prepared);
      assertCurrentOperation(bearer, controller);
      const expiresAt = prepared.expires_at ? Date.parse(prepared.expires_at) : Number.NaN;
      if (!Number.isFinite(expiresAt) || expiresAt - Date.now() < 5_000) continue;
      return {prepared, signature};
    }
    throw new Error('Prepared transaction expired repeatedly before it could be submitted.');
  }

  async function refreshPosition(
    bearer: string,
    baseline: Position[] | undefined,
    chainInfo: MemeChain,
    signal: AbortSignal,
  ) {
    setPositionRefreshing(true);
    let baselineMark = baseline ? targetPositionMark(baseline, chainInfo, address) : undefined;
    try {
      // Gaps yield absolute checks at 0/3/8/15/25/40 seconds.
      for (const delay of [0, 3_000, 5_000, 7_000, 10_000, 15_000]) {
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        signal.throwIfAborted();
        const positions = await listPositions(bearer, signal);
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
    controller: AbortController,
  ): Promise<TradeReply> {
    let current = initial;
    let payload = initialPayload;
    let queueRetries = 0;
    let reprepareRetries = 0;
    setPendingSubmission(payload);

    for (;;) {
      assertCurrentOperation(bearer, controller);
      setStage('submitting');
      submitAttemptedRef.current = true;
      try {
        current = await submitTrade(bearer, current.trade_id, payload.signature, controller.signal);
        assertCurrentOperation(bearer, controller);
        setPendingSubmission(undefined);
        return current;
      } catch (submitError) {
        if (controller.signal.aborted || sessionJWTRef.current !== bearer) {
          throw new UncertainTradeError('The session changed after Submit was attempted.');
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

        if (['signed', 'submitted', 'included', 'confirmed', 'failed'].includes(recovered.lifecycle ?? '')) {
          setPendingSubmission(undefined);
          return recovered;
        }
        if (recovered.lifecycle !== 'awaiting_signature') {
          throw new UncertainTradeError(`Submit failed while lifecycle is ${recovered.lifecycle ?? 'unknown'}.`);
        }

        if (submitError instanceof ApiError && submitError.code === 430296) {
          if (queueRetries < 1) {
            queueRetries += 1;
            continue; // Retry the exact same trade + signature once.
          }
          throw new UncertainTradeError('Dispatch remains full. Keep this trade ID and retry the same Submit later.');
        }
        if (reprepareRetries >= 1) {
          throw new UncertainTradeError('Submit still needs a signature after one safe re-prepare attempt.');
        }
        reprepareRetries += 1;
        const next = await prepareAndSign(bearer, current.trade_id, controller);
        payload = {tradeID: current.trade_id, signature: next.signature, expiresAt: next.prepared.expires_at};
        setPendingSubmission(payload);
      }
    }
  }

  async function executeTrade() {
    if (!session?.jwt || !intentResult.intent || operationLockRef.current || hasUnresolvedSubmission) return;
    operationLockRef.current = true;
    submitAttemptedRef.current = false;
    const bearer = session.jwt;
    tradeSessionJWTRef.current = bearer;
    operationTokenContextRef.current = currentTokenContextRef.current;
    const controller = new AbortController();
    operationAbortRef.current?.abort();
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
    let baseline: Position[] | undefined;
    try {
      baseline = await listPositions(bearer, controller.signal).catch(() => undefined);
      assertCurrentOperation(bearer, controller);
      setStage('creating');
      let current = await createTrade(bearer, intentResult.intent, controller.signal);
      assertCurrentOperation(bearer, controller);
      setTrade(current);
      const signed = await prepareAndSign(bearer, current.trade_id, controller);
      const payload = {tradeID: current.trade_id, signature: signed.signature, expiresAt: signed.prepared.expires_at};
      current = await submitWithRecovery(bearer, current, payload, controller);
      setTrade(current);
      if (current.lifecycle === 'failed') {
        setStage('failed');
        setErrorMessage('The trade reached a failed terminal state. Review its transaction hash before retrying.');
        return;
      }
      setStage('polling');
      const result = await pollTrade(bearer, current.trade_id, {
        signal: controller.signal,
        onTick: setTrade,
      });
      setTrade(result.trade);
      if (result.stop !== 'settled') {
        setStage('uncertain');
        setErrorMessage('The trade has no final answer yet. Do not place it again; check this trade ID later.');
        return;
      }
      const phase = phaseOf(result.trade);
      if (phase === TRADE_PHASE_FAILED) {
        setStage('failed');
        setErrorMessage('The trade reached a failed terminal state. Review its transaction hash before retrying.');
        return;
      }
      if (phase === TRADE_PHASE_SUCCESS) {
        setStage(result.trade.lifecycle === 'confirmed' ? 'confirmed' : 'included');
        if (enabledChain) void refreshPosition(bearer, baseline, enabledChain, controller.signal);
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

  async function retryPendingSubmit() {
    if (
      !pendingSubmission || !trade || !session?.jwt ||
      session.jwt !== tradeSessionJWTRef.current ||
      operationTokenContextRef.current !== currentTokenContextRef.current ||
      operationLockRef.current
    ) return;
    operationLockRef.current = true;
    const bearer = session.jwt;
    operationTokenContextRef.current = currentTokenContextRef.current;
    const controller = new AbortController();
    operationAbortRef.current?.abort();
    operationAbortRef.current = controller;
    setErrorMessage(undefined);
    try {
      let current = await getTrade(bearer, trade.trade_id, controller.signal);
      assertCurrentOperation(bearer, controller);
      setTrade(current);
      if (['signed', 'submitted', 'included', 'confirmed', 'failed'].includes(current.lifecycle ?? '')) {
        setPendingSubmission(undefined);
      } else if (current.lifecycle === 'awaiting_signature') {
        let payload = pendingSubmission;
        const expiresAt = payload.expiresAt ? Date.parse(payload.expiresAt) : Number.NaN;
        if (!Number.isFinite(expiresAt) || expiresAt - Date.now() < 5_000) {
          const next = await prepareAndSign(bearer, current.trade_id, controller);
          payload = {tradeID: current.trade_id, signature: next.signature, expiresAt: next.prepared.expires_at};
          setPendingSubmission(payload);
        }
        current = await submitWithRecovery(bearer, current, payload, controller);
        setTrade(current);
      } else {
        throw new UncertainTradeError(`Trade lifecycle is ${current.lifecycle ?? 'unknown'}.`);
      }

      if (current.lifecycle === 'failed') {
        setStage('failed');
        setErrorMessage('The trade reached a failed terminal state.');
        return;
      }
      setStage('polling');
      const result = await pollTrade(bearer, current.trade_id, {signal: controller.signal, onTick: setTrade});
      assertCurrentOperation(bearer, controller);
      setTrade(result.trade);
      if (result.stop !== 'settled') {
        setStage('uncertain');
        setErrorMessage('The trade is still pending. Do not place it again.');
      } else if (phaseOf(result.trade) === TRADE_PHASE_FAILED) {
        setStage('failed');
      } else {
        setStage(result.trade.lifecycle === 'confirmed' ? 'confirmed' : 'included');
        if (enabledChain) void refreshPosition(bearer, undefined, enabledChain, controller.signal);
      }
    } catch (error) {
      setStage('uncertain');
      setErrorMessage(`${error instanceof Error ? error.message : 'Trade status is unknown.'} Do not place this order again.`);
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
      if (sessionJWTRef.current === bearer && !(error instanceof ApiError && (error.code === 100286 || error.code === 100295))) {
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
    operationAbortRef.current = controller;
    setStage('polling');
    setErrorMessage(undefined);
    try {
      const result = await pollTrade(bearer, trade.trade_id, {signal: controller.signal, onTick: setTrade, budgetMs: 45_000});
      assertCurrentOperation(bearer, controller);
      setTrade(result.trade);
      if (result.stop !== 'settled') {
        setStage('uncertain');
        setErrorMessage('Still pending. Do not place another order.');
      } else if (phaseOf(result.trade) === TRADE_PHASE_FAILED) {
        setStage('failed');
      } else {
        setStage(result.trade.lifecycle === 'confirmed' ? 'confirmed' : 'included');
        if (enabledChain) void refreshPosition(bearer, undefined, enabledChain, controller.signal);
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
  const canReview = !!session?.jwt && privyReady && authenticated && !!enabledChain && walletsReady && !!intentResult.intent && !previewBlocked && !busy && !unresolved && !hasUnresolvedSubmission;
  const inputUnit = side === 'buy' ? 'USDC' : (symbol ?? activeTokenInfo?.symbol ?? 'token');
  const outputDecimals = side === 'buy' ? activeTokenInfo?.decimals : 6;

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
              <button key={value} type="button" disabled={busy} onClick={() => {setSide(value); setReviewOpen(false);}}
                className={`rounded-md px-3 py-2 text-sm font-medium capitalize ${side === value ? 'bg-surface text-foreground shadow' : 'text-muted'}`}>
                {value}
              </button>
            ))}
          </div>
          <label className="block text-xs text-muted">
            Amount ({inputUnit})
            <input value={amount} onChange={(event) => {setAmount(event.target.value); setReviewOpen(false);}} disabled={busy}
              inputMode="decimal" placeholder="0.0"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-base text-foreground outline-none focus:border-accent" />
          </label>
          <label className="block text-xs text-muted">
            Slippage (bps)
            <input value={slippage} onChange={(event) => {setSlippage(event.target.value); setReviewOpen(false);}} disabled={busy}
              inputMode="numeric"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent" />
            <span className="mt-1 block">300 = 3%. Zero uses the server default; 10,000 accepts any price.</span>
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
            {side === 'buy' ? 'Spend' : 'Sell'} {amount} {inputUnit} for {symbol ?? activeTokenInfo?.symbol ?? address} on {chain}, with {intentResult.intent.slippageBps === 0 ? 'the server default 300 bps (3%)' : `${intentResult.intent.slippageBps} bps`} slippage.
          </p>
          {!preview ? <p className="mt-2 text-xs text-muted">The preview is unavailable. The actual executable quote is created during Prepare.</p> : null}
          <p className="mt-2 text-xs text-muted">After Submit, do not place the order again while its final status is unknown.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setReviewOpen(false)} className="rounded-md border border-border px-3 py-2 text-sm text-muted">Cancel</button>
            <button type="button" disabled={busy || hasUnresolvedSubmission} onClick={() => void executeTrade()} className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Confirm & sign</button>
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
          {trade.amount_out ? (
            <p className="mt-1 text-muted">
              Actual output: {tradeOutputFormat?.decimals !== undefined ? formatUnits(trade.amount_out, tradeOutputFormat.decimals) : `${trade.amount_out} smallest units`} {tradeOutputFormat?.unit ?? ''}
            </p>
          ) : null}
          {trade.sellable_after_graduation ? <p className="mt-2 text-accent">This purchase cannot be sold until the token graduates.</p> : null}
          {(stage === 'uncertain' || stage === 'included') && sameTradeSession && sameTradeContext ? (
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" onClick={() => void checkStatus()} className="inline-flex items-center gap-1.5 text-accent hover:underline">
                <RefreshCw className="h-3.5 w-3.5" /> Check status again
              </button>
              {pendingSubmission ? (
                <button type="button" onClick={() => void retryPendingSubmit()} className="text-accent hover:underline">
                  Retry the same Submit
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {position && sameTradeContext && sameTradeSession ? (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted">
          <CheckCircle2 className="h-4 w-4 text-up" />
          Position: {position.asset_decimals !== undefined ? formatUnits(position.shares, position.asset_decimals) : position.shares} {symbol ?? activeTokenInfo?.symbol ?? 'tokens'}
          {positionRefreshing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
        </div>
      ) : null}
      {errorMessage ? <p className={`mt-3 text-sm ${stage === 'uncertain' ? 'text-accent' : 'text-down'}`}>{errorMessage}</p> : null}
    </section>
  );
}
