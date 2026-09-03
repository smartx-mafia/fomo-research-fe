/**
 * X 绑定跨「整页跳转」的临时上下文。
 *
 * **这里碰的是 sessionStorage，不是 localStorage** —— `storage.ts` 那条
 * 「全站唯一」的约束管的是后者，两者是不同的存储，互不影响。
 * 选 sessionStorage 是因为这两条记录都只对**当前这个标签页的这一次绑定**
 * 有意义：
 *
 *   - `state` 是一次性的（10 分钟内、提交一次即作废）。落进 localStorage
 *     会跨标签页、跨浏览器重启活下来，于是下次打开页面时那个早已作废的
 *     state 还在，页面把它当成"有一次绑定正在进行中"，用户点提交必然
 *     400103 —— 而 400103 的说明是"重新发起"，人照做后又落回同一个坑。
 *   - 抓到的 `code` 同理，且它是真实凭据，没有任何理由长期留在盘上。
 *
 * 为什么非存不可：第 ② 步是**整页跳转**去 x.com，React 树整个被卸载，
 * 内存里的 state 到时候就没了 —— 而没有 state 就完成不了绑定。
 */
const PREFIX = 'smartx-login-fe.';

const KEYS = {
  /** bind/start 下发的一次性 state + 授权页地址。 */
  pending: `${PREFIX}x_bind_pending`,
  /** 从回调 URL 上抓到、但还没提交给后端的 code/state。 */
  capture: `${PREFIX}x_callback`,
} as const;

/** bind/start 的产出，等着回调回来配对。 */
export type XPending = {
  state: string;
  authorizeUrl: string;
  /** 本地发起时刻（ms）。用来在界面上显示"这个 state 还剩多久"（10 分钟）。 */
  at: number;
};

/** 从回调 URL 上抓到的东西。**抓到就先落盘，再谈能不能提交。** */
export type XCapture = {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
  at: number;
};

/** state 的服务端有效期。到点后再提交必回 400103，界面上要提前说清楚。 */
export const PENDING_TTL_MS = 10 * 60 * 1000;

function read<T>(key: string): T | null {
  try {
    const s = sessionStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    // 存储不可用、或手改过内容 —— 坏数据一律当没有，不要抛。
    // 这类调试台被手改 storage 是常态。
    return null;
  }
}

function write(key: string, v: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 存储被禁时退化成"跳转回来要手工粘 URL"，那条路本来就一直在 */
  }
}

function drop(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* 本来也没写进去 */
  }
}

export const readPending = () => read<XPending>(KEYS.pending);
export const writePending = (p: XPending) => write(KEYS.pending, p);
export const clearPending = () => drop(KEYS.pending);

export const readCapture = () => read<XCapture>(KEYS.capture);
export const writeCapture = (c: XCapture) => write(KEYS.capture, c);
export const clearCapture = () => drop(KEYS.capture);
