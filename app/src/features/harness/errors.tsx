import {codeInfo} from './codes';
import type {ApiError} from './api';
import {BUSINESS_LABEL} from './config';
import {Copy, Note} from './ui';

/**
 * 三类失败的统一展示。抄自 `../privy-login-demo/src/components/ErrorPanel.tsx`。
 *
 * **三类的文案与语气刻意不同** —— 混成一个"请求失败"的话，
 * 「代理没起来」和「identity token 过期」会长得一样，而这两者的排查方向
 * 完全相反。这条不是审美，是这个 harness 存在的理由本身：它的产出物是
 * 「哪一步、什么六位码、哪个 trace_id」，不是「失败了」三个字。
 */
const KIND_TEXT = {
  business: {
    tag: '业务失败',
    hint: '请求到了、信封回来了，是后端按业务规则拒绝。看六位码。',
    tone: 'err',
  },
  transport: {
    tag: '没到信封层',
    hint: 'HTTP 状态码不是 200 —— 请求没走到 business 的业务逻辑。最常见的是这个后端根本没有这条路由。',
    tone: 'warn',
  },
  network: {
    tag: '浏览器层失败',
    hint: 'fetch 本身抛了：dev server 没起、代理目标不通，或代码里写了绝对 URL 撞上 CORS。',
    tone: 'warn',
  },
} as const;

export function ErrorPanel({
  err,
  /** Privy 上真实存在的 linked account 类型。只在 100107 那格用得上。 */
  linkedTypes,
}: {
  err: ApiError;
  linkedTypes?: string[];
}) {
  const style = KIND_TEXT[err.kind];
  const info = err.kind === 'business' ? codeInfo(err.code) : undefined;
  // 已知的确定性诊断：旧构建没有这条路由，这会真实发生（X 绑定那四条路
  // 2026-08-31 在测试服上实测就是这样），值得写死一条提示而不是让人自己推。
  const oldBuild = err.kind === 'transport' && err.code === 404;

  const report = [
    '端点失败报障',
    `时间: ${new Date().toISOString()}`,
    `类别: ${style.tag}`,
    `code: ${err.code}${err.reason ? ` (${err.reason})` : ''}`,
    `msg: ${err.message}`,
    `trace_id: ${err.traceID ?? '(没到后端)'}`,
    `x-request-id(发出): ${err.sentRequestID ?? '-'}`,
    `后端: ${BUSINESS_LABEL}`,
  ].join('\n');

  return (
    <div className="card" style={{borderColor: 'rgba(239, 68, 68, 0.4)'}}>
      <h2>
        <span className="n">!</span>
        {err.code} · {style.tag}
        {err.reason && (
          <span className="code" style={{marginLeft: 'auto', letterSpacing: 0}}>
            {err.reason}
          </span>
        )}
      </h2>

      <p className="bad" style={{margin: '0 0 var(--s2)'}}>
        {info?.text ?? err.message}
      </p>
      <p className="hint tight">{style.hint}</p>

      {info?.advice && (
        <p className="hint" style={{marginTop: 'var(--s2)'}}>
          建议：{info.advice}
        </p>
      )}

      {!info && err.kind === 'business' && (
        <Note>
          这是本地码表里没有的码 —— <b>原样显示，不要当成"未知错误"忽略</b>。
          码表（<code className="code">src/codes.ts</code>）必然落后于后端，以后端返回为准。
        </Note>
      )}

      {oldBuild && (
        <Note>
          <b>HTTP 404 = 这个后端没有这条路由</b>，多半是旧构建。判据很干脆：同一台机器上{' '}
          <code className="code">/v1/auth/login</code> 若回的是正常信封（比如{' '}
          <code className="code">400100</code>），而这条路回裸 404 —— 那就不是鉴权问题也不是
          代理问题。改 <code className="code">.env.local</code> 的{' '}
          <code className="code">BUSINESS_ORIGIN</code> 指到有这套路由的环境，
          <b>改完必须重启 dev server</b>（代理配置在启动时读一次）。
        </Note>
      )}

      {err.code === 100107 && linkedTypes && (
        <Note>
          这个 Privy 账号上真实存在的绑定：
          <code className="code"> {linkedTypes.join(', ') || '(空)'}</code>
          <br />
          声称的 <code className="code">auth_method</code> 必须在这个列表里 ——
          用 email 登进来却选 Google，就是这个码。
        </Note>
      )}

      {err.rawBody && (
        <>
          <p className="hint tight" style={{marginTop: 'var(--s3)'}}>
            响应体前 300 字符（原样）—— 一段 HTML 说明它被中间层换掉了：
          </p>
          <pre className="block" style={{maxHeight: 140}}>
            {err.rawBody}
          </pre>
        </>
      )}

      <div className="kv" style={{marginTop: 'var(--s3)'}}>
        <span className="k">trace_id</span>
        <code className="code">{err.traceID ?? '(请求没到后端，故没有)'}</code>
        {err.traceID && <Copy text={err.traceID} />}
      </div>
      <div className="kv">
        <span className="k">x-request-id</span>
        <code className="code">{err.sentRequestID ?? '-'}</code>
        {/* 两者不一致 = 我们发的 ID 被后端判非法丢弃了。契约说这是**静默
            失效**，所以只能靠显式对比发现（见 trace.ts 的第 ② 条）。 */}
        {err.traceID && err.sentRequestID && (
          <span className={err.traceID === err.sentRequestID ? 'badge ok' : 'badge err'}>
            {err.traceID === err.sentRequestID ? '一致' : '不一致 —— 我们的 ID 被丢弃了'}
          </span>
        )}
      </div>

      <div className="row">
        <Copy text={report} label="复制报障模板" />
      </div>
    </div>
  );
}
