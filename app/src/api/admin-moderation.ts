/**
 * 管理后台（sx_admin）内容审查模块的客户端。契约：后端仓 docs/contracts/admin.md §2（会话）、
 * §10（内容审查）。只给 `/dev/moderation` 这个内部工具用，**不进产品构建**（见那个页面的开关）。
 *
 * 与 business 客户端（envelope.ts）的差别，都写成代码：
 * ① 前缀是 `/admin/api/v1`，与 App 的 `/v1` 不同源、不共享会话：会话是管理员账号口令换来的
 *    HS256 token，与 Privy / 平台 JWT 互不相认。
 * ② 请求一律走相对路径，开发期由 harness 的 dev 代理转到 sx_admin（摘掉 Origin —— sx_admin
 *    的 CORS 零值是拒绝一切带 Origin 的请求，回裸 403，看起来像没登录）。
 * ③ `400700`（会话失效）的唯一动作是清会话回登录；拒绝原因看 `metadata.reason`，不看 msg。
 */
import {ApiError} from '@/api/envelope';

const ADMIN_PATH = '/admin/api/v1';
const TOKEN_KEY = 'smartx.admin.token';

// 环境：前缀（'' 本机 / '/test-env' 测试服）与会话键。harness 的顶栏环境开关在挂载时调用
// configureAdmin；`/dev/moderation` 不调，保持本机默认（会话键也与旧版相同）。
//
// **会话按环境分开存**：两个环境是两套 sx_admin、两套管理员账号。共用一个键的话，切到测试服
// 会拿本机 token 去请求 → 400700「会话失效」，顺手把本机那份也清掉。
let prefix = '';
let tokenKey = TOKEN_KEY;

export function configureAdmin(env: {prefix: string; sessionKey: string}): void {
  prefix = env.prefix;
  tokenKey = env.sessionKey === 'local' ? TOKEN_KEY : `${TOKEN_KEY}.${env.sessionKey}`;
}

/** 会话失效：过期、登出、改口令、被停用都会触发。 */
export const SESSION_INVALID = 400700;

export type ModerationStatus = {
  embedded_version: string;
  embedded_rules: number;
  db_revision: number;
  applied_revision: number;
  rule_set_version: string;
  last_confirmed_at: string;
  active_dynamic: number;
  cap: number;
  blocks_24h: Record<string, number>;
  blocks_available: boolean;
};

export type BlockCount = {total: number; last_24h: number; authors_24h: number};

export type ModerationRule = {
  rule_id: string;
  revision: number;
  locale: string;
  match_type: string;
  term_raw: string;
  term: string;
  actor: string;
  reason: string;
  created_at: string;
  retired: boolean;
  retired_at: string;
  retired_by: string;
  retire_reason: string;
  counts: BlockCount;
};

export type PageInfo = {page: number; size: number; total: number; total_capped: boolean};

export type RuleList = {items: ModerationRule[]; page: PageInfo; counts_available: boolean};

export type Preview = {
  term: string;
  match_type: string;
  rejections: string[];
  authors: number;
  cumulative_authors: number;
  sample_size: number;
  sample_opinion_ids: string[];
  insufficient_sample: boolean;
};

/** 正文试判（契约 admin.md §10.1 `POST /moderation/check`）。 */
export type TextCheck = {
  blocked: boolean;
  rule_id: string;
  stage: string; // exact | gap；放行为空
  rule_source: string; // embedded | dynamic；放行为空
  rule_set_version: string;
  normalized_text: string;
  matched_text: string;
  rule_locale: string;
  rule_match_type: string;
  rule_term: string;
  allow_suppressed: number;
  cloud_evaluated: boolean;
};

export type AddResult = {changed: boolean; message: string; rule_id: string; insufficient_sample: boolean};
export type ActionReply = {changed: boolean; message: string};

export const LOCALES = ['zh', 'en', 'ko', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];

// ---- 会话 ----

// 拿不到 sessionStorage（服务端渲染、隐私模式、测试环境）时回落到内存：会话只活到页面刷新，
// 而不是静默丢失 —— 后者的症状是「登录成功了，下一个请求却说没登录」。
const memory = new Map<string, string>();

function storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
  } catch {
    // 落到内存
  }
  return {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, v),
    removeItem: (k) => void memory.delete(k),
  };
}

/** 会话只放 sessionStorage：关掉标签页就没了 —— 这枚 token 能改全站审查词库。 */
export function getToken(): string {
  return storage().getItem(tokenKey) ?? '';
}

export function setToken(token: string): void {
  if (token) storage().setItem(tokenKey, token);
  else storage().removeItem(tokenKey);
}

type Envelope<T> = {
  code: number;
  msg: string;
  data?: T;
  error?: string;
  metadata?: Record<string, unknown>;
  trace_id?: string;
};

type Fetcher = typeof fetch;

/** 发一次请求并按信封判定成败（HTTP 恒 200，成败看 body.code）。fetcher 可替换以便单测。 */
export async function adminCall<T>(
  path: string,
  init: {method?: 'GET' | 'POST'; body?: unknown; token?: string} = {},
  fetcher: Fetcher = fetch,
): Promise<T> {
  const headers: Record<string, string> = {Accept: 'application/json'};
  const token = init.token ?? getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetcher(prefix + ADMIN_PATH + path, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (e) {
    throw new ApiError('network', 0, e instanceof Error ? e.message : String(e));
  }
  const text = await res.text();
  if (res.status !== 200) {
    // 没到信封层：代理 502（sx_admin 没起来）、裸 403（Origin 没摘掉）、404（旧构建）。
    throw new ApiError('transport', res.status, `HTTP ${res.status}`, undefined, undefined, undefined, text.slice(0, 300));
  }
  let env: Envelope<T>;
  try {
    env = JSON.parse(text) as Envelope<T>;
  } catch {
    throw new ApiError('transport', res.status, 'response is not JSON', undefined, undefined, undefined, text.slice(0, 300));
  }
  if (env.code !== 200) {
    if (env.code === SESSION_INVALID) setToken('');
    throw new ApiError('business', env.code, env.msg, env.error, env.trace_id, undefined, undefined, env.metadata);
  }
  return env.data as T;
}

// ---- 接口 ----

export async function login(username: string, password: string, fetcher?: Fetcher): Promise<void> {
  const d = await adminCall<{token: string}>('/auth/login', {method: 'POST', body: {username, password}, token: ''}, fetcher);
  setToken(d.token);
}

export const getStatus = (f?: Fetcher) => adminCall<ModerationStatus>('/moderation/status', {}, f);

export function listRules(
  q: {page: number; size: number; ruleID?: string; includeRetired?: boolean},
  f?: Fetcher,
): Promise<RuleList> {
  const p = new URLSearchParams({'page.page': String(q.page), 'page.size': String(q.size)});
  if (q.ruleID) p.set('rule_id', q.ruleID);
  if (q.includeRetired) p.set('include_retired', 'true');
  return adminCall<RuleList>(`/moderation/rules?${p}`, {}, f);
}

export const previewRule = (locale: string, term: string, f?: Fetcher) =>
  adminCall<Preview>('/moderation/rules/preview', {method: 'POST', body: {locale, term}}, f);

export const addRule = (
  body: {locale: string; term: string; reason: string; evidence_opinion_ids: string[]},
  f?: Fetcher,
) => adminCall<AddResult>('/moderation/rules', {method: 'POST', body}, f);

export const retireRule = (ruleID: string, reason: string, f?: Fetcher) =>
  adminCall<ActionReply>(`/moderation/rules/${encodeURIComponent(ruleID)}/retire`, {method: 'POST', body: {reason}}, f);

/** 正文原样发给后端：规整只在后端一处做，前端再规整一遍会让试判与发帖对同一段文字给出不同结论。 */
export const checkText = (text: string, f?: Fetcher) =>
  adminCall<TextCheck>('/moderation/check', {method: 'POST', body: {text}}, f);

// ---- 拒绝原因 → 给运营的话（契约 admin.md §10.2 的「建议运营动作」列）----

/**
 * reason → 一句中文说明。**必然落后于后端**：查不到时原样显示 reason 与 msg，不吞成「未知错误」。
 */
export const REASON_TEXT: Record<string, string> = {
  unsupported_locale: '语言只能选 zh / en / ko / ja',
  invalid_utf8: '词条含非法字符编码',
  raw_too_long: '原文超过 256 字节',
  control_char: '词条含控制字符 / 零宽字符 / 方向覆盖字符',
  too_short: '规范化后不足 2 个字',
  too_long: '过长（词条最多 64 字；理由最多 500 字）',
  no_letter: '至少要有一个字母或文字（纯符号 / emoji 不行）',
  edge_separator: '首尾不能是符号或空格',
  script_mismatch: '语言与文字对不上（中文须含汉字、日文须含汉字或假名、韩文须含韩文）',
  pii_like: '像手机号 / 邮箱 / 网址 / @账号，不能加（事件表删不掉），请交给举报与人工处理',
  bad_actor: '会话异常，请重新登录',
  required: '理由必填',
  bad_format: 'rule_id 形态不对（应为 dyn-<数字>）',
  too_many: '证据观点最多 5 条',
  duplicate_embedded: '内嵌词库已经拦这个词，无需添加',
  duplicate_dynamic: '已有动态规则拦这个词（可在列表里按 rule_id 查看）',
  retired_same_request: '同一请求加过又被下线了；确需重新加入，请换一个理由',
  false_positive_corpus: '命中零误杀语料或代币符号（聊某个币的正常帖子会整体被拒），请换一个更具体的说法',
  recent_authors: '最近观点里有太多不同作者用过这个词，多半是泛用词；若确是同一波刷屏，把刷屏的观点作为证据重提',
  recent_authors_cumulative: '连同近 24 小时新加的规则合起来命中作者过多（在拆近义词逐条加），先下线过宽的那几条',
  cap_reached: '有效动态规则已达上限，先下线不再需要的规则',
  embedded_immutable: '内嵌规则只随发版变化，后台不能下线；误杀请提给研发',
  not_found: '这条动态规则不存在',
  moderation_write_quota: '操作太频繁（每小时最多新增 10 条、下线 20 次）',
  sample_error: '取不到最近观点样本，不会放行写入，请稍后重试',
  sample_empty: '取不到最近观点样本，不会放行写入，请稍后重试',
};

/** 把一次失败翻成给运营看的一行字（带 trace_id 便于报障）。 */
export function describeError(e: unknown): string {
  if (!(e instanceof ApiError)) return String(e);
  if (e.kind === 'network') return `连不上后台（${e.message}）。开发期检查 sx_admin 与 dev 代理是否起着。`;
  if (e.kind === 'transport') return `请求没到后台信封层（HTTP ${e.code}）。${e.rawBody ?? ''}`.trim();
  const reason = typeof e.metadata?.reason === 'string' ? e.metadata.reason : '';
  let text = (reason && REASON_TEXT[reason]) || '';
  // 正文试判的空 / 超长与词条同名（too_long），按字段分开说：套用词条那句「最多 64 字」是错的。
  if (e.metadata?.field === 'text') {
    if (reason === 'empty') text = '正文为空（去掉空白与零宽字符后什么都不剩）';
    if (reason === 'too_long') text = '正文超长：发帖上限是加权 280（中文、日文假名、韩文按 2 计）';
  }
  if (reason === 'moderation_write_quota' && e.metadata?.retry_after_ms) {
    text += `，约 ${Math.ceil(Number(e.metadata.retry_after_ms) / 60000)} 分钟后可再提交`;
  }
  if (e.code === SESSION_INVALID) text = '会话已失效，请重新登录';
  const head = text || e.message;
  return `${head}（${e.code}${reason ? ` / ${reason}` : ''}${e.traceID ? ` · trace ${e.traceID}` : ''}）`;
}
