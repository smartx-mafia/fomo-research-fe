/**
 * 登录域全站唯一读 process.env 的地方（自 privy-login-demo 迁移，Vite 的
 * import.meta.env 已换成 Next 的 NEXT_PUBLIC_ 前缀）。
 *
 * 集中读的理由：缺配置的报错要在一处说清楚。散在各组件里读的话，
 * 缺 appId 的表现是「点登录没反应」（Privy 内部静默拒绝），
 * 而那个症状与网络问题、与 dashboard 没开 email 完全无法区分。
 */

/** Privy 应用 id。必须与后端 configs/business.yaml 的 privy.app_id 逐字符一致。 */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';

/**
 * Privy App client id（可选）。
 * 空串必须转成 undefined —— 传空串给 PrivyProvider 会被当成一个真实存在的
 * client id 去校验，然后失败；而 undefined 才是「不传」。
 */
export const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || undefined;

/** google / apple 的**硬闸**，默认关。与运行期探测是「与」的关系，见 useOAuthAvail。 */
export const ENABLE_GOOGLE = process.env.NEXT_PUBLIC_ENABLE_GOOGLE === 'true';
export const ENABLE_APPLE = process.env.NEXT_PUBLIC_ENABLE_APPLE === 'true';

/**
 * 后端来源，**仅用于页面上的显示与生成 curl 命令**，不用于发请求。
 *
 * 真正的请求一律打相对路径 /v1，由 Next rewrites 同源代理转发（绕 CORS，
 * 配置见 next.config.ts）。
 */
export const BUSINESS_ORIGIN_LABEL =
  process.env.NEXT_PUBLIC_BUSINESS_ORIGIN_LABEL || 'http://13.231.246.26:8080';

/** 缺了就没法工作的配置。返回缺失项，由登录页在挂载前 fail-loud。 */
export function missingConfig(): string[] {
  return [!PRIVY_APP_ID && 'NEXT_PUBLIC_PRIVY_APP_ID'].filter(Boolean) as string[];
}
