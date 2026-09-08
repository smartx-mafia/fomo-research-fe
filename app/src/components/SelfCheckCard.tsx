import {useState} from 'react';

import {probeLoginRoute, probeUnauthenticated} from '@/api/auth';
import {ApiError} from '@/api/envelope';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {BUSINESS_ORIGIN_LABEL} from '@/config';

type Probe = {ok: boolean; text: string; detail?: string};

/**
 * 后端自检 —— **不碰 Privy、不需要登录**。
 *
 * 它把"后端够不够得着"从"登录能不能成"里切出来。没有这一层的话，
 * 后端/CORS 不通、后端是旧构建、identity token 过期这三件事，症状都是
 * "登录失败"，而排查方向完全不同。
 */
export function SelfCheckCard({
  onEvent,
}: {
  onEvent: (level: 'info' | 'ok' | 'warn' | 'error', step: string, detail?: string) => void;
}) {
  const [envelope, setEnvelope] = useState<Probe | null>(null);
  const [route, setRoute] = useState<Probe | null>(null);
  const [busy, setBusy] = useState(false);

  async function runAll() {
    setBusy(true);
    setEnvelope(null);
    setRoute(null);

    // 探针 1：不带任何凭据打 /v1/user/info。**期望失败**（400000）——
    // 拿到它就证明浏览器直连通了、信封层活着、这个后端认得这条路由。
    try {
      await probeUnauthenticated();
      const p = {ok: false, text: '异常：匿名请求竟然成功了，这不符合契约（该端点是 Required 档）'};
      setEnvelope(p);
      onEvent('error', '探针1 匿名 /v1/user/info', p.text);
    } catch (e) {
      const err = e as ApiError;
      if (err.kind === 'business' && err.code === 400000) {
        const p = {
          ok: true,
          text: '通过：拿到 400000 / SYS_UNAUTHENTICATED',
          detail: `浏览器直连通、信封层活着、路由存在。trace_id=${err.traceID ?? '-'}`,
        };
        setEnvelope(p);
        onEvent('ok', '探针1 匿名 /v1/user/info', p.detail);
      } else {
        const p = {
          ok: false,
          text: `未通过：${err.kind} / ${err.code} — ${err.message}`,
          detail:
            err.kind === 'network'
              ? '真实后端不可达、混合内容被拦或 CORS 未放行。检查 .env.local 的 NEXT_PUBLIC_BUSINESS_API_BASE。'
              : err.rawBody,
        };
        setEnvelope(p);
        onEvent('error', '探针1 匿名 /v1/user/info', p.text);
      }
    }

    // 探针 2：用必然无效的 identity_token 打登录端点。
    // **拿到 HTTP 404 就说明这个后端是旧构建**，没有 /v1/auth/login。
    try {
      await probeLoginRoute();
      const p = {ok: false, text: '异常：假 token 竟然登录成功了'};
      setRoute(p);
      onEvent('error', '探针2 /v1/auth/login 存在性', p.text);
    } catch (e) {
      const err = e as ApiError;
      if (err.kind === 'business' && (err.code === 400100 || err.code === 100108)) {
        const p = {
          ok: true,
          text: `通过：拿到 ${err.code}，路由存在且 Privy 验签在跑`,
          detail: `trace_id=${err.traceID ?? '-'}`,
        };
        setRoute(p);
        onEvent('ok', '探针2 /v1/auth/login 存在性', p.text);
      } else if (err.kind === 'transport' && err.code === 404) {
        const p = {
          ok: false,
          text: 'HTTP 404 —— 这个后端是旧构建，没有 /v1/auth/login 路由',
          detail:
            '测试服浏览器入口是 https://sm-test-api.smartx.io。改 .env.local 的 NEXT_PUBLIC_BUSINESS_API_BASE 后重启 dev server。',
        };
        setRoute(p);
        onEvent('error', '探针2 /v1/auth/login 存在性', p.text);
      } else if (err.kind === 'business' && err.code === 500097) {
        const p = {
          ok: false,
          text: '500097 —— 这个环境没配 Privy（或数据库），登录不可用',
        };
        setRoute(p);
        onEvent('error', '探针2 /v1/auth/login 存在性', p.text);
      } else {
        const p = {ok: false, text: `未通过：${err.kind} / ${err.code} — ${err.message}`};
        setRoute(p);
        onEvent('error', '探针2 /v1/auth/login 存在性', p.text);
      }
    }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">0 · 后端自检</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-xs">
          先跑这个。它不碰 Privy，只回答「后端够不够得着、是不是带登录的那个构建」。
          当前目标：<code className="font-mono">{BUSINESS_ORIGIN_LABEL}</code>
          （浏览器直接请求该地址，不经过 Next.js 转发）。
        </p>
        <Button size="sm" onClick={() => void runAll()} disabled={busy}>
          {busy ? '检测中…' : '运行自检'}
        </Button>
        {[
          ['探针1 · 匿名 GET /v1/user/info', envelope],
          ['探针2 · POST /v1/auth/login 是否存在', route],
        ].map(([label, p]) => {
          const probe = p as Probe | null;
          if (!probe) return null;
          return (
            <div
              key={label as string}
              className={`rounded-md border p-2 text-xs ${
                probe.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'
              }`}
            >
              <p className="font-medium">
                {probe.ok ? '✓' : '✗'} {label as string}
              </p>
              <p className="mt-0.5">{probe.text}</p>
              {probe.detail && (
                <p className="text-muted-foreground mt-0.5 font-mono text-[10px] break-all">
                  {probe.detail}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
