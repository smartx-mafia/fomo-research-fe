import {useEffect, useRef, useState} from 'react';

import {X_CODE} from '@/api/ximport';
import {CopyButton} from '@/components/CopyButton';
import {ErrorPanel} from '@/components/ErrorPanel';
import {XBindingCard} from '@/components/XBindingCard';
import {XCallbackCard} from '@/components/XCallbackCard';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {BUSINESS_ORIGIN_LABEL} from '@/config';
import {useXBind, type EventLogFns} from '@/hooks/useXBind';
import {hasCallbackPayload, parseCallbackParams} from '@/lib/xcallback';
import {clearCapture, readCapture, writeCapture, type XCapture} from '@/session/xpending';

/** 自动路径要求后端的 x.redirect_uri 与 X 后台登记的都是这个值。 */
export const CALLBACK_PATH = '/x/callback';

/**
 * X（Twitter）账号绑定联调台。
 *
 * 与登录页同一种性质：**产出物是「哪一步、什么六位码、哪个 trace_id」**，
 * 不是"绑定成功"四个字。所以每一步的原始回包、缺席的字段、
 * 以及"为什么这个码要重新发起而不是重试"都写在界面上。
 *
 * 页面同时支持两条回调路径，理由见 XCallbackCard 的注释：
 * X 官方文档没写明是否允许 `http://localhost` 作为 Callback URI，未实测。
 */
export function XBindPage({
  jwt,
  log,
  onGoLogin,
}: {
  jwt: string | null;
  log: EventLogFns;
  onGoLogin: () => void;
}) {
  const ctl = useXBind(jwt, log);
  const {push} = log;

  /** 上一次抓到、还没提交的回调参数（本标签页内跨视图切换也活着）。 */
  const [capture, setCapture] = useState<XCapture | null>(() => readCapture());
  /** 地址栏只该被读一次。 */
  const scanned = useRef(false);
  /** 同一个 code 只自动提交一次 —— 它是一次性的，重放只会换来 400103。 */
  const autoSubmitted = useRef<string | null>(null);

  /**
   * 从地址栏读回调参数。这是**与外部系统（浏览器地址栏）同步**，
   * 所以确实该待在 effect 里，尽管它会多触发一次渲染。
   *
   * 只认 code / state / error 三个名字。Privy 的 OAuth 回跳用的是
   * privy_oauth_code / privy_oauth_state，名字不撞，两套回调不会互相吃掉
   * 对方的参数。
   */
  useEffect(() => {
    if (scanned.current) return;
    scanned.current = true;
    const params = parseCallbackParams(location.href);
    if (!hasCallbackPayload(params)) return;

    const c: XCapture = {...params, at: Date.now()};
    writeCapture(c);
    setCapture(c);
    push(
      params.error ? 'warn' : 'info',
      '回调参数已从地址栏读出',
      params.error
        ? `error=${params.error}${params.errorDescription ? ` (${params.errorDescription})` : ''}`
        : `code=${params.code ? '有' : '无'} state=${params.state ?? '(无)'}`,
    );

    // **立刻把地址栏洗干净。** 留着的话，任何一次刷新都会重放一份已经被消费的
    // code，而重放的结果是 400103 —— 那个码的说明是"重新发起"，与真实原因
    // （你只是刷新了一下）完全对不上，人会照着提示一遍遍重发。
    // 参数已经进了 sessionStorage 并填进手工框，不会丢。
    history.replaceState(null, '', CALLBACK_PATH);
  }, [push]);

  const complete = ctl.complete;
  useEffect(() => {
    if (!jwt || !capture?.code || !capture.state) return;
    if (autoSubmitted.current === capture.code) return;
    autoSubmitted.current = capture.code;
    push('info', '自动路径：URL 里带回了 code+state，直接提交绑定');
    complete(capture.code, capture.state);
  }, [jwt, capture, complete, push]);

  const expectedRedirect = `${location.origin}${CALLBACK_PATH}`;
  // 200106 是流程分支不是故障，hook 里已经折成 unbound 态；这里再挡一道，
  // 免得将来有人从别处把它塞进 err 就在页面上炸出一个红框。
  const err = ctl.err?.code === X_CODE.bindingNotFound ? null : ctl.err;

  return (
    <>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">X（Twitter）账号绑定联调台</h1>
        <p className="text-muted-foreground text-sm">
          四个端点<strong>全部要求本站 JWT</strong>。绑定改的是"我的"账号关联，
          身份只取自 JWT，请求体里没有也不接受用户标识。
        </p>
        <p className="text-muted-foreground font-mono text-[11px]">
          后端={BUSINESS_ORIGIN_LABEL} · 回调页={expectedRedirect}
        </p>
      </header>

      {!jwt && (
        <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p>
            <strong>本地没有本站 JWT，这一页什么都做不了。</strong>
            四个 <code className="font-mono">/v1/user/x/*</code> 端点都是 Required 档，
            没头一律 <code className="font-mono">400000</code>。
          </p>
          <p className="text-xs">
            先去登录联调台走一遍 Privy 登录并「换取本站 token」，再回来。
            {capture?.code && (
              <>
                {' '}
                <strong>刚才那份回调参数已经存下来了</strong>（在本标签页里），
                拿到 token 回到本页会自动继续 —— 但 state 只活 10 分钟，别耽搁。
              </>
            )}
          </p>
          <Button size="sm" onClick={onGoLogin}>
            去登录联调台
          </Button>
        </div>
      )}

      {capture?.error && (
        <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p>
            <strong>
              X 那边没有给授权码，回跳只带了 error=
              <code className="font-mono">{capture.error}</code>。
            </strong>
          </p>
          <p className="text-xs">
            {capture.error === 'access_denied'
              ? '这是你（或测试账号）在 X 授权页上点了「取消」。不用调后端，也不用报障 —— 重新点一次「发起绑定」，在授权页上点确认即可。'
              : capture.errorDescription || 'X 拒绝了这次授权。检查 X 后台的 App 权限与 Callback URI 登记。'}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              clearCapture();
              setCapture(null);
            }}
          >
            知道了，清掉这条
          </Button>
        </div>
      )}

      <XBindingCard
        state={ctl.state}
        loading={ctl.loading}
        busy={ctl.busy}
        polling={ctl.polling}
        pollTimedOut={ctl.pollTimedOut}
        onRefresh={ctl.refresh}
        onUnbind={ctl.unbind}
        onResumePolling={ctl.resumePolling}
      />

      <XCallbackCard
        hasJwt={Boolean(jwt)}
        busy={ctl.busy}
        pending={ctl.pending}
        capture={capture}
        onStart={ctl.start}
        onSubmit={(code, state) => {
          autoSubmitted.current = code;
          complete(code, state);
        }}
      />

      {err?.kind === 'transport' && err.code === 404 && (
        <p className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-3 text-xs">
          <strong>这四条 /v1/user/x/* 路由在当前后端上根本不存在（HTTP 404，没到信封层）。</strong>
          <br />
          判据很干脆：同一台机器上 <code className="font-mono">/v1/auth/login</code> 回的是
          正常的信封（<code className="font-mono">400100</code>），而这条路回裸 404 ——
          说明它是 X 绑定合并<strong>之前</strong>的构建，不是鉴权问题也不是代理问题。
          2026-08-31 在 <code className="font-mono">{BUSINESS_ORIGIN_LABEL}</code> 上实测如此。
          等后端发一版带 X 绑定的再回来，或把{' '}
          <code className="font-mono">NEXT_PUBLIC_BUSINESS_API_BASE</code> 指到有这套路由的环境
          （改完要重启 dev server）。
        </p>
      )}

      {err && <ErrorPanel err={err} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">redirect_uri：两条路，先确认走哪条</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">本页的回调地址</span>
            <code className="font-mono break-all">{expectedRedirect}</code>
            <CopyButton value={expectedRedirect} />
          </div>
          <p>
            后端 <code className="font-mono">configs/business.yaml</code> 的{' '}
            <code className="font-mono">x.redirect_uri</code> 必须与 X 开发者后台
            （Settings → User authentication settings → Callback URI / Redirect URL）
            登记的值<strong>完全一致</strong> —— 差一个斜杠、差 http/https，
            X 都会拒绝授权码，而它只回一句 <code className="font-mono">invalid_request</code>，
            不会告诉你是哪里不一致。
          </p>
          <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
            <strong>
              X 官方文档没有说明是否允许 <code className="font-mono">http://localhost</code>{' '}
              作为 Callback URI，这一点尚未实测。
            </strong>
            <br />
            所以本页不假设自动路径可用：上面那个「回调 URL（手工兜底）」框在
            <strong>任何</strong> redirect_uri 配置下都能用，哪怕回调页 404 ——
            302 之后地址栏里就有 code 与 state。
          </p>
          <Collapsible>
            <CollapsibleTrigger className="underline underline-offset-4">
              后端还要配好什么？（500097 就是这里没配）
            </CollapsibleTrigger>
            <CollapsibleContent className="text-muted-foreground mt-2 space-y-1.5 rounded-md border p-3">
              <p>
                <code className="font-mono">x.client_id</code> 与{' '}
                <code className="font-mono">x.redirect_uri</code> 任一留空 = X 绑定未接入，
                四个端点显式回 <code className="font-mono">500097</code>（服务照常起，这是部署选择）。
                <code className="font-mono">metadata.upstream</code> 区分是{' '}
                <code className="font-mono">x</code> 还是 <code className="font-mono">database</code>。
              </p>
              <p>
                <code className="font-mono">x.client_secret</code> 只写{' '}
                <code className="font-mono">configs/business.secret.yaml</code>；
                X 后台把 App 建成 public client（PKCE-only）时<strong>留空才是对的</strong>，
                填了反而会被 X 拒。
              </p>
              <p>
                关注列表走的是另一条通道（<code className="font-mono">sorsa</code>）：
                它的 key 没配时<strong>绑定与档案照常可用</strong>，只是关注导入不启动 ——
                表现为 <code className="font-mono">status</code> 一直是 1，轮询 2 分钟后停。
              </p>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </>
  );
}
