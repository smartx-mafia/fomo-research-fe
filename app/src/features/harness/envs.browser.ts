/**
 * `envs.ts` 的**浏览器态那一半**：读写 `localStorage`、定死当前环境、整页刷新。
 *
 * # 为什么与 `envs.ts` 分成两个文件
 *
 * 下面那几行（`readStored()` 与紧跟着的 `pickEnv(readStored())`）是在**模块
 * 顶层**跑的：一被 import 就去读 `localStorage`，然后把 `CURRENT_ENV` /
 * `API_PREFIX` 定死。这件事在 vite 里没有问题（模块只在浏览器里求值），
 * 但换到 Next 之后多了一条求值路径 —— 构建期预渲染在 **Node** 里跑一遍，
 * 那里没有 `localStorage`，于是求值出来的是"默认档"，而那个值会被当成
 * 真的。同一个原因也挡住了 CLI 脚本：它们要的只是环境表，却会被这段顶层
 * 副作用一起拖进来（`transport.ts` 头部那段注释说的就是这件事）。
 *
 * 所以拆开：环境表与 `pickEnv()` 是纯的，留在 `envs.ts`，Node 里可以放心
 * import；一切与浏览器有关的（`localStorage`、`location.reload()`）挪到
 * 这里。**这个文件只能在浏览器里 import。**
 *
 * 语义一点没动：`CURRENT_ENV` 依旧是整页只定一次、中途不变，切换依旧是
 * 写下选择再整页刷新（理由见 `envs.ts` 头部"为什么切换要整页刷新"那一节）。
 */

import {pickEnv, type EnvKey, type HarnessEnv} from './envs';

const STORAGE_KEY = 'harness.env';

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // 无痕窗口 / 禁了站点数据时会抛。读不到 = 没选过 = 默认档，这是对的降级：
    // 默认档是本机，最坏的结果是"没切过去"，而那件事在顶栏上看得见。
    return null;
  }
}

const picked = pickEnv(readStored());

/** 当前环境。**整个页面只在启动时定一次**，中途不变（切换靠整页刷新）。 */
export const CURRENT_ENV: HarnessEnv = picked.env;

/** 存的那一档没生效时的人话，null = 一切正常。页面上要显示它。 */
export const ENV_DROPPED: string | null = picked.dropped;

/** 发请求时加在 `/v1` 前面的前缀。默认档是空串。 */
export const API_PREFIX: string = CURRENT_ENV.apiPrefix;

/**
 * 切到另一个环境：写下选择，然后**整页刷新**（理由见本文件头）。
 *
 * 写不进去就抛，**不静默返回** —— 静默的表现是"点了没反应"，
 * 而那与"切过去了但后端一样"无法区分。
 */
export function switchEnv(key: EnvKey): void {
  if (key === CURRENT_ENV.key) return;
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch (e) {
    throw new Error(`环境选择写不进 localStorage（无痕窗口？）：${e instanceof Error ? e.message : String(e)}`);
  }
  location.reload();
}
