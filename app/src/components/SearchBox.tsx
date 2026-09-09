"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/api/envelope";
import { fetchSearch } from "@/api/search";
import {
  followTarget,
  getRelations,
  unfollowTarget,
  type SocialTargetType,
} from "@/api/social";
import { clearSite, useSession } from "@/session/storage";
import type { SearchAccountEntry, SearchData, SearchScope, SearchSmartMoney } from "@/lib/types";
import { chainLabel, fmtPrice, fmtCompact, fmtPct, shortAddr } from "@/lib/format";

/**
 * 顶栏搜索（GET /v1/search）：产品仍展示 Token / People 两个范围，后端分别使用
 * TOKEN / ACCOUNT。ACCOUNT 同时返回平台用户和聪明钱，关注态另走关系批查。
 */

type Tab = Extract<SearchScope, "SEARCH_SCOPE_TOKEN" | "SEARCH_SCOPE_ACCOUNT">;

interface ScopeState {
  data: SearchData | null;
  /** data 实际所属的查询词；输入防抖期间仍指向旧结果。 */
  query?: string;
  unavailable: boolean;
  rateLimited: boolean;
  failed: boolean;
  loading: boolean;
  loadingMore: boolean;
}

type RelationView = {
  following: boolean;
  remark?: string;
  chains?: string[];
};

type Target = { type: SocialTargetType; id: string };

const EMPTY: ScopeState = {
  data: null,
  unavailable: false,
  rateLimited: false,
  failed: false,
  loading: false,
  loadingMore: false,
};

const relationKey = (target: Target) => `${target.type}:${target.id}`;

function accountTarget(entry: SearchAccountEntry): Target {
  return entry.target_type === "user"
    ? { type: "user", id: entry.user.identifier }
    : { type: "smart_money", id: entry.smart_money.address };
}

export function SearchBox() {
  const session = useSession();
  const [phrase, setPhrase] = useState("");
  const [tab, setTab] = useState<Tab>("SEARCH_SCOPE_TOKEN");
  const [open, setOpen] = useState(false);
  const [tokenState, setTokenState] = useState<ScopeState>(EMPTY);
  const [accountState, setAccountState] = useState<ScopeState>(EMPTY);
  const [relations, setRelations] = useState<Record<string, RelationView>>({});
  const [relationsLoading, setRelationsLoading] = useState(false);
  const [relationsFailed, setRelationsFailed] = useState(false);
  const [pendingTargets, setPendingTargets] = useState<Record<string, boolean>>({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [relationsRetryNonce, setRelationsRetryNonce] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const tokenReqIdRef = useRef(0);
  const accountReqIdRef = useRef(0);
  const relationsGenerationRef = useRef(0);
  const relationsContextRef = useRef<string | null>(null);
  const queriedRelationsRef = useRef<Set<string>>(new Set());
  const pendingRelationRequestsRef = useRef(0);

  const q = phrase.trim();
  const accounts = accountState.data?.accounts;

  // 防抖 >=250ms；两个范围独立请求、独立失败，并在更新时保留旧结果。
  useEffect(() => {
    if (!q) {
      tokenReqIdRef.current += 1;
      accountReqIdRef.current += 1;
      setTokenState(EMPTY);
      setAccountState(EMPTY);
      setActionMessage(null);
      return;
    }
    const tokenReqId = ++tokenReqIdRef.current;
    const accountReqId = ++accountReqIdRef.current;
    setOpen(true);
    const timer = setTimeout(() => {
      setTokenState((state) => ({
        ...state,
        unavailable: false,
        rateLimited: false,
        failed: false,
        loading: true,
        loadingMore: false,
      }));
      setAccountState((state) => ({
        ...state,
        unavailable: false,
        rateLimited: false,
        failed: false,
        loading: true,
        loadingMore: false,
      }));

      fetchSearch("SEARCH_SCOPE_TOKEN", q, { limit: 10 })
        .then((data) => {
          if (tokenReqIdRef.current !== tokenReqId) return;
          setTokenState({ ...EMPTY, data, query: q });
        })
        .catch(handleSearchError(tokenReqIdRef, tokenReqId, setTokenState));

      fetchSearch("SEARCH_SCOPE_ACCOUNT", q, { limit: 10 })
        .then((data) => {
          if (accountReqIdRef.current !== accountReqId) return;
          setAccountState({ ...EMPTY, data, query: q });
        })
        .catch(handleSearchError(accountReqIdRef, accountReqId, setAccountState));
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  function handleSearchError(
    requestRef: { current: number },
    requestID: number,
    setState: typeof setTokenState,
  ) {
    return (error: unknown) => {
      if (requestRef.current !== requestID) return;
      setState((state) => ({
        ...state,
        loading: false,
        loadingMore: false,
        unavailable: error instanceof ApiError && error.code === 500097,
        rateLimited: error instanceof ApiError && error.code === 420000,
        failed: !(error instanceof ApiError) || (error.code !== 500097 && error.code !== 420000),
      }));
    };
  }

  function retryActiveScope() {
    if (tab === "SEARCH_SCOPE_TOKEN") {
      const requestID = ++tokenReqIdRef.current;
      setTokenState((state) => ({ ...state, loading: true, unavailable: false, rateLimited: false, failed: false }));
      fetchSearch("SEARCH_SCOPE_TOKEN", q, { limit: 10 })
        .then((data) => {
          if (tokenReqIdRef.current === requestID) setTokenState({ ...EMPTY, data, query: q });
        })
        .catch(handleSearchError(tokenReqIdRef, requestID, setTokenState));
      return;
    }
    const requestID = ++accountReqIdRef.current;
    setAccountState((state) => ({ ...state, loading: true, unavailable: false, rateLimited: false, failed: false }));
    fetchSearch("SEARCH_SCOPE_ACCOUNT", q, { limit: 10 })
      .then((data) => {
        if (accountReqIdRef.current === requestID) setAccountState({ ...EMPTY, data, query: q });
      })
      .catch(handleSearchError(accountReqIdRef, requestID, setAccountState));
  }

  // ACCOUNT 的 cursor 只翻用户侧；续页不会重复返回聪明钱条目。
  function loadMoreAccounts() {
    const cursor = accountState.data?.next_cursor;
    if (!cursor || accountState.loadingMore) return;
    const requestID = accountReqIdRef.current;
    setAccountState((state) => ({ ...state, loadingMore: true }));
    fetchSearch("SEARCH_SCOPE_ACCOUNT", q, { limit: 10, cursor })
      .then((data) => {
        if (accountReqIdRef.current !== requestID) return;
        setAccountState((state) => ({
          ...state,
          loadingMore: false,
          data: {
            scope: 4,
            accounts: [...(state.data?.accounts ?? []), ...(data.accounts ?? [])],
            next_cursor: data.next_cursor,
          },
        }));
      })
      .catch((error: unknown) => {
        if (accountReqIdRef.current !== requestID) return;
        if (error instanceof ApiError && error.code === 100103) {
          const refreshID = ++accountReqIdRef.current;
          fetchSearch("SEARCH_SCOPE_ACCOUNT", q, { limit: 10 })
            .then((data) => {
              if (accountReqIdRef.current === refreshID) setAccountState({ ...EMPTY, data, query: q });
            })
            .catch(handleSearchError(accountReqIdRef, refreshID, setAccountState));
          return;
        }
        handleSearchError(accountReqIdRef, requestID, setAccountState)(error);
      });
  }

  // 搜索回包不含 viewer 字段。登录后按 target_type 分桶，一次批查关注态与备注。
  useEffect(() => {
    const jwt = session?.jwt ?? null;
    const context = jwt && accountState.query ? `${jwt}\u0000${accountState.query}` : null;
    if (context !== relationsContextRef.current) {
      relationsContextRef.current = context;
      relationsGenerationRef.current += 1;
      queriedRelationsRef.current = new Set();
      pendingRelationRequestsRef.current = 0;
      setRelations({});
      setRelationsLoading(false);
      setRelationsFailed(false);
    }
    if (!jwt || !accounts?.length) {
      return;
    }

    const missing = accounts.filter((entry) => !queriedRelationsRef.current.has(relationKey(accountTarget(entry))));
    if (missing.length === 0) return;
    const userIdentifiers = [...new Set(missing.flatMap((entry) => entry.target_type === "user" ? [entry.user.identifier] : []))];
    const addresses = [...new Set(missing.flatMap((entry) => entry.target_type === "smart_money" ? [entry.smart_money.address] : []))];
    const missingKeys = missing.map((entry) => relationKey(accountTarget(entry)));
    missingKeys.forEach((key) => queriedRelationsRef.current.add(key));

    // relations/batch 两个桶各自上限 100；长分页结果分批查，绝不能截断后把
    // 未查询目标误画成“未关注”。同一批里 user/address 可以各带 100 条。
    const batches = Array.from(
      { length: Math.max(Math.ceil(userIdentifiers.length / 100), Math.ceil(addresses.length / 100)) },
      (_, index) => ({
        userIdentifiers: userIdentifiers.slice(index * 100, (index + 1) * 100),
        addresses: addresses.slice(index * 100, (index + 1) * 100),
      }),
    );

    const generation = relationsGenerationRef.current;
    pendingRelationRequestsRef.current += 1;
    setRelationsLoading(true);
    setRelationsFailed(false);
    Promise.all(batches.map((batch) => getRelations(jwt, batch)))
      .then((responses) => {
        if (relationsGenerationRef.current !== generation) return;
        const next: Record<string, RelationView> = {};
        let responseIncomplete = false;
        responses.forEach((response, batchIndex) => {
          const batch = batches[batchIndex];
          batch.userIdentifiers.forEach((identifier, index) => {
            const relation = response.data.users?.[index];
            if (!relation) {
              queriedRelationsRef.current.delete(relationKey({ type: "user", id: identifier }));
              responseIncomplete = true;
              return;
            }
            next[relationKey({ type: "user", id: identifier })] = {
              following: !!relation.following,
              remark: relation.remark,
            };
          });
          batch.addresses.forEach((address, index) => {
            const relation = response.data.smart_money?.[index];
            if (!relation) {
              queriedRelationsRef.current.delete(relationKey({ type: "smart_money", id: address }));
              responseIncomplete = true;
              return;
            }
            next[relationKey({ type: "smart_money", id: address })] = {
              following: !!relation.following,
              remark: relation.remark,
              chains: relation.chains,
            };
          });
        });
        setRelations((current) => ({ ...current, ...next }));
        if (responseIncomplete) setRelationsFailed(true);
      })
      .catch((error: unknown) => {
        if (relationsGenerationRef.current !== generation) return;
        missingKeys.forEach((key) => queriedRelationsRef.current.delete(key));
        if (error instanceof ApiError && error.code === 400000) clearSite();
        if (error instanceof ApiError && error.code === 430114) {
          setActionMessage("Complete invite access before using social actions.");
        }
        setRelationsFailed(true);
      })
      .finally(() => {
        if (relationsGenerationRef.current !== generation) return;
        pendingRelationRequestsRef.current = Math.max(0, pendingRelationRequestsRef.current - 1);
        setRelationsLoading(pendingRelationRequestsRef.current > 0);
      });
  }, [accountState.query, accounts, relationsRetryNonce, session?.jwt]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function goToken(chain: string, address: string) {
    setOpen(false);
    // 路径式详情页在静态导出下无客户端路由，走整页加载经 _redirects 重写
    window.location.assign(`/token/${chain}/${address}`);
  }

  function goSmartMoney(account: SearchSmartMoney) {
    const chain = primarySmartMoneyChain(account);
    if (!chain) {
      setActionMessage("This account has no available chain profile.");
      return;
    }
    setOpen(false);
    window.location.assign(`/smart-money/${encodeURIComponent(chain)}/${encodeURIComponent(account.address)}`);
  }

  async function toggleFollow(entry: SearchAccountEntry) {
    const target = accountTarget(entry);
    const key = relationKey(target);
    if (!session?.jwt) {
      setActionMessage("Sign in to follow accounts.");
      return;
    }
    if (target.type === "user" && target.id === session.user?.identifier) return;
    const current = relations[key]?.following;
    if (current === undefined || pendingTargets[key]) return;

    setActionMessage(null);
    setPendingTargets((pending) => ({ ...pending, [key]: true }));
    setRelations((value) => ({ ...value, [key]: { ...value[key], following: !current } }));
    try {
      const response = current
        ? await unfollowTarget(session.jwt, target.type, target.id)
        : await followTarget(session.jwt, target.type, target.id);
      setRelations((value) => ({
        ...value,
        [key]: {
          ...value[key],
          following: !!response.data.following,
          chains: response.data.chains ?? value[key]?.chains,
        },
      }));
    } catch (error) {
      setRelations((value) => ({ ...value, [key]: { ...value[key], following: current } }));
      if (error instanceof ApiError) {
        if (error.code === 400000) {
          clearSite();
          setActionMessage("Session expired. Sign in again to continue.");
        } else if (error.code === 430100) {
          setActionMessage("You cannot follow yourself.");
        } else if (error.code === 200102 || error.code === 200104) {
          setActionMessage("This account is no longer available to follow.");
        } else if (error.code === 500097) {
          setActionMessage("Follow service is temporarily unavailable. Try again.");
        } else if (error.code === 430114) {
          setActionMessage("Complete invite access before following accounts.");
        } else {
                setActionMessage("Follow could not be updated. Try again.");
        }
      } else {
        setActionMessage("Follow could not be updated. Try again.");
      }
    } finally {
      setPendingTargets((pending) => ({ ...pending, [key]: false }));
    }
  }

  const state = tab === "SEARCH_SCOPE_TOKEN" ? tokenState : accountState;
  const showDropdown = open && q !== "";
  const stateFailed = state.unavailable || state.rateLimited || state.failed;

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <input
        value={phrase}
        onChange={(event) => {
          setPhrase(event.target.value);
          if (event.target.value.trim()) setOpen(true);
        }}
        onFocus={() => q && setOpen(true)}
        placeholder="Search tokens or people…"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent/60"
      />
      {showDropdown && (
        <div className="absolute z-20 mt-1 max-h-[30rem] w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-border bg-surface px-2 pt-1.5">
            {(
              [
                ["SEARCH_SCOPE_TOKEN", "Tokens"],
                ["SEARCH_SCOPE_ACCOUNT", "People"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === id ? "border-b-2 border-accent text-foreground" : "border-b-2 border-transparent text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
            {state.loading && <span className="ml-auto pr-1 text-[10px] text-muted">Updating…</span>}
          </div>

          {(state.unavailable || state.rateLimited || state.failed) && (
            <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-xs text-muted">
              <span>
                {state.unavailable
                  ? "This search range is temporarily unavailable."
                  : state.rateLimited
                    ? "Search is busy. Try again in a moment."
                    : "Search failed. Your query has been kept."}
              </span>
              <button type="button" onClick={retryActiveScope} className="text-accent hover:underline">
                Retry
              </button>
            </div>
          )}

          {(!stateFailed || state.data) && (
            tab === "SEARCH_SCOPE_TOKEN" ? (
              <TokenResults data={tokenState.data} loading={tokenState.loading} onGo={goToken} />
            ) : (
              <AccountResults
                data={accountState.data}
                loading={accountState.loading}
                loadingMore={accountState.loadingMore}
                relations={relations}
                relationsLoading={relationsLoading}
                relationsFailed={relationsFailed}
                pendingTargets={pendingTargets}
                viewerIdentifier={session?.user?.identifier}
                signedIn={!!session}
                onRelationsRetry={() => setRelationsRetryNonce((value) => value + 1)}
                onOpenSmartMoney={goSmartMoney}
                onToggle={toggleFollow}
                onLoadMore={loadMoreAccounts}
              />
            )
          )}
          {actionMessage && <div className="border-t border-border/50 px-3 py-2 text-xs text-muted">{actionMessage}</div>}
        </div>
      )}
    </div>
  );
}

function TokenResults({
  data,
  loading,
  onGo,
}: {
  data: SearchData | null;
  loading: boolean;
  onGo: (chain: string, address: string) => void;
}) {
  const tokens = data?.tokens ?? [];
  if (tokens.length === 0) {
    return <div className="px-3 py-3 text-sm text-muted">{loading ? "Searching tokens…" : "No tokens found."}</div>;
  }
  return (
    <>
      {tokens.map((result) => (
        <button
          key={`${result.chain}:${result.address}`}
          type="button"
          onClick={() => onGo(result.chain, result.address)}
          className="flex w-full items-center justify-between gap-3 border-b border-border/50 px-3 py-2 text-left last:border-0 hover:bg-surface-2"
        >
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-sm font-medium text-foreground">
              {result.symbol ?? result.address.slice(0, 8)}
              <span className="ml-1.5 text-[10px] font-normal text-muted">
                {chainLabel(result.chain)} · {shortAddr(result.address, 6, 4)}
              </span>
            </span>
            <span className="truncate text-xs text-muted">{result.name ?? result.address}</span>
          </div>
          <div className="shrink-0 text-right">
            {result.market ? (
              <>
                <div className="text-sm tabular text-foreground">{fmtPrice(result.market.price)}</div>
                <div className="text-[11px] tabular text-muted">
                  MC {fmtCompact(result.market.market_cap)}
                  {result.market.price_change_24h !== undefined && (
                    <span className={result.market.price_change_24h >= 0 ? " text-up" : " text-down"}>
                      {" "}
                      {fmtPct(result.market.price_change_24h)}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <span className="text-xs text-muted">No market data</span>
            )}
          </div>
        </button>
      ))}
    </>
  );
}

function AccountResults({
  data,
  loading,
  loadingMore,
  relations,
  relationsLoading,
  relationsFailed,
  pendingTargets,
  viewerIdentifier,
  signedIn,
  onRelationsRetry,
  onOpenSmartMoney,
  onToggle,
  onLoadMore,
}: {
  data: SearchData | null;
  loading: boolean;
  loadingMore: boolean;
  relations: Record<string, RelationView>;
  relationsLoading: boolean;
  relationsFailed: boolean;
  pendingTargets: Record<string, boolean>;
  viewerIdentifier?: string;
  signedIn: boolean;
  onRelationsRetry: () => void;
  onOpenSmartMoney: (account: SearchSmartMoney) => void;
  onToggle: (entry: SearchAccountEntry) => void;
  onLoadMore: () => void;
}) {
  const accounts = data?.accounts ?? [];
  if (accounts.length === 0) {
    return <div className="px-3 py-3 text-sm text-muted">{loading ? "Searching people…" : "No people found."}</div>;
  }
  return (
    <>
      {relationsFailed && signedIn && (
        <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-xs text-muted">
          <span>Follow status is temporarily unavailable.</span>
          <button type="button" onClick={onRelationsRetry} className="text-accent hover:underline">Retry</button>
        </div>
      )}
      {accounts.map((entry) => {
        const target = accountTarget(entry);
        const key = relationKey(target);
        const relation = relations[key];
        const isSelf = target.type === "user" && target.id === viewerIdentifier;
        return (
          <div key={key} className="flex w-full items-center justify-between gap-3 border-b border-border/50 px-3 py-2 last:border-0">
            {entry.target_type === "user" ? (
              <UserIdentity entry={entry} remark={relation?.remark} />
            ) : (
              <SmartMoneyIdentity entry={entry} remark={relation?.remark} onOpen={() => onOpenSmartMoney(entry.smart_money)} />
            )}
            <FollowButton
              isSelf={isSelf}
              signedIn={signedIn}
              loading={relationsLoading && relation === undefined}
              unavailable={signedIn && relation === undefined && !relationsLoading}
              pending={!!pendingTargets[key]}
              following={relation?.following}
              onClick={() => onToggle(entry)}
            />
          </div>
        );
      })}
      {data?.next_cursor && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="w-full px-3 py-2 text-center text-xs text-muted hover:text-foreground disabled:opacity-50"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </>
  );
}

function UserIdentity({ entry, remark }: { entry: Extract<SearchAccountEntry, { target_type: "user" }>; remark?: string }) {
  const person = entry.user;
  const displayName = remark ?? person.nickname ?? person.username ?? shortAddr(person.identifier, 6, 4);
  return (
    <div className="flex min-w-0 items-center gap-2">
      {person.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote hosts are not an image optimization allowlist.
        <img src={person.avatar_url} alt={displayName} className="h-7 w-7 rounded-full bg-surface-2 object-cover" />
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-[10px] text-muted">
          {displayName.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
        <span className="truncate text-xs text-muted">
          {person.username ? `@${person.username}` : shortAddr(person.identifier, 6, 4)}
          {remark && person.nickname ? ` · ${person.nickname}` : ""}
        </span>
      </div>
    </div>
  );
}

function SmartMoneyIdentity({
  entry,
  remark,
  onOpen,
}: {
  entry: Extract<SearchAccountEntry, { target_type: "smart_money" }>;
  remark?: string;
  onOpen: () => void;
}) {
  const account = entry.smart_money;
  return (
    <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-2 text-left hover:opacity-80">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[9px] font-semibold text-accent">SM</div>
      <div className="flex min-w-0 flex-col gap-0.5 leading-tight">
        <span className="truncate text-sm font-medium text-foreground">{remark ?? shortAddr(account.address, 7, 5)}</span>
        <span className="truncate text-[10px] text-muted">{account.chains.map((item) => formatChainProfit(item.chain, item.total_profit, item.snapshot_at)).join(" · ") || "No chain data"}</span>
      </div>
    </button>
  );
}

function primarySmartMoneyChain(account: SearchSmartMoney): string | undefined {
  return account.chains.reduce<(typeof account.chains)[number] | undefined>((best, item) => {
    if (!best) return item;
    const profit = item.total_profit === undefined ? Number.NEGATIVE_INFINITY : Number(item.total_profit);
    const bestProfit = best.total_profit === undefined ? Number.NEGATIVE_INFINITY : Number(best.total_profit);
    return Number.isFinite(profit) && (!Number.isFinite(bestProfit) || profit > bestProfit) ? item : best;
  }, undefined)?.chain;
}

function formatChainProfit(chain: string, totalProfit?: string, snapshotAt?: number) {
  if (!snapshotAt || totalProfit === undefined) return `${chainLabel(chain)} —`;
  const value = Number(totalProfit);
  if (!Number.isFinite(value)) return `${chainLabel(chain)} —`;
  return `${chainLabel(chain)} ${value >= 0 ? "+" : "-"}$${fmtCompact(Math.abs(value))}`;
}

function FollowButton({
  isSelf,
  signedIn,
  loading,
  unavailable,
  pending,
  following,
  onClick,
}: {
  isSelf: boolean;
  signedIn: boolean;
  loading: boolean;
  unavailable: boolean;
  pending: boolean;
  following?: boolean;
  onClick: () => void;
}) {
  if (isSelf) return <span className="rounded bg-accent/10 px-2 py-1 text-[10px] text-accent">You</span>;
  const disabled = pending || loading || unavailable;
  const label = pending || loading ? "…" : unavailable ? "—" : following ? "Following" : "Follow";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={!signedIn ? "Sign in to follow" : unavailable ? "Follow status unavailable" : undefined}
      className={`shrink-0 rounded px-2 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        following ? "bg-surface-2 text-muted hover:text-foreground" : "border border-border text-foreground hover:border-accent/60"
      }`}
    >
      {label}
    </button>
  );
}
