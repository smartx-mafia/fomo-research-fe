// `/v2/swaps` 的 HTTP 客户端。
//
// 不复用 `api.ts` 的 `call`，理由有三条，都是契约差异：
//   ① 失败信封带 `metadata`（`recovery_action` / `related_swap_id` / `retry_after_ms`），
//      **恢复必须按它分支，不按码分支**（fastswap.md §9、§9.1）—— `call` 把它丢了；
//   ② 除 `/quote` 外的 POST 必带 `Idempotency-Key`，而且键由调用方持有、跨重试不变；
//   ③ 执行上报要把 HTTP 区间拆成「开始 / 响应头 / 响应体 / 解析完成」四个点
//      （fastswap-app.md §9 的 `execution_http_ms`）。
//
// 出口层（前缀、计时钩子、x-request-id）仍与 `/v1` 共用同一份 `transport.ts`。

import {ApiError, type FailureKind} from '../api';
import {API_PREFIX} from '../envs.browser';
import {newTraceID} from '../trace';
import {emitTiming, nowMs, resolveUrl} from '../transport';
import {
  CONTRACT_VERSION,
  recoveryActionOf,
  type ActiveReply,
  type CapabilitiesReply,
  type CreateIntent,
  type EventsReply,
  type ExecutionReport,
  type QuoteReply,
  type QuoteRequest,
  type RecoveryAction,
  type SwapReply,
  type TelemetryEvent,
  type TelemetryReply,
} from './wire';

/** 一次 HTTP 尝试的四个时刻（单调时钟，毫秒）。差值由消费者算。 */
export type HttpTiming = {
  path: string;
  method: string;
  sentRequestID: string;
  startedAt: number;
  headersAt?: number;
  bodyAt?: number;
  parsedAt?: number;
  ok: boolean;
};

/** 失败信封里的 metadata。四个键全是字符串（§9）。 */
export type SwapErrorMeta = {
  retryable?: string;
  retry_after_ms?: string;
  recovery_action?: string;
  related_swap_id?: string;
  /** 结算方原样的拒绝码。**只许展示与上报，不许按它写分支**（fastswap.md §2.2）。 */
  settlement_code?: string;
  /** 买入入口的市场关拒单成因：launchpad_custody / no_exit_liquidity / no_entry_route。 */
  market_cause?: string;
  /** 430618 可卖量不足时的三个量（十进制原子数）。 */
  ledger_shares_raw?: string;
  reserved_raw?: string;
  sellable_raw?: string;
};

export class SwapApiError extends ApiError {
  readonly meta: SwapErrorMeta;
  /** 已按「认不得的一律 get_snapshot」归一过。transport / network 类恒为 get_snapshot。 */
  readonly recovery: RecoveryAction;

  constructor(
    kind: FailureKind,
    code: number,
    msg: string,
    extra: {traceID?: string; reason?: string; sentRequestID?: string; rawBody?: string; meta?: SwapErrorMeta} = {},
  ) {
    super(kind, code, msg, extra);
    this.name = 'SwapApiError';
    this.meta = extra.meta ?? {};
    this.recovery = recoveryActionOf(this.meta.recovery_action);
  }

  /** metadata.retry_after_ms 解成数字；缺席或非法为 null。 */
  get retryAfterMs(): number | null {
    const n = Number(this.meta.retry_after_ms);
    return this.meta.retry_after_ms && Number.isFinite(n) && n > 0 ? n : null;
  }
}

type Envelope<T> = {
  code: number;
  msg: string;
  error?: string;
  metadata?: SwapErrorMeta;
  trace_id?: string;
  data?: T;
};

export type ClientOptions = {
  token: string;
  /** 每次 HTTP 尝试结束时回调（成功失败都报）。回调抛错被吞掉。 */
  onTiming?: (t: HttpTiming) => void;
};

async function request<T>(
  opts: ClientOptions,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const sentRequestID = newTraceID();
  const url = resolveUrl(API_PREFIX, path);
  const t: HttpTiming = {path, method, sentRequestID, startedAt: nowMs(), ok: false};
  const startedAtWall = Date.now();
  let status: number | undefined;
  let code: number | undefined;
  let traceID: string | undefined;
  let failure: FailureKind | undefined;

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.token}`,
      'x-request-id': sentRequestID,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    let resp: Response;
    try {
      resp = await fetch(url, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
    } catch (e) {
      failure = 'network';
      throw new SwapApiError('network', 0, `请求没能发出去：${e instanceof Error ? e.message : String(e)}`, {
        sentRequestID,
      });
    }
    t.headersAt = nowMs();
    status = resp.status;
    const text = await resp.text();
    t.bodyAt = nowMs();

    // 裸 403（CORS 白名单拒绝）与裸 413（请求体超限）不套信封（§0、§0.4）。
    if (resp.status !== 200) {
      failure = 'transport';
      const hint =
        resp.status === 403
          ? '裸 403 —— 多半是带了 Origin 且不在 allowed_origins 里（检查 vite 代理有没有摘掉 Origin）'
          : resp.status === 413
            ? '裸 413 —— 请求体超过 1 MiB，请求本身不对，不要重试'
            : `HTTP ${resp.status} —— 没到 fastswap 的信封层，检查代理与 sx_fastswap 进程`;
      throw new SwapApiError('transport', resp.status, hint, {sentRequestID, rawBody: text.slice(0, 300)});
    }

    let env: Envelope<T>;
    try {
      env = JSON.parse(text) as Envelope<T>;
    } catch {
      failure = 'transport';
      throw new SwapApiError('transport', 200, '回包不是合法 JSON', {sentRequestID, rawBody: text.slice(0, 300)});
    }
    t.parsedAt = nowMs();
    code = env.code;
    traceID = env.trace_id;

    if (env.code !== 200) {
      failure = 'business';
      throw new SwapApiError('business', env.code, env.msg, {
        traceID: env.trace_id,
        reason: env.error,
        sentRequestID,
        meta: env.metadata,
      });
    }
    const data = env.data as {contract_version?: string} | undefined;
    if (!data || data.contract_version !== CONTRACT_VERSION) {
      // 版本串变了 = 结构演进成不兼容形态，停下来而不是解析出一堆零值（§0）。
      failure = 'business';
      throw new SwapApiError(
        'business',
        200,
        `data.contract_version 是「${data?.contract_version ?? '缺席'}」，本页只认「${CONTRACT_VERSION}」`,
        {traceID: env.trace_id, sentRequestID},
      );
    }
    t.ok = true;
    return env.data as T;
  } finally {
    try {
      opts.onTiming?.(t);
    } catch {
      /* 观测不该影响被观测者 */
    }
    emitTiming({
      method,
      url,
      sentRequestID,
      startedAtWall,
      startedAt: t.startedAt,
      firstByteAt: t.headersAt,
      completedAt: nowMs(),
      status,
      code,
      traceID,
      ok: t.ok,
      failure,
    });
  }
}

export type SwapClient = ReturnType<typeof createSwapClient>;

export function createSwapClient(opts: ClientOptions) {
  const enc = encodeURIComponent;
  return {
    capabilities: () => request<CapabilitiesReply>(opts, 'GET', '/v2/swaps/capabilities'),
    active: (cursor = '', limit = 20) =>
      request<ActiveReply>(opts, 'GET', `/v2/swaps/active?cursor=${enc(cursor)}&limit=${limit}`),
    /** 展示报价。无副作用，**不带**幂等键（带了也被忽略）。 */
    quote: (q: QuoteRequest) => request<QuoteReply>(opts, 'POST', '/v2/swaps/quote', q),
    create: (intent: CreateIntent, idempotencyKey: string) =>
      request<SwapReply>(opts, 'POST', '/v2/swaps', intent, idempotencyKey),
    get: (swapID: string) => request<SwapReply>(opts, 'GET', `/v2/swaps/${enc(swapID)}`),
    refresh: (swapID: string, idempotencyKey: string) =>
      request<SwapReply>(opts, 'POST', `/v2/swaps/${enc(swapID)}/refresh`, {}, idempotencyKey),
    cancel: (swapID: string, idempotencyKey: string) =>
      request<SwapReply>(opts, 'POST', `/v2/swaps/${enc(swapID)}/cancel`, {}, idempotencyKey),
    execute: (swapID: string, report: ExecutionReport, idempotencyKey: string) =>
      request<SwapReply>(opts, 'POST', `/v2/swaps/${enc(swapID)}/executions`, report, idempotencyKey),
    events: (swapID: string, afterVersion: string) =>
      request<EventsReply>(opts, 'GET', `/v2/swaps/${enc(swapID)}/events?after_version=${enc(afterVersion)}`),
    telemetry: (events: TelemetryEvent[], idempotencyKey: string) =>
      request<TelemetryReply>(opts, 'POST', '/v2/swaps/telemetry', {events}, idempotencyKey),
  };
}
