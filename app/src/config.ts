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

/** Privy Solana transaction simulation + balance reads. Public browser configuration, never a secret. */
export const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || '';

/** Crossmint browser SDK public key. Server key and order client_secret must never be configured here. */
export const CROSSMINT_CLIENT_API_KEY = process.env.NEXT_PUBLIC_CROSSMINT_CLIENT_SIDE_API_KEY || '';

/** google / apple 的**硬闸**，默认关。与运行期探测是「与」的关系，见 useOAuthAvail。 */
export const ENABLE_GOOGLE = process.env.NEXT_PUBLIC_ENABLE_GOOGLE === 'true';
export const ENABLE_APPLE = process.env.NEXT_PUBLIC_ENABLE_APPLE === 'true';

/**
 * `/dev/harness` 的**页面总开关**。非 `'true'` 一律当作关闭，页面渲染 not-found。
 *
 * 默认关的理由：harness 是内部调试工具，会连真实 Privy、真实后端并签真实交易，
 * 任何一次误部署都不该让它在产品域名上可达。开关必须显式写成字符串 `'true'`，
 * 「存在即开启」那种写法会让一个空串或 `false` 也把它打开。
 */
export const ENABLE_HARNESS = process.env.NEXT_PUBLIC_ENABLE_HARNESS === 'true';

/** 浏览器直接访问的 business API 根地址。公开配置，不得包含服务端凭据。 */
export const BUSINESS_API_BASE = (
  process.env.NEXT_PUBLIC_BUSINESS_API_BASE ||
  // 兼容旧部署变量，避免切换期间静默打到默认环境。
  process.env.NEXT_PUBLIC_BUSINESS_ORIGIN_LABEL ||
  'https://sm-test-api.smartx.io'
).replace(/\/+$/, '');

/** 旧组件名称的兼容别名；显示值与真实请求地址现在严格同源。 */
export const BUSINESS_ORIGIN_LABEL = BUSINESS_API_BASE;

const CURRENT_TEST_BUSINESS_ALIASES = new Set([
  'http://35.78.100.24',
  'https://sm-test-api.smartx.io',
]);

/** 裸 IP 与 HTTPS 网关指向同一测试部署；切换到网关不应误报 JWT 来自另一环境。 */
export function sameBusinessEnvironment(left: string, right: string): boolean {
  const a = left.replace(/\/+$/, '');
  const b = right.replace(/\/+$/, '');
  return a === b || (CURRENT_TEST_BUSINESS_ALIASES.has(a) && CURRENT_TEST_BUSINESS_ALIASES.has(b));
}

/** 缺了就没法工作的配置。返回缺失项，由登录页在挂载前 fail-loud。 */
export function missingConfig(): string[] {
  return [!PRIVY_APP_ID && 'NEXT_PUBLIC_PRIVY_APP_ID'].filter(Boolean) as string[];
}
