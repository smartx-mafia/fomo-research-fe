/**
 * **全站唯一碰 localStorage 的地方。**
 *
 * 「清除」按钮要能清干净，前提是键名只有一处定义。散在各处的话，
 * 退出后总会剩下一两个键，症状是「我明明退了，刷新又是登录态」。
 *
 * 不存的东西同样重要：
 *   - **identity token 不存**。它 1 小时后就是垃圾，存下来的唯一后果是
 *     有人复制走一个过期串去调试，然后对着 400100 查半天。
 *   - **OTP 验证码不存**。
 */
'use client';

import {useSyncExternalStore} from 'react';

import type {AuthMethod, UserInfo} from '@/api/auth';

const PREFIX = 'smartx-login-fe.';

export const KEYS = {
  jwt: `${PREFIX}jwt`,
  user: `${PREFIX}user`,
  meta: `${PREFIX}login_meta`,
  lastEmail: `${PREFIX}last_email`,
} as const;

export type LoginMeta = {
  /** 换取成功的本地时刻（ms）。 */
  at: number;
  is_new?: boolean;
  auth_method: AuthMethod;
  trace_id?: string;
  /**
   * 这个 token 是**哪个后端**签的。
   *
   * 切换 NEXT_PUBLIC_BUSINESS_API_BASE 后旧 token 必然 400000。没有这条记录的话，
   * 人会去怀疑 JWT 验签、去比对公钥 —— 而真相只是「换了个后端」。
   */
  origin: string;
};

export type SiteSession = {
  jwt: string;
  user: UserInfo | null;
  meta: LoginMeta | null;
};

/** localStorage 可能整个不可用（隐私模式、企业策略）。读失败一律当没有。 */
function raw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parse<T>(key: string): T | null {
  const s = raw(key);
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    // 手改过 localStorage 是这类测试台的常态，坏数据当没有，不要抛。
    return null;
  }
}

export function readSite(): SiteSession | null {
  const jwt = raw(KEYS.jwt);
  if (!jwt) return null;
  return {jwt, user: parse<UserInfo>(KEYS.user), meta: parse<LoginMeta>(KEYS.meta)};
}

/**
 * 写入失败时返回 false（存储被禁 / 配额满）。
 *
 * 调用方**必须**把 false 显示出来。静默失败的症状是「刷新后登录态没了」，
 * 而人会去查 token 有效期 —— 方向完全错了。
 */
export function writeSite(jwt: string, user: UserInfo, meta: LoginMeta): boolean {
  try {
    localStorage.setItem(KEYS.jwt, jwt);
    localStorage.setItem(KEYS.user, JSON.stringify(user));
    localStorage.setItem(KEYS.meta, JSON.stringify(meta));
    notify();
    return true;
  } catch {
    return false;
  }
}

/** 只清本站的键。**不碰 privy: 开头的键** —— 那些由 Privy SDK 自己管，
 *  手删会让它的内存态与存储不一致，下次 sendCode 直接抛。 */
export function clearSite(): void {
  try {
    localStorage.removeItem(KEYS.jwt);
    localStorage.removeItem(KEYS.user);
    localStorage.removeItem(KEYS.meta);
    notify();
  } catch {
    /* 存储不可用时本来也没写进去 */
  }
}

// ---- 全站登录态订阅（收藏星标等个人化 UI 用） ----

/** 同标签页内 writeSite/clearSite 后广播；跨标签页靠原生 storage 事件 */
const SESSION_EVENT = 'smartx-login-fe.session-change';

function notify() {
  window.dispatchEvent(new Event(SESSION_EVENT));
}

function subscribeSession(cb: () => void) {
  window.addEventListener(SESSION_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(SESSION_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

// getSnapshot 必须返回引用稳定的值：每次 new 一个对象会让
// useSyncExternalStore 认为 store 永远在变 → 无限重渲染（Max update depth）。
// 这里按三个键的原始字符串做签名，签名不变就复用上一次解析好的快照。
let snapshotCache: SiteSession | null = null;
let snapshotSig = '';

function sessionSnapshot(): SiteSession | null {
  const jwt = raw(KEYS.jwt);
  const userRaw = raw(KEYS.user);
  const metaRaw = raw(KEYS.meta);
  const sig = `${jwt ?? ''}\u0000${userRaw ?? ''}\u0000${metaRaw ?? ''}`;
  if (sig !== snapshotSig) {
    snapshotSig = sig;
    snapshotCache = jwt
      ? {jwt, user: parse<UserInfo>(KEYS.user), meta: parse<LoginMeta>(KEYS.meta)}
      : null;
  }
  return snapshotCache;
}

/** React hook：登录/登出（含其它标签页）时重渲染。SSR 阶段恒 null。 */
export function useSession(): SiteSession | null {
  return useSyncExternalStore(
    subscribeSession,
    sessionSnapshot,
    () => null,
  );
}

export function readLastEmail(): string {
  return raw(KEYS.lastEmail) ?? '';
}

/** 邮箱不是凭据（OTP 才是），存下来免得反复测试时一遍遍打字。 */
export function writeLastEmail(email: string): void {
  try {
    localStorage.setItem(KEYS.lastEmail, email);
  } catch {
    /* 忽略：这只是便利功能 */
  }
}
