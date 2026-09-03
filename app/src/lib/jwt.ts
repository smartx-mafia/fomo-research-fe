/**
 * 只解 JWT 的 payload，**不验签**。
 *
 * 用途只有一个：把 exp / aud / iss / sub 显示出来给人看。
 * 页面上任何用到它的地方都必须标注「仅本地解码，未验签」——
 * 不标注的话，会有人以为这个页面在校验 token 的真伪。
 */
export type JwtPayload = {
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
  sub?: string;
  identifier?: string;
  auth_type?: number;
  [k: string]: unknown;
};

/** 解不出来一律返回 null（手改过的 token、随便贴进来的串都是常态）。 */
export function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    // base64url → base64：JWT 用的是 url-safe 变体，直接喂给 atob 会在
    // 含 - 或 _ 的 token 上抛 InvalidCharacterError。
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = decodeURIComponent(
      Array.from(atob(pad), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    );
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/** 剩余秒数。没有 exp 或解不出来返回 null（**不要**当成 0，那会显示成"已过期"）。 */
export function secondsLeft(payload: JwtPayload | null): number | null {
  if (!payload?.exp) return null;
  return payload.exp - Math.floor(Date.now() / 1000);
}

/** 把秒数说成人话：3天2小时 / 52分钟 / 已过期。 */
export function humanDuration(sec: number | null): string {
  if (sec === null) return '未知';
  if (sec <= 0) return '已过期';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分钟`;
  return `${sec} 秒`;
}
