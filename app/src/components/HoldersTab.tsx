"use client";

import Link from "next/link";
import { RefreshCw, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import useSWR from "swr";

import { ApiError } from "@/api/envelope";
import { listTokenFollowHolders, type FollowedHolderItem, type FollowedHolderPage } from "@/api/social-content";
import { fetchHolderPage, fetchTopTraders, MarketApiError } from "@/lib/market";
import { decimalSign, formatBaseUnitsExact, formatDecimalExact } from "@/lib/exact-decimal";
import { DASH, fmtAge, fmtInt, fmtPct, fmtUsd, num, shortAddr } from "@/lib/format";
import type { HolderItem, HolderPage } from "@/lib/types";
import { useSession } from "@/session/storage";

const LIMIT = 20;

type HolderSource = "smartx" | "smart-money" | "followed" | "on-chain";

const SOURCES: { id: HolderSource; label: string; note: string }[] = [
  { id: "smartx", label: "SmartX", note: "SmartX identities in the top-100 holder slice" },
  { id: "smart-money", label: "Smart Money", note: "Top traders · 1y realized PnL" },
  { id: "followed", label: "Followed", note: "People you follow who hold this token" },
  { id: "on-chain", label: "On-Chain", note: "Current balances · top 100 depth" },
];

function moneyString(value?: string): string {
  if (!value) return DASH;
  const formatted = formatDecimalExact(value, 2);
  if (formatted === DASH) return DASH;
  const sign = decimalSign(value);
  return `${sign === -1 ? "-$" : "$"}${formatted.replace(/^-/, "")}`;
}

function signedMoneyNumber(value: unknown): string {
  const amount = num(value);
  if (amount === undefined) return DASH;
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${sign}${fmtUsd(Math.abs(amount))}`;
}

function signedPercentString(value?: string): string {
  if (!value) return DASH;
  const formatted = formatDecimalExact(value, 2);
  if (formatted === DASH) return DASH;
  const sign = decimalSign(value);
  return `${sign === 1 ? "+" : sign === -1 ? "-" : ""}${formatted.replace(/^-/, "")}%`;
}

function addressTypeLabel(type?: number): string | undefined {
  if (type === 1) return "Wallet";
  if (type === 2) return "Pool";
  if (type === 3) return "Burn";
  return undefined;
}

function displayName(row: HolderItem): string {
  const identity = row.identity;
  return identity?.nickname || identity?.username || shortAddr(row.wallet_address, 6, 4);
}

function displayHandle(row: HolderItem): string | undefined {
  const identity = row.identity;
  if (identity?.username) return `@${identity.username}`;
  if (identity?.identifier) return "SmartX user";
  return undefined;
}

function Avatar({ src, label }: { src?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  const initial = label.trim().slice(0, 1).toUpperCase() || "•";
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[#514879] text-sm font-semibold text-white">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}

function HolderTableSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4 py-5">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-full bg-surface-2" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="h-3 w-28 animate-pulse rounded bg-surface-2" />
            <div className="h-3 w-40 animate-pulse rounded bg-surface-2" />
          </div>
          <div className="h-4 w-20 animate-pulse rounded bg-surface-2" />
        </div>
      ))}
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof MarketApiError && (error.code === 500097 || error.code === 500098)) return "Holder data is temporarily unavailable. Try again later.";
  if (error instanceof ApiError && error.code === 400000) return "Please sign in again to load this view.";
  if (error instanceof ApiError && error.code === 430114) return "Complete invite access before loading followed holders.";
  return "Could not load holder data right now.";
}

function ErrorNotice({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-sm text-down">{errorMessage(error)}</p>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:border-accent/60">
        <RefreshCw size={12} aria-hidden="true" /> Retry
      </button>
    </div>
  );
}

function HolderRow({ row, source }: { row: HolderItem; source: Exclude<HolderSource, "followed"> }) {
  const name = displayName(row);
  const platform = row.platform_holding;
  const isSmartX = source === "smartx";
  const value = isSmartX && platform?.status === 1 ? moneyString(platform.market_value_usd) : fmtUsd(row.token_amount_usd);
  const secondary = isSmartX
    ? platform?.status === 1
      ? signedPercentString(platform.pnl_percent)
      : platform?.status === 3
        ? "SmartX ledger unavailable"
        : row.token_amount_usd === undefined
          ? DASH
          : "On-chain balance"
    : source === "smart-money"
      ? signedMoneyNumber(row.total_pnl_usd)
      : fmtPct(row.percentage_of_total_supply, { sign: false });
  const secondaryClass = source === "on-chain" ? "text-muted" : secondary.startsWith("-") ? "text-down" : secondary.startsWith("+") ? "text-up" : "text-muted";
  const note = isSmartX && platform?.status === 1 && platform.avg_cost_usd
    ? `Avg. cost ${moneyString(platform.avg_cost_usd)}`
    : source === "smart-money"
      ? `Avg. buy ${fmtUsd(row.avg_buy_price_usd)}`
      : source === "on-chain"
        ? `Held since ${fmtAge(row.first_held_time)}`
        : row.token_amount
          ? `Holding ${formatDecimalExact(row.token_amount, 4)}`
          : "Holding amount unavailable";
  const typeLabel = source === "on-chain" ? addressTypeLabel(row.address_type) : undefined;
  const labels = source === "smart-money" ? (row.labels ?? []).slice(0, 2) : [];

  return (
    <article className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar src={row.identity?.avatar_url} label={name} />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-semibold text-foreground" title={name}>{name}</span>
            {typeLabel ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted">{typeLabel}</span> : null}
            {labels.map((label) => <span key={label} className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted">{label}</span>)}
          </div>
          <p className="truncate text-xs text-muted" title={row.wallet_address}>{displayHandle(row) ?? row.wallet_address ?? DASH}</p>
          <p className="truncate text-xs text-muted">{note}</p>
        </div>
      </div>
      <div className="flex min-w-20 flex-col items-end gap-1 text-right tabular">
        <span className="text-base font-semibold text-foreground" title={isSmartX && platform?.status === 1 ? "SmartX ledger market value" : "On-chain token value"}>{value}</span>
        <span className={`text-xs font-medium ${secondaryClass}`} title={source === "smart-money" ? "Total PnL · 1y" : source === "on-chain" ? "Share of total supply" : "SmartX PnL percent"}>{secondary}</span>
      </div>
    </article>
  );
}

function followedName(item: FollowedHolderItem): string {
  return item.remark || item.user.nickname || item.user.username || shortAddr(item.user.identifier, 6, 4);
}

function FollowedRow({ item, token }: { item: FollowedHolderItem; token?: FollowedHolderPage["token"] }) {
  const name = followedName(item);
  const shares = item.shares && token?.decimals !== undefined
    ? `${formatDecimalExact(formatBaseUnitsExact(item.shares, token.decimals), 4)} ${token.symbol ?? "tokens"}`
    : item.shares
      ? `${formatDecimalExact(item.shares, 4)} base units`
      : "Holding amount unavailable";
  const pnl = signedPercentString(item.pnlPercent);
  return (
    <article className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar src={item.user.avatarURL} label={name} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground" title={name}>{name}</span>
            {item.remark ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted">Remark</span> : null}
          </div>
          <p className="truncate text-xs text-muted">{item.user.username ? `@${item.user.username}` : item.user.identifier}</p>
          <p className="truncate text-xs text-muted">Held {shares} · Cost {moneyString(item.costUSD)}</p>
        </div>
      </div>
      <div className="flex min-w-20 flex-col items-end gap-1 text-right tabular">
        <span className="text-base font-semibold text-foreground">{moneyString(item.costUSD)}</span>
        <span className={`text-xs font-medium ${pnl.startsWith("-") ? "text-down" : pnl.startsWith("+") ? "text-up" : "text-muted"}`}>{pnl}</span>
      </div>
    </article>
  );
}

function FollowedHolders({ chain, address, bearer }: { chain: string; address: string; bearer: string }) {
  const [cursor, setCursor] = useState<string>();
  const [items, setItems] = useState<FollowedHolderItem[]>([]);
  const [token, setToken] = useState<FollowedHolderPage["token"]>();
  const { data, error, isLoading, mutate } = useSWR<FollowedHolderPage>(
    ["token-follow-holders", chain, address, bearer, cursor ?? ""],
    () => listTokenFollowHolders(bearer, chain, address, { cursor, limit: LIMIT }),
    { shouldRetryOnError: false, revalidateOnFocus: false },
  );

  useEffect(() => {
    if (!data) return;
    if (data.token) setToken(data.token);
    setItems((current) => {
      const seen = new Set<string>();
      return (cursor ? [...current, ...data.items] : data.items).filter((item) => {
        if (seen.has(item.user.identifier)) return false;
        seen.add(item.user.identifier);
        return true;
      });
    });
  }, [cursor, data]);

  if (isLoading && !data && items.length === 0) return <HolderTableSkeleton />;
  if (error && items.length === 0) return <ErrorNotice error={error} onRetry={() => void mutate()} />;
  if (items.length === 0) return <div className="flex min-h-32 items-center justify-center px-4 text-sm text-muted">No followed holders found.</div>;

  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 text-[11px] text-muted"><span>{fmtInt(data?.total ?? items.length)} followed holders</span><span>Cost / PnL</span></div>
      {items.map((item) => <FollowedRow key={item.user.identifier} item={item} token={token} />)}
      {data?.nextCursor ? <div className="flex justify-center border-t border-border px-4 py-3"><button type="button" onClick={() => setCursor(data.nextCursor)} disabled={isLoading} className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground disabled:opacity-50">{isLoading ? "Loading…" : "Load more"}</button></div> : null}
    </>
  );
}

export default function HoldersTab({ chain, address }: { chain: string; address: string }) {
  const session = useSession();
  const [source, setSource] = useState<HolderSource>("smartx");
  const tokenID = `${chain}:${address}`;
  const [pagination, setPagination] = useState({tokenID, offset: 0});
  const offset = pagination.tokenID === tokenID ? pagination.offset : 0;
  const sourceConfig = SOURCES.find((item) => item.id === source) ?? SOURCES[0];
  const marketKey = source === "followed" ? null : source === "smartx"
    ? ["smartx-holders", chain, address]
    : [source === "smart-money" ? "top-traders" : "on-chain-holders", chain, address, String(offset)];
  const { data, error, isLoading, mutate } = useSWR<HolderPage>(
    marketKey,
    () => source === "smart-money"
      ? fetchTopTraders(chain, address, { limit: LIMIT, offset })
      : fetchHolderPage(chain, address, { limit: source === "smartx" ? 100 : LIMIT, offset: source === "smartx" ? 0 : offset }),
    { shouldRetryOnError: false, revalidateOnFocus: false, refreshInterval: 0 },
  );

  useEffect(() => {
    if (pagination.tokenID !== tokenID) setPagination({tokenID, offset: 0});
  }, [pagination.tokenID, tokenID]);

  function selectSource(next: HolderSource) {
    setSource(next);
    setPagination({tokenID, offset: 0});
  }

  const visibleRows = source === "smartx" ? (data?.items ?? []).filter((row) => Boolean(row.identity?.identifier)) : data?.items ?? [];
  const hasNext = (source === "on-chain" || source === "smart-money") && (data?.items.length ?? 0) >= LIMIT && offset < 100 - LIMIT;
  const summary = source === "on-chain" ? `${fmtInt(data?.holders_count)} holders` : source === "smartx" ? `${fmtInt(visibleRows.length)} SmartX holders` : source === "smart-money" ? "Top traders" : "";
  const metricLabel = source === "on-chain" ? "Value / Share" : "Value / PnL";

  return (
    <section aria-label="Token holders" className="overflow-hidden">
      <div role="tablist" aria-label="Holder source" className="flex gap-2 overflow-x-auto px-4 py-3">
        {SOURCES.map((item) => <button key={item.id} type="button" role="tab" aria-selected={source === item.id} onClick={() => selectSource(item.id)} className={`shrink-0 rounded-full px-3 py-2 text-xs transition-colors ${source === item.id ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}>{item.label}</button>)}
      </div>
      <p className="px-4 pb-2 text-[11px] text-muted">{sourceConfig.note}</p>

      {source === "followed" ? (
        session ? <FollowedHolders key={`${chain}:${address}:${session.jwt}`} chain={chain} address={address} bearer={session.jwt} /> : <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 text-center"><UserRound size={18} className="text-muted" aria-hidden="true" /><p className="text-sm text-muted">Sign in to see holders you follow.</p><Link href="/login" className="text-xs text-accent hover:underline">Sign in</Link></div>
      ) : isLoading && !data ? (
        <HolderTableSkeleton />
      ) : error ? (
        <ErrorNotice error={error} onRetry={() => void mutate()} />
      ) : visibleRows.length === 0 ? (
        <div className="flex min-h-32 items-center justify-center px-4 text-sm text-muted">{source === "smartx" ? "No SmartX holders found in the current holder slice." : source === "smart-money" ? "No top traders found." : "No on-chain holders found."}</div>
      ) : (
        <>
          <div className="flex items-center justify-between px-4 py-2 text-[11px] text-muted"><span>{summary}</span><span>{metricLabel}</span></div>
          {visibleRows.map((row, index) => <HolderRow key={`${row.wallet_address ?? "holder"}-${index}`} row={row} source={source} />)}
          {hasNext ? <div className="flex items-center justify-between border-t border-border px-4 py-3"><span className="text-[11px] text-muted">{offset + 1}–{offset + visibleRows.length}</span><button type="button" onClick={() => setPagination((current) => ({tokenID, offset: current.offset + LIMIT}))} className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:border-accent/60">Next</button></div> : source === "on-chain" || source === "smart-money" ? <div className="border-t border-border px-4 py-3 text-[11px] text-muted">{offset + 1}–{offset + visibleRows.length}</div> : null}
        </>
      )}
    </section>
  );
}
