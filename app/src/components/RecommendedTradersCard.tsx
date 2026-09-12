'use client';

/**
 * 引导步骤 ④「关注推荐交易者」（social.md §5.4 + onboarding.md §3 功能点码表）。
 *
 * 契约义务全部落在这一个卡里：
 * - 进页拉 GET /v1/social/recommended-traders（无副作用，拉多少次都不写关注）：
 *   最多 10 行、按 rank 升序，rank 是列表位次不是全站名次；
 * - 空列表**不是错误**（不足 10 人 / 已全部关注 / 榜不可用，三种来源同一形状），
 *   按 PRD 展示「可稍后在 People 关注交易者」并允许继续；榜不可用
 *   （as_of 全零对象）时加一句灰字说明；
 * - `pnl_usd` 是 7 天 PnL 的美元十进制字符串 —— **不要转 float**，按字符串
 *   裁小数尾零、整数千分位分组后加 $ 前缀；`window` 恒 "7d"，标签写「7D P&L」；
 * - 勾选初值取服务端 `preselected`（规则归服务端，当前 = 前三，**不要写死**）；
 * - 单行「Follow」走既有 POST /v1/social/follows（target_type='user'）；
 * - 底部 CTA「Follow N and continue」：N>0 先 POST /v1/social/follows/batch，
 *   然后**不论关注了几个**（零也算完成）都调 POST /v1/user/onboarding/skip
 *   记 `recommended_traders`，否则下次冷启动还会弹；最后交父组件 refresh()。
 *   整批失败时一条边都不落 —— 手动重试即**原样重发同一份列表**（已成功的
 *   回 outcome=2 幂等，不用记差集）。
 */
import {useCallback, useEffect, useState} from 'react';

import {ApiError} from '@/api/envelope';
import {skipOnboarding} from '@/api/onboarding';
import {
  batchFollowUsers,
  followTarget,
  getRecommendedTraders,
  type RecommendedTrader,
  type RecommendedTradersReply,
} from '@/api/social';
import {ErrorPanel} from '@/components/ErrorPanel';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';

/**
 * 美元十进制字符串 → 展示串：全程字符串操作，不经过 Number / parseFloat
 * （精度必须原样保留，social.md §5.4）。裁小数尾零、整数部分千分位、加 $。
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

/** 展示名兜底链：nickname → @username → 未设置用户名；两者都在时同时展示。 */
function displayName(user: RecommendedTrader['user']): {primary: string; secondary: string | null} {
  const nickname = user.nickname ?? '';
  const username = user.username ?? '';
  const handle = username ? `@${username}` : null;
  if (nickname) return {primary: nickname, secondary: handle};
  return {primary: handle ?? '未设置用户名', secondary: null};
}

export function RecommendedTradersCard({
  bearer,
  onDone,
  busy = false,
}: {
  bearer: string;
  /** 关注/跳过收尾后交给父组件 refresh()（引导真源在 GET /v1/user/onboarding）。 */
  onDone: () => void;
  /** 父组件层面的忙碌（刷新引导状态期间）。 */
  busy?: boolean;
}) {
  const [reply, setReply] = useState<RecommendedTradersReply | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<ApiError | null>(null);
  /** 勾选集合（identifier）。初值 = 服务端 preselected，规则改了不发版。 */
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  /** 已关注的行（单行 Follow 成功或批量回执 1/2）：按钮与勾选框一起禁用。 */
  const [followed, setFollowed] = useState<ReadonlySet<string>>(new Set());
  /** 交互失败（单行关注 / 批量关注 / skip）。批量失败重发同一份列表即可。 */
  const [actionErr, setActionErr] = useState<ApiError | null>(null);
  const [rowPending, setRowPending] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await getRecommendedTraders(bearer);
      setReply(res.data);
      // preselected 规则归服务端（social.md §5.4），不要自己写死「前三」。
      setChecked(new Set((res.data.traders ?? []).filter((t) => t.preselected).map((t) => t.user.identifier)));
    } catch (e) {
      setLoadErr(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [bearer]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 单行 Follow（POST /v1/social/follows，target_type='user'）。成功后该行置灰。 */
  const followOne = async (identifier: string) => {
    setRowPending(identifier);
    setActionErr(null);
    try {
      await followTarget(bearer, 'user', identifier);
      setFollowed((prev) => new Set(prev).add(identifier));
      // 已关注的行不再计入 CTA 的 N。
      setChecked((prev) => {
        const next = new Set(prev);
        next.delete(identifier);
        return next;
      });
    } catch (e) {
      setActionErr(e as ApiError);
    } finally {
      setRowPending(null);
    }
  };

  /**
   * 底部 CTA：先批量关注勾选行（N>0 才发；空数组虽合法但零关注时没必要），
   * 然后不论关注了几个都 skip 记 recommended_traders（onboarding.md §2 ——
   * 不 skip 下次冷启动还会弹），最后 onDone → 父组件 refresh()。
   * 整批失败一条边都不落：在这里接住报错，用户手动重试即原样重发同一份
   * 列表（已成功的回 outcome=2，其余再试一次）。
   */
  const followCheckedAndContinue = async () => {
    const identifiers = (reply?.traders ?? [])
      .filter((t) => checked.has(t.user.identifier))
      .map((t) => t.user.identifier);
    setSubmitting(true);
    setActionErr(null);
    try {
      if (identifiers.length > 0) {
        const res = await batchFollowUsers(bearer, identifiers);
        // 回执按请求顺序逐目标一行：1=FOLLOWED 2=ALREADY_FOLLOWING 都算完成；
        // 3=NOT_FOUND 4=RESTRICTED 未落库，不拦「继续」（契约只要求记 skip）。
        const done = (res.data.results ?? [])
          .filter((r) => r.outcome === 1 || r.outcome === 2)
          .map((r) => r.user_identifier);
        if (done.length > 0) setFollowed((prev) => new Set([...prev, ...done]));
      }
      await skipOnboarding(bearer, 'recommended_traders');
      onDone();
    } catch (e) {
      setActionErr(e as ApiError);
    } finally {
      setSubmitting(false);
    }
  };

  const traders = reply?.traders ?? [];
  // as_of 全零对象（{"seconds":0} 或缺席）= 榜不可用（还没算出第一轮 / 数据陈旧）。
  // protojson 的 int64 可能回字符串，统一 Number 后判断。
  const asOfSeconds = Number(reply?.as_of?.seconds ?? 0);
  const leaderboardNotReady = !(asOfSeconds > 0);
  const inFlight = submitting || busy;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">④ 关注推荐交易者</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loadErr ? (
          <div className="space-y-2">
            <ErrorPanel err={loadErr} />
            <Button size="sm" variant="outline" onClick={() => void load()}>
              重试
            </Button>
          </div>
        ) : loading ? (
          <p className="text-muted-foreground text-sm">榜单加载中…</p>
        ) : traders.length === 0 ? (
          // 空列表不是错误（social.md §5.4）：按 PRD 给兜底文案 + 可继续。
          <div className="space-y-3">
            <p className="text-sm">暂时没有推荐，可稍后在 People 关注交易者</p>
            {leaderboardNotReady && (
              <p className="text-muted-foreground text-xs">榜单还没算好（每小时重算一次），数据就绪后这里会列出推荐。</p>
            )}
            <Button size="sm" disabled={inFlight} onClick={() => void followCheckedAndContinue()}>
              {submitting ? '提交中…' : '继续'}
            </Button>
          </div>
        ) : (
          <>
            <div className="divide-y rounded-md border">
              {traders.map((t) => {
                const isFollowed = followed.has(t.user.identifier);
                const name = displayName(t.user);
                const initial = (t.user.nickname || t.user.username || '?').trim().charAt(0).toUpperCase() || '?';
                return (
                  <div key={t.user.identifier} className="flex items-center gap-3 p-3">
                    {/* ui/ 下没有 checkbox 原语：用原生 input 配暗色主题样式。 */}
                    <input
                      type="checkbox"
                      aria-label={`关注 ${name.primary}`}
                      className="accent-primary size-4 shrink-0"
                      checked={checked.has(t.user.identifier)}
                      disabled={isFollowed || inFlight}
                      onChange={(e) =>
                        setChecked((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(t.user.identifier);
                          else next.delete(t.user.identifier);
                          return next;
                        })
                      }
                    />
                    <span className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground">{t.rank}</span>
                    {t.user.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 头像 URL 由后端下发，next/image 优化域名不可枚举
                      <img src={t.user.avatar_url} alt="" className="size-8 shrink-0 rounded-full object-cover" />
                    ) : (
                      // avatar_url 可为空串（未设置）—— 纯圆圈 + 首字母兜底。
                      <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs">
                        {initial}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{name.primary}</p>
                      {name.secondary && <p className="text-muted-foreground truncate text-xs">{name.secondary}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      {/* window 恒 "7d" —— 标签固定写「7D P&L」（social.md §5.4）。 */}
                      <p className="text-muted-foreground text-[10px] tracking-wide uppercase">7D P&L</p>
                      <p className="font-mono text-sm">{formatPnlUsd(t.pnl_usd)}</p>
                    </div>
                    <Button
                      size="sm"
                      variant={isFollowed ? 'outline' : 'default'}
                      disabled={isFollowed || rowPending === t.user.identifier || inFlight}
                      onClick={() => void followOne(t.user.identifier)}
                    >
                      {isFollowed ? '已关注' : rowPending === t.user.identifier ? '关注中…' : 'Follow'}
                    </Button>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={inFlight} onClick={() => void followCheckedAndContinue()}>
                {submitting ? '提交中…' : `Follow ${checked.size} and continue`}
              </Button>
              <span className="text-muted-foreground text-xs">
                勾选要关注的行；点继续后不论关注了几个都记为完成（onboarding.md §2 的 skip）。
              </span>
            </div>
          </>
        )}
        {actionErr && <ErrorPanel err={actionErr} />}
      </CardContent>
    </Card>
  );
}
