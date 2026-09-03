'use client';

/**
 * 收藏（Watchlist）全站状态：星标 Map + 批量 status 查询 + 乐观 toggle。
 *
 * - 榜单/搜索回包没有收藏字段（公共数据），星标统一走
 *   POST /v1/tokens/favorites/status 批量问一次（favorites.md §4）；
 * - 回包按下标 zip（回显地址是归一化形态，不能按字符串反查）；
 * - toggle 乐观更新；回包地址用服务端归一化后的形态修正本地 key；
 * - 400000 时清会话引导重登（带上坏 token 请求不会降级成匿名）。
 */
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';

import {addFavorite, favoriteStatus, removeFavorite, type FavoriteStatusInput} from '@/api/favorites';
import {ApiError} from '@/api/envelope';
import {clearSite, useSession} from '@/session/storage';

const keyOf = (chain: string, address: string) => `${chain}:${address.toLowerCase()}`;

export type ToggleResult = {ok: true; favorited: boolean; changed: boolean} | {ok: false; code: number; message: string};

type FavoritesCtx = {
  /** chain:address(小写) → 是否已收藏。未查询过的键缺席（视为 false 可，星标三态不区分） */
  statusMap: Record<string, boolean>;
  /** 已登录且查询进行中 */
  loading: boolean;
  /** 批量确保一批 token 的状态在 map 里（榜单/搜索/详情星标用）；去重、限 500 */
  ensureStatus: (tokens: FavoriteStatusInput[]) => void;
  toggle: (chain: string, address: string) => Promise<ToggleResult>;
};

const Ctx = createContext<FavoritesCtx | null>(null);

export function useFavorites(): FavoritesCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFavorites must be used within FavoritesProvider');
  return ctx;
}

export function FavoritesProvider({children}: {children: ReactNode}) {
  const session = useSession();
  const [statusMap, setStatusMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  /** 本生命周期内已查过的 key，避免同一批榜单反复打 status 端点 */
  const queriedRef = useRef<Set<string>>(new Set());
  const jwtRef = useRef<string | null>(null);
  const needResetRef = useRef(false);

  // 登录态变化：换人/登出时清空（收藏是"每人一份"的个人数据）
  if (session?.jwt !== jwtRef.current) {
    jwtRef.current = session?.jwt ?? null;
    needResetRef.current = true;
  }
  useEffect(() => {
    if (needResetRef.current) {
      needResetRef.current = false;
      queriedRef.current = new Set();
      setStatusMap({});
    }
  }, [session?.jwt]);

  const ensureStatus = useCallback(
    (tokens: FavoriteStatusInput[]) => {
      const jwt = jwtRef.current;
      if (!jwt) return;
      const missing = tokens.filter((t) => !queriedRef.current.has(keyOf(t.chain, t.address)));
      if (missing.length === 0) return;
      // 1–500 条契约限制：超限砍尾（榜单/搜索一屏远小于 500）
      const batch = missing.slice(0, 500);
      for (const t of batch) queriedRef.current.add(keyOf(t.chain, t.address));
      setLoading(true);
      favoriteStatus(jwt, batch)
        .then((res) => {
          // 按下标 zip（回显是归一化地址，不能按字符串反查）
          setStatusMap((prev) => {
            const next = {...prev};
            res.data.results.forEach((r, i) => {
              next[keyOf(r.chain ?? batch[i].chain, r.address ?? batch[i].address)] = !!r.is_favorited;
            });
            return next;
          });
        })
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.code === 400000) {
            clearSite(); // 坏 token 不降级匿名：清会话引导重登
            return;
          }
          // 仅可重试类错误（500106/500097）放行重查；404 等 transport/永久
          // 错误不放行，否则每次渲染都重打一遍 status 端点
          if (e instanceof ApiError && (e.kind !== 'business' || e.code === 500106 || e.code === 500097)) {
            for (const t of batch) queriedRef.current.delete(keyOf(t.chain, t.address));
          }
        })
        .finally(() => setLoading(false));
    },
    []
  );

  const toggle = useCallback(
    async (chain: string, address: string): Promise<ToggleResult> => {
      const jwt = jwtRef.current;
      if (!jwt) return {ok: false, code: 400000, message: 'Sign in to use your watchlist'};
      const k = keyOf(chain, address);
      const currently = !!statusMap[k];
      // 乐观更新
      setStatusMap((prev) => ({...prev, [k]: !currently}));
      try {
        const res = currently
          ? await removeFavorite(jwt, chain, address)
          : await addFavorite(jwt, chain, address);
        const favorited = !!res.data.favorited;
        const changed = !!res.data.changed;
        // 用服务端归一化后的回显地址修正本地 key（EVM 小写）
        const normKey = keyOf(res.data.chain ?? chain, res.data.address ?? address);
        setStatusMap((prev) => {
          const next = {...prev};
          delete next[k];
          next[normKey] = favorited;
          return next;
        });
        queriedRef.current.add(normKey);
        return {ok: true, favorited, changed};
      } catch (e) {
        // 回滚
        setStatusMap((prev) => ({...prev, [k]: currently}));
        if (e instanceof ApiError) {
          if (e.code === 400000) {
            clearSite();
            return {ok: false, code: 400000, message: 'Session expired — sign in again'};
          }
          if (e.code === 430110) return {ok: false, code: 430110, message: 'Watchlist is full — remove some first'};
          if (e.code === 200107) return {ok: false, code: 200107, message: 'Token not found on this chain'};
          if (e.code === 500097) return {ok: false, code: 500097, message: 'Market upstream unavailable — try again'};
          if (e.code === 500106) return {ok: false, code: 500106, message: 'Watchlist storage unavailable — try again'};
          return {ok: false, code: e.code, message: e.message};
        }
        return {ok: false, code: 0, message: e instanceof Error ? e.message : String(e)};
      }
    },
    [statusMap]
  );

  const value = useMemo(() => ({statusMap, loading, ensureStatus, toggle}), [statusMap, loading, ensureStatus, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 星标按钮。榜单行 / 搜索结果 / 详情页通用；未登录点击提示登录 */
export function StarButton({chain, address, size = 'sm'}: {chain: string; address: string; size?: 'sm' | 'md'}) {
  const {statusMap, toggle} = useFavorites();
  const session = useSession();
  const [hint, setHint] = useState<string | null>(null);
  const on = !!statusMap[`${chain}:${address.toLowerCase()}`];

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const r = await toggle(chain, address);
    if (!r.ok) {
      setHint(r.message);
      setTimeout(() => setHint(null), 2200);
    }
  }

  const cls = size === 'md' ? 'text-lg' : 'text-sm';
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={onClick}
        title={session ? (on ? 'Remove from watchlist' : 'Add to watchlist') : 'Sign in to use your watchlist'}
        className={`${cls} leading-none transition-colors ${on ? 'text-accent' : 'text-muted hover:text-foreground'}`}
      >
        {on ? '★' : '☆'}
      </button>
      {hint && (
        <span className="absolute left-1/2 top-full z-30 mt-1 w-max max-w-[220px] -translate-x-1/2 rounded border border-border bg-surface px-2 py-1 text-[10px] text-muted shadow">
          {hint}
        </span>
      )}
    </span>
  );
}
