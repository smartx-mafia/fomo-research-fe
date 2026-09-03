import {AlertTriangle} from 'lucide-react';

import {CopyButton} from '@/components/CopyButton';
import {Separator} from '@/components/ui/separator';
import {codeInfo} from '@/api/codes';
import {ApiError} from '@/api/envelope';
import {BUSINESS_ORIGIN_LABEL} from '@/config';

/**
 * 三类失败的统一展示。它们的**颜色与文案刻意不同** —— 混成一个
 * "请求失败" 的话，「代理没起来」和「identity token 过期」会长得一样，
 * 而这两者的排查方向完全相反。
 */
const KIND_STYLE = {
  business: {ring: 'border-red-500/40 bg-red-500/5', tag: '业务失败', hint: '请求到了，信封回来了，是后端按业务规则拒绝。看六位码。'},
  transport: {ring: 'border-orange-500/40 bg-orange-500/5', tag: '没到信封层', hint: 'HTTP 状态码不是 200 —— 请求没走到 business 的业务逻辑。'},
  network: {ring: 'border-zinc-500/40 bg-zinc-500/5', tag: '浏览器层失败', hint: 'fetch 本身抛了：dev server 没起、代理目标不通，或代码里写了绝对 URL 撞上 CORS。'},
} as const;

export function ErrorPanel({err, linkedTypes}: {err: ApiError; linkedTypes?: string[]}) {
  const style = KIND_STYLE[err.kind];
  const info = err.kind === 'business' ? codeInfo(err.code) : undefined;
  // 已知的确定性诊断：本机旧构建没有这条路由，这会真实发生，
  // 值得写死一条提示而不是让人自己推。
  const oldBuild = err.kind === 'transport' && err.code === 404;

  const report = [
    `端点失败报障`,
    `时间: ${new Date().toISOString()}`,
    `类别: ${style.tag}`,
    `code: ${err.code}${err.reason ? ` (${err.reason})` : ''}`,
    `msg: ${err.message}`,
    `trace_id: ${err.traceID ?? '(没到后端)'}`,
    `x-request-id(发出): ${err.sentRequestID ?? '-'}`,
    `后端: ${BUSINESS_ORIGIN_LABEL}`,
  ].join('\n');

  return (
    <div className={`space-y-3 rounded-lg border p-3 ${style.ring}`}>
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-red-500" />
        <span className="font-mono text-lg font-semibold">{err.code}</span>
        {err.reason && <span className="font-mono text-xs opacity-80">{err.reason}</span>}
        <span className="bg-background/60 rounded border px-1.5 py-0.5 text-[10px]">
          {style.tag}
        </span>
      </div>

      <p className="text-sm">{info?.text ?? err.message}</p>
      <p className="text-muted-foreground text-xs">{style.hint}</p>

      {info?.advice && <p className="text-xs">建议：{info.advice}</p>}

      {!info && err.kind === 'business' && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          这是本地码表里没有的码 —— 原样显示，不要当成"未知错误"忽略。
          码表必然落后于后端，以后端返回为准。
        </p>
      )}

      {oldBuild && (
        <p className="rounded border border-orange-500/40 bg-orange-500/10 p-2 text-xs">
          <strong>HTTP 404 = 这个后端是旧构建，没有这条路由。</strong>
          <br />
          测试服是 <code className="font-mono">http://13.231.246.26:8080</code>；
          检查 <code className="font-mono">.env.local</code> 里的{' '}
          <code className="font-mono">VITE_BUSINESS_ORIGIN</code>，改完要重启 dev server。
        </p>
      )}

      {err.code === 100107 && linkedTypes && (
        <p className="rounded border p-2 text-xs">
          这个 Privy 账号上真实存在的绑定：
          <code className="font-mono"> {linkedTypes.join(', ') || '(空)'}</code>
          <br />
          声称的登录方式必须在这个列表里 —— email 登的却选 google，就是这个码。
        </p>
      )}

      {err.rawBody && (
        <div>
          <p className="text-muted-foreground mb-1 text-xs">响应体前 300 字符（原样）：</p>
          <pre className="bg-background/60 max-h-28 overflow-auto rounded border p-2 font-mono text-[10px] break-all whitespace-pre-wrap">
            {err.rawBody}
          </pre>
        </div>
      )}

      <Separator />

      <div className="space-y-1.5 font-mono text-[11px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">trace_id</span>
          <span className="break-all">{err.traceID ?? '(请求没到后端，故没有)'}</span>
          {err.traceID && <CopyButton value={err.traceID} label="复制" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">x-request-id(发出)</span>
          <span className="break-all">{err.sentRequestID ?? '-'}</span>
          {/* 两者不一致 = 我们的 ID 被后端判非法丢弃了。契约说这是静默失效，
              所以必须显式对比出来。 */}
          {err.traceID && err.sentRequestID && (
            <span className={err.traceID === err.sentRequestID ? 'text-emerald-500' : 'text-amber-500'}>
              {err.traceID === err.sentRequestID ? '✓ 一致' : '✗ 不一致（我们的 ID 被丢弃了）'}
            </span>
          )}
        </div>
      </div>

      <CopyButton value={report} label="复制报障模板" />
    </div>
  );
}
