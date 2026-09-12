'use client';

import {
  getIdentityToken,
  useIdentityToken,
  useLoginWithOAuth,
  usePrivy,
} from '@privy-io/react-auth';
import Link from 'next/link';
import {useCallback, useEffect, useRef, useState} from 'react';

import {getUserInfo, login, type AuthMethod, type UserInfo} from '@/api/auth';
import {ApiError} from '@/api/envelope';
import {
  getInviteStatus,
  normalizeNextAction,
  type InviteInfoReply,
  type InviteNextAction,
  type InviteStatusReply,
} from '@/api/invite';
import {firstPrompt, getOnboarding, type OnboardingItem} from '@/api/onboarding';
import {BindInviteCard} from '@/components/BindInviteCard';
import {EmailOtpCard} from '@/components/EmailOtpCard';
import {ErrorPanel} from '@/components/ErrorPanel';
import {EventLog} from '@/components/EventLog';
import {OAuthCard} from '@/components/OAuthCard';
import {PrivyStatusCard} from '@/components/PrivyStatusCard';
import {SelfCheckCard} from '@/components/SelfCheckCard';
import {SessionCard} from '@/components/SessionCard';
import {WalletProvisionCard} from '@/components/WalletProvisionCard';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {BUSINESS_ORIGIN_LABEL, missingConfig, PRIVY_APP_ID} from '@/config';
import {useEventLog} from '@/hooks/useEventLog';
import {useOAuthAvail} from '@/hooks/useOAuthAvail';
import {clearSite, readSite, writeSite, type SiteSession} from '@/session/storage';

/** OAuth 是整页重定向，跳走前把上下文寄存在这里，回来才续得上日志。 */
const OAUTH_PENDING = 'smartx-login-fe.oauth_pending';

/** 邀请链接 ?invite_code= 的落地暂存：登录成功后预填进绑定卡。 */
const PENDING_INVITE = 'smartx-login-fe.pending_invite';

/**
 * 登录联调台（自 privy-login-demo 的 App.tsx 迁移；X 绑定拆到 /login/x）。
 * 路径不变量：OAuth / X 的回调都整页跳回 /login*，由 Privy SDK 在此收尾。
 *
 * 2026-09-11 起登录不再收码、不再因邀请域失败：任何阶段都建号发 JWT。
 * 新用户流程在登录成功之后 —— GET /v1/invite/status 按 next_action 分支
 * （invite.md §2.2）：enter 进 App / bind 绑定邀请码 / wait 倒计时等待。
 * 引导判定（GET /v1/user/onboarding）继续只提示、不拦路。
 */
export function LoginBench() {
  const {ready, authenticated, user, logout} = usePrivy();
  // 这个值只用来**显示**。换取路径一律用命令式的 getIdentityToken()，理由见 exchange()。
  const {identityToken} = useIdentityToken();
  const log = useEventLog();
  const avail = useOAuthAvail();

  const [session, setSession] = useState<SiteSession | null>(null);
  const [exchanging, setExchanging] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [infoResult, setInfoResult] = useState<UserInfo | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  /** 登录成功后的准入判定（invite.md §2.2：每次登录成功都调 /status）。 */
  const [admission, setAdmission] = useState<InviteStatusReply | null>(null);
  /** 绑定成功时顺手缓存的邀请页数据（invite.md §4.4：回包本身就是邀请页数据）。 */
  const [boundInfo, setBoundInfo] = useState<InviteInfoReply | null>(null);
  /** bind_opens_at 的倒计时（wait 态）；到点后重新调 /status，不直接调 bind。 */
  const [waitLeft, setWaitLeft] = useState(0);
  /** 登录成功后的引导判定（onboarding.md：冷启动调一次，取首个 should_prompt）。 */
  const [prompt, setPrompt] = useState<OnboardingItem | null>(null);

  const methodRef = useRef<AuthMethod>('AUTH_METHOD_EMAIL');

  const missing = missingConfig();

  // localStorage 读取放到挂载后：SSR 阶段没有 localStorage，服务端渲染时
  // readSite() 会抛错。跨标签页同步也在这里一并接上。
  useEffect(() => {
    setSession(readSite());

    // 邀请链接（/login?invite_code=xxxx）：暂存码、洗掉 URL。登录成功若还需
    // 绑定，用它预填绑定卡；分享链接仍带在 /invite 页可复制。
    const params = new URLSearchParams(window.location.search);
    const fromLink = params.get('invite_code');
    if (fromLink) {
      sessionStorage.setItem(PENDING_INVITE, fromLink.trim().toLowerCase());
      params.delete('invite_code');
      const rest = params.toString();
      history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
      log.push('info', '收到邀请链接的邀请码', '登录成功后将在绑定步骤预填');
    }

    const onStorage = () => setSession(readSite());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // wait 态倒计时：到点后**重新调 /status**（窗口可被运营改，不要直接调 bind）。
  useEffect(() => {
    const opensAt = Number(admission?.bind_opens_at ?? 0);
    if (!opensAt || normalizeNextAction(admission?.next_action) !== 'wait') {
      setWaitLeft(0);
      return;
    }
    const tick = () => setWaitLeft(Math.max(0, opensAt - Math.floor(Date.now() / 1000)));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [admission]);

  // 同时有 EVM/Solana 钱包时 type 都是 wallet；去重避免重复 React key 与重复徽章。
  const linkedTypes = [...new Set((user?.linkedAccounts ?? []).map((a) => a.type))];

  /** OAuth 回跳收尾：接线常驻在页面层，否则跳回来时组件没挂载，收不了尾。 */
  const oauth = useLoginWithOAuth({
    onComplete: ({isNewUser}) => {
      setOauthBusy(false);
      const pending = sessionStorage.getItem(OAUTH_PENDING);
      sessionStorage.removeItem(OAUTH_PENDING);
      log.push('ok', 'OAuth 登录完成', `provider=${pending ?? '?'} isNewUser=${String(isNewUser)}`);
      // 洗掉 URL 上的回调参数：留着的话刷新会重放一次登录，
      // 症状是「我明明退了，刷新又登进去了」。
      history.replaceState(null, '', location.pathname);
    },
    onError: (e) => {
      setOauthBusy(false);
      sessionStorage.removeItem(OAUTH_PENDING);
      log.push('error', 'OAuth 登录失败', String(e));
    },
  });

  /**
   * identity token → 本站 JWT。
   *
   * **必须现取 identity token，不能用 useIdentityToken() 的渲染快照** ——
   * 闭包里那个串可能已过期，后端回 400100，排查方向会被带偏。
   */
  const exchange = useCallback(
    async (method: AuthMethod): Promise<void> => {
      setExchanging(true);
      setErr(null);
      setInfoResult(null);
      methodRef.current = method;
      try {
        // 第二轮只为 400100 而存在，且只有一次：token 过期（重取能自愈）与
        // app 不匹配（永远不会自愈）要区分开，无限重试只会打满 Privy 限流。
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            log.begin('换取本站 token');
            const idt = await getIdentityToken();
            if (!idt) {
              const detail = authenticated
                ? 'Privy 已登录却拿不到 identity token —— 多半是该 app 没开 identity token（Dashboard → User management → Authentication → Advanced → 「Return user data in an identity token」）'
                : 'Privy 未登录';
              log.end('error', '换取本站 token', `identity token 取不到（null）：${detail}`);
              setErr(new ApiError('network', 0, `identity token 取不到（null）：${detail}`));
              return;
            }
            const res = await login(method, idt);
            const meta = {
              at: Date.now(),
              is_new: res.data.is_new,
              auth_method: method,
              trace_id: res.traceID,
              origin: BUSINESS_ORIGIN_LABEL,
            };
            const ok = writeSite(res.data.token, res.data.user, meta);
            setStorageFailed(!ok);
            setSession({jwt: res.data.token, user: res.data.user, meta});
            log.end(
              'ok',
              '换取本站 token',
              // is_new 只说明「本次调用建了行」，不等于首次登录（webhook 可能抢先建号）。
              `identifier=${res.data.user.identifier} is_new=${String(res.data.is_new)}`,
              res.traceID,
            );
            await afterLogin(res.data.token);
            return;
          } catch (e) {
            const apiErr = e as ApiError;
            log.end('error', '换取本站 token', `${apiErr.code} ${apiErr.message}`, apiErr.traceID);
            // 2026-09-11 起登录不再有邀请域分支（430115~430119 已从登录消失）。
            const retriable =
              apiErr.kind === 'business' && apiErr.code === 400100 && attempt === 0;
            if (!retriable) {
              setErr(apiErr);
              return;
            }
            log.push('warn', '400100，重取 identity token 后再试一次');
          }
        }
      } finally {
        setExchanging(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [log, authenticated],
  );

  /**
   * 登录成功之后的两件事（顺序不敏感、互不拦路）：
   * ① GET /v1/invite/status —— 按 next_action 分支（invite.md §2.2）；
   * ② GET /v1/user/onboarding —— 只提示待办，不拦使用（查不出来宁可少弹）。
   */
  const afterLogin = useCallback(
    async (jwt: string) => {
      try {
        const st = await getInviteStatus(jwt);
        setAdmission(st.data);
        setBoundInfo(null);
        log.push(
          'info',
          '准入判定（GET /v1/invite/status）',
          `next_action=${st.data.next_action} phase=${st.data.phase ?? ''}`,
          {traceID: st.traceID},
        );
      } catch (e) {
        const apiErr = e as ApiError;
        setAdmission(null);
        log.push('error', '准入判定失败', `${apiErr.code} ${apiErr.message}`, {traceID: apiErr.traceID});
      }
      try {
        const ob = await getOnboarding(jwt);
        const first = firstPrompt(ob.data.items);
        setPrompt(first);
        if (first) {
          log.push('info', '引导判定', `首个待办：${first.feature}`);
        }
      } catch {
        setPrompt(null);
      }
    },
    [log],
  );

  /** 绑定成功（含 430111 并发）：重拉 /status 确认 enter。 */
  const onBound = useCallback(
    (_info: InviteInfoReply | null) => {
      if (!session?.jwt) return;
      sessionStorage.removeItem(PENDING_INVITE);
      void afterLogin(session.jwt);
    },
    [session?.jwt, afterLogin, log],
  );

  /** wait 到点 / 手动重查：重新调 /status，不直接调 bind（invite.md §4.6）。 */
  const recheckAdmission = useCallback(() => {
    if (!session?.jwt) return;
    log.push('info', '重新判定准入', '倒计时结束 / 手动刷新 → GET /v1/invite/status');
    void afterLogin(session.jwt);
  }, [session?.jwt, afterLogin, log]);

  async function fetchInfo() {
    if (!session) return;
    setFetching(true);
    setErr(null);
    try {
      log.begin('GET /v1/user/info');
      const res = await getUserInfo(session.jwt);
      setInfoResult(res.data);
      log.end('ok', 'GET /v1/user/info', `identifier=${res.data.identifier}`, res.traceID);
    } catch (e) {
      const apiErr = e as ApiError;
      setErr(apiErr);
      log.end('error', 'GET /v1/user/info', `${apiErr.code} ${apiErr.message}`, apiErr.traceID);
    } finally {
      setFetching(false);
    }
  }

  function clearSiteToken() {
    clearSite();
    setSession(null);
    setInfoResult(null);
    setErr(null);
    setAdmission(null);
    setBoundInfo(null);
    setPrompt(null);
    log.push('info', '已清除本站 token（Privy 会话保持不变）');
  }

  async function fullLogout() {
    // 先清本站，再退 Privy —— 反过来的话页面会闪一下
    // 「Privy 未登录但本站有效」。
    clearSite();
    setSession(null);
    setInfoResult(null);
    setErr(null);
    setAdmission(null);
    setBoundInfo(null);
    setPrompt(null);
    sessionStorage.removeItem(OAUTH_PENDING);
    // **不手删 privy: 开头的键** —— 那会让 SDK 的内存态与存储不一致。
    await logout();
    history.replaceState(null, '', location.pathname);
    log.push('info', '已全部退出并清空');
  }

  if (missing.length > 0) {
    return (
      <div className="mx-auto max-w-2xl p-6 font-mono text-sm leading-7 text-red-500">
        登录域缺配置：{missing.join('、')}。复制 .env.example 成 .env.local 并填上。
      </div>
    );
  }

  const nextAction: InviteNextAction | null = session
    ? admission
      ? normalizeNextAction(admission.next_action)
      : null
    : null;

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="default">
          登录联调台
        </Button>
        <Link href="/login/x">
          <Button size="sm" variant="outline">
            X 账号绑定
          </Button>
        </Link>
        <Link href="/">
          <Button size="sm" variant="outline">
            ← 行情页
          </Button>
        </Link>
      </nav>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold">SmartX 登录联调台</h1>
        <p className="text-muted-foreground text-sm">
          登录（=注册）→ identity token → POST /v1/auth/login → 本站 JWT（localStorage 保留）→ 按
          /v1/invite/status 的 next_action 走准入。
        </p>
        <p className="text-muted-foreground font-mono text-[11px]">
          appId={PRIVY_APP_ID} · 后端={BUSINESS_ORIGIN_LABEL}
        </p>
      </header>

      {storageFailed && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          <strong>写不进 localStorage</strong>（隐私模式或企业策略）。
          当前会话只在内存里，刷新即失 —— 不是登录失败。
        </p>
      )}

      {/* ── 准入分支（invite.md §2.2）：登录成功后唯一要看的字段 next_action ── */}
      {session && nextAction === 'bind' && (
        <BindInviteCard
          bearer={session.jwt}
          defaultBindEnabled={admission?.default_bind_enabled ?? null}
          onBound={onBound}
          onWait={recheckAdmission}
          initialCode={typeof window !== 'undefined' ? sessionStorage.getItem(PENDING_INVITE) ?? '' : ''}
          heading="还差一步：绑定邀请码（准入）"
        />
      )}
      {session && nextAction === 'wait' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              准入绑定暂未开放
              {admission?.phase && (
                <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11px] text-amber-500">
                  阶段 {admission.phase}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground text-xs">
              当前阶段还不能绑定上级。你可以浏览行情与搜索，任何写操作要等准入完成。
            </p>
            <p className="text-sm">
              {waitLeft > 0
                ? `绑定窗口将在 ${Math.floor(waitLeft / 3600)}h ${Math.floor((waitLeft % 3600) / 60)}m ${waitLeft % 60}s 后开放`
                : '窗口应已开放 —— 点击下方按钮重新判定（不要直接重试绑定）。'}
            </p>
            <Button size="sm" variant="outline" onClick={recheckAdmission}>
              重新判定准入
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 登录成功 ≠ 引导完成：onboarding.md，判引导在登录之后。 */}
      {session && prompt && nextAction !== 'bind' && nextAction !== 'wait' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              登录成功，还有引导待完成
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11px] text-amber-500">
                {prompt.feature}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 text-sm">
            <p className="text-muted-foreground text-xs">
              服务端引导判定（GET /v1/user/onboarding）的首个待办。完成 / 跳过在引导页进行。
            </p>
            <Link href="/onboarding">
              <Button size="sm">进入引导</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* 准入完成：给一个明显的「进 App」出口。 */}
      {session && nextAction === 'enter' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              会话有效
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[11px] text-emerald-500">
                已准入{admission?.origin ? `（${admission.origin}）` : ''}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 text-sm">
            <Link href="/">
              <Button size="sm">进入发现页</Button>
            </Link>
            <Link href="/onboarding">
              <Button size="sm" variant="outline">
                引导页
              </Button>
            </Link>
            {boundInfo?.invite_code && (
              <span className="text-muted-foreground text-xs">
                我的邀请码 {boundInfo.invite_code}（详情在邀请页）
              </span>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <PrivyStatusCard
          ready={ready}
          authenticated={authenticated}
          did={user?.id}
          linkedTypes={linkedTypes}
          identityToken={identityToken}
          onLogout={() => void logout()}
        />
        <SessionCard
          session={session}
          onClear={clearSiteToken}
          onFetchInfo={() => void fetchInfo()}
          fetching={fetching}
        />
      </div>

      <SelfCheckCard onEvent={(l, s, d) => log.push(l, s, d)} />

      {ready && authenticated && user ? (
        <WalletProvisionCard key={user.id} onEvent={(l, s, d) => log.push(l, s, d)} />
      ) : null}

      {!authenticated && ready && (
        <div className="grid gap-4 md:grid-cols-2">
          <EmailOtpCard
            onLoggedIn={() => log.push('info', '可以换取本站 token 了')}
            onEvent={(l, s, d) => log.push(l, s, d)}
          />
          <OAuthCard
            avail={avail}
            busy={oauthBusy}
            onStart={(p) => {
              setOauthBusy(true);
              sessionStorage.setItem(OAUTH_PENDING, p);
              log.push('info', `发起 ${p} 登录（整页跳转）`);
              void oauth.initOAuth({provider: p}).catch((e: unknown) => {
                setOauthBusy(false);
                log.push('error', 'initOAuth 失败', String(e));
              });
            }}
          />
        </div>
      )}

      {authenticated && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2 · 换取本站 token</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-xs">
              把 Privy 的 identity token 拿去换本站 JWT。
              <strong>auth_method 必须与上面「绑定」里真实存在的一项一致</strong>，
              否则后端回 100107。
            </p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['AUTH_METHOD_EMAIL', 'email'],
                  ['AUTH_METHOD_GOOGLE', 'google_oauth'],
                  ['AUTH_METHOD_APPLE', 'apple_oauth'],
                ] as const
              ).map(([m, privyType]) => {
                const present = linkedTypes.includes(privyType);
                return (
                  <Button
                    key={m}
                    size="sm"
                    variant={present ? 'default' : 'outline'}
                    // 请求期间禁用：后端有防重入锁（TTL 10s），连点第二发
                    // 直接回 420102，而那个码看起来像 bug。
                    disabled={exchanging}
                    onClick={() => void exchange(m)}
                    title={present ? '' : `token 里没有 ${privyType}，这样发会回 100107`}
                  >
                    {exchanging ? '换取中…' : `以 ${m.replace('AUTH_METHOD_', '')} 登录`}
                    {!present && <span className="ml-1 text-[10px] opacity-70">未绑定</span>}
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {err && <ErrorPanel err={err} linkedTypes={linkedTypes} />}

      {infoResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              /v1/user/info 回包
              {session?.user?.identifier === infoResult.identifier ? (
                <span className="ml-2 text-xs text-emerald-500">
                  ✓ identifier 与登录返回的一致
                </span>
              ) : (
                <span className="ml-2 text-xs text-red-500">✗ identifier 与登录返回的不一致</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted/50 overflow-auto rounded-md border p-2 font-mono text-[11px]">
              {JSON.stringify(infoResult, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {(authenticated || session) && (
        <Button variant="destructive" size="sm" onClick={() => void fullLogout()}>
          全部退出并清空
        </Button>
      )}

      <EventLog entries={log.entries} onClear={log.clear} />
    </div>
  );
}
