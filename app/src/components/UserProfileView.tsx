'use client';

/**
 * 客态用户主页（路由 /user/:identifier）。
 *
 * 契约依据（后端仓 docs/contracts/）：
 * - settings.md §3.5 —— GET /v1/users/{id}/profile 六字段恒在场；展示名回退
 *   remark → nickname → @username → 缩写由**前端**拼，remark 是「我起的」要用
 *   与真名不同的样式；目标不可见（不存在/注销/封禁/未激活）一律 200102 且回包
 *   逐字节相同（有意不给探测口），前端一律按「用户不存在」渲染。
 * - social.md §5 —— relations/batch 回 following（我→TA）与 followed_by（TA→我）
 *   两个独立的位；users 桶与请求同序，按下标 zip；备注与关注完全解耦（§5.2，
 *   空串 = 清除）。
 * - social.md §5.5 —— follow-counts 实时计算，关注/取关后重拉即新值，不本地 ±1；
 *   known-followers 的 total 封顶 100，拿到 100 要显示「100+」。
 * - portfolio.md 第一部分 —— 客态四端点均为 Optional 档：匿名可看、**坏 JWT 一律
 *   400000 且不降级成匿名**，所以 bearer 只在有会话时传，绝不过期重试；用户
 *   不存在/受限按不存在处理，查询故障不得渲染成空账户。
 *
 * 页面各区块**并行发出、各自失败**（settings.md §3.5 的区块表）：portfolio、
 * 关注列表等区块的失败只影响自己的区块，不许把整页打 blank。
 */

import {useEffect, useState} from 'react';

import {ApiError} from '@/api/envelope';
import {
  getUserClosedPositions,
  getUserPortfolio,
  getUserPortfolioTrades,
} from '@/api/portfolio';
import type {
  PortfolioClosedPosition,
  PortfolioPosition,
  PortfolioReply,
  PortfolioTrade,
  ProtoTimestamp,
} from '@/api/portfolio';
import {
  followTarget,
  getFollowCounts,
  getFollowers,
  getFollowing,
  getKnownFollowers,
  getMutualFollows,
  getRelations,
  setRemark,
  shortIdentifier,
  socialDisplayName,
  unfollowTarget,
} from '@/api/social';
import type {FollowEntry, TimestampLike, UserRelation} from '@/api/social';
import {getUserPublicProfile} from '@/api/users';
import type {UserPublicProfile} from '@/api/users';
import {ErrorPanel} from '@/components/ErrorPanel';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {
  decimalSign,
  formatBaseUnitsExact,
  formatDecimalExact,
  marketValueFromBaseUnits,
} from '@/lib/exact-decimal';
import {chainLabel, shortAddr} from '@/lib/format';
import {useSession} from '@/session/storage';

// ── 路由参数解析 ────────────────────────────────────────────────────────────

export type UserRouteState =
  // SSR / 客户端首帧还读不到 location，先挂起
  | {status: 'pending'}
  | {status: 'ready'; identifier: string}
  // 挂载后路径与查询串都没有 identifier
  | {status: 'invalid'};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * /user 壳页参数解析（复制 useDetailRouteParams 的 pending→ready→invalid 模式，
 * 本地小实现、不改共享 hook）。静态托管下 /user/:identifier 被 _redirects
 * 200 重写到壳页，浏览器地址保留原路径，挂载后从 location 解析；
 * ?identifier= 查询串优先。整站是静态导出 + 整页 `<a>` 导航，
 * window.location 恒是当前地址，不需要 next/navigation。
 */
export function useUserRouteIdentifier(): UserRouteState {
  const [state, setState] = useState<UserRouteState>({status: 'pending'});
  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get('identifier');
    const segments = window.location.pathname.split('/').filter(Boolean);
    const baseIndex = segments.indexOf('user');
    const fromPath =
      baseIndex >= 0 && segments.length > baseIndex + 1 ? safeDecode(segments[baseIndex + 1]) : undefined;
    const identifier = fromQuery ?? fromPath;
    setState(identifier ? {status: 'ready', identifier} : {status: 'invalid'});
  }, []);
  return state;
}

// ── 错误与格式辅助 ──────────────────────────────────────────────────────────

/**
 * 业务码提取。信封层抛 ApiError 实例，但调用方（含测试）可能抛「带 kind/code
 * 字段的普通 Error」，这里按形状统一读，避免 instanceof 漏判。
 */
function businessCodeOf(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const candidate = error as {kind?: unknown; code?: unknown};
  if (candidate.kind === 'business' && typeof candidate.code === 'number') return candidate.code;
  return undefined;
}

/** USD 十进制串直读展示；空/非法 = 不可用「—」，不填 0（portfolio.md §1.2）。 */
function money(value?: string): string {
  if (!value) return '—';
  const sign = decimalSign(value);
  if (sign === undefined) return '—';
  const abs = sign === -1 ? value.replace(/^-/, '') : value;
  return `${sign === -1 ? '-' : ''}$${formatDecimalExact(abs, 2)}`;
}

/** pnl_ratio 是比例（0.1 = 10%），换算成百分数展示；非法一律 —，不硬猜。 */
function ratioPercent(value?: string): string {
  if (!value) return '—';
  const sign = decimalSign(value);
  if (sign === undefined) return '—';
  const abs = sign === -1 ? value.replace(/^-/, '') : value;
  try {
    return `${sign === -1 ? '-' : ''}${formatDecimalExact(marketValueFromBaseUnits('100', 0, abs), 2)}%`;
  } catch {
    return '—';
  }
}

function toneClass(value?: string): string {
  const sign = decimalSign(value);
  return sign === 1 ? 'text-up' : sign === -1 ? 'text-down' : 'text-muted';
}

/** 持仓量：decimals 在场才换算人类可读量；缺席时最小单位原样缩短，不伪造精度。 */
function sharesText(sharesRaw: string, decimals?: number): string {
  if (decimals !== undefined && Number.isInteger(decimals) && decimals >= 0 && decimals <= 255) {
    return formatBaseUnitsExact(sharesRaw, decimals);
  }
  return sharesRaw.length > 14 ? `${sharesRaw.slice(0, 12)}…` : sharesRaw;
}

function timeRfc3339(value?: string): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : '—';
}

/** protojson 全零时间戳（{seconds:0}）= 未设置，按 — 渲染（响应侧编码规则 10）。 */
function timeProto(value?: ProtoTimestamp | TimestampLike): string {
  const seconds = value === undefined ? Number.NaN : Number(value.seconds ?? 0);
  if (!Number.isFinite(seconds) || seconds === 0) return '—';
  return new Date(seconds * 1000).toLocaleString();
}

// ── 小部件 ──────────────────────────────────────────────────────────────────

function RetryButton({onClick, pending}: {onClick: () => void; pending?: boolean}) {
  return (
    <button type="button" onClick={onClick} disabled={pending} className="ml-2 text-xs text-accent underline disabled:opacity-50">
      重试
    </button>
  );
}

/**
 * 区块级失败展示：信封层错误（ApiError）用 ErrorPanel 完整呈现（三类失败
 * 颜色/文案不同），其余（如 PortfolioDataError）退化为单行错误 + 重试。
 */
function ErrorLine({error, onRetry, pending}: {error: unknown; onRetry: () => void; pending?: boolean}) {
  if (error instanceof ApiError) {
    return (
      <div className="space-y-1">
        <ErrorPanel err={error} />
        <RetryButton onClick={onRetry} pending={pending} />
      </div>
    );
  }
  return (
    <p className="text-sm text-down">
      数据加载失败：{error instanceof Error ? error.message : '未知错误'}
      <RetryButton onClick={onRetry} pending={pending} />
    </p>
  );
}

function Avatar({url, name, size = 'size-14'}: {url?: string; name: string; size?: string}) {
  const [failed, setFailed] = useState<string>();
  const source = url && /^https?:\/\//i.test(url) ? url : undefined;
  return (
    <div className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-base font-bold text-muted`}>
      {source && failed !== source ? (
        <img src={source} alt="" className="h-full w-full object-cover" onError={() => setFailed(source)} />
      ) : (
        <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      )}
    </div>
  );
}

/** remark 是「我起的」，必须与 TA 自己的名字用不同样式（settings.md §3.5 硬约束 ①）。 */
function RemarkBadge() {
  return (
    <span title="我给 TA 起的备注" className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
      备注
    </span>
  );
}

/** followed_by = TA 关注我（social.md §5，2026-09-12），与 following 是两件事。 */
function FollowsYouBadge() {
  return (
    <span title="TA 关注了你" className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
      Follows you
    </span>
  );
}

function EventBadge({side}: {side: 'buy' | 'sell'}) {
  const style = side === 'buy' ? 'bg-up/10 text-up' : 'bg-down/10 text-down';
  return <span className={`rounded px-2 py-1 text-[10px] font-semibold ${style}`}>{side}</span>;
}

function Stat({label, value, tone}: {label: string; value: string; tone?: string}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 px-3 py-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`tabular mt-0.5 truncate font-mono text-sm font-semibold ${tone ?? 'text-foreground'}`}>{value}</p>
    </div>
  );
}

function TokenCell({symbol, logo, chain, address}: {symbol?: string; logo?: string; chain: string; address: string}) {
  const [failed, setFailed] = useState<string>();
  const source = logo && /^https?:\/\//i.test(logo) && failed !== logo ? logo : undefined;
  const label = symbol ?? shortAddr(address, 6, 4);
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-xs font-bold text-muted">
        {source ? (
          <img src={source} alt="" className="h-full w-full object-cover" onError={() => setFailed(source)} />
        ) : (
          <span aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      {/* 静态导出下路径式详情页整页跳转（_redirects 重写），与全站 <a> 约定一致 */}
      <a href={`/token/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`} className="truncate font-medium text-foreground hover:text-accent">
        {label}
      </a>
    </div>
  );
}

/** 200102（四种不可见原因回包逐字节相同）→ 只渲染「用户不存在」，不做原因猜测。 */
function UserNotFoundCard() {
  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-surface p-10 text-center">
      <h1 className="text-lg font-semibold text-foreground">用户不存在</h1>
      <p className="text-sm text-muted">该账号当前不可见。</p>
      <a href="/" className="mt-2 text-sm text-accent hover:underline">← 返回首页</a>
    </div>
  );
}

// ── 入口 ────────────────────────────────────────────────────────────────────

/**
 * identifier 显式传入优先（复用/测试）；缺省时解析 /user 壳页路由。
 * key=identifier：切换目标时整树重挂载，旧游标与乐观状态全部清空
 * （portfolio.md：切换用户要清空旧游标、丢弃上一用户的迟到响应）。
 */
export function UserProfileView({identifier: identifierProp}: {identifier?: string}) {
  const route = useUserRouteIdentifier();
  const identifier = identifierProp ?? (route.status === 'ready' ? route.identifier : undefined);
  if (!identifier) {
    if (route.status === 'invalid') {
      return <p className="p-6 text-sm text-muted">缺少 identifier 参数</p>;
    }
    return null;
  }
  return <ProfilePage key={identifier} identifier={identifier} />;
}

// ── 页面主体 ────────────────────────────────────────────────────────────────

function ProfilePage({identifier}: {identifier: string}) {
  const session = useSession();
  const jwt = session?.jwt;

  const [headerKey, setHeaderKey] = useState(0);
  const [mutationKey, setMutationKey] = useState(0);
  const [tab, setTab] = useState<'positions' | 'trades' | 'follows'>('positions');
  const [visited, setVisited] = useState({positions: true, trades: false, follows: false});

  // ── 头部四路数据：并行发出、各自失败（settings.md §3.5 区块表） ──
  const [profile, setProfile] = useState<UserPublicProfile>();
  // 本人判定用**回包的 identifier** 与登录用户比对（social.md §5：前端自己比对，
  // 决定画「编辑资料」还是「关注」）；profile 未到时不算本人，避免误隐藏动作。
  const isSelf = profile !== undefined && profile.identifier !== '' && profile.identifier === session?.user?.identifier;
  const [profileError, setProfileError] = useState<unknown>();
  const [profileLoading, setProfileLoading] = useState(Boolean(jwt));

  const [relation, setRelation] = useState<UserRelation>();
  const [relationError, setRelationError] = useState<unknown>();

  const [counts, setCounts] = useState<{following_count?: number; follower_count?: number}>();
  const [countsError, setCountsError] = useState<unknown>();

  const [known, setKnown] = useState<{names: string[]; total: number}>();

  useEffect(() => {
    if (!jwt) {
      // profile 端点需要登录（settings.md §3.5）；匿名给登录引导而不是空白
      setProfile(undefined);
      setProfileError(undefined);
      setProfileLoading(false);
      return;
    }
    let cancelled = false;
    setProfile(undefined);
    setProfileError(undefined);
    setProfileLoading(true);
    getUserPublicProfile(jwt, identifier)
      .then((result) => {
        if (!cancelled) setProfile(result.data);
      })
      .catch((error) => {
        if (!cancelled) setProfileError(error);
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jwt, identifier, headerKey]);

  useEffect(() => {
    if (!jwt) {
      setRelation(undefined);
      setRelationError(undefined);
      return;
    }
    let cancelled = false;
    setRelation(undefined);
    setRelationError(undefined);
    getRelations(jwt, {userIdentifiers: [identifier], addresses: []})
      .then((result) => {
        if (cancelled) return;
        // users 桶与请求同序，按下标 zip 取唯一目标（social.md §5）
        setRelation(result.data.users?.[0]);
      })
      .catch((error) => {
        if (!cancelled) setRelationError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [jwt, identifier, headerKey, mutationKey]);

  useEffect(() => {
    if (!jwt) {
      setCounts(undefined);
      setCountsError(undefined);
      return;
    }
    let cancelled = false;
    setCounts(undefined);
    setCountsError(undefined);
    getFollowCounts(jwt, identifier)
      .then((result) => {
        if (!cancelled) setCounts(result.data);
      })
      .catch((error) => {
        if (!cancelled) setCountsError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [jwt, identifier, headerKey, mutationKey]);

  useEffect(() => {
    // known-followers 需要登录且必填 user_identifier；本人视角请用互关列表（§5）
    if (!jwt || isSelf) {
      setKnown(undefined);
      return;
    }
    let cancelled = false;
    setKnown(undefined);
    getKnownFollowers(jwt, identifier, {limit: 20})
      .then(async (result) => {
        if (cancelled) return;
        const entries = result.data.entries ?? [];
        const total = result.data.total ?? 0;
        if (total <= 0) {
          setKnown({names: [], total: 0});
          return;
        }
        // 中间人名字：一批 relations/batch（≤100）拿「我给 TA 的备注」，再走展示名回退；
        // 这批失败不阻塞整行，回退到缩写
        const middleMen = entries.map((entry) => entry.user_identifier).slice(0, 100);
        const remarkByID = new Map<string, string>();
        try {
          const relations = await getRelations(jwt, {userIdentifiers: middleMen, addresses: []});
          if (cancelled) return;
          for (const user of relations.data.users ?? []) {
            if (user.remark) remarkByID.set(user.identifier, user.remark);
          }
        } catch {
          /* 辅助行：名字解析失败不报错 */
        }
        if (cancelled) return;
        const names = middleMen.slice(0, 3).map(
          (id) => socialDisplayName({remark: remarkByID.get(id), identifier: id}).primary,
        );
        setKnown({names, total});
      })
      .catch(() => {
        if (!cancelled) setKnown({names: [], total: 0}); // 辅助行失败静默
      });
    return () => {
      cancelled = true;
    };
  }, [jwt, identifier, isSelf]);

  // ── 备注（social.md §5.2：与关注解耦；空串 = 清除；1..64 字符） ──
  const [remark, setRemarkState] = useState<string>();
  const [remarkEditorOpen, setRemarkEditorOpen] = useState(false);
  const [remarkDraft, setRemarkDraft] = useState('');
  const [remarkPending, setRemarkPending] = useState(false);
  const [remarkError, setRemarkError] = useState<unknown>();

  useEffect(() => {
    // profile.remark 与 relations.remark 是同一份数据（settings.md §3.5）
    if (profile) setRemarkState(profile.remark ?? '');
  }, [profile]);

  const submitRemark = async (value: string) => {
    if (!jwt || isSelf || remarkPending) return;
    setRemarkPending(true);
    setRemarkError(undefined);
    try {
      const result = await setRemark(jwt, 'user', identifier, value);
      setRemarkState(result.data.remark ?? value);
      setRemarkEditorOpen(false);
    } catch (error) {
      setRemarkError(error);
    } finally {
      setRemarkPending(false);
    }
  };

  // ── 关注/取关（social.md §5）：乐观更新，失败回滚到 relations 真相 ──
  const [followingOverride, setFollowingOverride] = useState<boolean>();
  const [followPending, setFollowPending] = useState(false);
  const [followError, setFollowError] = useState<unknown>();
  const following = followingOverride ?? relation?.following === true;

  const toggleFollow = async () => {
    if (!jwt || isSelf || followPending) return;
    const next = !following;
    setFollowingOverride(next);
    setFollowPending(true);
    setFollowError(undefined);
    try {
      await (next ? followTarget(jwt, 'user', identifier) : unfollowTarget(jwt, 'user', identifier));
      // §5.5：计数实时计算，重拉即新值，不本地 ±1
      setMutationKey((key) => key + 1);
    } catch (error) {
      setFollowingOverride(undefined);
      setFollowError(error);
    } finally {
      setFollowPending(false);
    }
  };

  // ── 200102（profile 或 follow-counts 任一回它）→ 整页替换为「用户不存在」 ──
  const notFound = businessCodeOf(profileError) === 200102 || businessCodeOf(countsError) === 200102;
  if (notFound) return <UserNotFoundCard />;

  const displayName = profile
    ? socialDisplayName({remark, nickname: profile.nickname, username: profile.username, identifier})
    : undefined;
  const retryHeader = () => setHeaderKey((key) => key + 1);

  return (
    <div className="space-y-5">
      <a href="/" className="text-sm text-muted hover:text-foreground">← 返回</a>

      {/* ── 头部卡片 ── */}
      <header className="rounded-xl border border-border bg-surface p-5">
        {profileError ? (
          <ErrorLine error={profileError} onRetry={retryHeader} pending={profileLoading} />
        ) : profileLoading || !profile ? (
          jwt ? (
            <p className="py-6 text-center text-sm text-muted">加载中…</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate font-mono text-lg font-semibold">{shortIdentifier(identifier)}</h1>
                <p className="mt-1 text-sm text-muted">登录后可查看完整资料与关注关系。</p>
              </div>
              <a href="/login" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white">登录</a>
            </div>
          )
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <Avatar url={profile.avatar_url} name={displayName?.primary ?? identifier} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-lg font-semibold text-foreground" title={displayName?.primary}>
                    {displayName?.primary}
                  </h1>
                  {displayName?.isRemark ? <RemarkBadge /> : null}
                  {relation?.followed_by ? <FollowsYouBadge /> : null}
                </div>
                {profile.username ? <p className="mt-0.5 text-sm text-muted">@{profile.username}</p> : null}
                {profile.bio ? <p className="mt-2 break-words text-sm text-foreground/90">{profile.bio}</p> : null}
                {/* social.md §5.5：两个数字实时，0 是合法答案；只数平台用户 */}
                <p className="mt-2 text-sm text-muted">
                  {`关注 ${counts?.following_count ?? '—'} · 粉丝 ${counts?.follower_count ?? '—'}`}
                  {countsError && businessCodeOf(countsError) !== 200102 ? (
                    <button type="button" onClick={retryHeader} className="ml-2 text-xs text-accent underline">
                      计数加载失败，重试
                    </button>
                  ) : null}
                </p>
                {relationError && !relation ? (
                  <p className="mt-1 text-xs text-down">
                    关注关系加载失败
                    <button type="button" onClick={retryHeader} className="ml-2 text-accent underline">重试</button>
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isSelf ? (
                <a href="/settings/profile" className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:text-accent">
                  编辑资料
                </a>
              ) : jwt ? (
                <>
                  <Button type="button" variant={following ? 'secondary' : 'default'} disabled={followPending} onClick={() => void toggleFollow()}>
                    {following ? 'Following' : 'Follow'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setRemarkDraft(remark ?? '');
                      setRemarkError(undefined);
                      setRemarkEditorOpen((open) => !open);
                    }}
                  >
                    备注
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        )}

        {/* 备注编辑器：保存提交当前输入（留空 = 清除），清除直接置空串 */}
        {remarkEditorOpen && !isSelf && jwt ? (
          <div className="mt-4 rounded-lg border border-border bg-surface-2/40 p-3">
            <p className="text-xs text-muted">当前备注：{remark ? remark : '（未设置）'}</p>
            <Input
              value={remarkDraft}
              maxLength={64}
              onChange={(event) => setRemarkDraft(event.target.value)}
              placeholder="输入备注（1-64 字符，留空清除）"
              className="mt-2"
            />
            <div className="mt-2 flex items-center gap-2">
              <Button type="button" size="sm" disabled={remarkPending} onClick={() => void submitRemark(remarkDraft.trim())}>
                保存
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={remarkPending}
                onClick={() => {
                  setRemarkDraft('');
                  void submitRemark('');
                }}
              >
                清除
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={remarkPending} onClick={() => setRemarkEditorOpen(false)}>
                取消
              </Button>
            </div>
            {remarkError ? (
              <p className="mt-2 text-xs text-down">备注保存失败：{remarkError instanceof Error ? remarkError.message : '未知错误'}</p>
            ) : null}
          </div>
        ) : null}

        {/* 关注动作失败（430100 自己 / 430101 被限制等）完整呈现，便于定位 */}
        {followError ? (
          <div className="mt-4">
            <ErrorLine error={followError} onRetry={() => void toggleFollow()} pending={followPending} />
          </div>
        ) : null}
      </header>

      {/* known-followers 行（social.md §5）：total 封顶 100 → 100+；保持单行、弱化 */}
      {known && known.total > 0 ? (
        <p className="text-xs text-muted">
          {known.names.length > 0 ? `${known.names.join('、')} 等 ` : ''}
          {known.total}
          {known.total >= 100 ? '+' : ''} 人也关注了 TA
        </p>
      ) : null}

      {/* ── Tabs：首次打开才挂载（惰性加载），之后保持挂载避免来回切丢数据 ── */}
      <div className="flex rounded-lg border border-border bg-surface p-1">
        {([
          ['positions', '持仓'],
          ['trades', '交易'],
          ['follows', '关注'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key);
              setVisited((current) => ({...current, [key]: true}));
            }}
            className={`rounded-md px-4 py-2 text-sm ${tab === key ? 'bg-surface-2 text-foreground' : 'text-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {visited.positions ? (
        <section className={tab === 'positions' ? '' : 'hidden'}>
          <PositionsTab identifier={identifier} jwt={jwt} />
        </section>
      ) : null}
      {visited.trades ? (
        <section className={tab === 'trades' ? '' : 'hidden'}>
          <TradesTab identifier={identifier} jwt={jwt} />
        </section>
      ) : null}
      {visited.follows ? (
        <section className={tab === 'follows' ? '' : 'hidden'}>
          <FollowsTab identifier={identifier} jwt={jwt} />
        </section>
      ) : null}
    </div>
  );
}

// ── 持仓 Tab（portfolio.md 第一部分：客态总览 + closed） ────────────────────

function PositionsTab({identifier, jwt}: {identifier: string; jwt?: string}) {
  const [data, setData] = useState<PortfolioReply>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    setError(undefined);
    setLoading(true);
    // Optional 档：匿名可看；坏 JWT 回 400000 且不降级，无会话就绝不传 bearer
    getUserPortfolio(identifier, jwt)
      .then((reply) => {
        if (!cancelled) setData(reply);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [identifier, jwt, reload]);

  const positions = data?.positions ?? [];
  const pnl7 = data?.pnl?.d7?.amount_usd;
  const pnlAll = data?.pnl?.all_usd ?? data?.pnl?.all?.amount_usd;

  return (
    <div className="space-y-4">
      {error ? <ErrorLine error={error} onRetry={() => setReload((key) => key + 1)} pending={loading} /> : null}
      {loading ? <p className="py-10 text-center text-sm text-muted">加载中…</p> : null}
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="总资产" value={money(data.total_assets_usd)} />
            <Stat label="持仓市值" value={money(data.total_value_usd)} />
            <Stat label="现金" value={money(data.cash_balance_usd)} />
            <Stat label="7D 盈亏" value={money(pnl7)} tone={toneClass(pnl7)} />
            <Stat label="累计盈亏" value={money(pnlAll)} tone={toneClass(pnlAll)} />
          </div>
          {data.partial_errors.length > 0 ? (
            <p className="text-xs text-muted">部分链数据不完整（{data.partial_errors.length} 项），数值可能偏低。</p>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <p className="border-b border-border px-4 py-3 text-sm font-semibold">当前持仓</p>
            {positions.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="p-3">Token</th>
                      <th className="p-3 text-right">持仓量</th>
                      <th className="p-3 text-right">成本</th>
                      <th className="p-3 text-right">市值</th>
                      <th className="p-3 text-right">总盈亏</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((position, index) => (
                      <tr key={`${position.asset.chain}:${position.asset.token_address}:${position.opened_entry_id}:${index}`} className="border-t border-border">
                        <td className="p-3">
                          <TokenCell symbol={position.symbol} logo={position.logo} chain={position.asset.chain} address={position.asset.token_address} />
                        </td>
                        <td
                          className="p-3 text-right font-mono"
                          title={position.decimals === undefined ? 'decimals 缺席：展示最小单位原值' : undefined}
                        >
                          {sharesText(position.shares_raw, position.decimals)}
                        </td>
                        <td className="p-3 text-right font-mono">{money(position.cost_basis_usd)}</td>
                        <td className="p-3 text-right font-mono">{money(position.market_value_usd)}</td>
                        <td className={`p-3 text-right font-mono font-semibold ${toneClass(position.total_pnl_usd)}`}>
                          {money(position.total_pnl_usd)}
                          <p className="text-[10px]">{ratioPercent(position.pnl_ratio)}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-8 text-center text-sm text-muted">暂无持仓。</p>
            )}
          </div>

          <ClosedPositions identifier={identifier} jwt={jwt} />
        </>
      ) : null}
    </div>
  );
}

function ClosedPositions({identifier, jwt}: {identifier: string; jwt?: string}) {
  const [items, setItems] = useState<PortfolioClosedPosition[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setCursor(undefined);
    setError(undefined);
    setLoading(true);
    getUserClosedPositions(identifier, '', jwt)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.next_cursor || undefined);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [identifier, jwt, reload]);

  const loadMore = async () => {
    if (!cursor || moreLoading) return;
    setMoreLoading(true);
    setError(undefined);
    try {
      const page = await getUserClosedPositions(identifier, cursor, jwt);
      setItems((current) => [...current, ...page.items]);
      setCursor(page.next_cursor || undefined);
    } catch (cause) {
      if (businessCodeOf(cause) === 100103) {
        // 历史游标过期：清空 cursor 重拉首屏（portfolio.md §1.2）
        setCursor(undefined);
        setReload((key) => key + 1);
      } else {
        setError(cause);
      }
    } finally {
      setMoreLoading(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <p className="border-b border-border px-4 py-3 text-sm font-semibold">已清仓</p>
      {error ? (
        <div className="p-4">
          <ErrorLine
            error={error}
            onRetry={() => {
              setItems([]);
              setCursor(undefined);
              setReload((key) => key + 1);
            }}
            pending={loading || moreLoading}
          />
        </div>
      ) : null}
      {loading ? <p className="py-8 text-center text-sm text-muted">加载中…</p> : null}
      {!loading && !error && items.length === 0 ? <p className="p-8 text-center text-sm text-muted">暂无已清仓记录。</p> : null}
      {items.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="p-3">Token</th>
                <th className="p-3 text-right">已实现盈亏</th>
                <th className="p-3 text-right">收益率</th>
                <th className="p-3 text-right">平仓时间</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${item.closed_entry_id}:${index}`} className="border-t border-border">
                  <td className="p-3">
                    <TokenCell symbol={item.symbol} logo={item.logo} chain={item.asset.chain} address={item.asset.token_address} />
                  </td>
                  <td className={`p-3 text-right font-mono font-semibold ${toneClass(item.realized_pnl_usd)}`}>{money(item.realized_pnl_usd)}</td>
                  <td className="p-3 text-right font-mono">{ratioPercent(item.pnl_ratio)}</td>
                  <td className="p-3 text-right font-mono">{timeProto(item.closed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {cursor && !loading && !error ? (
        <div className="border-t border-border p-3">
          <button type="button" disabled={moreLoading} onClick={() => void loadMore()} className="rounded border border-border px-3 py-1.5 text-xs text-accent disabled:opacity-50">
            {moreLoading ? '加载中…' : '加载更多'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── 交易 Tab（portfolio.md §1.7：before_id 游标分页） ───────────────────────

function TradesTab({identifier, jwt}: {identifier: string; jwt?: string}) {
  const [trades, setTrades] = useState<PortfolioTrade[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setTrades([]);
    setCursor(undefined);
    setError(undefined);
    setLoading(true);
    getUserPortfolioTrades(identifier, '0', 50, jwt)
      .then((page) => {
        if (cancelled) return;
        setTrades(page.trades);
        setCursor(page.next_cursor);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [identifier, jwt, reload]);

  const loadMore = async () => {
    if (!cursor || moreLoading) return;
    setMoreLoading(true);
    setError(undefined);
    try {
      const page = await getUserPortfolioTrades(identifier, cursor, 50, jwt);
      setTrades((current) => [...current, ...page.trades]);
      setCursor(page.next_cursor);
    } catch (cause) {
      if (businessCodeOf(cause) === 100103) {
        setCursor(undefined);
        setReload((key) => key + 1);
      } else {
        setError(cause);
      }
    } finally {
      setMoreLoading(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {error ? (
        <div className="p-4">
          <ErrorLine
            error={error}
            onRetry={() => {
              setTrades([]);
              setCursor(undefined);
              setReload((key) => key + 1);
            }}
            pending={loading || moreLoading}
          />
        </div>
      ) : null}
      {loading ? <p className="py-10 text-center text-sm text-muted">加载中…</p> : null}
      {!loading && !error && trades.length === 0 ? <p className="p-8 text-center text-sm text-muted">暂无交易记录。</p> : null}
      {trades.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="p-3">类型</th>
                <th className="p-3">Token</th>
                <th className="p-3 text-right">金额</th>
                <th className="p-3 text-right">时间</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade, index) => (
                <tr key={`${trade.trade_id}:${index}`} className="border-t border-border">
                  <td className="p-3"><EventBadge side={trade.side} /></td>
                  <td className="p-3" title={trade.token}>
                    <TokenCell symbol={trade.symbol ?? undefined} logo={trade.logo} chain={trade.chain} address={trade.token} />
                  </td>
                  <td className="p-3 text-right font-mono">{money(trade.trade_value_usd)}</td>
                  <td className="p-3 text-right font-mono">{timeRfc3339(trade.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {cursor && !loading && !error ? (
        <div className="border-t border-border p-3">
          <button type="button" disabled={moreLoading} onClick={() => void loadMore()} className="rounded border border-border px-3 py-1.5 text-xs text-accent disabled:opacity-50">
            {moreLoading ? '加载中…' : '加载更多'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── 关注 Tab（social.md §5：following 混合列表 / followers / mutual） ───────

type FollowsKind = 'following' | 'followers' | 'mutual';

const FOLLOWS_TABS: readonly {key: FollowsKind; label: string}[] = [
  {key: 'following', label: '我的关注'},
  {key: 'followers', label: '粉丝'},
  {key: 'mutual', label: '互关'},
];

function followsFetcher(kind: FollowsKind) {
  return kind === 'following' ? getFollowing : kind === 'followers' ? getFollowers : getMutualFollows;
}

function FollowsTab({identifier, jwt}: {identifier: string; jwt?: string}) {
  const [kind, setKind] = useState<FollowsKind>('following');
  const [visited, setVisited] = useState<Record<FollowsKind, boolean>>({following: true, followers: false, mutual: false});
  const open = (next: FollowsKind) => {
    setKind(next);
    setVisited((current) => ({...current, [next]: true}));
  };

  // 关注面是登录端点（social.md §5），匿名没有可渲染的数据
  if (!jwt) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
        登录后可查看关注列表。
        <a href="/login" className="ml-1 text-accent hover:underline">去登录</a>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex gap-1 border-b border-border p-3">
        {FOLLOWS_TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => open(entry.key)}
            className={`rounded px-3 py-1.5 text-xs ${kind === entry.key ? 'bg-surface-2 text-foreground' : 'text-muted'}`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {visited.following ? (
        <div className={kind === 'following' ? '' : 'hidden'}>
          <FollowListPanel jwt={jwt} identifier={identifier} kind="following" />
        </div>
      ) : null}
      {visited.followers ? (
        <div className={kind === 'followers' ? '' : 'hidden'}>
          <FollowListPanel jwt={jwt} identifier={identifier} kind="followers" />
        </div>
      ) : null}
      {visited.mutual ? (
        <div className={kind === 'mutual' ? '' : 'hidden'}>
          <FollowListPanel jwt={jwt} identifier={identifier} kind="mutual" />
        </div>
      ) : null}
    </div>
  );
}

function FollowListPanel({jwt, identifier, kind}: {jwt: string; identifier: string; kind: FollowsKind}) {
  const [entries, setEntries] = useState<FollowEntry[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setEntries([]);
    setCursor(undefined);
    setError(undefined);
    setLoading(true);
    // user_identifier 指定看谁（缺省才是自己）；条目里的 remark 恒是查看者自己的备注（§5）
    followsFetcher(kind)(jwt, {userIdentifier: identifier, limit: 50})
      .then((result) => {
        if (cancelled) return;
        setEntries(result.data.entries ?? []);
        setCursor(result.data.next_cursor || undefined);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jwt, identifier, kind, reload]);

  const loadMore = async () => {
    if (!cursor || moreLoading || loading) return;
    setMoreLoading(true);
    setError(undefined);
    try {
      const result = await followsFetcher(kind)(jwt, {userIdentifier: identifier, cursor, limit: 50});
      setEntries((current) => [...current, ...(result.data.entries ?? [])]);
      setCursor(result.data.next_cursor || undefined);
    } catch (cause) {
      if (businessCodeOf(cause) === 100103) {
        // cursor 损坏/过期/跨列表复用（social.md §1.4）：丢弃游标重拉首屏
        setReload((key) => key + 1);
      } else {
        setError(cause);
      }
    } finally {
      setMoreLoading(false);
    }
  };

  const emptyText = kind === 'following' ? '暂无关注。' : kind === 'followers' ? '暂无粉丝。' : '暂无互关。';

  return (
    <div>
      {error ? (
        <div className="p-4">
          <ErrorLine
            error={error}
            onRetry={() => {
              setEntries([]);
              setCursor(undefined);
              setReload((key) => key + 1);
            }}
            pending={loading || moreLoading}
          />
        </div>
      ) : null}
      {loading ? <p className="py-8 text-center text-sm text-muted">加载中…</p> : null}
      {!loading && !error && entries.length === 0 ? <p className="p-8 text-center text-sm text-muted">{emptyText}</p> : null}
      {entries.map((entry, index) => (
        <FollowEntryRow key={`${entry.target_type}:${entry.user?.identifier ?? entry.smart_money?.address ?? index}:${index}`} entry={entry} />
      ))}
      {cursor && !loading && !error ? (
        <div className="border-t border-border p-3">
          <button type="button" disabled={moreLoading} onClick={() => void loadMore()} className="rounded border border-border px-3 py-1.5 text-xs text-accent disabled:opacity-50">
            {moreLoading ? '加载中…' : '加载更多'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** smart_money 只有身份键 address + 名录 chains（§5）：无资料可渲，地址等宽展示。 */
function FollowEntryRow({entry}: {entry: FollowEntry}) {
  if (entry.target_type === 'smart_money') {
    const sm = entry.smart_money;
    if (!sm) return null;
    const display = socialDisplayName({remark: entry.remark, identifier: sm.address});
    return (
      <div className="flex items-center gap-3 border-t border-border p-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-muted">$</div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-mono text-sm text-foreground" title={sm.address}>
              {display.isRemark ? display.primary : shortAddr(sm.address, 10, 8)}
            </p>
            {display.isRemark ? <RemarkBadge /> : null}
            {(sm.chains ?? []).map((chain) => (
              <span key={chain} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                {chainLabel(chain)}
              </span>
            ))}
          </div>
          {!display.isRemark ? <p className="break-all text-[11px] text-muted">{sm.address}</p> : null}
        </div>
      </div>
    );
  }
  const user = entry.user;
  if (!user) return null;
  const display = socialDisplayName({remark: entry.remark, nickname: user.nickname, username: user.username, identifier: user.identifier});
  return (
    <a href={`/user/${encodeURIComponent(user.identifier)}`} className="flex items-center gap-3 border-t border-border p-3 hover:bg-surface-2/50">
      <Avatar url={user.avatar_url} name={display.primary} size="size-9" />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{display.primary}</p>
          {display.isRemark ? <RemarkBadge /> : null}
        </div>
        {user.username ? <p className="truncate text-[11px] text-muted">@{user.username}</p> : null}
      </div>
    </a>
  );
}
