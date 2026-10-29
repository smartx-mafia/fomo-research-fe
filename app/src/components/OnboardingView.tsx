'use client';

import {useLinkAccount, usePrivy} from '@privy-io/react-auth';
import Link from 'next/link';
import {useCallback, useEffect, useState} from 'react';

import {ApiError} from '@/api/envelope';
import {getInviteStatus, type InviteStatusReply} from '@/api/invite';
import {
  firstPrompt,
  getOnboarding,
  ONBOARDING_FEATURES,
  ONBOARDING_FEATURE_LABELS,
  skipOnboarding,
  type OnboardingItem,
} from '@/api/onboarding';
import {setNickname as setNicknameApi, validateNickname} from '@/api/user';
import {BindInviteCard} from '@/components/BindInviteCard';
import {ErrorPanel} from '@/components/ErrorPanel';
import {RecommendedTradersCard} from '@/components/RecommendedTradersCard';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {useXBind} from '@/hooks/useXBind';
import {useEventLog} from '@/hooks/useEventLog';
import {useSession} from '@/session/storage';

/**
 * 引导页（onboarding.md）：服务端说该弹哪个就处理哪个。
 *
 * 规则都在契约里、这里只做搬运：
 * - 取 items 里**第一个** should_prompt 的项（firstPrompt），其余不弹；
 * - `invite` 不能 skip —— 它的「跳过」产品动作就是无码 bind（也是准入），
 *   复用与 /invite 页共用的 BindInviteCard；`default_bind_enabled` 来自
 *   同一次 refresh() 里的 GET /v1/invite/status（true 才渲染「跳过」）；
 * - nickname / x_bind 的「以后再说」走 POST /v1/user/onboarding/skip，
 *   幂等、单向、没有撤销；recommended_traders 的 skip 在卡片的 CTA 里一并调；
 * - 读到不认识的 feature 就跳过它，不要崩（onboarding.md §3）—— 但**不要
 *   替用户 skip**：只提示「需要更新前端版本」，此时其余步骤卡都不渲染。
 */

/** 在册功能点码集合（onboarding.md §3）：用来识别「老前端不认识的新引导项」。 */
const KNOWN_FEATURES: ReadonlySet<string> = new Set(ONBOARDING_FEATURES);
export function OnboardingView() {
  const session = useSession();
  const jwt = session?.jwt ?? null;
  const log = useEventLog();
  const {ready} = usePrivy();

  const [items, setItems] = useState<OnboardingItem[] | null>(null);
  const [status, setStatus] = useState<InviteStatusReply | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [nickname, setNickname] = useState('');

  const xbind = useXBind(jwt, log);

  /**
   * Privy 通道（x-import.md §6.1）：先让用户在 Privy 弹窗里连 X，
   * onSuccess 后**立刻**调 bind/privy —— 服务端只信自己向 Privy 拉的
   * 权威数据，回包才是绑定成立的时刻。
   */
  const {linkTwitter} = useLinkAccount({
    onSuccess: () => {
      void xbind.bindViaPrivy().then(async (ok) => {
        if (!ok) {
          log.push('warn', 'Privy 侧还没连上 X', '在弹窗里完成 X 授权后再点一次');
          return;
        }
        await refresh();
      });
    },
    onError: (e) => log.push('error', 'Privy 连接 X 失败', String(e)),
  });

  const refresh = useCallback(async () => {
    if (!jwt) return;
    try {
      const [ob, st] = await Promise.all([
        getOnboarding(jwt),
        // 引导判定的风向标：next_action 与 default_bind_enabled 都从这里读（invite.md §2.2）。
        getInviteStatus(jwt).catch((e: unknown) => {
          const apiErr = e as ApiError;
          if (apiErr.kind === 'business' && apiErr.code === 430114) return null; // 残留态，不是报错页
          throw e;
        }),
      ]);
      setItems(ob.data.items);
      setStatus(st?.data ?? null);
      setErr(null);
    } catch (e) {
      setErr(e as ApiError);
    }
  }, [jwt]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 完成昵称引导后同步本地会话里的 user（SessionCard / 顶栏都读它）。
  useEffect(() => {
    if (session?.user?.nickname) setNickname(session.user.nickname);
  }, [session?.user?.nickname]);

  if (!jwt) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6 text-sm">
          <p>引导状态是「我的」状态，需要先登录。</p>
          <Link href="/login">
            <Button size="sm">去登录</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const active = items ? firstPrompt(items) : null;

  /** 执行一个动作并重拉引导状态。写接口的回包不需要单独处理 —— 引导真源在 GET。 */
  const run = async (step: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      log.push('ok', step, '完成');
    } catch (e) {
      const apiErr = e as ApiError;
      setErr(apiErr);
      log.push('error', step, `${apiErr.code} ${apiErr.message}`, {traceID: apiErr.traceID});
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">引导</h1>
        <p className="text-muted-foreground text-sm">
          顺序与「该不该弹」由服务端决定（GET /v1/user/onboarding）；全部完成或跳过后不再出现。
        </p>
      </header>

      {/* 全量清单：done / skipped / 待办一目了然（列表本身恒非空）。 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">引导清单</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-sm">
            {(items ?? []).map((item) => (
              <li key={item.feature} className="flex items-center gap-2">
                <span className="w-40 shrink-0">
                  {ONBOARDING_FEATURE_LABELS[item.feature] ?? item.feature}
                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">{item.feature}</span>
                </span>
                {item.done ? (
                  <span className="text-xs text-emerald-500">已完成</span>
                ) : item.skipped ? (
                  <span className="text-muted-foreground text-xs">已跳过</span>
                ) : item.should_prompt ? (
                  <span className="text-xs text-amber-500">待办</span>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </li>
            ))}
            {items && items.length === 0 && (
              <li className="text-muted-foreground text-xs">items 为空（与契约不符，刷新看看）</li>
            )}
          </ul>
        </CardContent>
      </Card>

      {/* ── 步骤 1：invite 准入（复用 /invite 页的 BindInviteCard） ──
          输入正则、逐码处置、Skip 只在 default_bind_enabled=true 时渲染等
          契约义务全在 BindInviteCard 里；这里只喂 /status 的两个判定字段。
          标题展示服务端算好的 next_action（invite.md §2.2：enter/bind/wait）。 */}
      {active?.feature === 'invite' && (
        <BindInviteCard
          bearer={jwt}
          // default_bind_enabled 只在 true 时渲染「跳过」；/status 没拉到（null）先不渲染。
          defaultBindEnabled={status?.default_bind_enabled ?? null}
          onBound={() => void refresh()}
          onWait={() => void refresh()}
          busy={busy}
          heading={status ? `① 邀请准入 · 当前 next_action=${status.next_action}` : '① 邀请准入'}
        />
      )}

      {/* ── 步骤 2：nickname ── */}
      {active?.feature === 'nickname' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">② 设置昵称</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="1–64 个字符"
                className="max-w-xs"
              />
              <Button
                size="sm"
                disabled={busy || !!validateNickname(nickname)}
                onClick={() => void run('POST /v1/user/nickname', () => setNicknameApi(jwt, nickname.trim()))}
              >
                {busy ? '保存中…' : '保存昵称'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run('POST /v1/user/onboarding/skip (nickname)', () => skipOnboarding(jwt, 'nickname'))}
              >
                以后再说
              </Button>
            </div>
            {validateNickname(nickname) && <p className="text-xs text-red-500">{validateNickname(nickname)}</p>}
          </CardContent>
        </Card>
      )}

      {/* ── 步骤 3：x_bind ── */}
      {active?.feature === 'x_bind' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">③ 绑定 X（Twitter）账号</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {xbind.state.kind === 'bound' ? (
              <p className="text-xs text-emerald-500">
                已绑定 @{xbind.state.binding.profile?.username ?? '?'}（关注导入
                {xbind.state.binding.follow_import?.status === 2
                  ? `完成，${xbind.state.binding.follow_import.count ?? 0} 条`
                  : '进行中'}
                ）—— 刷新引导清单确认 done。
              </p>
            ) : (
              <>
                <p className="text-muted-foreground text-xs">
                  两条通道等价：官方 X OAuth（跳转授权页）或 Privy 通道（页内弹窗）。绑定是身份关联，不影响登录方式。
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href="/login/x">
                    <Button size="sm" variant="outline">
                      官方 X OAuth 通道
                    </Button>
                  </Link>
                  <Button
                    size="sm"
                    disabled={!ready || xbind.busy}
                    onClick={() => linkTwitter()}
                  >
                    {xbind.busy ? '绑定中…' : 'Privy 通道绑定'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run('POST /v1/user/onboarding/skip (x_bind)', () => skipOnboarding(jwt, 'x_bind'))}
                  >
                    以后再说
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── 步骤 4：recommended_traders（social.md §5.4） ──
          榜、单行关注、批量关注与 skip 全在 RecommendedTradersCard 里；
          onDone 只负责重拉引导状态（真源在 GET /v1/user/onboarding）。 */}
      {active?.feature === 'recommended_traders' && (
        <RecommendedTradersCard bearer={jwt} busy={busy} onDone={() => void refresh()} />
      )}

      {/* ── 不认识的 feature（onboarding.md §3：跳过它、不当错误、不崩） ──
          新引导项上线时老版本暂时处理不了：不替用户 skip（那是单向的），
          只提示升级前端；此时上面四张步骤卡都不渲染。 */}
      {active && !KNOWN_FEATURES.has(active.feature) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">待更新的引导项</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>这个引导项需要更新前端版本才能处理。清单里其余已完成 / 已跳过的项不受影响。</p>
            <p className="font-mono text-xs text-muted-foreground">feature: {active.feature}</p>
          </CardContent>
        </Card>
      )}

      {items && !active && (
        <Card>
          <CardContent className="p-6 text-sm">
            没有待办引导了。去
            <Link href="/" className="mx-1 underline underline-offset-2">
              发现页
            </Link>
            或
            <Link href="/settings" className="mx-1 underline underline-offset-2">
              设置中心
            </Link>
            。
          </CardContent>
        </Card>
      )}

      {xbind.err && <ErrorPanel err={xbind.err} />}
      {err && <ErrorPanel err={err} />}
    </div>
  );
}
