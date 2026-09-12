'use client';

/**
 * /people 关注域主页（social.md §5 / §5.2 / §5.5）。四个标签页：
 *
 * ① 我的关注 —— GET /v1/social/following 混合列表（用户 + 聪明钱）：
 *    展示名回退链 remark → nickname → @username → 缩写（socialDisplayName）；
 *    remark 是「我自己」给目标设的备注原值，带「备注」徽标区分；聪明钱身份键
 *    只有地址不带链 —— chains[] 在场时取第一条拼 /smart-money/:chain/:address
 *    整页跳转，缺席（已移出名录 / 未收录）时只渲染地址文本 + 「未收录」徽标。
 *    取关走乐观移除（失败回滚原位）；翻页 cursor 损坏 / 过期 / 跨列表复用回
 *    100103 → 丢弃 cursor 重拉首屏（social.md §1.4）。
 * ② 推荐交易者 —— GET /v1/social/recommended-traders（§5.4，无副作用），
 *    行内单发 POST /v1/social/follows；空列表不是错误，as_of 全零 = 榜没算好。
 * ③ 可能认识的人 —— GET /v1/social/follow-suggestions（§5）：回包只有
 *    user_identifier + via_count，没有资料 —— 按契约用缩写 identifier 渲染。
 * ④ 我的备注 —— GET /v1/social/remarks（§5.2）：回包没有 chains，聪明钱行
 *    不给跳转链接；清备注 = setRemark('', 空串即清除，逻辑删除）。
 *
 * 契约义务：
 * - 头部 GET /v1/social/follow-counts（缺省 = 本人）实时计数；**任何
 *   关注 / 取关成功后都重拉**（§5.5 实时计算，不需要前端自己 ±1）。计数
 *   只数平台用户，关注的聪明钱不计入 —— 灰字提示写明口径。
 * - 430114（未准入）不特判：envelope.call 已广播 smartx:invite-gate 全局
 *   事件（InviteGateListener 统一带去邀请页），这里照常 ErrorPanel。
 * - proto 零值：可选类型 + 真值判断（user / smart_money 结构按 target_type
 *   二选一在带，读之前都判空）。
 * - 路径式 URL 一律整页 <a href>（本仓约定，不用 next/link）。
 */
import Link from 'next/link';
import {useCallback, useEffect, useState} from 'react';

import {ApiError} from '@/api/envelope';
import {
  followTarget,
  getFollowCounts,
  getFollowSuggestions,
  getFollowing,
  getRecommendedTraders,
  listRemarks,
  setRemark,
  shortIdentifier,
  socialDisplayName,
  unfollowTarget,
  type FollowEntry,
  type FollowSuggestion,
  type RecommendedTrader,
  type RecommendedTradersReply,
  type RemarkEntry,
  type TimestampLike,
} from '@/api/social';
import {ErrorPanel} from '@/components/ErrorPanel';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {useSession} from '@/session/storage';

/** §1.4：limit 缺省 20（following 列表）。 */
const FOLLOW_PAGE_SIZE = 20;
/** §5.2：备注列表按需求一页 50。 */
const REMARKS_PAGE_SIZE = 50;

type TabKey = 'following' | 'recommended' | 'suggestions' | 'remarks';

const TABS: {key: TabKey; label: string}[] = [
  {key: 'following', label: '我的关注'},
  {key: 'recommended', label: '推荐交易者'},
  {key: 'suggestions', label: '可能认识的人'},
  {key: 'remarks', label: '我的备注'},
];

/**
 * 美元十进制字符串 → 展示串：全程字符串操作，不经过 Number / parseFloat
 * （精度必须原样保留，social.md §5.4）。与 RecommendedTradersCard 同一份实现
 * （那边是局部函数，这里按需求复制，逻辑保持一致）。
 * 例："5900.43000000" → "$5,900.43"；"5700.00000000" → "$5,700"。
 */
function formatPnlUsd(raw: string): string {
  const s = raw.trim();
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf('.');
  const intPart = (dot === -1 ? body : body.slice(0, dot)) || '0';
  const fracPart = (dot === -1 ? '' : body.slice(dot + 1)).replace(/0+$/, '');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = neg ? '-$' : '$';
  return `${sign}${fracPart ? `${grouped}.${fracPart}` : grouped}`;
}

/** proto 时间戳 → 本地时间串；全零 / 缺席（protojson 不回零值）显示占位。 */
function formatTimestamp(ts?: TimestampLike): string {
  const seconds = Number(ts?.seconds ?? 0);
  if (!(seconds > 0)) return '—';
  return new Date(seconds * 1000).toLocaleString();
}

/** 条目目标 id：user = identifier，smart_money = 地址（原样、不带链）。 */
function targetIdOf(entry: FollowEntry): string {
  return entry.target_type === 'user' ? (entry.user?.identifier ?? '') : (entry.smart_money?.address ?? '');
}

function entryKey(entry: FollowEntry): string {
  return `${entry.target_type}:${targetIdOf(entry)}`;
}

function remarkKey(entry: RemarkEntry): string {
  return `${entry.target_type}:${entry.target_id}`;
}

/** 头像兜底首字母：nickname → username → identifier；全空给 ?。 */
function initialOf(text: string): string {
  return text.trim().charAt(0).toUpperCase() || '?';
}

/**
 * 100103（BIZ_CURSOR_INVALID）统一处置：social.md §1.4 —— cursor 损坏 /
 * 过期 / 跨列表复用都回它，正确动作是丢弃 cursor 重拉首屏。
 */
function isCursorInvalid(e: unknown): boolean {
  const apiErr = e as ApiError;
  return apiErr instanceof ApiError && apiErr.kind === 'business' && apiErr.code === 100103;
}

/** 头像或首字母圆圈（SquareOpinionCard / RecommendedTradersCard 同款兜底）。 */
function TargetAvatar({url, initial, tone = 'primary'}: {url?: string; initial: string; tone?: 'primary' | 'muted'}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 头像 URL 由后端下发，next/image 优化域名不可枚举
      <img src={url} alt="" className="size-8 shrink-0 rounded-full object-cover" />
    );
  }
  return (
    <span
      className={
        (tone === 'primary' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground') +
        ' flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-[10px]'
      }
    >
      {initial}
    </span>
  );
}

export function PeopleView() {
  const session = useSession();
  const jwt = session?.jwt ?? null;

  const [tab, setTab] = useState<TabKey>('following');
  const [counts, setCounts] = useState<{following_count?: number; follower_count?: number} | null>(null);

  /** §5.5：计数实时计算 —— 任何关注 / 取关成功后重拉即新值，不自己 ±1。 */
  const refreshCounts = useCallback(async () => {
    if (!jwt) return;
    try {
      const res = await getFollowCounts(jwt);
      setCounts(res.data);
    } catch {
      // 计数是头部装饰性数据，失败不拦主内容；430114 已由全局 InviteGateListener 接管。
    }
  }, [jwt]);

  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts]);

  if (!jwt) {
    // 未登录：同 OnboardingView 的「去登录」卡（关注域是「我的」数据）。
    return (
      <Card>
        <CardContent className="space-y-2 p-6 text-sm">
          <p>关注列表、推荐与备注都是「我的」数据，需要先登录。</p>
          <Link href="/login">
            <Button size="sm">去登录</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">People · 关注域</h1>
        <p className="text-muted-foreground text-sm">
          关注的人与聪明钱、推荐、可能认识的人、备注名 —— 用户与聪明钱是同一个「可关注目标」的两种形态（social.md §5）。
        </p>
      </header>

      {/* §5.5 关注计数：只数状态正常的平台用户；聪明钱是外部地址不计入。 */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4 text-sm">
          <span>
            关注 <span className="font-mono">{counts?.following_count ?? 0}</span> / 粉丝{' '}
            <span className="font-mono">{counts?.follower_count ?? 0}</span>
          </span>
          <span
            className="text-muted-foreground text-xs"
            title="口径（social.md §5.5）：只数状态正常的平台用户，关注的聪明钱是外部地址不计入；实时计算，关注 / 取关后重拉即新值。"
          >
            只含平台用户，聪明钱不计入
          </span>
        </CardContent>
      </Card>

      {/* 标签行：同 SettingsNav 的按钮样式（本地 state，默认第一页签）。 */}
      <nav className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              'rounded-md border px-2.5 py-1 text-xs transition-colors ' +
              (t.key === tab
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:text-foreground')
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'following' && <FollowingTab bearer={jwt} onFollowChanged={() => void refreshCounts()} onGoRecommend={() => setTab('recommended')} />}
      {tab === 'recommended' && <RecommendedTab bearer={jwt} onFollowChanged={() => void refreshCounts()} />}
      {tab === 'suggestions' && <SuggestionsTab bearer={jwt} onFollowChanged={() => void refreshCounts()} />}
      {tab === 'remarks' && <RemarksTab bearer={jwt} />}
    </div>
  );
}

// ── Tab 1「我的关注」：GET /v1/social/following 混合列表 + 乐观取关 ──

function FollowingTab({
  bearer,
  onFollowChanged,
  onGoRecommend,
}: {
  bearer: string;
  /** 取关成功后重拉头部计数（§5.5 实时）。 */
  onFollowChanged: () => void;
  /** 空态跳转到「推荐交易者」页签。 */
  onGoRecommend: () => void;
}) {
  const [entries, setEntries] = useState<FollowEntry[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [actionErr, setActionErr] = useState<ApiError | null>(null);
  /** 取关中的行（乐观移除后行已不在，用它禁用其它行避免并发错乱）。 */
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await getFollowing(bearer, {limit: FOLLOW_PAGE_SIZE});
      setEntries(res.data.entries ?? []);
      // 空串 = 到底了（键恒在场）。
      setNextCursor(res.data.next_cursor ?? '');
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [bearer]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setErr(null);
    try {
      const res = await getFollowing(bearer, {cursor: nextCursor, limit: FOLLOW_PAGE_SIZE});
      setEntries((prev) => [...prev, ...(res.data.entries ?? [])]);
      setNextCursor(res.data.next_cursor ?? '');
    } catch (e) {
      if (isCursorInvalid(e)) {
        // §1.4：丢弃 cursor 重拉首屏，不当成页面级错误。
        setNextCursor('');
        await loadFirst();
      } else {
        setErr(e as ApiError);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  /** 乐观取关：先当成功把行移除，失败再塞回原位并报错。 */
  const unfollow = async (entry: FollowEntry, index: number) => {
    const key = entryKey(entry);
    const targetId = targetIdOf(entry);
    if (!targetId) return;
    setActionErr(null);
    setPendingKey(key);
    setEntries((prev) => prev.filter((e) => entryKey(e) !== key));
    try {
      await unfollowTarget(bearer, entry.target_type, targetId);
      onFollowChanged();
    } catch (e) {
      setEntries((prev) => {
        const next = [...prev];
        next.splice(Math.min(index, next.length), 0, entry);
        return next;
      });
      setActionErr(e as ApiError);
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">我的关注</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {err ? (
          <div className="space-y-2">
            <ErrorPanel err={err} />
            <Button size="sm" variant="outline" onClick={() => void loadFirst()}>
              重试
            </Button>
          </div>
        ) : loading ? (
          <p className="text-muted-foreground text-sm">列表加载中…</p>
        ) : entries.length === 0 ? (
          <div className="space-y-2 text-sm">
            <p>还没有关注任何目标</p>
            <Button size="sm" variant="outline" onClick={onGoRecommend}>
              去推荐看看
            </Button>
          </div>
        ) : (
          <>
            <div className="divide-y rounded-md border">
              {entries.map((entry, i) => {
                const key = entryKey(entry);
                const id = targetIdOf(entry);
                const isUser = entry.target_type === 'user';
                const sm = entry.smart_money;
                // 聪明钱 chains：名录里收录且未拉黑的链（字典序）；缺席 = 无链可跳。
                const chains = (sm?.chains ?? []).filter((c) => !!c);
                const hasChains = !isUser && chains.length > 0;
                const display = isUser
                  ? socialDisplayName({
                      remark: entry.remark,
                      nickname: entry.user?.nickname,
                      username: entry.user?.username,
                      identifier: id,
                    })
                  : socialDisplayName({remark: entry.remark, identifier: id});
                // @username 作次行：只在 nickname 在场时补（否则 primary 已是 @username）。
                const secondary = isUser
                  ? entry.user?.nickname && entry.user?.username
                    ? `@${entry.user.username}`
                    : null
                  : id || null;
                const href = isUser
                  ? id
                    ? `/user/${encodeURIComponent(id)}`
                    : null
                  : hasChains
                    ? `/smart-money/${encodeURIComponent(chains[0])}/${encodeURIComponent(id)}`
                    : null;
                return (
                  <div key={key} className="flex items-center gap-3 p-3">
                    <TargetAvatar
                      url={entry.user?.avatar_url}
                      initial={isUser ? initialOf(entry.user?.nickname || entry.user?.username || id) : 'SM'}
                      tone={isUser ? 'primary' : 'muted'}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm">
                        {href ? (
                          <a href={href} className="truncate underline-offset-2 hover:underline">
                            {display.primary}
                          </a>
                        ) : (
                          <span className="truncate">{display.primary}</span>
                        )}
                        {/* remark 是「我自己」起的备注，样式上要与平台资料区分开。 */}
                        {display.isRemark && (
                          <Badge variant="secondary" className="shrink-0">
                            备注
                          </Badge>
                        )}
                        {/* 无链可跳的聪明钱：地址还在关注边里，只是名录里没有链。 */}
                        {!isUser && !hasChains && (
                          <Badge variant="outline" className="text-muted-foreground shrink-0">
                            未收录
                          </Badge>
                        )}
                      </p>
                      {secondary && <p className="text-muted-foreground truncate font-mono text-xs">{secondary}</p>}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingKey !== null}
                      onClick={() => void unfollow(entry, i)}
                    >
                      取关
                    </Button>
                  </div>
                );
              })}
            </div>
            {nextCursor && (
              <Button size="sm" variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? '加载中…' : '加载更多'}
              </Button>
            )}
          </>
        )}
        {actionErr && <ErrorPanel err={actionErr} />}
      </CardContent>
    </Card>
  );
}

// ── Tab 2「推荐交易者」：GET /v1/social/recommended-traders（§5.4） ──

function RecommendedTab({bearer, onFollowChanged}: {bearer: string; onFollowChanged: () => void}) {
  const [reply, setReply] = useState<RecommendedTradersReply | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<ApiError | null>(null);
  /** 关注成功的行：本地置灰「已关注」（服务端下次拉榜已剔除）。 */
  const [followed, setFollowed] = useState<ReadonlySet<string>>(new Set());
  const [actionErr, setActionErr] = useState<ApiError | null>(null);
  const [rowPending, setRowPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await getRecommendedTraders(bearer);
      setReply(res.data);
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [bearer]);

  useEffect(() => {
    void load();
  }, [load]);

  const followOne = async (trader: RecommendedTrader) => {
    setRowPending(trader.user.identifier);
    setActionErr(null);
    try {
      await followTarget(bearer, 'user', trader.user.identifier);
      setFollowed((prev) => new Set(prev).add(trader.user.identifier));
      onFollowChanged();
    } catch (e) {
      setActionErr(e as ApiError);
    } finally {
      setRowPending(null);
    }
  };

  const traders = reply?.traders ?? [];
  // as_of 全零对象（{"seconds":0} 或缺席）= 榜不可用；int64 可能回字符串，统一 Number。
  const asOfSeconds = Number(reply?.as_of?.seconds ?? 0);
  const leaderboardNotReady = traders.length === 0 && !(asOfSeconds > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">推荐交易者</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {err ? (
          <div className="space-y-2">
            <ErrorPanel err={err} />
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </div>
        ) : loading ? (
          <p className="text-muted-foreground text-sm">榜单加载中…</p>
        ) : traders.length === 0 ? (
          // 空列表不是错误（不足 10 人 / 已全部关注 / 榜不可用，同一形状）。
          <p className="text-sm">暂时没有推荐</p>
        ) : (
          <div className="divide-y rounded-md border">
            {traders.map((t) => {
              const isFollowed = followed.has(t.user.identifier);
              // 展示名兜底链同 §5：nickname → @username → 缩写；nickname 与
              // @username 都在时同显（次行放 @username）。
              const display = socialDisplayName({
                nickname: t.user.nickname,
                username: t.user.username,
                identifier: t.user.identifier,
              });
              const secondary = t.user.nickname && t.user.username ? `@${t.user.username}` : null;
              return (
                <div key={t.user.identifier} className="flex items-center gap-3 p-3">
                  <span className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground">{t.rank}</span>
                  <TargetAvatar url={t.user.avatar_url} initial={initialOf(t.user.nickname || t.user.username || t.user.identifier)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{display.primary}</p>
                    {secondary && <p className="text-muted-foreground truncate text-xs">{secondary}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    {/* window 恒 "7d" —— 标签固定写「7D P&L」（social.md §5.4）。 */}
                    <p className="text-muted-foreground text-[10px] tracking-wide uppercase">7D P&L</p>
                    <p className="font-mono text-sm">{formatPnlUsd(t.pnl_usd)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={isFollowed ? 'outline' : 'default'}
                    disabled={isFollowed || rowPending === t.user.identifier}
                    onClick={() => void followOne(t)}
                  >
                    {isFollowed ? '已关注' : rowPending === t.user.identifier ? '关注中…' : 'Follow'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        {/* 榜不可用的灰字说明（与 RecommendedTradersCard 同款）。 */}
        {!loading && !err && traders.length === 0 && leaderboardNotReady && (
          <p className="text-muted-foreground text-xs">榜单还没算好（每小时重算一次），数据就绪后这里会列出推荐。</p>
        )}
        {actionErr && <ErrorPanel err={actionErr} />}
      </CardContent>
    </Card>
  );
}

// ── Tab 3「可能认识的人」：GET /v1/social/follow-suggestions（§5） ──

function SuggestionsTab({bearer, onFollowChanged}: {bearer: string; onFollowChanged: () => void}) {
  const [suggestions, setSuggestions] = useState<FollowSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<ApiError | null>(null);
  const [actionErr, setActionErr] = useState<ApiError | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await getFollowSuggestions(bearer, 20);
      setSuggestions(res.data.suggestions ?? []);
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [bearer]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 关注成功 → 行移除（下次拉取服务端也会剔除已关注）。 */
  const followOne = async (identifier: string) => {
    setPendingId(identifier);
    setActionErr(null);
    try {
      await followTarget(bearer, 'user', identifier);
      setSuggestions((prev) => prev.filter((s) => s.user_identifier !== identifier));
      onFollowChanged();
    } catch (e) {
      setActionErr(e as ApiError);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">可能认识的人</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {err ? (
          <div className="space-y-2">
            <ErrorPanel err={err} />
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </div>
        ) : loading ? (
          <p className="text-muted-foreground text-sm">推荐加载中…</p>
        ) : suggestions.length === 0 ? (
          <p className="text-sm">暂时没有推荐</p>
        ) : (
          <div className="divide-y rounded-md border">
            {suggestions.map((s) => (
              <div key={s.user_identifier} className="flex items-center gap-3 p-3">
                {/* 契约只回 user_identifier + via_count，没有资料 —— 缩写 identifier 展示。 */}
                <TargetAvatar initial="?" tone="muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm">{shortIdentifier(s.user_identifier)}</p>
                  {!!s.via_count && s.via_count > 0 && (
                    <p className="text-muted-foreground truncate text-xs">{s.via_count} 位你关注的人也关注了 TA</p>
                  )}
                </div>
                <Button
                  size="sm"
                  disabled={pendingId === s.user_identifier}
                  onClick={() => void followOne(s.user_identifier)}
                >
                  {pendingId === s.user_identifier ? '关注中…' : 'Follow'}
                </Button>
              </div>
            ))}
          </div>
        )}
        {actionErr && <ErrorPanel err={actionErr} />}
      </CardContent>
    </Card>
  );
}

// ── Tab 4「我的备注」：GET /v1/social/remarks（§5.2） ──

function RemarksTab({bearer}: {bearer: string}) {
  const [entries, setEntries] = useState<RemarkEntry[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [actionErr, setActionErr] = useState<ApiError | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await listRemarks(bearer, {limit: REMARKS_PAGE_SIZE});
      setEntries(res.data.entries ?? []);
      setNextCursor(res.data.next_cursor ?? '');
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [bearer]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setErr(null);
    try {
      const res = await listRemarks(bearer, {cursor: nextCursor, limit: REMARKS_PAGE_SIZE});
      setEntries((prev) => [...prev, ...(res.data.entries ?? [])]);
      setNextCursor(res.data.next_cursor ?? '');
    } catch (e) {
      if (isCursorInvalid(e)) {
        // §1.4：处置同 following —— 丢弃 cursor 重拉首屏。
        setNextCursor('');
        await loadFirst();
      } else {
        setErr(e as ApiError);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  /** 清备注 = setRemark 空串（逻辑删除，随时可再设，§5.2）。430106 走 ErrorPanel。 */
  const clearOne = async (entry: RemarkEntry) => {
    const key = remarkKey(entry);
    setActionErr(null);
    setPendingKey(key);
    try {
      await setRemark(bearer, entry.target_type, entry.target_id, '');
      setEntries((prev) => prev.filter((e) => remarkKey(e) !== key));
    } catch (e) {
      setActionErr(e as ApiError);
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">我的备注</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {err ? (
          <div className="space-y-2">
            <ErrorPanel err={err} />
            <Button size="sm" variant="outline" onClick={() => void loadFirst()}>
              重试
            </Button>
          </div>
        ) : loading ? (
          <p className="text-muted-foreground text-sm">备注加载中…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm">还没有给任何目标设备注</p>
        ) : (
          <>
            <div className="divide-y rounded-md border">
              {entries.map((entry) => {
                const key = remarkKey(entry);
                const isUser = entry.target_type === 'user';
                return (
                  <div key={key} className="flex items-center gap-3 p-3">
                    <Badge variant={isUser ? 'secondary' : 'outline'} className="shrink-0">
                      {isUser ? '用户' : '聪明钱'}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm">{shortIdentifier(entry.target_id)}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {entry.remark} · 更新于 {formatTimestamp(entry.updated_at)}
                      </p>
                    </div>
                    {/* 跳转：user 直链资料页；备注列表没有 chains 字段，聪明钱行不给链接。 */}
                    {isUser && entry.target_id && (
                      <a
                        href={`/user/${encodeURIComponent(entry.target_id)}`}
                        className="text-primary shrink-0 text-xs underline underline-offset-2"
                      >
                        跳转
                      </a>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingKey !== null}
                      onClick={() => void clearOne(entry)}
                    >
                      清除
                    </Button>
                  </div>
                );
              })}
            </div>
            {nextCursor && (
              <Button size="sm" variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? '加载中…' : '加载更多'}
              </Button>
            )}
          </>
        )}
        {actionErr && <ErrorPanel err={actionErr} />}
      </CardContent>
    </Card>
  );
}
