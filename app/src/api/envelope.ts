/**
 * business 对外 HTTP 面的最小客户端。契约见后端仓 docs/contracts/user.md。
 *
 * 这里刻意把这套契约最容易踩的坑做成类型与代码：
 *
 * ① **HTTP 状态码恒为 200**，成败看 body.code。用 `res.ok` 判断成败会
 *    **永远为真** —— 这是这套契约最坑的一处，所以 call() 里根本不给
 *    调用方看见 Response 对象的机会。
 * ② 失败分三类，视觉与处理都不同（见 FailureKind）：混在一起的话，
 *    "代理没起来"和"identity token 过期"会长得一模一样。
 * ③ 当前 HTTP 编码会显式输出 protobuf 零值；各领域 normalizer 必须把
 *    `""`、`0` 与全零嵌套对象按契约折叠，不能直接当成有效业务数据。
 */
import {newTraceID} from '@/lib/trace';
import {BUSINESS_API_BASE} from '@/config';

/** 恒 200 信封。成功与失败共用同一个结构。 */
export type Envelope<T> = {
  code: number;
  msg: string;
  data?: T;
  /** 失败时才有，是错误原因的枚举名，如 BIZ_IDENTITY_TOKEN_INVALID。 */
  error?: string;
  action?: {type: string};
  metadata?: Record<string, unknown>;
  trace_id?: string;
};

/**
 * 失败分三类 —— 它们指向完全不同的排查方向，绝不能混成一个 "请求失败"。
 *
 * - `business`：请求到了、信封回来了，是业务拒绝。看六位码。
 * - `transport`：HTTP 状态码不是 200，**没到信封层**。最常见的是 404
 *   （后端是旧构建，没有这条路由）。
 * - `network`：fetch 本身抛了。后端不可达、浏览器拦截或 CORS 配置错误。
 */
export type FailureKind = 'business' | 'transport' | 'network';

export class ApiError extends Error {
  /** 业务码（六位）。transport 类放 HTTP 状态码，network 类为 0。 */
  readonly kind: FailureKind;
  readonly code: number;
  /** 错误原因枚举名，如 BIZ_IDENTITY_TOKEN_INVALID。只有业务失败才有。 */
  readonly reason?: string;
  /** 后端回包里的 trace_id。没到后端时为 undefined。 */
  readonly traceID?: string;
  /** 我们发出去的 x-request-id。**任何情况下都有**，这是它存在的意义。 */
  readonly sentRequestID?: string;
  /** transport 类保留响应体前若干字符，用来认出 HTML 错误页。 */
  readonly rawBody?: string;
  /** 业务失败的结构化细节，例如审查 rule_id；不得直接当用户文案展示。 */
  readonly metadata?: Record<string, unknown>;

  constructor(
    kind: FailureKind,
    code: number,
    msg: string,
    reason?: string,
    traceID?: string,
    sentRequestID?: string,
    rawBody?: string,
    metadata?: Record<string, unknown>,
  ) {
    super(msg);
    this.name = 'ApiError';
    this.kind = kind;
    this.code = code;
    this.reason = reason;
    this.traceID = traceID;
    this.sentRequestID = sentRequestID;
    this.rawBody = rawBody;
    this.metadata = metadata;
  }
}

export type CallResult<T> = {
  data: T;
  /** 后端最终生效的 trace_id。 */
  traceID?: string;
  /** 我们发出的 x-request-id。与 traceID 不一致说明被后端判非法丢弃了。 */
  sentRequestID: string;
};

/** HTTPS 页面不能直连 HTTP API；在 fetch 前给出可诊断错误，而不是浏览器泛化的 Failed to fetch。 */
export function assertNoMixedContent(url: URL, pageProtocol?: string): void {
  const protocol = pageProtocol ?? (typeof window === 'undefined' ? undefined : window.location.protocol);
  if (protocol === 'https:' && url.protocol === 'http:') {
    throw new Error(
      `HTTPS pages cannot call the HTTP API ${url.origin}. Configure NEXT_PUBLIC_BUSINESS_API_BASE with an HTTPS origin.`,
    );
  }
}

type CallOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /**
   * This backend currently emits selected protobuf int64 values as JSON
   * numbers. Quote only those known fields before JSON.parse so cursors and
   * identities above Number.MAX_SAFE_INTEGER stay exact.
   */
  preserveInt64Fields?: readonly string[];
  /**
   * 本站 JWT。**登录端点绝不能传这个**，所以它是显式参数而不是从
   * storage 里自动读 —— 自动读的话，「登录请求不带 Authorization」
   * 这条红线就只剩一句口头约定，而违反它不报错：带着过期 token 打登录
   * 会拿到 400000（未认证），指向的排查方向完全是错的。
   */
  bearer?: string;
};

function preserveIntegerFields(text: string, fields: readonly string[]): string {
  if (fields.length === 0) return text;
  const names = fields.map((field) => field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`([,{]\\s*)("(?:${names})"\\s*:\\s*)(-?\\d+)(?=\\s*[,}])`, 'g');
  return text.replace(pattern, '$1$2"$3"');
}

/**
 * 发一次浏览器直连请求。传入的契约路径仍写成 /v1/...，这里统一补上
 * NEXT_PUBLIC_BUSINESS_API_BASE，让 DevTools Network 显示真实后端地址。
 */
export async function call<T>(path: string, opts: CallOptions = {}): Promise<CallResult<T>> {
  // 每次请求新生成，不复用（契约硬规则，复用比不传更糟）。
  const sentRequestID = newTraceID();
  const headers: Record<string, string> = {'x-request-id': sentRequestID};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;

  let res: Response;
  try {
    const url = new URL(path, `${BUSINESS_API_BASE}/`).toString();
    assertNoMixedContent(new URL(url));
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (e) {
    throw new ApiError(
      'network',
      0,
      `请求没能发出去：${e instanceof Error ? e.message : String(e)}`,
      undefined,
      undefined,
      sentRequestID,
    );
  }

  const text = await res.text();

  // HTTP 不是 200 = 没到信封层。business 的对外面恒 200，所以这里只可能是
  // 反代 / 代理 / 路由不存在。保留响应体原文，HTML 错误页要能被一眼认出。
  if (res.status !== 200) {
    throw new ApiError(
      'transport',
      res.status,
      `HTTP ${res.status}，没到 business 的信封层`,
      undefined,
      undefined,
      sentRequestID,
      text.slice(0, 300),
    );
  }

  let env: Envelope<T>;
  try {
    env = JSON.parse(preserveIntegerFields(text, opts.preserveInt64Fields ?? [])) as Envelope<T>;
  } catch {
    throw new ApiError(
      'transport',
      200,
      '回包不是合法 JSON（大概率被中间层换成了 HTML）',
      undefined,
      undefined,
      sentRequestID,
      text.slice(0, 300),
    );
  }

  if (env.code !== 200) {
    // 准入门禁（invite.md §5）：Required 且未豁免的端点对未准入账号一律回
    // 430114 —— 那是新用户「登录后、绑定前」的正常态，不是故障。这里广播给
    // 全局监听器（InviteGateListener）统一带去邀请页，各调用方不必各自处理。
    if (env.code === 430114 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('smartx:invite-gate'));
    }
    throw new ApiError(
      'business',
      env.code,
      env.msg,
      env.error,
      env.trace_id,
      sentRequestID,
      undefined,
      env.metadata,
    );
  }
  // code=200 但 data 缺席 = 回包形状与契约不符。也当失败抛，不要让
  // undefined 一路流进 UI 变成空白字段。
  if (env.data === undefined) {
    throw new ApiError(
      'business',
      200,
      '回包 code=200 但没有 data，形状与契约不符',
      undefined,
      env.trace_id,
      sentRequestID,
    );
  }
  return {data: env.data, traceID: env.trace_id, sentRequestID};
}
