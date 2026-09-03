"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSearch, MarketApiError } from "@/lib/market";
import type { SearchData, SearchPerson, SearchScope } from "@/lib/types";
import { chainLabel, fmtPrice, fmtCompact, fmtPct, shortAddr } from "@/lib/format";

/**
 * 顶栏搜索（GET /v1/search）：Token / People 两个范围（docs/contracts/search.md）。
 * - 空查询不发请求（服务端空 phrase 回 100120）；
 * - 两个范围独立请求、独立失败：一边 420000/500097 不影响另一边；
 * - 切 tab 用同一个 phrase 重发，各自保留结果；
 * - Token 的 market 缺席 = 暂无行情（可能配额打满），如实显示，不渲染成价格 0；
 * - People 用 next_cursor 翻页（不透明回传，换词即丢弃）。
 */

type Tab = Extract<SearchScope, "SEARCH_SCOPE_TOKEN" | "SEARCH_SCOPE_PEOPLE">;

interface ScopeState {
  data: SearchData | null;
  unavailable: boolean; // 500097：该范围暂时不可用
  rateLimited: boolean; // 420000：退避 + 降频
  loadingMore: boolean;
}

const EMPTY: ScopeState = { data: null, unavailable: false, rateLimited: false, loadingMore: false };

export function SearchBox() {
  const router = useRouter();
  const [phrase, setPhrase] = useState("");
  const [tab, setTab] = useState<Tab>("SEARCH_SCOPE_TOKEN");
  const [open, setOpen] = useState(false);
  const [tokenState, setTokenState] = useState<ScopeState>(EMPTY);
  const [peopleState, setPeopleState] = useState<ScopeState>(EMPTY);
  const boxRef = useRef<HTMLDivElement>(null);
  const reqIdRef = useRef(0);

  const q = phrase.trim();

  // 防抖 ≥250ms；两个范围各自独立发，保留旧结果直到新结果返回
  useEffect(() => {
    if (!q) {
      setTokenState(EMPTY);
      setPeopleState(EMPTY);
      return;
    }
    const reqId = ++reqIdRef.current;
    const t = setTimeout(async () => {
      // 每个范围独立请求、独立失败：一边挂了不影响另一边
      fetchSearch("SEARCH_SCOPE_TOKEN", q, { limit: 10 })
        .then((data) => {
          if (reqIdRef.current !== reqId) return;
          setTokenState({ ...EMPTY, data });
          setOpen(true);
        })
        .catch(handleError(reqId, setTokenState));
      fetchSearch("SEARCH_SCOPE_PEOPLE", q, { limit: 10 })
        .then((data) => {
          if (reqIdRef.current !== reqId) return;
          setPeopleState({ ...EMPTY, data });
        })
        .catch(handleError(reqId, setPeopleState));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  function handleError(reqId: number, set: typeof setTokenState) {
    return (e: unknown) => {
      if (reqIdRef.current !== reqId) return;
      if (e instanceof MarketApiError && e.code === 500097) {
        set({ ...EMPTY, unavailable: true });
      } else if (e instanceof MarketApiError && e.code === 420000) {
        set({ ...EMPTY, rateLimited: true });
      } else {
        set(EMPTY);
      }
    };
  }

  // People 翻页：next_cursor 不透明回传；换词后 state 重建，cursor 自然丢弃
  function loadMorePeople() {
    const cur = peopleState.data?.next_cursor;
    if (!cur || peopleState.loadingMore) return;
    setPeopleState((s) => ({ ...s, loadingMore: true }));
    fetchSearch("SEARCH_SCOPE_PEOPLE", q, { limit: 10, cursor: cur })
      .then((data) => {
        setPeopleState((s) => ({
          ...s,
          loadingMore: false,
          data: {
            people: [...(s.data?.people ?? []), ...(data.people ?? [])],
            next_cursor: data.next_cursor,
          },
        }));
      })
      .catch((e) => {
        if (e instanceof MarketApiError && e.code === 100103) {
          // cursor 失效（过期/换词）：丢弃重拉首页
          fetchSearch("SEARCH_SCOPE_PEOPLE", q, { limit: 10 }).then((d) =>
            setPeopleState({ ...EMPTY, data: d })
          );
          return;
        }
        setPeopleState((s) => ({ ...s, loadingMore: false }));
      });
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function goToken(chain: string, address: string) {
    setOpen(false);
    router.push(`/token/${chain}/${address}`);
  }

  const state = tab === "SEARCH_SCOPE_TOKEN" ? tokenState : peopleState;
  const showDropdown = open && q !== "";

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <input
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        onFocus={() => q && setOpen(true)}
        placeholder="Search tokens or people…"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent/60"
      />
      {showDropdown && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <div className="flex items-center gap-1 border-b border-border px-2 pt-1.5">
            {(
              [
                ["SEARCH_SCOPE_TOKEN", "Tokens"],
                ["SEARCH_SCOPE_PEOPLE", "People"],
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
          </div>

          {state.unavailable ? (
            <div className="px-3 py-3 text-sm text-muted">Search is temporarily unavailable — try again later.</div>
          ) : state.rateLimited ? (
            <div className="px-3 py-3 text-sm text-muted">Search is busy — try again in a moment.</div>
          ) : tab === "SEARCH_SCOPE_TOKEN" ? (
            <TokenResults data={tokenState.data} onGo={goToken} />
          ) : (
            <PeopleResults
              data={peopleState.data}
              loadingMore={peopleState.loadingMore}
              onLoadMore={loadMorePeople}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Token 半边：多链同名不合并，逐条带 chain + 地址缩写（§5） */
function TokenResults({
  data,
  onGo,
}: {
  data: SearchData | null;
  onGo: (chain: string, address: string) => void;
}) {
  const tokens = data?.tokens ?? [];
  if (tokens.length === 0) {
    return <div className="px-3 py-3 text-sm text-muted">No tokens found.</div>;
  }
  return (
    <>
      {tokens.map((r) => (
        <button
          key={`${r.chain}:${r.address}`}
          type="button"
          onClick={() => onGo(r.chain, r.address)}
          className="flex w-full items-center justify-between gap-3 border-b border-border/50 px-3 py-2 text-left last:border-0 hover:bg-surface-2"
        >
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-sm font-medium text-foreground">
              {r.symbol ?? r.address.slice(0, 8)}
              <span className="ml-1.5 text-[10px] font-normal text-muted">
                {chainLabel(r.chain)} · {shortAddr(r.address, 6, 4)}
              </span>
            </span>
            <span className="truncate text-xs text-muted">{r.name ?? r.address}</span>
          </div>
          <div className="shrink-0 text-right">
            {/* market 只保证 7 字段子集；缺席 = 暂无行情，不要渲染成价格 0 */}
            {r.market ? (
              <>
                <div className="text-sm tabular text-foreground">{fmtPrice(r.market.price)}</div>
                <div className="text-[11px] tabular text-muted">
                  MC {fmtCompact(r.market.market_cap)}
                  {r.market.price_change_24h !== undefined && (
                    <span className={r.market.price_change_24h >= 0 ? " text-up" : " text-down"}>
                      {" "}
                      {fmtPct(r.market.price_change_24h)}
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

/** People 半边：nickname 缺席回退 username / identifier 缩写；follow_state 只做展示 */
function followBadge(fs: SearchPerson["follow_state"]) {
  if (fs === 3) return <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">Following</span>;
  if (fs === 4) return <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">You</span>;
  if (fs === 2) return <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">Follow</span>;
  return null; // 1=UNKNOWN（匿名）：不渲染
}

function PeopleResults({
  data,
  loadingMore,
  onLoadMore,
}: {
  data: SearchData | null;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const people = data?.people ?? [];
  if (people.length === 0) {
    return <div className="px-3 py-3 text-sm text-muted">No people found.</div>;
  }
  return (
    <>
      {people.map((p) => (
        <div
          key={p.identifier}
          className="flex w-full items-center justify-between gap-3 border-b border-border/50 px-3 py-2 text-left last:border-0"
        >
          <div className="flex min-w-0 items-center gap-2">
            {p.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.avatar_url} alt={p.nickname ?? p.identifier} className="h-6 w-6 rounded-full bg-surface-2 object-cover" />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-[10px] text-muted">
                {(p.nickname ?? p.username ?? p.identifier).slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="flex min-w-0 flex-col leading-tight">
              {/* nickname 不得用 identifier 伪造：空就回退 username / identifier 缩写 */}
              <span className="text-sm font-medium text-foreground">
                {p.nickname ?? p.username ?? shortAddr(p.identifier, 6, 4)}
              </span>
              {p.username && <span className="truncate text-xs text-muted">@{p.username}</span>}
            </div>
          </div>
          {followBadge(p.follow_state)}
        </div>
      ))}
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
