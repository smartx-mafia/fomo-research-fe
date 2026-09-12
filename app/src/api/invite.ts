/**
 * 邀请与准入域 —— docs/contracts/invite.md（2026-09-11 BREAKING 后的形态）。
 *
 * 三条最容易接错的设计，先写在门口：
 *
 * ① **登录不再绑定邀请关系、不再收任何码**：`POST /v1/auth/login` 只建号发
 *    JWT，不因邀请域失败。绑定只剩 `POST /v1/invite/bind` 一条路，且
 *    **准入门禁恒生效** —— 未准入的账号调非豁免端点一律 430114，那是每个
 *    新用户「登录后、绑定前」的正常态，不是故障（处置：回 /status 重判）。
 * ② **只按 `next_action` 分支**（enter / bind / wait）：不要自己从
 *    `admitted` + `phase` 推导，也不要按 `is_new` 判断 —— webhook 可能
 *    先于登录建号。读到不认识的取值按 `wait` 处理（落在不放行的一侧）。
 * ③ **上级一次定下、永不改变**：不做改绑、不做换绑入口；`inviter` 恒是
 *    对象（字段恒在场），「有没有上级」只看 `admitted`，不看对象是否为空。
 */
import {call} from './envelope';

/** 邀请码（公开码）：8 位小写字母数字。服务端大小写不敏感，本地先归一小写。 */
export const INVITE_CODE_RE = /^[a-z0-9]{8}$/;

/** 阶段。窗口可被运营改，phase 只作展示与埋点，**不要用它分支**。 */
export type AdmissionPhase = 'not_open' | 'exclusive' | 'protect' | 'open';

/**
 * 服务端替前端算好的下一步（invite.md §2.2）。**登录后唯一要分支的字段**：
 * enter 进 App / bind 进绑定页 / wait 进等待页（按 bind_opens_at 倒计时）。
 * 读到不认识的值按 `wait` 处理 —— normalizeNextAction 就是这件事。
 */
export type InviteNextAction = 'enter' | 'bind' | 'wait';

export function normalizeNextAction(value: string | undefined): InviteNextAction {
  return value === 'enter' || value === 'bind' ? value : 'wait';
}

/** `/status` `/info` `/default` 共用的上级展示片段。上级未认领/未设置时字段可为空串。 */
export type InviterSnippet = {
  handle?: string;
  avatar_url?: string;
  /** 上级还是名单里未认领的行（文案「等待加入」）。true 时上面两项恒为空。 */
  pending?: boolean;
};

/** GET /v1/invite/default —— 默认邀请人（Optional 档）。留给未登录的落地页展示。 */
export type InviteDefaultReply = {
  /** 允许不带码 bind。false 时不会回码 —— 不要拿它当兜底码。 */
  enabled?: boolean;
  invite_code?: string;
  inviter?: InviterSnippet;
};

/**
 * GET /v1/invite/status —— 准入状态机（Required）。**每次登录成功、每次
 * 冷启动都调**，登录后、引导判定前。任何端点回 430114 都回到这里重判。
 */
export type InviteStatusReply = {
  /** 唯一要分支的字段；不认识的值按 wait（normalizeNextAction）。 */
  next_action: string;
  /** 此刻不带码调 /bind 会不会成功。**为 true 才渲染「跳过」按钮**。 */
  default_bind_enabled?: boolean;
  /** 绑定窗口打开的 Unix 秒。只在 next_action=wait 时非零，其余恒 0。 */
  bind_opens_at?: number | string;
  /** 只作展示与埋点，不要用它分支。 */
  phase?: AdmissionPhase;
  /** 已准入。它是 next_action=enter 的解释项；false 时 inviter 内容无意义。 */
  admitted?: boolean;
  /** 准入来源：waitlist（名单认领）/ app（自己绑的）。未准入时为空串。 */
  origin?: 'waitlist' | 'app' | '';
  /** 我的上级。admitted=false 时是全零对象，不要读。 */
  inviter?: InviterSnippet;
};

/** GET /v1/invite/info —— 邀请页（Required）。未准入回 430114：先看 /status。 */
export type InviteInfoReply = {
  /** 我的公开邀请码，8 位小写，永不变。 */
  invite_code: string;
  /** 我邀请的人数（**含名单里还没认领的**，与 list 里 pending=true 对应）。 */
  invitee_count?: number;
  /** 还能邀多少人。**0 = 不限 / 服务端没开人数限制**，不是「一个都不能邀」。 */
  invitee_quota?: number;
  /** 我这一档的等级名；运营没配等级时为空串。 */
  level_name?: string;
  inviter?: InviterSnippet;
  origin?: 'waitlist' | 'app' | '';
  /** 准入时刻，Unix 秒。 */
  admitted_at?: number | string;
};

/** 我邀请的人列表项（按绑定时间倒序）。 */
export type Invitee = {
  /** 被邀请人的用户名（无 @）。未认领或未设置时为空串。 */
  handle?: string;
  avatar_url?: string;
  /** 还是名单里未认领的行。true 时上面两项恒为空。 */
  pending?: boolean;
  /**
   * 关系来源：1 冻结名单导入 / 6 存量回填 / 7 登录后 bind 带码 /
   * 8 登录后 bind 无码挂默认。3 / 4 是 2026-09-11 之前登录期绑定的历史值，
   * 新行不再产生；2 / 5 是空号。前端只按 1 与其它分文案，读到新值当「其它」。
   */
  source?: number;
  /** 绑定时刻，Unix 秒。 */
  bound_at?: number | string;
};

export type InviteeListReply = {
  items?: Invitee[];
  /** 没有下一页时为空串。不透明串，**不要解析**；损坏/过期回 100124，处置是丢弃重拉首页。 */
  next_cursor?: string;
};

/** /v1/invite/check 的四态。服务端会附带可直接展示的 message，本地表只做兜底。 */
export const INVITE_CHECK = {
  /** 可用（放行提交；建议性的，提交仍要处理 200108 / 430113）。 */
  OK: 1,
  /** 不存在（含已封禁/已注销持有人的码 —— 不暴露状态）。 */
  NOT_FOUND: 2,
  /** 存在但当前不可用：是你自己的码 / 持有人未激活或冻结 / 独占期未开放。 */
  UNAVAILABLE: 3,
  /** 额度已满（只在服务端开了人数限制时出现）。 */
  QUOTA_EXHAUSTED: 4,
} as const;

export type InviteCheckStatus = (typeof INVITE_CHECK)[keyof typeof INVITE_CHECK];

/** 服务端 message 为空串（status=1）或老服务端不带 message 时的本地兜底文案。 */
export const INVITE_CHECK_LABEL: Record<InviteCheckStatus, string> = {
  1: '邀请码可用',
  2: '邀请码不存在，请核对拼写',
  3: '这个邀请码暂不可用（等待加入 / 是你自己的码 / 当前阶段不可用）',
  4: '这个邀请码的名额已用完，请换一个',
};

export type InviteCheckReply = {
  status: InviteCheckStatus;
  /** 可直接展示的英文句子；status=1 时为空串。展示优先用它，兜底用 INVITE_CHECK_LABEL。 */
  message?: string;
};

/**
 * GET /v1/invite/default —— 默认邀请人（Optional 档，**不带 Authorization**）。
 *
 * 与调用方是谁无关。本端点留给还没登录的落地页 / 注册页展示用；登录之后
 * 请用 /status 的 default_bind_enabled（同源、少一次请求、少一处漂移）。
 */
export function getInviteDefault(signal?: AbortSignal) {
  return call<InviteDefaultReply>('/v1/invite/default', {signal});
}

/**
 * GET /v1/invite/check?code=… —— 输入框实时校验（Optional 档）。
 *
 * 防抖 ≥300ms 且本地格式校验通过后再发；**带 JWT** —— 不带就判不出
 * 「这是你自己的码」（匿名一律回 1）。回包乱序时按输入框当前值兜底丢弃。
 */
export function checkInviteCode(code: string, bearer?: string, signal?: AbortSignal) {
  return call<InviteCheckReply>(`/v1/invite/check?code=${encodeURIComponent(code)}`, {bearer, signal});
}

/** GET /v1/invite/status —— 准入状态机（Required）。在豁免表里，未准入也能拿到回包。 */
export function getInviteStatus(bearer: string, signal?: AbortSignal) {
  return call<InviteStatusReply>('/v1/invite/status', {bearer, signal});
}

/** GET /v1/invite/info —— 邀请页（Required）。next_action=enter 时才请求它。 */
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
 * POST /v1/invite/bind —— **唯一的绑定入口**（Required）。
 *
 * 带 8 位公开码，或不带码「跳过」（`{}`，仅 /status.default_bind_enabled=true
 * 时可用 —— 为 false 时渲染了 Skip 也必然收 430115）。绑错不可改：唯一补救是
 * 注销后重新登录。逐码处置见 invite.md §4.4。
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
