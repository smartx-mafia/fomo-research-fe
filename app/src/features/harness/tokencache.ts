// 本站 JWT 的本地缓存。
//
// # 为什么现在存了（2026-09-18 改）
//
// 从前故意不存：那时的理由是"存着会出现『Privy 已认证（30 天）但本站 token
// 已过期（72 小时）』"。那条理由在没有过期校验的前提下才成立 —— 这里读的时候
// 就把 `exp` 查了，过期的（以及快过期的）当作没有，于是那个失败模式不会出现。
//
// 不存的代价是每次刷新页面都要重跑一次 `getIdentityToken()` + `/v1/auth/login`，
// 而调试时刷新是最高频的动作。2026-09-18 实测撞上 Privy 的限流：
// 「换取本站 token 失败：Too many requests. Please wait to try again.」——
// 那是 Privy 侧的 429，等它冷却之前谁都登不进来。
//
// # 三条纪律
//
//   · **按环境 + Privy DID 双重分桶**。只按环境分桶的话，换一个人登录会把
//     上一个人的 token 交给他 —— 页面上看起来一切正常，请求却带着别人的身份。
//   · **读的时候校验 `exp`**，还剩不到一分钟的当作没有：token 在一次下单中途
//     过期的症状是每个 /v1 请求回 400000，而那个码指向"未认证"，看起来像登录坏了。
//   · **localStorage 不可用时静默降级**（隐私模式、被禁用），退回"每次重换"。

import {decodeJwtPayload} from './jwt';

export type CachedToken = {
  token: string;
  /** 签发给哪个 Privy 用户（`user.id`，即 DID）。换人登录时靠它作废。 */
  did: string;
  identifier: string;
};

/** 还剩不到这么多秒的不再交出去：留给一次下单跑完的余量。 */
const MIN_LEFT_MS = 60_000;

const keyOf = (env: string) => `harness.token.${env}`;

function storage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    // 只有真的能写才算可用：Safari 的隐私模式里对象在、writeText 抛。
    s.setItem('harness.probe', '1');
    s.removeItem('harness.probe');
    return s;
  } catch {
    return null;
  }
}

/** token 还能用到什么时候（毫秒时间戳）。解不出 `exp` 的一律当作不可用。 */
export function expiresAt(token: string): number | null {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
}

export function saveToken(env: string, v: CachedToken, store: Storage | null = storage()): void {
  try {
    store?.setItem(keyOf(env), JSON.stringify(v));
  } catch {
    /* 存不下就当没存过，下次重换一份 */
  }
}

/**
 * 取出这个环境、这个 Privy 用户的 token。**任何一条对不上都返回 null**
 * （没存过 / 换了人 / 解不出 / 过期或快过期 / 存的东西形状不对）。
 */
export function loadToken(
  env: string,
  did: string,
  now: number = Date.now(),
  store: Storage | null = storage(),
): CachedToken | null {
  let raw: string | null = null;
  try {
    raw = store?.getItem(keyOf(env)) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  let v: CachedToken;
  try {
    v = JSON.parse(raw) as CachedToken;
  } catch {
    return null;
  }
  if (!v || typeof v.token !== 'string' || typeof v.did !== 'string') return null;
  if (v.did !== did) return null;
  const at = expiresAt(v.token);
  if (at === null || at - now < MIN_LEFT_MS) return null;
  return v;
}

export function clearToken(env: string, store: Storage | null = storage()): void {
  try {
    store?.removeItem(keyOf(env));
  } catch {
    /* 清不掉也无所谓：读的时候还有 DID 与 exp 两道闸 */
  }
}
