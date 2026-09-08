/**
 * 设置域 —— docs/contracts/settings.md（四页设置中心 + 个人资料扩展）。
 *
 * 四条贯穿性规则（settings-integration.md §0）：
 *
 * ① **22 个端点全部要求登录**，身份只取自 JWT。
 * ② **每条 POST 回整页**：改一个开关，回包就是那一页的最新全貌，直接
 *    覆盖本地状态，不用再打 GET。
 * ③ **限次是滚动窗口**（最近 24h / 30 天）：到上限回 420104，
 *    `metadata.retry_after_seconds`（字符串）是还要等的秒数 —— 只显示倒计时，
 *    不自动重试；查询回包里的 `next_allowed_at` 是下次可改的 Unix 秒。
 * ④ 枚举大小写不敏感、服务端归一后回包（`cny` → `CNY`）；不合法回 100123。
 *
 * 编码事实（README 规则 10，2026-09-07 起）：为 false 的布尔、为 0 的数字、
 * 空串都照常出现。但类型仍全部写成可缺席 —— 老版本服务端整个 key 不出现，
 * 真值判断两边都对。
 */
import {call} from './envelope';

import type {UserInfo} from './auth';

// ── Trading ────────────────────────────────────────────────────────────────

export type TradingSettings = {
  /** 默认滑点，十进制串固定 6 位小数（"0.030000" = 3%）。展示用它。 */
  default_slippage: string;
  /** 下单前滑动确认条开关。 */
  trade_confirmation?: boolean;
  /** 计价单位：USD / USDC / USDT / CNY（展示单位，换算由前端做）。 */
  currency: string;
  /** default_slippage 的万分之一整数（向下取整）。**下单接口显式传它**。 */
  slippage_bps: number;
  /** 用户明确设过滑点。缺席 = 上面是服务端默认 3%。 */
  explicit?: boolean;
};

export const CURRENCIES = ['USD', 'USDC', 'USDT', 'CNY'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** 滑点本地校验（与后端同口径）：十进制串 0.0001~1，最多 6 位小数，0 不合法。 */
export function validateSlippage(value: string): string | null {
  const v = value.trim();
  if (!/^\d*(\.\d*)?$/.test(v) || v === '' || v === '.') return '请输入数字';
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '滑点不能为 0';
  if (n < 0.0001 || n > 1) return '滑点范围 0.0001 ~ 1（0.01% ~ 100%）';
  const frac = v.split('.')[1] ?? '';
  if (frac.length > 6) return '最多 6 位小数';
  return null;
}

/** GET /v1/settings/trading */
export function getTradingSettings(bearer: string, signal?: AbortSignal) {
  return call<TradingSettings>('/v1/settings/trading', {bearer, signal});
}

/** POST /v1/settings/trading/slippage —— 十进制串（"0.02" = 2%）。回整页。 */
export function setSlippage(bearer: string, value: string) {
  return call<TradingSettings>('/v1/settings/trading/slippage', {method: 'POST', bearer, body: {value}});
}

/** POST /v1/settings/trading/confirmation —— 回整页。 */
export function setTradeConfirmation(bearer: string, enabled: boolean) {
  return call<TradingSettings>('/v1/settings/trading/confirmation', {method: 'POST', bearer, body: {enabled}});
}

/** POST /v1/settings/trading/currency —— 大小写不敏感，入库大写。回整页。 */
export function setCurrency(bearer: string, currency: string) {
  return call<TradingSettings>('/v1/settings/trading/currency', {method: 'POST', bearer, body: {currency}});
}

// ── Security ───────────────────────────────────────────────────────────────

/** 私钥导出记录：三者都是零值时是 `{}`。记录只增不减，没有撤销端点。 */
export type KeyExportRecord = {
  exported?: boolean;
  count?: number;
  last_at?: number | string;
};

export type SecuritySettings = {
  /** Face ID 总开关（默认关）。五个开关都只是状态位，服务端不据此拦截任何动作。 */
  face_id?: boolean;
  /** Authenticator 已绑定（状态位；TOTP 校验不在本域）。 */
  authenticator?: boolean;
  face_id_withdraw?: boolean;
  face_id_export_key?: boolean;
  face_id_open_app?: boolean;
  key_export?: KeyExportRecord;
}

export type KeyChain = 'ethereum' | 'bsc' | 'base' | 'solana';

/** GET /v1/settings/security */
export function getSecuritySettings(bearer: string, signal?: AbortSignal) {
  return call<SecuritySettings>('/v1/settings/security', {bearer, signal});
}

/** 五个开关端点共用 {"enabled":bool} 请求体，各回整页。 */
function postSecuritySwitch(path: string, bearer: string, enabled: boolean) {
  return call<SecuritySettings>(path, {method: 'POST', bearer, body: {enabled}});
}

export const setFaceId = (bearer: string, enabled: boolean) =>
  postSecuritySwitch('/v1/settings/security/face-id', bearer, enabled);
export const setAuthenticator = (bearer: string, enabled: boolean) =>
  postSecuritySwitch('/v1/settings/security/authenticator', bearer, enabled);
export const setFaceIdWithdraw = (bearer: string, enabled: boolean) =>
  postSecuritySwitch('/v1/settings/security/face-id-withdraw', bearer, enabled);
export const setFaceIdExportKey = (bearer: string, enabled: boolean) =>
  postSecuritySwitch('/v1/settings/security/face-id-export-key', bearer, enabled);
export const setFaceIdOpenApp = (bearer: string, enabled: boolean) =>
  postSecuritySwitch('/v1/settings/security/face-id-open-app', bearer, enabled);

/**
 * POST /v1/settings/security/key-export —— 每完成一次 Privy 私钥导出打一次。
 *
 * 请求只有链名与地址，**绝不上传私钥**。地址必须是本人的 Privy 托管钱包
 * （服务端按账户表校验），否则 100123。EVM 大小写不敏感。
 */
export function recordKeyExport(bearer: string, chain: KeyChain, address: string) {
  return call<KeyExportRecord>('/v1/settings/security/key-export', {
    method: 'POST',
    bearer,
    body: {chain, address},
  });
}

// ── Notifications ──────────────────────────────────────────────────────────

export type NotificationSettings = {
  /** 系统推送总开关。 */
  push?: boolean;
  /** “我关注的人”类通知。 */
  following?: boolean;
};

export function getNotificationSettings(bearer: string, signal?: AbortSignal) {
  return call<NotificationSettings>('/v1/settings/notifications', {bearer, signal});
}

export const setPushEnabled = (bearer: string, enabled: boolean) =>
  call<NotificationSettings>('/v1/settings/notifications/push', {method: 'POST', bearer, body: {enabled}});

export const setFollowingEnabled = (bearer: string, enabled: boolean) =>
  call<NotificationSettings>('/v1/settings/notifications/following', {method: 'POST', bearer, body: {enabled}});

// ── Preferences ────────────────────────────────────────────────────────────

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export type Preferences = {
  /** 读自用户资料；改它走 POST /v1/user/language（本域不复制该端点）。 */
  language?: string;
  theme?: string;
};

export function getPreferences(bearer: string, signal?: AbortSignal) {
  return call<Preferences>('/v1/settings/preferences', {bearer, signal});
}

/** POST /v1/settings/preferences/theme —— 取值 system / light / dark（大小写不敏感）。 */
export function setTheme(bearer: string, theme: string) {
  return call<Preferences>('/v1/settings/preferences/theme', {method: 'POST', bearer, body: {theme}});
}

// ── 个人资料（Profile 页） ─────────────────────────────────────────────────

/** 三项限次资料共用的配额形状。 */
export type ProfileQuota = {
  /** 窗口内允许次数。 */
  limit?: number;
  /** 还剩几次。**为 0 时缺席** —— 缺席就是不能改，用 next_allowed_at 显示倒计时。 */
  remaining?: number;
  /** 下次可改时刻，Unix 秒。**能改时缺席**。 */
  next_allowed_at?: number | string;
  /** 窗口长度（秒），用来生成“每 24 小时最多 5 次”这类文案。 */
  window_seconds?: number;
};

/** X 绑定摘要。未绑定时是 {}。不含绑定渠道 —— 标注渠道取 /v1/user/x/binding 的 bind_source。 */
export type ProfileXSummary = {
  bound?: boolean;
  username?: string;
  avatar_url?: string;
};

export type ProfileAggregate = {
  /** 与 /v1/user/info 同一个 UserInfo，多一个 bio。 */
  user: UserInfo;
  x?: ProfileXSummary;
  quota?: {
    avatar?: ProfileQuota;
    bio?: ProfileQuota;
    username?: ProfileQuota;
  };
};

/** GET /v1/profile —— 进 Profile 页只打这一次。不要缓存跨页使用。 */
export function getProfile(bearer: string, signal?: AbortSignal) {
  return call<ProfileAggregate>('/v1/profile', {bearer, signal});
}

export type AvatarPreset = {id: string; url: string};

/** GET /v1/profile/avatar/presets —— 8 张预设（服务端写死），URL 直接当 img src。 */
export function getAvatarPresets(bearer: string, signal?: AbortSignal) {
  return call<{presets?: AvatarPreset[]}>(`/v1/profile/avatar/presets`, {bearer, signal});
}

export type AvatarHistoryItem = {
  url: string;
  /** 本人用过时才有；已绑 X 但没用过该头像时缺席。 */
  used_at?: number | string;
};

/** GET /v1/profile/avatar/history —— 本人用过的头像，去重、最近在前；已绑 X 时当前 X 头像也在列表里。 */
export function getAvatarHistory(bearer: string, signal?: AbortSignal) {
  return call<{items?: AvatarHistoryItem[]}>(`/v1/profile/avatar/history`, {bearer, signal});
}

/** POST /v1/profile/avatar —— preset_id / url 二选一（都传或都不传回 100123）。 */
export function setAvatar(bearer: string, source: {presetId?: string; url?: string}) {
  const body: Record<string, string> = {};
  if (source.presetId !== undefined) body.preset_id = source.presetId;
  if (source.url !== undefined) body.url = source.url;
  return call<{user: UserInfo; quota?: ProfileQuota}>('/v1/profile/avatar', {method: 'POST', bearer, body});
}

/** POST /v1/profile/bio —— 空串 = 清空；bio 字段必须出现在请求体里（缺席回 100111）。回 user + bio 配额。 */
export function setBio(bearer: string, bio: string) {
  return call<{user: UserInfo; quota?: ProfileQuota}>('/v1/profile/bio', {method: 'POST', bearer, body: {bio}});
}

/** 从 X 导入的字段名（请求里只有字段名，值一律取服务端存的快照）。 */
export type XImportField = 'nickname' | 'username' | 'avatar' | 'bio';

export type XImportReply = {
  user: UserInfo;
  /** 逐字段跳过原因：taken（handle 被占）/ invalid（昵称含非法字符）/ empty（X 侧为空，不清空本站值）。全部跳过仍是 200。 */
  skipped?: {field: string; reason: 'taken' | 'invalid' | 'empty'}[];
};

/** POST /v1/profile/x/import —— 不占任何修改次数。Privy 通道绑定的快照没有 bio，导入 bio 恒跳过（empty）。 */
export function importProfileFromX(bearer: string, fields: XImportField[]) {
  return call<XImportReply>('/v1/profile/x/import', {method: 'POST', bearer, body: {fields}});
}
