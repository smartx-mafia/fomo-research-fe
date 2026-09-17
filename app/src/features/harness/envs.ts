/**
 * 页面对着**哪一个后端**跑。顶栏上那个「环境」开关的全部依据。
 *
 * # 为什么需要它
 *
 * 下单最后落到 `sx_trade`，而 Relay 的 api key 配在 `sx_trade` 那一侧
 * （后端仓 `configs/trade.secret.yaml` 的 `relay.api_key`）——
 * **本机那把与测试环境那把不是同一把**。于是"用测试环境的 key 下一单"
 * 这件事，在这个页面上唯一能做的动作就是：把 `/v1` 打到测试环境的 business。
 *
 * # 一个环境不止一个变量，这是这个模块存在的理由
 *
 * 换后端的同时**必须换 Privy app id**：business 拿 `privy.app_id` 当
 * identity token 的 `aud` 校验值，前端 SDK 用的 appId 与它不一致时登录一律
 * 400100 —— 而那个码说的是"identity token 不合法"，看起来像 Privy 出了问题。
 * 两套 app 还是**两套用户、两套钱包**：同一个邮箱在两边是两个人，地址不同。
 *
 * 所以环境是一个**成组的东西**（后端 + Privy app + 标签），不是一个开关。
 * 手工改 `.env.local` 再重启也能换，但那条路上漏改一个变量不报错，
 * 症状是登录失败，指向的是登录本身。这里把它们绑在一起。
 *
 * # 为什么请求走"路径前缀"而不是直接打绝对 URL
 *
 * business 的 HTTP 面**不发 CORS 头**（本仓已知缺口表里那一条）。浏览器里
 * 跨源打它，预检就被拦下，而 fetch 抛出来的 `Failed to fetch` 与"后端没起来"
 * 长得一模一样。所以两个环境都得经 dev server 同源代理（理由见
 * `vite.config.ts`），而 vite 的代理表**只按路径前缀分流** —— 于是选中测试
 * 环境时，每一发请求的路径前面加一段 `/test-env`，代理按它转到另一个 target。
 *
 * 顺带一个好处：devtools 的网络面板里一眼看得出这一发打的是哪个环境，
 * 不必去猜 dev server 当时的配置。
 *
 * # 为什么切换要整页刷新
 *
 * 三样东西各自绑在环境上，而它们都不是能就地改的：
 *
 * - **Privy app id** 是 `PrivyProvider` 的 prop，SDK 的会话建在 provider 内部；
 * - **本站 JWT** 只活在内存里（见 `App.tsx` 顶部 token 那段），拿旧环境的
 *   token 打新后端一律 400000，而那个码说的是"未认证"；
 * - 页面上一堆读过的状态（钱包、余额、仓位）全是上一个环境的。
 *
 * 一次 `location.reload()` 把三件事一起清掉，比逐个 reset 少一整类"忘了清"
 * 的 bug。代价是切换要重登一次 —— 本来也必须重登，两边是两套用户。
 */

/** 环境的键。**写进 localStorage 的就是这两个串**，改名字要考虑存量。 */
export type EnvKey = 'local' | 'test';

export type HarnessEnv = {
  key: EnvKey;
  /** 顶栏开关上的名字。 */
  label: string;
  /** Privy 应用 id。必须与该环境 business 的 `privy.app_id` 逐字符一致。 */
  privyAppId: string;
  /** 打 `/v1` 之前加的前缀，dev server 的代理表按它分流。默认档是空串。 */
  apiPrefix: string;
  /** 后端地址，**只给人看**（顶栏 title 与报障模板），不用于发请求。 */
  originLabel: string;
  /**
   * 不为 null = 这一档**没配全**，开关上禁用并原样写出缺的那个变量名。
   *
   * 缺配置时不静默隐藏这一档：一个消失了的开关无法与"这个版本没有这功能"
   * 区分，而禁用 + 写出缺哪个变量是能直接照着做的。
   */
  missing: string | null;
};

const LOCAL: HarnessEnv = {
  key: 'local',
  // 默认档的名字可配：部署在 smartx-test 上的那一份，同源打到的**就是**测试
  // 环境的 business，那儿写"本机"是假的。见 README 的部署那一节。
  label: process.env.NEXT_PUBLIC_HARNESS_ENV_LABEL || '本机',
  privyAppId: process.env.NEXT_PUBLIC_HARNESS_PRIVY_APP_ID ?? '',
  apiPrefix: '',
  originLabel:
    process.env.NEXT_PUBLIC_HARNESS_BUSINESS_LABEL || '(未配 VITE_BUSINESS_ORIGIN_LABEL，由 dev server 代理转发)',
  missing: process.env.NEXT_PUBLIC_HARNESS_PRIVY_APP_ID ? null : 'VITE_PRIVY_APP_ID',
};

const TEST: HarnessEnv = {
  key: 'test',
  label: process.env.NEXT_PUBLIC_HARNESS_TEST_ENV_LABEL || '测试环境',
  // **不给默认值。** 填一个猜的 app id，症状是登录 400100 —— 指向 identity
  // token，而真相是这一档根本没配。没配就禁用，理由写在开关上。
  privyAppId: process.env.NEXT_PUBLIC_HARNESS_TEST_PRIVY_APP_ID ?? '',
  apiPrefix: '/test-env',
  originLabel:
    process.env.NEXT_PUBLIC_HARNESS_TEST_BUSINESS_LABEL ||
    '(未配 VITE_TEST_BUSINESS_ORIGIN_LABEL，由 dev server 按 TEST_BUSINESS_ORIGIN 代理转发)',
  missing: process.env.NEXT_PUBLIC_HARNESS_TEST_PRIVY_APP_ID ? null : 'VITE_TEST_PRIVY_APP_ID',
};

/** 全部环境。**第 0 个是默认档**（存量键认不出时退回它）。 */
export const ENVS: readonly HarnessEnv[] = [LOCAL, TEST];

export type EnvPick = {
  env: HarnessEnv;
  /**
   * 不为 null = 存的那一档**没生效**，这是一句能直接显示的人话。
   *
   * 退回默认档时必须说出来：静默退回的表现是"我明明选了测试环境，
   * 可下的单还是进了本机"，而那时页面上任何一处都不会提示。
   */
  dropped: string | null;
};

/**
 * 按存下来的键挑一档。**纯函数**，好让它在没有 localStorage 的环境里可测。
 *
 * `stored` 为 null（没选过）不算异常，也就不产生 `dropped`。
 */
export function pickEnv(stored: string | null, envs: readonly HarnessEnv[] = ENVS): EnvPick {
  const fallback = envs[0]!;
  if (stored === null || stored === fallback.key) return {env: fallback, dropped: null};

  const hit = envs.find((e) => e.key === stored);
  if (!hit) {
    return {env: fallback, dropped: `存着的环境「${stored}」不认识，已退回「${fallback.label}」`};
  }
  if (hit.missing) {
    return {
      env: fallback,
      dropped: `已选的「${hit.label}」缺 ${hit.missing}，没有生效，当前跑在「${fallback.label}」上`,
    };
  }
  return {env: hit, dropped: null};
}
