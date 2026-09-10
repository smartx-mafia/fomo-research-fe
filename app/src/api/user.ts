/**
 * 个人资料域（username / nickname / language / 注销）—— docs/contracts/user.md §3、§4。
 *
 * 四个写端点都回**完整 UserInfo**（改完不必再拉 /v1/user/info），身份只取自
 * JWT —— 请求体里没有、也不接受 identifier。
 *
 * 校验规则与后端同源（§3.1），本地先拦一道再发请求；本地规则与 100111
 * 分岔时按前端 bug 处理，不把 100111 当「用户输错」提示。
 */
import {call} from './envelope';

import type {UserInfo} from './auth';

/** 用户名：1–128 位，`A-Za-z0-9_`，不含空格 / 点 / 连字符 / 中文 / emoji。唯一且大小写不敏感。 */
export const USERNAME_RE = /^[A-Za-z0-9_]{1,128}$/;

/** 昵称：1–64 个字符（按字符计，中文一个字算一个）。后端另拒换行 / 控制字符 / 零宽字符。 */
export const NICKNAME_MAX_CHARS = 64;

/** 简介：最多 512 个字符（按字符计）。 */
export const BIO_MAX_CHARS = 512;

/** language 白名单（大小写不敏感，服务端归一后入库）。 */
export const LANGUAGES = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
  ko: '한국어',
};

/** 按字符数限长（[...str] 按 Unicode 码点切，emoji 不重复计）。 */
export function charLength(s: string): number {
  return [...s].length;
}

/** 昵称本地校验：去首尾空白后 1–64 字符，且不含控制字符。 */
export function validateNickname(nickname: string): string | null {
  const trimmed = nickname.trim();
  if (!trimmed) return '昵称不能为空';
  if (charLength(trimmed) > NICKNAME_MAX_CHARS) return `昵称最多 ${NICKNAME_MAX_CHARS} 个字符`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return '昵称不能包含控制字符';
  return null;
}

/** POST /v1/user/username —— 设置用户名（handle）。回整份 UserInfo。 */
export function setUsername(bearer: string, username: string) {
  return call<UserInfo>('/v1/user/username', {method: 'POST', bearer, body: {username}});
}

/** POST /v1/user/nickname —— 设置昵称（不限次）。回整份 UserInfo。 */
export function setNickname(bearer: string, nickname: string) {
  return call<UserInfo>('/v1/user/nickname', {method: 'POST', bearer, body: {nickname}});
}

/** POST /v1/user/language —— 设置界面语言（服务端归一大小写）。回整份 UserInfo。 */
export function setLanguage(bearer: string, language: string) {
  return call<UserInfo>('/v1/user/language', {method: 'POST', bearer, body: {language}});
}

/** GET /v1/user/username/available —— 可用性预检。status 恒存在：1 可用 / 2 已被占用。 */
export async function checkUsernameAvailable(
  bearer: string,
  username: string,
  signal?: AbortSignal,
): Promise<{status: 1 | 2}> {
  const res = await call<{status: number}>(
    `/v1/user/username/available?username=${encodeURIComponent(username)}`,
    {bearer, signal},
  );
  if (res.data.status !== 1 && res.data.status !== 2) {
    throw new Error(`username/available 回包 status=${res.data.status}，契约里只有 1/2`);
  }
  return {status: res.data.status};
}

/**
 * POST /v1/user/delete —— 注销账号。请求体恒 `{}`，幂等、不可逆。
 *
 * 成功后调用方必须立刻 clearSite() 丢弃本站 JWT：服务端没有全局吊销，
 * 旧 token 打其它域可能仍被放行（已登记的服务端缺口）。
 */
export function deleteAccount(bearer: string) {
  return call<Record<string, never>>('/v1/user/delete', {method: 'POST', bearer, body: {}});
}
