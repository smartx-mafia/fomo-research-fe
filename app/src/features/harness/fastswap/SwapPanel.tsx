// Fast Swap v2 的交易卡：链 + 方向 / 资产 / 金额 → 展示报价 → 一键执行 → 在途恢复。
//
// 页面形态按对齐会话定的来：只有一键（Q13 B），不做分步按钮；在途列表每行一个
// 「恢复」（Q13a）；EXPIRED 自动 refresh 至多一次，「取消」只在已建未签时出现（Q13b）；
// 「高级」里是五个一次性故障注入开关（Q14）。所有协议逻辑在 flow.ts，这里只接线。

'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useSign7702Authorization, useSignTypedData, type ConnectedWallet} from '@privy-io/react-auth';
import {useSignMessage, useSignTransaction, type ConnectedStandardSolanaWallet} from '@privy-io/react-auth/solana';

import {formatUnits, USDC_MINT} from '../balance';
import {CHAINS, caipOf, chainOfCaip, type Chain} from '../chains';
import {isSolanaAddress} from '../transfer';
import {Badge, Btn, Copy, Field, Info, Note, Tabs} from '../ui';
import {SwapApiError, createSwapClient, type HttpTiming} from './client';
import {NO_FAULTS, SwapRun, type Faults, type RunState, type Signer} from './flow';
import {createSwapStore, withSwapLock, type SwapRecord} from './store';
import {StageLog, secs, type TraceView} from './stagelog';
import {TokenPicker} from './TokenPicker';
import {acceptedMinOut} from './verify';
import {
  ExecutionStatus,
  FeePolicy,
  Outcome,
  Side,
  accountingLabel,
  accountingTone,
  chainLegLabel,
  chainLegTone,
  executionLabel,
  outcomeLabel,
  executionTone,
  outcomeTone,
  preparationLabel,
  preparationTone,
  relayLabel,
  relayTone,
  sideLabel,
  swapStep,
  type QuoteReply,
  type QuoteRequest,
  type SwapRoute,
  type SwapSnapshot,
} from './wire';

const SOLANA = caipOf('solana');
const QUOTE_DEBOUNCE_MS = 400;
const PREWARM_SESSION_TIMEOUT_MS = 4_000;
/** 服务端 quote.max_slippage_bps 本机配置是 300；超限拒单不截断。 */
const DEFAULT_SLIPPAGE_BPS = '300';

export type SellPrefill = {originChain: string; originAsset: string; amountRaw: string; nonce: number};

export type SwapPanelProps = {
  token: string;
  /** 「环境 + 用户键」，存储分桶与签名锁都用它。 */
  account: string;
  /** 身份链是否就绪（readiness()），以及没就绪时那句话。 */
  gateReady: boolean;
  gateBlocker: string | null;
  solWallet: ConnectedStandardSolanaWallet | undefined;
  evmWallet: ConnectedWallet | undefined;
  /** 按地址取 Privy 钱包 id（`user.linkedAccounts[].id`）。 */
  walletIdOf: (address: string | undefined) => string | null;
  /** 预热前先刷新 Privy 会话；只判断会话可用，不保存 token。 */
  getAccessToken: () => Promise<string | null>;
  say: (text: string, bad?: boolean) => void;
  /** 一笔到终态后调（刷新持仓 / 余额，只作旁证）。 */
  onTerminal: () => void;
  prefill: SellPrefill | null;
};

/**
 * 本页的链选项**从 `chains.ts` 派生**，不在这里另立一张表：两张表会各自演化，
 * 而漏改这一张的症状是"那条链在页面上根本选不到，代码里样样都在"。
 *
 * 六条链与后端 `fastswap/domain/chains.go` 的 chainRefs 一一对应。某条链此刻
 * 开没开是 capabilities 说了算（本机 `signer.allow_chain_ids` 只放行了 Solana
 * 与 BSC，其余三条会带着 `unavailable_reason` 回来，按钮点不亮并写出原因）。
 */
const CHAIN_OPTS = CHAINS.map((k) => ({k, wire: caipOf(k)}));
type ChainKey = Chain;
type Dir = 'buy' | 'sell';

/**
 * 链 + 方向 → 线上的 origin / destination / side。页面像 v1 一样选「标的在哪条链」与方向，
 * 由这里映射成 capabilities 里的路线（后端 `quote/routes.go`：Solana 起点开 buy / swap，
 * EVM 起点开 sell —— 目的链不限，所以「拿 Solana USDC 买 BSC 上的币」是一条跨链买入）：
 *
 *   solana 买入 → origin solana，destination solana，side=buy
 *   bsc    买入 → origin solana，destination eip155:56，side=buy（跨链；签的仍是 Solana 交易）
 *   solana 卖出 → origin solana，destination solana，side=swap（Solana 起点填 side=sell 会 430611）
 *   bsc    卖出 → origin eip155:56，destination solana，side=sell（Calibur 批次）
 *
 * 现金资产恒是 Solana USDC（Q15），所以买入的出资侧与卖出的收款侧都在 Solana。
 */
function shapeOf(chain: ChainKey, dir: Dir): {origin: string; destination: string; side: number} {
  const wire = caipOf(chain);
  // 买入恒从 Solana USDC 出：同链时 destination 也是 Solana，跨链时是标的那条链。
  if (dir === 'buy') return {origin: SOLANA, destination: wire, side: Side.BUY};
  return chain === 'solana'
    ? {origin: SOLANA, destination: SOLANA, side: Side.SWAP}
    : {origin: wire, destination: SOLANA, side: Side.SELL};
}

/**
 * 代币地址与所选链对不对得上。**这一条挡的是真事**：2026-09-18 把 BSC 的
 * `0x3efb…` 填进「solana 买入」，请求原样发出去，Relay 回 400
 * `Invalid input currency`，前端只看到 430611「结算方拒绝且没给码」——
 * 那句话指不回"地址与链不匹配"。
 */
function addressFitsChain(chain: ChainKey, addr: string): boolean {
  const a = addr.trim();
  return chain === 'solana' ? isSolanaAddress(a) : /^0x[0-9a-fA-F]{40}$/.test(a);
}

/** 契约 §5 的终态：完成 / 已取消 / 过期未执行 / 失败未扣款 / 已退款。9「需人工核实」**不是**终态。 */
const TERMINAL_OUTCOMES: readonly number[] = [
  Outcome.COMPLETED,
  Outcome.CANCELLED,
  Outcome.EXPIRED_UNEXECUTED,
  Outcome.FAILED_NO_DEBIT,
  Outcome.REFUNDED,
];

/** 链名短写：`solana:mainnet` / `eip155:56` 在一行里太长，且一眼看不出是哪条。 */
function chainShort(wire: string): string {
  return chainOfCaip(wire) ?? wire;
}

/**
 * 在途一行要显示的四样：标的在哪条链、方向、代币、金额。
 *
 * 标的那一侧按 side 取：买入时标的是 destination，卖出（含 side=swap）时是 origin ——
 * 另一侧恒是 Solana USDC（Q15），显示它等于每行都写一遍同一个 mint。
 */
function rowBrief(intent: {origin_chain: string; destination_chain: string; origin_asset: string; destination_asset: string; amount_in_raw: string; side: number}) {
  const buy = intent.side === Side.BUY;
  return {
    chain: chainShort(buy ? intent.destination_chain : intent.origin_chain),
    dir: buy ? '买入' : '卖出',
    token: buy ? intent.destination_asset : intent.origin_asset,
    amountRaw: intent.amount_in_raw,
  };
}

const uuid = () => crypto.randomUUID();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const errText = (e: unknown) =>
  e instanceof SwapApiError
    ? `${e.code} ${e.reason ?? ''} ${e.message}` +
      (e.meta.recovery_action ? ` · recovery=${e.meta.recovery_action}` : '') +
      (e.meta.settlement_code ? ` · settlement_code=${e.meta.settlement_code}` : '') +
      (e.meta.market_cause ? ` · market_cause=${e.meta.market_cause}` : '') +
      (e.meta.sellable_raw ? ` · 可卖 ${e.meta.sellable_raw}（账本 ${e.meta.ledger_shares_raw}，在途 ${e.meta.reserved_raw}）` : '')
    : e instanceof Error
      ? e.message
      : String(e);

function fmt(raw: string | null | undefined, decimals: number | undefined): string {
  if (raw == null) return '—（未知）';
  try {
    return decimals == null ? raw : `${formatUnits(BigInt(raw), decimals)}（raw ${raw}）`;
  } catch {
    return raw;
  }
}

const ms = (v: number | undefined) => (v == null ? '—' : `${Math.round(v)} ms`);

export function SwapPanel(p: SwapPanelProps) {
  const {signTransaction} = useSignTransaction();
  const {signMessage: signWarmupMessage} = useSignMessage();
  const {signTypedData} = useSignTypedData();
  const {signAuthorization} = useSign7702Authorization();

  const store = useMemo(() => createSwapStore(p.account), [p.account]);
  const runRef = useRef<SwapRun | null>(null);
  // 这一笔的阶段时间线（trade_id + 每次切换的毫秒时刻），每次开跑 / 恢复时换新的
  const stageLogRef = useRef<StageLog | null>(null);
  // 交易卡里那张前端时间线表的数据。跑完不清 —— 要回看的正是刚跑完的那一笔。
  const [trace, setTrace] = useState<TraceView | null>(null);
  const client = useMemo(
    () =>
      createSwapClient({
        token: p.token,
        onTiming: (t: HttpTiming) => {
          runRef.current?.onHttpTiming(t);
          const log = stageLogRef.current;
          if (log) {
            log.http(t);
            setTrace(log.view());
          }
        },
      }),
    [p.token],
  );

  // ── 能力 ──────────────────────────────────────────────────────────
  const [routes, setRoutes] = useState<SwapRoute[] | null>(null);
  const [routesErr, setRoutesErr] = useState<string | null>(null);
  const loadRoutes = useCallback(async () => {
    if (!p.token) return;
    try {
      const c = await client.capabilities();
      setRoutes(c.routes);
      setRoutesErr(null);
    } catch (e) {
      setRoutesErr(errText(e));
    }
  }, [client, p.token]);
  useEffect(() => void loadRoutes(), [loadRoutes]);

  // ── 表单 ──────────────────────────────────────────────────────────
  const [chain, setChain] = useState<ChainKey>('solana');
  const [dir, setDir] = useState<Dir>('buy');
  const shape = shapeOf(chain, dir);
  // capabilities 只用来判断这一形状开没开，不再拿来让人挑。
  const route = (routes ?? []).find(
    (r) => r.origin_chain === shape.origin && r.destination_chain === shape.destination && r.side === shape.side,
  );
  const [tokenAddr, setTokenAddr] = useState('');
  // 选币面板默认收着：它一展开就会去拉五个榜，而多数时候人手上已经有地址了。
  const [picking, setPicking] = useState(false);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE_BPS);

  useEffect(() => {
    if (!p.prefill) return;
    const c = chainOfCaip(p.prefill.originChain);
    if (!c) {
      p.say(`填充卖出：${p.prefill.originChain} 不是本域的链（chains.ts 里没有）`, true);
      return;
    }
    setChain(c);
    setDir('sell');
    setTokenAddr(p.prefill.originAsset);
    setAmount(p.prefill.amountRaw);
    p.say(`已填入卖出：${c}，${p.prefill.amountRaw}（最小单位）—— 只填了表单，还没有执行`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.prefill?.nonce]);

  // **两个钱包各按自己那条链挑，不是「出资看链、收款恒 Solana」。**
  //
  // 服务端在报价之前先查「这个钱包在不在那条链上」，对不上回 400602（2026-09-18 的
  // 48cf3e09：目的链已经是 eip155:56，收款钱包 id 还填着 Solana 那个）。跨链买入的
  // 收款侧在标的链上，所以它要填 EVM 钱包 id；卖出时两者正好对调。
  //
  // 五条 EVM 链（bsc / base / ethereum / robinhood / arc）**共用同一个 Privy 钱包 id 与地址**，
  // 所以这里按「是不是 Solana」挑就够，不能反过来拿 id 去区分链。
  const walletFor = (wire: string) => (wire === SOLANA ? p.solWallet : p.evmWallet);
  const srcWallet = walletFor(shape.origin);
  const dstWallet = walletFor(shape.destination);
  const srcWalletID = p.walletIdOf(srcWallet?.address);
  const dstWalletID = p.walletIdOf(dstWallet?.address);

  const quoteReq: QuoteRequest | null = useMemo(() => {
    if (!route || !addressFitsChain(chain, tokenAddr) || !/^\d+$/.test(amount.trim()) || !/^\d+$/.test(slippage.trim()))
      return null;
    if (!srcWalletID || !dstWalletID) return null;
    const buy = route.side === Side.BUY;
    // EVM 地址发出去之前先转小写：服务端在建单入口就归一（EIP-55 的大小写是
    // 校验和不是身份），不归一的话本地留底与快照逐字节不同。签前第 1 条已经
    // 按链宽严有别地比过，这里只是让两边从一开始就是同一个串。
    const token = chain === 'solana' ? tokenAddr.trim() : tokenAddr.trim().toLowerCase();
    return {
      origin_chain: route.origin_chain,
      destination_chain: route.destination_chain,
      origin_asset: buy ? USDC_MINT : token,
      destination_asset: buy ? token : USDC_MINT,
      amount_in_raw: amount.trim(),
      slippage_bps: Number(slippage.trim()),
      side: route.side,
      source_wallet_id: srcWalletID,
      destination_wallet_id: dstWalletID,
      fee_policy: FeePolicy.PLATFORM_SPONSORED,
    };
  }, [route, chain, tokenAddr, amount, slippage, srcWalletID, dstWalletID]);
  const quoteKey = quoteReq ? JSON.stringify(quoteReq) : '';

  // ── 展示报价（防抖；只看不签）──────────────────────────────────────
  const [quote, setQuote] = useState<{key: string; reply: QuoteReply; ms: number} | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  useEffect(() => {
    if (!quoteReq) return;
    let live = true;
    const t = setTimeout(async () => {
      setQuoting(true);
      const t0 = performance.now();
      try {
        const reply = await client.quote(quoteReq);
        if (live) {
          setQuote({key: quoteKey, reply, ms: performance.now() - t0});
          setQuoteErr(null);
        }
      } catch (e) {
        if (live) setQuoteErr(errText(e));
      } finally {
        if (live) setQuoting(false);
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, client]);
  const freshQuote = quote && quote.key === quoteKey ? quote : null;

  // ── 故障注入（一次性）──────────────────────────────────────────────
  const [faults, setFaults] = useState<Faults>(NO_FAULTS);
  const faultsRef = useRef<Faults>(NO_FAULTS);
  faultsRef.current = faults;
  const takeFault = useCallback((k: keyof Faults) => {
    const v = faultsRef.current[k];
    if (v) {
      faultsRef.current = {...faultsRef.current, [k]: false};
      setFaults(faultsRef.current);
    }
    return v;
  }, []);

  // ── 运行 ──────────────────────────────────────────────────────────
  const [run, setRun] = useState<RunState | null>(null);
  // revision 的预计 / 底价 / 实际到手 / 源链 tx **写进「过程」日志，不占交易卡的版面**：
  // 它们是这一笔跑过的痕迹（出了事要回看），而交易卡要回答的是"现在怎么样、下一步点什么"。
  // 值变了才说一次 —— 轮询每两秒回来一次，不去重的话同一句会刷屏。
  const saidDigest = useRef('');

  const [running, setRunning] = useState(false);
  const [settledPrepareQuoteKey, setSettledPrepareQuoteKey] = useState('');
  const [pageVisible, setPageVisible] = useState(true);
  const preparedRef = useRef<{key: string; run: SwapRun} | null>(null);
  const prepareQueueRef = useRef<Promise<void>>(Promise.resolve());
  const prepareGenerationRef = useRef(0);
  const consumedPrepareKeyRef = useRef('');
  const [prepareNonce, setPrepareNonce] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const warmedKeysRef = useRef(new Set<string>());
  const prewarmInFlightRef = useRef(false);
  const prewarmDesiredKeyRef = useRef('');
  const [prewarm, setPrewarm] = useState<{key: string; status: 'idle' | 'running' | 'succeeded' | 'failed'; ms: number | null}>({
    key: '', status: 'idle', ms: null,
  });

  // 新报价成功 = 人已经在准备下一笔了：把上一笔已经停下 / 到终态的交易卡（连同时间线）清掉，
  // 否则「stopped 430611 route unsupported …」这种上一笔的结论会一直挂在新报价下面，
  // 看起来像是这份报价出了错。
  // 只清已结束的：还在跑的不动。清掉不丢东西 —— 过程日志里留着原文，
  // 建了单没签的那种仍在「在途 Swap」里可以恢复 / 取消。
  useEffect(() => {
    if (!quote || running) return;
    if (run?.stage === 'stopped' || run?.stage === 'done') {
      setRun(null);
      setTrace(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  // 签名默认**静默**（2026-09-18 起，按用户要求）：沿用 main.tsx 全局的 showWalletUIs=false。
  //
  // **静默签名，没有开关**（Privy 的 uiOptions 一律不传）。
  // 从前是逐次弹确认框，实测一笔（c5922c3e）弹窗里 Approve 灰了很久，签完用了 53 秒，
  // 而可签窗口只有约 39 秒 —— 上报时链上有效期已过，服务端验签后没有广播（expired_unsent）。
  // 静默不等于不核对：签前七条 + 解码核对、签后逐字节核对照跑，任一不过就不签 / 不上报。
  const signer: Signer | null = useMemo(() => {
    return {
      solana: async (tx) => {
        if (!p.solWallet) throw new Error('浏览器里没有 Solana embedded 钱包');
        const out = await signTransaction({
          transaction: tx,
          wallet: p.solWallet,
          chain: 'solana:mainnet',
        });
        return out.signedTransaction;
      },
      typedData: async (typed, address) => {
        // **把"请谁签"写进日志。** 签完恢复出陌生地址时，这一行是区分
        // 「我们要错了人」与「Privy 没按 address 挑钱包」的唯一证据 ——
        // 两者症状一模一样（ecrecover 出一个谁也不认识的地址）。
        const evmHere = p.evmWallet?.address ?? '（无）';
        p.say(`请 Privy 用 ${address} 签 calibur_batch（浏览器里的 EVM 钱包：${evmHere}）`);
        const out = await signTypedData(typed as Parameters<typeof signTypedData>[0], {address});
        return out.signature;
      },
      authorization7702: async (input, address) => {
        const out = await signAuthorization(
          {contractAddress: input.contractAddress as `0x${string}`, chainId: input.chainId, nonce: input.nonce},
          {address},
        );
        return {r: out.r, s: out.s, yParity: out.yParity};
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.solWallet, signTransaction, signTypedData, signAuthorization]);

  const depsFor = useCallback(
    (walletAddress: string) => ({
      client,
      store,
      signer: signer!,
      account: p.account,
      withLock: <T,>(name: string, fn: () => Promise<T>) => withSwapLock(name, fn),
      takeFault,
      now: () => performance.now(),
      wall: () => new Date().toISOString(),
      sleep,
      visible: () => document.visibilityState === 'visible',
      uuid,
      onUpdate: (s: RunState) => {
        const log = stageLogRef.current;
        if (log) {
          for (const line of log.observe(s)) p.say(line, s.stage === 'stopped');
          setTrace(log.view());
        }
        setRun(s);
      },
      telemetry: async (events: Parameters<typeof client.telemetry>[0]) => {
        const r = await client.telemetry(events, uuid());
        if (r.rejected_count > 0) p.say(`埋点：${r.accepted_count} 条收下，${r.rejected_count} 条被拒`, true);
      },
      walletAddress,
    }),
    [client, store, signer, p.account, p.say, takeFault],
  );

  useEffect(() => {
    const changed = () => setPageVisible(document.visibilityState !== 'hidden');
    changed();
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);

  // 与展示报价共用相同的稳定输入窗口，但不等 `/quote` 回来：两个请求并行，
  // 报价网络时间不会再串到完整交易的预构建之前。
  useEffect(() => {
    if (!quoteReq || !route?.enabled || !p.gateReady || !srcWallet || !signer) {
      setSettledPrepareQuoteKey('');
      return;
    }
    const key = quoteKey;
    const timer = setTimeout(() => setSettledPrepareQuoteKey(key), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [p.gateReady, quoteKey, quoteReq, route?.enabled, signer, srcWallet]);

  const prepareKey = settledPrepareQuoteKey === quoteKey && quoteReq && route?.enabled && p.gateReady && srcWallet && signer
    ? `${quoteKey}\u0000${prepareNonce}`
    : '';

  const cancelPrepared = useCallback(async (old: {key: string; run: SwapRun}): Promise<void> => {
    const state = old.run.snapshotState;
    const record = store.byIntent(state.clientIntentID);
    if (!state.swapID) throw new Error('旧 Create 尚未拿到 swap_id，结果不可确认；已停止创建新意图');
    if (record?.artifact || state.snapshot?.execution.status !== ExecutionStatus.NOT_REPORTED) {
      throw new Error('旧交易已经签名或上报，不能按未签交易取消；请先恢复同一笔');
    }
    p.say(`[trade_id ${state.swapID}] 输入变化，先取消旧的未签可执行交易`);
    runRef.current = old.run;
    const cancelled = await old.run.cancel();
    if (cancelled.stage !== 'done') {
      throw new Error(`旧交易取消未确认：${cancelled.stopReason ?? '未到终态'}；已停止创建新意图`);
    }
    if (preparedRef.current === old) preparedRef.current = null;
  }, [p.say, store]);

  // 输入稳定后，串行生成完整可签交易。prepareKey 变空也必须进入队列取消旧意图；
  // 只有旧 swap 的取消已经确认到终态，才会为新输入 Create。
  useEffect(() => {
    if (running) return;
    // consumed 只阻止“同一轮输入在终态后立刻自动再建一笔”。一旦离开这轮输入，
    // 即使之后又改回来，也应视为新的明确输入过程。
    if (consumedPrepareKeyRef.current && consumedPrepareKeyRef.current !== prepareKey) {
      consumedPrepareKeyRef.current = '';
    }
    const oldAtSchedule = preparedRef.current;
    if (!prepareKey) {
      if (!oldAtSchedule) {
        setPreparing(false);
        return;
      }
    } else if (oldAtSchedule?.key === prepareKey || !oldAtSchedule && consumedPrepareKeyRef.current === prepareKey) {
      return;
    }
    const generation = ++prepareGenerationRef.current;
    setPreparing(true);
    setPrepareError(null);
    prepareQueueRef.current = prepareQueueRef.current.then(async () => {
      const old = preparedRef.current;
      if (old && old.key !== prepareKey) await cancelPrepared(old);
      if (generation !== prepareGenerationRef.current) return;
      if (!prepareKey || !quoteReq || !srcWallet || !signer) return;

      const next = SwapRun.start(depsFor(srcWallet.address), quoteReq, null);
      preparedRef.current = {key: prepareKey, run: next};
      runRef.current = next;
      p.say(`⏱ 输入稳定，后台准备完整可签交易 · client_intent_id=${next.snapshotState.clientIntentID}`);
      const state = await next.prepare();
      // 输入在请求期间变化时，下一项串行任务会取消这笔；这里不并发 cancel。
      if (generation !== prepareGenerationRef.current) return;
      if (state.stage === 'ready') {
        p.say(`[trade_id ${state.swapID}] 可签交易 READY（预构建 ${ms(state.timeline.create_ms)}），点击时只签名并上报`);
      } else {
        setPrepareError(state.stopReason ?? '可签交易准备失败');
      }
    }).catch((e: unknown) => {
      if (generation === prepareGenerationRef.current) setPrepareError(errText(e));
    }).finally(() => {
      if (generation === prepareGenerationRef.current) setPreparing(false);
    });
  }, [cancelPrepared, depsFor, p.say, prepareKey, quoteReq, running, signer, srcWallet]);

  const prepared = preparedRef.current?.key === prepareKey ? preparedRef.current.run.snapshotState : null;
  const preparedReady = prepared?.stage === 'ready' && prepared.snapshot?.execution.status === ExecutionStatus.NOT_REPORTED;
  const prewarmWalletAddress = shape.origin === SOLANA ? p.solWallet?.address ?? '' : p.evmWallet?.address ?? '';
  const prewarmKey = preparedReady && prewarmWalletAddress
    ? `${p.account}\u0000${shape.origin}\u0000${prewarmWalletAddress}\u0000${prepared?.swapID ?? ''}\u0000${prepared?.snapshot?.revision.revision ?? ''}`
    : '';
  prewarmDesiredKeyRef.current = prewarmKey;

  // READY 之后、点击之前支付 Privy 会话与 signer 初始化成本。失败时记录并放行；
  // 预热不是交易授权，最终交易仍会完成全部签前/签后核对。
  useEffect(() => {
    if (!prewarmKey || !preparedReady || !pageVisible ||
        prewarmInFlightRef.current || warmedKeysRef.current.has(prewarmKey)) return;
    prewarmInFlightRef.current = true;
    setPrewarm({key: prewarmKey, status: 'running', ms: null});
    const started = performance.now();
    const desired = prewarmKey;
    void (async () => {
      let status: 'succeeded' | 'failed' = 'succeeded';
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const access = await Promise.race([
          p.getAccessToken(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Privy signer warm-up session timed out')), PREWARM_SESSION_TIMEOUT_MS);
          }),
        ]);
        if (timeout) {clearTimeout(timeout); timeout = undefined;}
        if (!access) throw new Error('Privy session is unavailable for signer warm-up');
        if (prewarmDesiredKeyRef.current !== desired || document.visibilityState === 'hidden') {
          throw new DOMException('Signer warm-up context changed', 'AbortError');
        }
        if (shape.origin === SOLANA) {
          if (!p.solWallet) throw new Error('浏览器里没有 Solana embedded 钱包');
          const message = new TextEncoder().encode([
            'SmartX Fast Swap signer warm-up',
            `origin:${location.origin}`,
            `wallet:${p.solWallet.address}`,
            `nonce:${uuid()}`,
            'purpose:non-authorizing latency warm-up',
          ].join('\n'));
          await signWarmupMessage({message, wallet: p.solWallet, options: {uiOptions: {showWalletUIs: false}}});
        } else {
          if (!p.evmWallet) throw new Error('浏览器里没有 EVM embedded 钱包');
          const provider = await p.evmWallet.getEthereumProvider();
          await provider.request({method: 'eth_chainId'});
        }
      } catch {
        status = 'failed';
      } finally {
        if (timeout) clearTimeout(timeout);
        const elapsed = performance.now() - started;
        prewarmInFlightRef.current = false;
        if (prewarmDesiredKeyRef.current === desired) {
          warmedKeysRef.current.add(desired);
          setPrewarm({key: desired, status, ms: elapsed});
          p.say(`Privy signer 预热${status === 'succeeded' ? '完成' : '失败后放行'}：${Math.round(elapsed)}ms`);
        } else {
          // 新输入在旧预热结束前已经 READY：触发一次新渲染，让新 key 接着预热。
          setPrewarm({key: '', status: 'idle', ms: null});
        }
      }
    })();
  }, [p.evmWallet, p.getAccessToken, p.say, p.solWallet, pageVisible, preparedReady, prewarm.status, prewarmKey, shape.origin, signWarmupMessage]);

  const prewarmSettled = !preparedReady || warmedKeysRef.current.has(prewarmKey) && !prewarmInFlightRef.current;

  const finish = useCallback(
    (s: RunState) => {
      runRef.current = null;
      setRunning(false);
      if (stageLogRef.current) p.say(stageLogRef.current.summary(s), s.stage === 'stopped');
      stageLogRef.current = null;
      if (s.stage === 'done') {
        p.say(`[trade_id ${s.swapID}] 到终态：${outcomeLabel(s.snapshot?.settlement.outcome)}`);
        p.onTerminal();
        // **成交之后清掉这一笔的输入，只清「完成」这一种终态。**
        //
        // 不清的话，下一笔的起点是上一笔的代币与金额 —— 而这个台子上最常见的
        // 下一步恰恰是换一只币再试，于是要么手工全选删掉，要么在旧金额上改几位
        // 数字（改错一位不报错，直接按旧金额下单，花的是真钱）。
        //
        // 其余终态（取消 / 过期未执行 / 失败未扣款 / 已退款）**不清**：那几种
        // 多半要照着同样的输入再来一次，清掉等于逼人重填一遍。
        //
        // 链、方向、滑点是「设置」不是「这一笔」，一并清掉会让人每笔都重选一次。
        if (s.snapshot?.settlement.outcome === Outcome.COMPLETED) {
          setTokenAddr('');
          setAmount('');
        }
      } else if (s.stage === 'stopped') {
        p.say(`[trade_id ${s.swapID ?? '（未建单）'}] 停下：${s.stopReason}`, true);
      }
      void loadActive();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p],
  );

  const doRun = async () => {
    const hot = preparedRef.current;
    if (!quoteReq || !srcWallet || !freshQuote || !hot || hot.key !== prepareKey ||
        hot.run.snapshotState.stage !== 'ready' || !prewarmSettled) return;
    const r = hot.run;
    r.acceptDisplayedQuote(acceptedMinOut(freshQuote.reply.min_out_raw, quoteReq.slippage_bps));
    setRunning(true);
    runRef.current = r;
    stageLogRef.current = new StageLog(() => performance.now(), undefined, '用户点执行（复用 READY 交易）');
    for (const line of stageLogRef.current.observe(r.snapshotState)) p.say(line);
    setTrace(stageLogRef.current.view());
    p.say(
      `⚡ 热路径执行 ${quoteReq.origin_chain}→${quoteReq.destination_chain} ${sideLabel(quoteReq.side)}，amount_in_raw=${quoteReq.amount_in_raw}` +
        ` · client_intent_id=${r.snapshotState.clientIntentID}`,
    );
    const result = await r.executePrepared();
    const record = store.byIntent(result.clientIntentID);
    // 签前失败时仍是活跃的未签 swap，保留引用，让“准备下一笔”先取消它。
    // 已有 artifact 则交给持久化恢复入口；终态已经释放服务端资源，可直接清理。
    if (result.stage === 'done' || record?.artifact) {
      consumedPrepareKeyRef.current = hot.key;
      if (preparedRef.current === hot) preparedRef.current = null;
    }
    finish(result);
  };

  // ── 在途 ──────────────────────────────────────────────────────────
  const [active, setActive] = useState<SwapSnapshot[] | null>(null);
  const [activeErr, setActiveErr] = useState<string | null>(null);
  const [localRecs, setLocalRecs] = useState<SwapRecord[]>([]);
  // 与持仓轮询同样的两把守卫（见 App.tsx 的 refreshPositions）：
  //   activeBusyRef —— 上一拍没回来就跳过这一拍，慢响应不堆积（一拍最多翻 5 页）。
  //   activeGenRef  —— 迟到的响应不许覆盖新的，列表不往回跳。
  // 守卫放在 loadActive 里而不是轮询 effect 里：手动「刷新」与 swap 收尾那两条路同样需要。
  const activeBusyRef = useRef(false);
  const activeGenRef = useRef(0);
  const loadActive = useCallback(async () => {
    setLocalRecs(store.list());
    if (!p.token || activeBusyRef.current) return;
    activeBusyRef.current = true;
    const gen = ++activeGenRef.current;
    try {
      const out: SwapSnapshot[] = [];
      let cursor = '';
      for (let i = 0; i < 5; i++) {
        const r = await client.active(cursor, 20);
        out.push(...r.items);
        if (!r.next_cursor) break;
        cursor = r.next_cursor;
      }
      if (gen !== activeGenRef.current) return;
      setActive(out);
      setActiveErr(null);
    } catch (e) {
      // 失败只更新卡片上那一行，不写「过程」日志 —— 1 秒一条会把右栏冲掉
      if (gen !== activeGenRef.current) return;
      setActiveErr(errText(e));
    } finally {
      activeBusyRef.current = false;
    }
  }, [client, store, p.token]);
  // 在途 Swap 每秒自动刷新（2026-09-18 按需求加）。
  //   · 没 token 不轮询（loadActive 里本来就会直接返回，这里连 interval 都不起）
  //   · 页面不可见时停，回到前台立刻补一拍，不等下一个 1s
  //   · loadActive 换了（token / 账号变了）就重建 interval，卸载时清掉
  useEffect(() => {
    if (!p.token) {
      void loadActive(); // 仍刷新本地记录那一半
      return;
    }
    const tick = () => {
      if (document.visibilityState === 'visible') void loadActive();
    };
    tick();
    const t = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [loadActive, p.token]);

  const walletForChain = (chain: string) => (chain === SOLANA ? p.solWallet : p.evmWallet);

  const resumeSwap = async (swapID: string, mode: 'resume' | 'follow' | 'cancel', snap?: SwapSnapshot) => {
    const hot = preparedRef.current;
    if (mode !== 'follow' && hot?.run.snapshotState.swapID === swapID) {
      setRunning(true);
      runRef.current = hot.run;
      const verb = mode === 'cancel' ? '取消' : '恢复';
      stageLogRef.current = new StageLog(() => performance.now(), undefined, `用户点${verb}`);
      setTrace(stageLogRef.current.view());
      p.say(`${verb}预构建 [trade_id ${swapID}]`);
      const result = await (mode === 'cancel' ? hot.run.cancel() : hot.run.resume());
      const record = store.byIntent(result.clientIntentID);
      if (result.stage === 'done' || mode === 'resume' && !!record?.artifact) {
        consumedPrepareKeyRef.current = hot.key;
        if (preparedRef.current === hot) preparedRef.current = null;
      }
      finish(result);
      return;
    }
    const rec =
      store.bySwap(swapID) ??
      ({
        client_intent_id: snap?.intent.client_intent_id ?? swapID,
        intent: snap?.intent,
        create_key: '',
        accepted_min_out_raw: null,
        swap_id: swapID,
        artifact: null,
        execution_key: null,
        reported: false,
        updated_at: '',
      } as SwapRecord);
    const w = walletForChain(rec.intent?.origin_chain ?? SOLANA);
    setRunning(true);
    const r = new SwapRun(depsFor(w?.address ?? ''), rec);
    runRef.current = r;
    const verb = mode === 'cancel' ? '取消' : mode === 'follow' ? '跟进' : '恢复';
    stageLogRef.current = new StageLog(() => performance.now(), undefined, `用户点${verb}`);
    setTrace(stageLogRef.current.view());
    p.say(`${mode === 'cancel' ? '取消' : mode === 'follow' ? '跟进' : '恢复'} [trade_id ${swapID}]`);
    finish(await (mode === 'cancel' ? r.cancel() : mode === 'follow' ? r.follow() : r.resume()));
  };

  // ── 渲染 ──────────────────────────────────────────────────────────
  const snap = run?.snapshot ?? null;
  const assets = snap?.revision.assets;
  useEffect(() => {
    if (!snap) return;
    const d = snap.revision.assets.destination.decimals;
    const line =
      `${run?.swapID ?? ''} revision 预计 ${fmt(snap.revision.expected_out_raw, d)} · 底价 ${fmt(snap.revision.min_out_raw, d)}` +
      ` · 实际到手 ${fmt(snap.settlement.amount_out_actual_raw, d)}` +
      (snap.settlement.outcome === Outcome.COMPLETED ? '' : '（只有「完成」时才算数）') +
      (snap.settlement.refund_fee_delta_raw != null ? ` · 退款差额 ${snap.settlement.refund_fee_delta_raw}` : '') +
      (snap.execution.origin_tx_hash ? ` · 源链 tx ${snap.execution.origin_tx_hash}` : '') +
      (snap.execution.failure_cause
        ? ` · 预检被拒：${snap.execution.failure_cause}（建议 ${snap.execution.recovery_action}，需建新意图）`
        : '');
    if (line === saidDigest.current) return;
    saidDigest.current = line;
    p.say(line, !!snap.execution.failure_cause);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);
  const baseBlocked = !p.gateReady
    ? p.gateBlocker
    : !routes
      ? '还没拿到 capabilities'
      : !route
        ? `capabilities 里没有 ${chain} ${dir === 'buy' ? '买入' : '卖出'}`
        : !route.enabled
          ? `${chain} ${dir === 'buy' ? '买入' : '卖出'}未开通：${route.unavailable_reason ?? '未说明'}`
          : tokenAddr.trim() !== '' && !addressFitsChain(chain, tokenAddr)
            ? `这个地址不像 ${chain} 上的代币（${chain === 'solana' ? 'base58 解出来要是 32 字节' : '0x + 40 位十六进制'}）—— 是不是链选错了`
      : !srcWallet || !dstWallet
        ? `浏览器里没有${!srcWallet ? (shape.origin === SOLANA ? ' Solana' : ' EVM') : shape.destination === SOLANA ? ' Solana' : ' EVM'} embedded 钱包`
        : !srcWalletID || !dstWalletID
          ? '拿不到 Privy 钱包 id（linkedAccounts[].id 为空）—— v2 只认钱包 id'
          : !quoteReq
            ? '填代币地址与金额（整数最小单位）'
            : !freshQuote
              ? quoting
                ? '报价中…'
                : '等一份与当前输入对应的展示报价'
              : null;
  const blocked = baseBlocked ?? (preparing
    ? '正在后台生成完整可签交易'
    : prepareError
      ? `可签交易准备失败：${prepareError}`
      : !preparedReady
        ? '等待完整交易 READY'
        : !prewarmSettled
          ? 'Privy signer 预热中'
          : null);

  const localRecord = run ? store.byIntent(run.clientIntentID) : undefined;
  const canCancelRun =
    !running && !!run?.swapID && run.stage === 'stopped' && !localRecord?.artifact &&
    snap?.execution.status === ExecutionStatus.NOT_REPORTED;

  // **只列未完成的。** /active 本身可能把已终态的也带回来（取消 / 过期那几种），
  // 而本地记录里那些「不在 /active」的行多半正是已经走完的 —— 只有一种要留：
  // 本地签了还没上报，它是唯一必须被人看见并「恢复」的状态。
  const activeRows = useMemo(() => {
    const byID = new Map<string, SwapSnapshot | null>();
    for (const s of active ?? []) if (!TERMINAL_OUTCOMES.includes(s.settlement.outcome)) byID.set(s.swap_id, s);
    for (const r of localRecs) {
      if (!r.swap_id || byID.has(r.swap_id)) continue;
      if (r.artifact && !r.reported) byID.set(r.swap_id, null);
    }
    return [...byID.entries()];
  }, [active, localRecs]);

  return (
    <div className="form">
      {routesErr && <Note tone="err">capabilities 失败：{routesErr}</Note>}
      {!store.durable() && <Note tone="warn">localStorage 不可用 —— 签名产物只在内存里，刷新页面就丢。</Note>}

      <div className="f2">
        <div className="f">
          <label>方向</label>
          <Tabs
            grow
            value={dir}
            onChange={setDir}
            label="买入还是卖出"
            items={[
              {k: 'buy', label: '买入 BUY'},
              {k: 'sell', label: '卖出 SELL'},
            ]}
          />
        </div>
        <div className="f">
          <label htmlFor="fs-chain">
            标的在哪条链<span className="u">{route ? `side=${sideLabel(route.side)}` : '—'}</span>
          </label>
          <select id="fs-chain" className="inp" value={chain} onChange={(e) => setChain(e.target.value as ChainKey)}>
            {CHAIN_OPTS.map((c) => (
              <option key={c.k} value={c.k}>
                {c.k}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="f3">
        <Field
          label={dir === 'buy' ? '买入的代币' : '卖出的代币'}
          unit={chain === 'solana' ? 'Solana mint' : 'EVM 合约地址（0x…）'}
          value={tokenAddr}
          onChange={setTokenAddr}
          after={
            <Btn size="sm" variant="ghost" onClick={() => setPicking((v) => !v)} title="按链列出候选标的">
              {picking ? '收起' : '选币'}
            </Btn>
          }
        />
        <Field
          label="amount_in_raw"
          unit={dir === 'buy' ? 'USDC 最小单位（1 USDC = 1000000）' : '代币最小单位'}
          value={amount}
          onChange={setAmount}
        />
        <Field label="slippage_bps" unit="服务端上限 300，超限拒单" value={slippage} onChange={setSlippage} />
      </div>
      {/* 选中只填地址，**不动金额与滑点** —— 那两个是人这一次想试的东西，
          被一次选币悄悄改掉的话，下一发报价是对着别的输入算的。 */}
      {picking && (
        <TokenPicker
          chain={chain}
          token={p.token}
          onPick={(addr) => {
            setTokenAddr(addr);
            setPicking(false);
          }}
        />
      )}
      <p className="hint tight">
        出资（{chainShort(shape.origin)}）<code className="code">{srcWallet?.address ?? '（无）'}</code> · id{' '}
        <code className="code">{srcWalletID ?? '（无）'}</code>
        {' '}→ 收款（{chainShort(shape.destination)}）<code className="code">{dstWallet?.address ?? '（无）'}</code> · id{' '}
        <code className="code">{dstWalletID ?? '（无）'}</code>
      </p>

      {/* 展示报价 + 执行：同一行，报价在左、按钮在右 */}
      <div className="row tight" style={{flexWrap: 'wrap', alignItems: 'center', gap: 8}}>
        <Badge kind={freshQuote ? 'ok' : quoteErr ? 'err' : 'off'}>
          {freshQuote ? `报价 ${ms(freshQuote.ms)}` : quoting ? '报价中' : quoteErr ? '报价失败' : '无报价'}
        </Badge>
        <Badge kind={preparedReady ? 'ok' : prepareError ? 'err' : preparing ? 'live' : 'off'}>
          {preparedReady ? `可签交易 READY ${ms(prepared?.timeline.create_ms)}` : preparing ? '预构建中' : prepareError ? '预构建失败' : '未预构建'}
        </Badge>
        {preparedReady && (
          <Badge kind={prewarm.status === 'failed' ? 'warn' : prewarmSettled ? 'ok' : 'live'}>
            {prewarmSettled
              ? prewarm.status === 'failed'
                ? `Privy 预热失败，回落正常签名${prewarm.ms == null ? '' : ` ${Math.round(prewarm.ms)}ms`}`
                : `Privy 已预热${prewarm.ms == null ? '' : ` ${Math.round(prewarm.ms)}ms`}`
              : 'Privy 预热中'}
          </Badge>
        )}
        <span className="hint tight" style={{flex: 1, minWidth: 0}}>
          {freshQuote && (
            <>
              预计到手 {fmt(freshQuote.reply.expected_out_raw, freshQuote.reply.assets.destination.decimals)} · 最少
              {freshQuote.reply.estimate ? '（约）' : ''} {fmt(freshQuote.reply.min_out_raw, freshQuote.reply.assets.destination.decimals)}
            </>
          )}
        </span>
        <Btn variant="primary" danger={dir !== 'buy'} busy={running} disabled={running || !!blocked} onClick={doRun}>
          {preparing ? '预构建中' : !preparedReady ? '等待 READY' : !prewarmSettled ? 'Privy 预热中' : '确认并执行'}
        </Btn>
        {(prepareError || run?.stage === 'done' || run?.stage === 'stopped') && !running && !preparing && (
          <Btn size="sm" onClick={() => {
            consumedPrepareKeyRef.current = '';
            setPrepareError(null);
            setRun(null);
            setTrace(null);
            setPrepareNonce((n) => n + 1);
          }}>
            准备下一笔同参数
          </Btn>
        )}
      </div>
      {quoteErr && !freshQuote && <p className="hint tight">{quoteErr}</p>}
      {freshQuote && freshQuote.reply.fees.length > 0 && (
        <p className="hint tight">
          费用：
          {freshQuote.reply.fees.map((f, i) => (
            <span key={i}>
              {i > 0 ? '；' : ''}kind={f.kind} payer={f.payer} {f.amount_raw}@{f.asset.slice(0, 6)}…
            </span>
          ))}
          {' '}—— 展示报价只供确认，不进任何签名材料。
        </p>
      )}

      {blocked && <p className="hint tight">还不能执行：{blocked}</p>}

      <Info label="高级 · 故障注入（一次性，用过即复位）">
        {(
          [
            ['dropCreateResponse', '丢弃建单回包，随后同键重发（应落回同一笔）'],
            ['stopAfterSign', '签完落盘后不上报 —— 刷新页面，到在途列表「恢复」'],
            ['dropExecutionResponse', '丢弃上报回包，随后同键重发'],
            ['waitUntilExpired', '拿到可签版本后不签，等它过期 → 自动 refresh'],
            ['doubleFire', '同时发起两次签名 + 上报（验签名锁）'],
          ] as [keyof Faults, string][]
        ).map(([k, label]) => (
          <label key={k} className="row tight" style={{gap: 8}}>
            <input
              type="checkbox"
              checked={faults[k]}
              onChange={(e) => {
                faultsRef.current = {...faultsRef.current, [k]: e.target.checked};
                setFaults(faultsRef.current);
              }}
            />
            <span className="hint tight">{label}</span>
          </label>
        ))}
      </Info>

      {/* 这一笔 */}
      {run && (
        <div>
          <div className="row tight">
            <Badge kind={run.stage === 'done' ? 'ok' : run.stage === 'stopped' ? 'err' : 'live'}>{run.stage}</Badge>
            {run.swapID && (
              <>
                <code className="code">{run.swapID}</code>
                <Copy text={run.swapID} />
              </>
            )}
            {canCancelRun && (
              <Btn size="sm" onClick={() => void resumeSwap(run.swapID!, 'cancel')}>
                取消这笔（已建未签）
              </Btn>
            )}
          </div>
          {run.stopReason && <Note tone="err">{run.stopReason}</Note>}
          {snap && (
            <div className="row tight">
              {/* 颜色一律由 wire.ts 的 *Tone 决定：灰=还没发生，黄=进行中，绿=这一档走完，红=出事。 */}
              <Badge kind={preparationTone(snap.preparation.status)}>
                准备 · {preparationLabel(snap.preparation.status)}
              </Badge>
              <Badge kind={executionTone(snap.execution.status)}>执行 · {executionLabel(snap.execution.status)}</Badge>
              <Badge kind={chainLegTone(snap.settlement.source)}>源链 · {chainLegLabel(snap.settlement.source)}</Badge>
              {/* Relay 排在目的链前面：钱先被 Relay 成交，目的链上的到账是它的结果。
                  照时间顺序摆，一行看下来就是这一笔走过的路。 */}
              <Badge kind={relayTone(snap.settlement.relay)}>Relay · {relayLabel(snap.settlement.relay)}</Badge>
              <Badge kind={chainLegTone(snap.settlement.destination)}>
                目的链 · {chainLegLabel(snap.settlement.destination)}
              </Badge>
              <Badge kind={accountingTone(snap.settlement.accounting)}>
                账务 · {accountingLabel(snap.settlement.accounting)}
              </Badge>
              <Badge kind={outcomeTone(snap.settlement.outcome)}>结局 · {outcomeLabel(snap.settlement.outcome)}</Badge>
            </div>
          )}
          {run.checks.length > 0 && (
            <Info label={`签名核对 · ${run.checks.filter((c) => c.ok).length}/${run.checks.length} 通过`}>
              {run.checks.map((c) => (
                <p key={c.id} className="hint tight">
                  <Badge kind={c.ok ? 'ok' : 'err'}>{c.id}</Badge> {c.detail}
                </p>
              ))}
            </Info>
          )}

          {trace && <TraceTable v={trace} />}

          {snap && (
            <Info label="快照全文">
              {/* 复制按钮在上面不在下面：报障时要贴的就是这一整坨，
                  而它有几百行 —— 按钮放末尾等于每次都要先滚到底。 */}
              <div className="row tight">
                <Copy text={JSON.stringify(snap, null, 2)} label="复制快照 JSON" />
              </div>
              <pre className="block">{JSON.stringify(snap, null, 2)}</pre>
            </Info>
          )}
        </div>
      )}

      {/* 在途 */}
      <div className="row tight" style={{justifyContent: 'space-between'}}>
        <b>在途 Swap</b>
        <Btn size="sm" disabled={!p.token} onClick={() => void loadActive()}>
          刷新
        </Btn>
      </div>
      {activeErr && <p className="hint tight">/active 失败：{activeErr}</p>}
      {activeRows.length === 0 && <p className="hint tight">没有在途的 swap。</p>}
      {activeRows.map(([id, s]) => {
        const rec = localRecs.find((r) => r.swap_id === id);
        const signedLocally = !!rec?.artifact;
        const confirmedLocally = rec?.accepted_min_out_raw != null;
        const notReported = !s || s.execution.status === ExecutionStatus.NOT_REPORTED;
        const brief = s ? rowBrief(s.intent) : rec ? rowBrief(rec.intent) : null;
        return (
          <div key={id} className="row tight">
            <code className="code" title={id}>{id.slice(0, 8)}</code>
            <Copy text={id} />
            {brief && (
              <span className="hint tight">
                {brief.chain} · {brief.dir} · <code className="code">{brief.token.slice(0, 6)}…{brief.token.slice(-4)}</code> ·{' '}
                {s ? fmt(brief.amountRaw, s.revision.assets.origin.decimals) : `${brief.amountRaw}（raw）`}
              </span>
            )}
            {s ? (
              // 一行只给一个状态：现在卡在哪一段（swapStep）。全量状态悬停可见，也在交易卡里
              (() => {
                const step = swapStep(s);
                const all =
                  `准备 ${preparationLabel(s.preparation.status)} · 执行 ${executionLabel(s.execution.status)} · ` +
                  `源链 ${chainLegLabel(s.settlement.source)} · Relay ${relayLabel(s.settlement.relay)} · ` +
                  `目的链 ${chainLegLabel(s.settlement.destination)} · 账务 ${accountingLabel(s.settlement.accounting)} · ` +
                  `结局 ${outcomeLabel(s.settlement.outcome)}`;
                return (
                  <span title={all}>
                    <Badge kind={step.tone}>{step.text}</Badge>
                  </span>
                );
              })()
            ) : (
              <Badge kind="off">不在 /active（可能已终态）</Badge>
            )}
            {/* 已上报的不再提：那只是本地还留着一份，没有要做的事。未上报的才要人去「恢复」 */}
            {signedLocally && !rec!.reported && <Badge kind="err">已签未上报</Badge>}
            {rec && (signedLocally || confirmedLocally) ? (
              <Btn size="sm" disabled={running} onClick={() => void resumeSwap(id, 'resume', s ?? undefined)}>
                恢复
              </Btn>
            ) : rec ? (
              <Badge kind="off">待交易卡确认，不从恢复入口签名</Badge>
            ) : (
              <Btn size="sm" disabled={running} onClick={() => void resumeSwap(id, 'follow', s ?? undefined)} title="本地没有这笔的记录，只跟进不签">
                跟进
              </Btn>
            )}
            {!signedLocally && notReported && s && (
              <Btn size="sm" disabled={running || preparing} onClick={() => void resumeSwap(id, 'cancel', s)}>
                取消
              </Btn>
            )}
          </div>
        );
      })}

    </div>
  );
}

/**
 * 前端时间线表，版式照 trade-trace skill 的「lifecycle 时间线」：
 * 时刻 / 谁 / 在做什么 / 距上一步 / 距开始 / 阶段。只有本页看到的，不含后端与链上。
 * 「距上一步」最长的那一行加粗 —— 它就是这一笔的瓶颈。
 */
function TraceTable({v}: {v: TraceView}) {
  const title =
    `前端时间线 · ${v.swapID ? `trade_id ${v.swapID}` : `intent ${v.clientIntentID}`}` +
    ` · ${v.closed ? '总时长' : '已进行'} ${secs(v.total)}`;
  // 默认折叠（Info 是 <details>）：标题已经给出 trade_id 与总时长，要细看再展开
  return (
    <Info label={title}>
      {v.swapID && (
        <p className="hint tight">
          trade_id <code className="code">{v.swapID}</code> <Copy text={v.swapID} />
          {v.requestID && (
            <>
              {' · '}request_id <code className="code">{v.requestID}</code> <Copy text={v.requestID} />
            </>
          )}
        </p>
      )}
      {v.stages.length > 0 && (
        <p className="hint tight">
          各阶段耗时：{v.stages.map((x) => `${x.stage} ${secs(x.ms)}`).join(' · ')}
        </p>
      )}
      <div className="tblwrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>时刻</th>
              <th>谁</th>
              <th>在做什么</th>
              <th>距上一步</th>
              <th>距开始</th>
              <th>阶段</th>
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r, i) => (
              <tr key={i} style={r.bad ? {color: 'var(--err, #f87171)'} : undefined}>
                <td style={{whiteSpace: 'nowrap', fontFamily: 'var(--mono)'}}>
                  {r.mark ? `${r.mark} ` : ''}
                  {r.at}
                </td>
                <td style={{whiteSpace: 'nowrap'}}>{r.who}</td>
                <td style={{wordBreak: 'break-all'}}>{r.what}</td>
                <td style={{whiteSpace: 'nowrap', fontWeight: i === v.slowest ? 700 : undefined}}>
                  {r.sincePrev === null ? '—' : secs(r.sincePrev)}
                </td>
                <td style={{whiteSpace: 'nowrap'}}>{secs(r.sinceStart)}</td>
                <td style={{whiteSpace: 'nowrap'}}>{r.flip ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint tight">
        ▶️ 用户点执行（零点）· ✍️ 签名后回传（首次上报）· ✅ 前端判定成交 · ❌ 前端判定失败 · ⏹️ 前端停下未拿到结论；
        加粗的「距上一步」是最长的一段。只列关键点：内部阶段的耗时并入下一行，重试与轮询合成一行。时刻为本机时钟，只含前端视角。
      </p>
    </Info>
  );
}
