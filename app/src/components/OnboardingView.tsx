'use client';

import {useLinkAccount, usePrivy} from '@privy-io/react-auth';
import Link from 'next/link';
import {useCallback, useEffect, useState} from 'react';

import {ApiError} from '@/api/envelope';
import {bindInvite, getInviteStatus, INVITE_CODE_RE, normalizeCode, type InviteStatusReply} from '@/api/invite';
import {
  firstPrompt,
  getOnboarding,
  ONBOARDING_FEATURE_LABELS,
  skipOnboarding,
  type OnboardingItem,
} from '@/api/onboarding';
import {setNickname as setNicknameApi, validateNickname} from '@/api/user';
import {ErrorPanel} from '@/components/ErrorPanel';
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
 * - 取 items 里**第一个** should_prompt 的项，其余不弹；
 * - `invite` 不能 skip —— 它的「跳过」产品动作就是无码 bind（也是准入）；
 * - nickname / x_bind 的「以后再说」走 POST /v1/user/onboarding/skip，
 *   幂等、单向、没有撤销；
 * - 读到不认识的 feature 直接当作「没有待办」，不崩（新引导项上线时
 *   老版本只是暂时不弹）。
 */
export function OnboardingView() {
  const session = useSession();
  const jwt = session?.jwt ?? null;
  const log = useEventLog();
  const {ready} = usePrivy();

  const [items, setItems] = useState<OnboardingItem[] | null>(null);
  const [status, setStatus] = useState<InviteStatusReply | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
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
        // 引导判定的风向标：admission_optional 与 phase 都从这里读（invite.md §3.3）。
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
  const inviteItem = items?.find((i) => i.feature === 'invite');
  const xItem = items?.find((i) => i.feature === 'x_bind');

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

  const normalizedInvite = normalizeCode(inviteCode);
  const inviteFormatOk = INVITE_CODE_RE.test(normalizedInvite);

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

      {/* ── 步骤 1：invite 准入 ── */}
      {inviteItem && !inviteItem.done && inviteItem.should_prompt && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">① 邀请准入</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-xs">
              {status
                ? `阶段 ${status.phase}` +
                  (status.admission_optional ? ' · 当前不强制准入（bind 仍可主动绑上级）' : ' · 需要完成准入')
                : '…'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="邀请码（8 位，可留空走默认）"
                className="max-w-xs font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                size="sm"
                disabled={busy || (inviteCode.trim() !== '' && !inviteFormatOk)}
                onClick={() =>
                  void run('POST /v1/invite/bind（带码）', () =>
                    bindInvite(jwt, inviteCode.trim() === '' ? undefined : normalizedInvite),
                  )
                }
              >
                {busy ? '绑定中…' : '绑定邀请码'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                title="invite 的「跳过」= 无码 bind，也是准入（onboarding.md §2）"
                onClick={() => void run('POST /v1/invite/bind（无码准入）', () => bindInvite(jwt))}
              >
                跳过（无码准入）
              </Button>
            </div>
            {inviteCode.trim() !== '' && !inviteFormatOk && (
              <p className="text-xs text-red-500">邀请码是 8 位小写字母数字（不收 @handle）</p>
            )}
            <p className="text-muted-foreground text-[11px]">
              上级一次绑定永不改变；绑错的唯一补救是注销重來。默认绑定开着时无码跳过即准入。
            </p>
          </CardContent>
        </Card>
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
