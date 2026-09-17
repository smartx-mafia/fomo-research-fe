/**
 * 浏览器侧读得到的配置。
 *
 * **与环境有关的那几项（Privy app id、后端标签）已经搬到 `envs.ts`**：
 * 它们是成组的，本机与测试环境各一套，单独读一个变量必然会有漏掉另一个的
 * 那一天（漏掉的症状是登录 400100，指向 identity token，而真相是配串了环境）。
 * 这里保留原来的名字，只是把值改成"当前环境的那一份"，好让消费方不必知道
 * 环境这回事。
 *
 * `main.tsx` 里另有两个必填项（Privy app id / `VITE_SOLANA_RPC_URL`）的
 * fail-loud 检查，那两个缺了页面直接不挂载 —— 见那边的注释。
 */
import {CURRENT_ENV} from './envs.browser';

/**
 * 后端来源，**仅用于页面上的显示与报障模板**，不用于发请求。
 *
 * 真正的请求一律打 `${API_PREFIX}/v1`，由 dev server 同源代理转发（绕 CORS，
 * 理由见 `vite.config.ts` 与 `envs.ts`）。这里之所以还要知道它，是因为报障时
 * "哪个后端"是第一个要问的问题 —— 而切过后端之后旧 token 必然 400000，
 * 没有这条记录的人会去怀疑 JWT 验签，方向整个反掉。
 *
 * 它与代理真正打到的那个地址（`BUSINESS_ORIGIN` / `TEST_BUSINESS_ORIGIN`，
 * **都没有 VITE_ 前缀**，只给 vite.config.ts 用）是两回事：那些是真的目标，
 * 这个只是给人看的标签。两边应当一致，但**没有任何机制保证** ——
 * 不一致时页面上写的会是假的，所以缺配置时宁可诚实地说"不知道"。
 */
export const BUSINESS_LABEL = CURRENT_ENV.originLabel;

/** 当前环境的 Privy 应用 id。必须与该环境 `configs/business.yaml` 的 `privy.app_id` 逐字符一致。 */
export const PRIVY_APP_ID = CURRENT_ENV.privyAppId;
