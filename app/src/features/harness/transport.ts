/**
 * 出口传输层的两个可注入点：**这一发打到哪个 origin**，以及**每一发的耗时往哪报**。
 *
 * # 为什么需要它
 *
 * `api.ts` 是这个仓库里唯一一份后端契约，页面和压测脚本都得用它 —— 契约抄第二份
 * 的那天不会报错，只会让脚本和页面开始测**两个不同的后端**，而那种分歧是从数据
 * 对不上才被发现的。
 *
 * 但那份契约今天只能在浏览器里跑，卡住它的是两件事，都在 `call` 里：
 *
 *   - 它打的是**相对路径**（`API_PREFIX + path`），靠 dev server 的代理表转发。
 *     Node 里没有 dev server，相对路径连 URL 都不是。
 *   - 它**不记录任何耗时**。页面上人眼能感知快慢，脚本不行。
 *
 * 两件事都只需要在 `call` 那一处开一个口子，调用方一行都不用改。
 *
 * # 为什么设了 origin 就**不再加** `API_PREFIX`
 *
 * 那个前缀（`/test-env`）压根不是后端路由的一部分，它是 vite 代理表的分流依据
 * （理由见 `envs.ts` 头部）。直连后端时带上它，拿到的是 404 —— 而 404 在这个
 * 恒 200 信封的体系里会被判成 transport 类失败，报错说「请求没到 business 的
 * 信封层，检查代理」，指向代理，可这条路上根本没有代理。
 *
 * 所以两者是**互斥**的：走代理就加前缀，直连就不加。这也正好是一句能记住的话
 * —— 设了 origin 就等于声明「我不经代理」。
 *
 * # 为什么计时钩子挂在这里，而不是各个调用点包一层
 *
 * 端点函数有十几个，压测还要再加。在每个调用点包一层的失败模式是**漏掉一个**，
 * 而漏掉的表现是那一段耗时在报告里干脆不存在 —— 报告不会报错，只会少一列，
 * 没人会想到是漏包了。挂在唯一那处 `fetch` 上，新加的端点自动就被覆盖。
 *
 * # 为什么是模块级可变状态，而不是给 `call` 加参数
 *
 * 加参数意味着十几个端点函数的签名全要改，且每一个都得把参数透传下去 ——
 * 那正是上一条说的「漏掉一个」，只是换了个地方漏。这两样东西在一个进程里
 * 从头到尾只设一次（脚本启动时设，页面上根本不设），模块级状态是它真实的
 * 生命周期。
 */

import type {FailureKind} from './api';

/**
 * 一次请求的计时记录。**只给原始时刻，不给算好的差值。**
 *
 * 算差值是消费者的事：压测报告要的分位数建在原始值上，而一旦这里先算一次，
 * 报告就只能拿到被这里的口径裁剪过的东西。口径改动的代价也不一样 ——
 * 改这里要重跑，改报告只要重算。
 */
export type RequestTiming = {
  /** HTTP 方法，大写。`init` 没给时是 GET。 */
  method: string;
  /** 真正打出去的完整 URL（已含 origin 或前缀），不是调用方传的 path。 */
  url: string;
  /** 我们发出去的 `x-request-id`。**任何情况下都有**，理由见 `ApiError`。 */
  sentRequestID: string;

  /** 墙上时间（`Date.now()`）。用来把这条记录钉在时间轴上，不用来算差值。 */
  startedAtWall: number;
  /** 单调时钟（`performance.now()`）。下面三个都是它，差值只在它们之间算。 */
  startedAt: number;
  /**
   * 响应头到手的时刻。`fetch` 的 promise 落定即是此刻，body 还没读。
   * `undefined` = 请求根本没发出去（network 类失败）。
   */
  firstByteAt?: number;
  /** body 读完、信封解完的时刻。失败路径上也有，就是失败判定那一刻。 */
  completedAt: number;

  /** HTTP 状态码。`undefined` = 没拿到响应。 */
  status?: number;
  /** 信封里的业务码。`undefined` = 没解出信封。 */
  code?: number;
  /** 后端回的 `trace_id`。与 `sentRequestID` 不一致说明我们发的那个被丢弃了。 */
  traceID?: string;

  /** 这一发成不成。 */
  ok: boolean;
  /** 失败分类，与 `ApiError.kind` 同一套。成功时 `undefined`。 */
  failure?: FailureKind;
};

export type TimingHook = (t: RequestTiming) => void;

/**
 * 直连后端的 origin。**空串 = 走 dev server 代理**，也就是浏览器里的老行为。
 *
 * 形如 `http://10.0.0.1` 或 `https://api.example.com`，**不带尾斜杠**（path
 * 自带前导斜杠，两者拼起来会变成双斜杠，有的网关会把它当成另一条路由）。
 */
let baseOrigin = '';

let timingHook: TimingHook | null = null;

/**
 * 设直连 origin。只在 Node 侧调；浏览器里**一次都不该调** —— business 不发
 * CORS 头，跨源打它预检就被拦，而 fetch 抛的 `Failed to fetch` 与「后端没起来」
 * 长得一模一样（这正是 `envs.ts` 当初选择走代理的原因）。
 */
export function setBaseOrigin(origin: string): void {
  const trimmed = origin.replace(/\/+$/, '');
  if (trimmed && !/^https?:\/\//.test(trimmed)) {
    // 少写 scheme 时 `fetch` 会把它当成相对路径，拼出来的东西看着像模像样，
    // 打到的却是当前页面的源。在 Node 里更直接：根本不是合法 URL。
    throw new Error(`baseOrigin 必须带 http:// 或 https://，收到的是「${origin}」`);
  }
  baseOrigin = trimmed;
}

export function getBaseOrigin(): string {
  return baseOrigin;
}

/** 设计时钩子。传 null 关掉。**钩子抛错不会影响请求本身**，见 `emitTiming`。 */
export function setTimingHook(hook: TimingHook | null): void {
  timingHook = hook;
}

/**
 * 把 path 解成真正要打的 URL。
 *
 * `prefix` 就是 `API_PREFIX`，由调用方传进来而不是这里 import —— 反过来会让
 * `envs.ts`（读 `import.meta.env` 与 `localStorage`）被拖进这个模块的依赖里，
 * 而这个模块要能在最裸的环境里用。
 */
export function resolveUrl(prefix: string, path: string): string {
  return baseOrigin ? baseOrigin + path : prefix + path;
}

/**
 * 报一条计时。**钩子自己抛错一律吞掉。**
 *
 * 计时是旁路观测，让它把主流程带崩是本末倒置：那时候页面上或脚本里看到的是
 * 一个下单失败，而真正坏掉的是记账那一段，排查会从下单链路开始，方向完全错。
 */
export function emitTiming(t: RequestTiming): void {
  if (!timingHook) return;
  try {
    timingHook(t);
  } catch {
    /* 观测不该影响被观测者 */
  }
}

/** 单调时钟。浏览器与 Node 都有 `performance`，不必分支。 */
export function nowMs(): number {
  return performance.now();
}
