"use client";

import Link from "next/link";
import { RefreshCw, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { ApiError } from "@/api/envelope";
import { fetchTokenTradeBoard, type TokenTradeBoardItem, type TokenTradeBoardPage, type TokenTradeScope } from "@/api/token-trade-boards";
import { fetchOnChainTradeBoard, MarketApiError } from "@/lib/market";
import { decimalSign, formatDecimalExact, formatPriceExact } from "@/lib/exact-decimal";
import { DASH, fmtAge, fmtPrice, fmtUsd, shortAddr } from "@/lib/format";
import { useSession } from "@/session/storage";

const LIMIT = 50;

type TradeBoardTab = "smartx" | "smart-money" | "on-chain";

const BOARDS: { id: TradeBoardTab; label: string; note: string }[] = [
  { id: "smartx", label: "SmartX", note: "Confirmed trades from SmartX users" },
  { id: "smart-money", label: "Smart Money", note: "Trades from tracked smart-money accounts" },
  { id: "on-chain", label: "On-Chain", note: "Recent buy / sell events from the market source" },
];

const COVERAGE_LABELS: Record<string, string> = {
  gmgn_chain_unsupported: "GMGN does not cover this chain",
  gmgn_not_configured: "GMGN is not configured",
  gmgn_unavailable: "GMGN is temporarily unavailable",
};

function exactMoney(value: string | number | undefined): string {
  if (typeof value === "number") return fmtUsd(value);
  if (!value) return DASH;
  const formatted = formatDecimalExact(value, 2);
  if (formatted === DASH) return DASH;
  const sign = decimalSign(value);
  return `${sign === -1 ? "-$" : "$"}${formatted.replace(/^-/, "")}`;
}

function exactPrice(value: string | number | undefined): string {
  if (typeof value === "number") return fmtPrice(value);
  if (!value) return DASH;
  const formatted = formatPriceExact(value);
  if (formatted === DASH) return DASH;
  return `${decimalSign(value) === -1 ? "-$" : "$"}${formatted.replace(/^-/, "")}`;
}

function exactQuantity(value?: string): string {
  return value ? formatDecimalExact(value, 4) : DASH;
}

function actorName(row: TokenTradeBoardItem, board: TradeBoardTab): string {
  if (row.actor) return row.actor.name;
  if (board === "smartx") return row.user?.nickname || row.user?.username || shortAddr(row.actorID, 6, 4);
  if (board === "smart-money") return row.smartMoney?.displayName || row.smartMoney?.handle || `Smart Money · ${shortAddr(row.actorID, 6, 4)}`;
  return shortAddr(row.sender, 6, 4);
}

function actorSubline(row: TokenTradeBoardItem, board: TradeBoardTab): string {
  if (row.actor?.wallets.length) return row.actor.wallets.map((wallet) => wallet.address).join(' · ');
  if (board === "smartx") return row.user?.username ? `@${row.user.username}` : "SmartX user";
  if (board === "smart-money") {
    if (row.smartMoney?.handle) return `@${row.smartMoney.handle}`;
    return row.smartMoney?.chains?.length ? `Smart Money · ${row.smartMoney.chains.join(", ")}` : "Smart Money";
  }
  return row.sender ?? "On-chain sender";
}

function avatarURL(row: TokenTradeBoardItem, board: TradeBoardTab): string | undefined {
  if (row.actor) return row.actor.avatarURL;
  return board === "smartx" ? row.user?.avatarURL : board === "smart-money" ? row.smartMoney?.avatarURL : undefined;
}

function Avatar({ src, label }: { src?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  const initial = label.trim().slice(0, 1).toUpperCase() || "•";
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[#514879] text-sm font-semibold text-white">
      {src && !failed ? (
        // Runtime profile artwork can come from the backend's selected source.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}

function sideLabel(side: string): string {
  return side === "buy" ? "BUY" : "SELL";
}

function sideClass(side: string): string {
  return side === "buy" ? "bg-up/10 text-up" : "bg-down/10 text-down";
}

function txHref(chain: string, hash: string): string | undefined {
  const encoded = encodeURIComponent(hash);
  if (chain === "solana") return `https://solscan.io/tx/${encoded}`;
  if (chain === "base") return `https://basescan.org/tx/${encoded}`;
  if (chain === "bsc") return `https://bscscan.com/tx/${encoded}`;
  if (chain === "ethereum") return `https://etherscan.io/tx/${encoded}`;
  if (chain === "robinhood") return `https://robinhoodchain.blockscout.com/tx/${encoded}`;
  if (chain === "arc") return `https://explorer.arc.io/tx/${encoded}`;
  return undefined;
}

function TradeRow({ row, board, chain }: { row: TokenTradeBoardItem; board: TradeBoardTab; chain: string }) {
  const name = actorName(row, board);
  const txChain = row.txChain || chain;
  const tx = row.txHash ? txHref(txChain, row.txHash) : undefined;
  const marketCap = board === "on-chain" ? row.marketCapUSDEstimated : row.marketCapUSDAtTrade;
  const marketCapLabel = board === "on-chain" ? "Est. MC" : "MC at trade";
  return (
    <article className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border px-4 py-3" aria-label={`${sideLabel(row.side)} trade by ${name}`}>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar src={avatarURL(row, board)} label={name} />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground" title={name}>{name}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${sideClass(row.side)}`}>{sideLabel(row.side)}</span>
            {row.actor?.following ? <span className="text-xs text-accent">{row.actor.followingPrimary ? 'Following' : row.actor.followedSubjects.some((id) => id.type === 'wallet') ? 'Following wallet' : 'Following related account'}</span> : null}
          </div>
          <p className="truncate text-xs text-muted" title={actorSubline(row, board)}>{actorSubline(row, board)}</p>
          <p className="truncate text-xs text-muted">
            {exactQuantity(row.tokenAmount)} tokens · {exactPrice(row.executionPriceUSD)}
            {tx ? <><span aria-hidden="true"> · </span><a href={tx} target="_blank" rel="noreferrer noopener" className="hover:text-foreground hover:underline">Tx</a></> : null}
          </p>
        </div>
      </div>
      <div className="flex min-w-24 flex-col items-end gap-1 text-right tabular">
        <span className="text-base font-semibold text-foreground" title={row.usd === undefined ? "Trade value unavailable" : "Trade value (USD)"}>{exactMoney(row.usd)}</span>
        <span className="text-xs text-muted" title={marketCap === undefined ? "Market cap unavailable" : marketCapLabel}>{marketCap === undefined ? `${marketCapLabel} ${DASH}` : `${marketCapLabel} ${exactMoney(marketCap)}`}</span>
        <time className="text-[11px] text-muted" dateTime={row.occurredAt > 0 ? new Date(row.occurredAt * 1000).toISOString() : undefined}>{row.occurredAt > 0 ? fmtAge(row.occurredAt * 1000) : DASH}</time>
      </div>
    </article>
  );
}

function ErrorNotice({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof ApiError && error.code === 400000
    ? "Your session expired. Sign in again to load this view."
    : error instanceof ApiError && error.code === 430114
      ? "Complete invite access before loading followed trades."
      : error instanceof ApiError && (error.code === 500097 || error.code === 500098 || error.code === 500100)
        ? "Trade data is temporarily unavailable."
        : error instanceof MarketApiError && error.code === 500097
          ? "Trade data is temporarily unavailable."
          : "Could not load trades right now.";
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-sm text-down">{message}</p>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:border-accent/60"><RefreshCw size={12} aria-hidden="true" /> Retry</button>
    </div>
  );
}

function CoverageNotice({ coverage }: { coverage: string[] }) {
  if (coverage.length === 0) return null;
  const missing = coverage.map((item) => COVERAGE_LABELS[item] ?? "Some data source is unavailable");
  return <div role="status" className="mx-4 mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">Partial data coverage: {missing.join(" · ")}. Results below are not a complete smart-money history.</div>;
}

function LoadingRows() {
  return <div className="flex flex-col gap-3 px-4 py-5">{Array.from({length: 6}).map((_, index) => <div key={index} className="flex items-center gap-3"><div className="h-10 w-10 animate-pulse rounded-full bg-surface-2" /><div className="flex min-w-0 flex-1 flex-col gap-2"><div className="h-3 w-32 animate-pulse rounded bg-surface-2" /><div className="h-3 w-48 animate-pulse rounded bg-surface-2" /></div><div className="h-4 w-20 animate-pulse rounded bg-surface-2" /></div>)}</div>;
}

export default function TradesTab({ chain, address }: { chain: string; address: string }) {
  const session = useSession();
  const [board, setBoard] = useState<TradeBoardTab>("smartx");
  const [scope, setScope] = useState<TokenTradeScope>("all");
  return <TradeBoardView key={JSON.stringify([chain, address, board, scope, session?.jwt ?? "public"])}
    chain={chain} address={address} board={board} scope={scope} session={session} setBoard={setBoard} setScope={setScope} />;
}

function TradeBoardView({chain, address, board, scope, session, setBoard, setScope}: {
  chain: string; address: string; board: TradeBoardTab; scope: TokenTradeScope;
  session: ReturnType<typeof useSession>; setBoard: (value: TradeBoardTab) => void; setScope: (value: TokenTradeScope) => void;
}) {
  const [extraPages, setExtraPages] = useState<TokenTradeBoardPage[]>([]);
  const [pinnedFirst, setPinnedFirst] = useState<TokenTradeBoardPage>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>();
  const mounted = useRef(true);
  const requests = useRef(new Set<AbortController>());
  const moreRequest = useRef(0);
  const inFlight = useRef(false);
  const consumed = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    const active = requests.current;
    return () => {
      mounted.current = false;
      // React Strict Mode may immediately remount the same effect.
      queueMicrotask(() => { if (!mounted.current) active.forEach(controller => controller.abort()); });
    };
  }, []);
  const fetchPage = async (cursor?: string) => {
    if (board === "on-chain") return fetchOnChainTradeBoard(chain, address, LIMIT);
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      return await fetchTokenTradeBoard(board === "smartx" ? "platform" : "smart-money", chain, address,
        {scope, limit: LIMIT, bearer: session?.jwt, signal: controller.signal, ...(cursor ? {cursor} : {})});
    } finally { requests.current.delete(controller); }
  };
  const needsLogin = board !== "on-chain" && scope === "following" && !session;
  const key = needsLogin ? null : ["token-trade-board", chain, address, board, scope, board === "on-chain" ? "" : session?.jwt ?? "public"];
  const { data, error, isLoading, isValidating, mutate } = useSWR<TokenTradeBoardPage>(
    key,
    () => fetchPage(),
    { refreshInterval: pinnedFirst ? 0 : 30_000, revalidateOnFocus: !pinnedFirst, dedupingInterval: 10_000, shouldRetryOnError: false },
  );

  const first = pinnedFirst ?? data;
  const pages = first ? [first, ...extraPages] : [];
  const last = pages.at(-1);
  const hasMore = board !== "on-chain" && last?.hasMore === true;
  const loadMore = async () => {
    if (inFlight.current || isValidating || !first || !hasMore || !last?.nextCursor) return;
    const cursor = last.nextCursor;
    const request = ++moreRequest.current;
    inFlight.current = true;
    setPinnedFirst(first);
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const page = await fetchPage(cursor);
      if (!mounted.current || request !== moreRequest.current) return;
      if (page.hasMore && (!page.nextCursor || page.nextCursor === cursor || consumed.current.has(page.nextCursor))) {
        throw new Error("Trade pagination did not advance");
      }
      consumed.current.add(cursor);
      setExtraPages(previous => [...previous, page]);
    } catch (failure) {
      if (mounted.current && request === moreRequest.current) setMoreError(failure);
    } finally {
      if (mounted.current && request === moreRequest.current) { inFlight.current = false; setLoadingMore(false); }
    }
  };
  const refresh = () => {
    moreRequest.current++;
    requests.current.forEach(controller => controller.abort());
    inFlight.current = false;
    consumed.current.clear();
    setPinnedFirst(undefined); setExtraPages([]); setLoadingMore(false); setMoreError(undefined);
    void mutate();
  };

  const boardNote = BOARDS.find((item) => item.id === board)?.note ?? "";
  const seen = new Set<string>();
  const items = pages.flatMap(page => page.items).filter(row => {
    const id = row.recordID ? `record:${row.recordID}:${row.actorID ?? ""}`
      : row.txHash ? JSON.stringify([row.txChain ?? chain, row.actorType, row.actorID ?? row.sender, row.txHash, row.side, row.occurredAt]) : undefined;
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id); return true;
  });
  const coverage = [...new Set(pages.flatMap(page => page.coverage))];
  const emptyText = board === "on-chain" ? "No on-chain trades found." : scope === "following" ? "No trades from people you follow." : board === "smartx" ? "No SmartX trades found." : "No smart-money trades found in the available sources.";

  return (
    <section aria-label="Token trades" className="overflow-hidden">
      <div role="tablist" aria-label="Trade source" className="flex gap-2 overflow-x-auto px-4 py-3">
        {BOARDS.map((item) => <button key={item.id} id={`trade-board-tab-${item.id}`} type="button" role="tab" aria-controls={`trade-board-panel-${item.id}`} aria-selected={board === item.id} onClick={() => setBoard(item.id)} className={`shrink-0 rounded-full px-3 py-2 text-xs transition-colors ${board === item.id ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}>{item.label}</button>)}
      </div>
      <div id={`trade-board-panel-${board}`} role="tabpanel" aria-labelledby={`trade-board-tab-${board}`} tabIndex={0}>
        {board !== "on-chain" ? <div role="group" aria-label="Trade scope" className="flex gap-2 px-4 pb-2"><button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")} className={`rounded-full px-3 py-1.5 text-xs ${scope === "all" ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}>All</button><button type="button" aria-pressed={scope === "following"} onClick={() => setScope("following")} className={`rounded-full px-3 py-1.5 text-xs ${scope === "following" ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}>Following</button></div> : null}
        <div className="flex items-center justify-between px-4 pb-2 text-[11px] text-muted"><p>{boardNote}{board === "on-chain" ? " · latest 50" : ""}</p>
          {!needsLogin && <button type="button" onClick={refresh} className="text-accent hover:underline">Refresh</button>}</div>

        {needsLogin ? <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 text-center"><UserRound size={18} className="text-muted" aria-hidden="true" /><p className="text-sm text-muted">Sign in to see trades from people you follow.</p><Link href="/login" className="text-xs text-accent hover:underline">Sign in</Link></div> : isLoading && !first ? <LoadingRows /> : error && !first ? <ErrorNotice error={error} onRetry={refresh} /> : <>
          <CoverageNotice coverage={board === "smart-money" ? coverage : []} />
          <div className="flex items-center justify-between px-4 py-2 text-[11px] text-muted"><span>{items.length ? `${items.length} trades` : coverage.length ? "Partial source result" : ""}</span><span>USD / time</span></div>
          {items.length > 0 ? items.map((row, index) => <TradeRow key={`${row.recordID ?? row.txHash ?? "trade"}-${row.occurredAt}-${index}`} row={row} board={board} chain={chain} />) : <div className="flex min-h-32 items-center justify-center px-4 text-sm text-muted">{hasMore ? "More history is available." : coverage.length ? "No trades from the available sources." : emptyText}</div>}
          {moreError ? <ErrorNotice error={moreError} onRetry={() => void loadMore()} /> : null}
          {error && first ? <ErrorNotice error={error} onRetry={refresh} /> : null}
          {hasMore && <div className="px-4 py-3"><button type="button" disabled={loadingMore || isValidating} onClick={() => void loadMore()} className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50">{loadingMore ? "Loading…" : "Load more"}</button></div>}
          {!hasMore && items.length > 0 && board !== "on-chain" && <p className="px-4 py-3 text-xs text-muted">End of available history</p>}
        </>}
      </div>
    </section>
  );
}
