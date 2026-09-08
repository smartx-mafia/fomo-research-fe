/**
 * 邀请与准入域 —— docs/contracts/invite.md（2026-09-06 BREAKING 后的形态）。
 *
 * 三条最容易接错的设计，先写在门口：
 *
 * ① **正常路径上前端不需要 `bind`**：邀请关系在登录那一笔事务里就绑好了
 *    （user.md §1）。`bind` 只留给两种场景：登录成功但 Required 端点回
 *    `430114` 的历史残留账号（他们下一次登录会自动补绑），以及服务端
 *    配置为不强制准入（`admission_optional=true`）时主动绑上级的入口。
 * ② **码只有 8 位公开码一种**：`inviter_code` / `check` 的 code 不收
 *    `@handle`（2026-09-07 起，以 `@` 开头回 100124，服务端不查库）。
 *    分享链接由前端拼，后端只认 `invite_code`。
 * ③ **`admission_optional` 判开关、`admitted` 判事实**：不强制准入时
 *    `admitted` 缺席是正常态（直接进 App），不要按它猜「还没绑、去绑」。
 */
import {call} from './envelope';

/** 邀请码（公开码）：8 位小写字母数字。服务端大小写不敏感，本地先归一小写。 */
export const INVITE_CODE_RE = /^[a-z0-9]{8}$/;

/** 入场码：运营发给 waitlist 用户本人的一次性认领凭证，16 位小写字母数字。 */
export const ENTRY_CODE_RE = /^[a-z0-9]{16}$/;

/** 阶段。窗口可被运营改，前端只认回包里的 phase，不得按时间自算。 */
export type AdmissionPhase = 'not_open' | 'exclusive' | 'protect' | 'open';

/**
 * `/status` `/info` `/default` 共用的上级展示片段。
 * 三项全缺席时是 `{}` —— 表示「有上级、但没有可展示的资料」，
 * 与「没有上级」（整个 inviter key 缺席）是两种状态，用真值区分。
 */
export type InviterSnippet = {
  handle?: string;
  avatar_url?: string;
  /** 上级还是名单里未认领的行（文案「等待加入」）。true 时上面两项缺席。 */
  pending?: boolean;
};

export type InviteDefaultReply = {
  /** 允许不带码注册。false 时缺席，且下面两项都不出现。 */
  enabled?: boolean;
  invite_code?: string;
  inviter?: InviterSnippet;
};

export type InviteStatusReply = {
  phase: AdmissionPhase;
  /** 已准入。false 时缺席。不强制准入时缺席是正常态，见文件头 ③。 */
  admitted?: boolean;
  /** 准入来源：waitlist（名单认领）/ app（注册）。未准入时缺席。 */
  origin?: 'waitlist' | 'app';
  /** 我的上级。没有上级时缺席。 */
  inviter?: InviterSnippet;
  /** true = 服务端当前不强制准入：门禁不生效，admitted 缺席直接进 App。缺席 = 强制。 */
  admission_optional?: boolean;
};

export type InviteInfoReply = {
  /** 我的公开邀请码，8 位小写，永不变。 */
  invite_code: string;
  /** 我邀请的人数（**含名单里还没认领的**）。0 时缺席。 */
  invitee_count?: number;
  /** 还能邀多少人。不限人数时整个缺席 —— 不要把缺席当成 0。 */
  invitee_quota?: number;
  /** 我这一档的等级名。运营没配等级时缺席。 */
  level_name?: string;
  inviter?: InviterSnippet;
  origin?: 'waitlist' | 'app';
  /** 准入时刻，Unix 秒。 */
  admitted_at?: number | string;
};

/** 我邀请的人列表项（按绑定时间倒序）。 */
export type Invitee = {
  /** 被邀请人的用户名（无 @）。未认领或未设置时缺席。 */
  handle?: string;
  avatar_url?: string;
  /** 还是名单里未认领的行。true 时上面两项缺席；false 缺席。 */
  pending?: boolean;
  /** 关系来源：1 冻结名单导入 / 3 注册时用码 / 4 注册时无码挂默认 / 6 存量回填 / 7 事后 bind。2、5 是空号。 */
  source?: number;
  /** 绑定时刻，Unix 秒。 */
  bound_at?: number | string;
};

export type InviteeListReply = {
  items?: Invitee[];
  /** 没有下一页时缺席。不透明串，**不要解析**；损坏/过期回 100124，处置是丢弃重拉首页。 */
  next_cursor?: string;
};

/** /v1/invite/check 的四态。 */
export const INVITE_CHECK = {
  /** 可用（放行提交；建议性的，提交仍要处理 430113/430116）。 */
  OK: 1,
  /** 不存在（含已封禁/已注销账号的码 —— 不暴露状态）。 */
  NOT_FOUND: 2,
  /** 存在但当前不可用：持有人未激活/被冻结、是你自己的码、或当前是独占期。 */
  UNAVAILABLE: 3,
  /** 额度已满（只在服务端开了人数限制时出现）。 */
  QUOTA_EXHAUSTED: 4,
} as const;

export type InviteCheckStatus = (typeof INVITE_CHECK)[keyof typeof INVITE_CHECK];

export const INVITE_CHECK_LABEL: Record<InviteCheckStatus, string> = {
  1: '邀请码可用',
  2: '邀请码不存在，请核对拼写',
  3: '这个邀请码暂不可用（等待加入 / 是你自己的码 / 当前阶段不可用）',
  4: '这个邀请码的名额已用完，请换一个',
};

/**
 * GET /v1/invite/default —— 默认邀请人（Optional 档，**不带 Authorization**）。
 *
 * 与调用方是谁无关。`enabled` 有值时注册页可以给「跳过」按钮
 * （跳过 = 不带 invite_code 登录）；缺席时邀请码输入框必填。
 * `enabled=false` 时不会回码，不要拿它当兜底码。
 */
export function getInviteDefault(signal?: AbortSignal) {
  return call<InviteDefaultReply>('/v1/invite/default', {signal});
}

/**
 * GET /v1/invite/check?code=… —— 输入框实时校验（Optional 档，**不带 Authorization**）。
 *
 * 防抖 ≥300ms 且本地格式校验通过后再发。带 JWT 时「是你自己的码」判得出
 * （回 3）；注册页匿名调用判不出（回 1），这是预期行为。
 */
export function checkInviteCode(code: string, signal?: AbortSignal) {
  return call<{status: InviteCheckStatus}>(`/v1/invite/check?code=${encodeURIComponent(code)}`, {signal});
}

/**
 * GET /v1/invite/status —— 准入状态机（Required）。登录后、引导判定前调，每次冷启动都调。
 * 未准入且 430114 门禁残留时它仍在豁免表里，正常能拿到回包。
 */
export function getInviteStatus(bearer: string, signal?: AbortSignal) {
  return call<InviteStatusReply>('/v1/invite/status', {bearer, signal});
}

/**
 * GET /v1/invite/info —— 邀请页（Required）。
 *
 * 未准入回 430114（码在准入时才生成）——先看 /status 再决定要不要请求它，
 * 不强制准入（admission_optional=true）时 430114 = 「还没绑」，不是门禁。
 */
export function getInviteInfo(bearer: string, signal?: AbortSignal) {
  return call<InviteInfoReply>('/v1/invite/info', {bearer, signal});
}

/** GET /v1/invite/list —— 我邀请的人（Required）。limit 1..50，超 50 回 100124（不钳位）。 */
export function listInvitees(bearer: string, cursor?: string, limit?: number, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit !== undefined) params.set('limit', String(limit));
  const qs = params.toString();
  return call<InviteeListReply>(`/v1/invite/list${qs ? `?${qs}` : ''}`, {bearer, signal});
}

/**
 * POST /v1/invite/bind —— 兜底准入 / 主动绑上级（Required）。
 *
 * 正常路径不需要它（登录即绑定）；给 onboarding 的 invite 项与不强制准入
 * 期间主动绑定用。不带码且服务端没开默认绑定回 430115；已准入再调回 430111。
 */
export function bindInvite(bearer: string, inviterCode?: string) {
  return call<InviteInfoReply>('/v1/invite/bind', {
    method: 'POST',
    bearer,
    body: inviterCode === undefined ? {} : {inviter_code: inviterCode},
  });
}

/** 归一用户输入的码：去首尾空白 + 转小写（服务端同规则）。不去连字符 —— 码本身没有连字符。 */
export function normalizeCode(input: string): string {
  return input.trim().toLowerCase();
}
