// 本域交易的链集合。**加链只改这个文件。**
//
// # 为什么它值得是一个单独的文件
//
// 这三样东西（链名、链号映射、是不是 EVM）原先都在 App.tsx 里，而 App.tsx
// 在 vitest 的 node 环境里 import 不进来（JSX + Privy + DOM）—— 也就是
// **本仓最容易漏改的那张表恰恰是唯一测不到的那张**。加 base 时曾有一条
// chains.test.ts 枚举过链集合，但它枚举的是代付表，代付面板删掉之后那条
// 守卫也一起没了。收在这里之后它重新测得到。
//
// 漏改一处的后果各不相同，且没有一个指向"你少改了一张表"：
//
//   · 漏了 Chain 那一行  → 选择器里的值 TypeScript 当场拒（唯一响亮的一种）；
//   · 漏了 chainOfID     → 服务端点名的链在仓位列表里解不出来，显示成 undefined；
//   · 漏了选择器 option  → 那条链在页面上根本选不到，而代码里样样都在。

/** 本域交易的链。它是**路由声明**（标的在哪条链上），不是身份声明。 */
export type Chain = 'solana' | 'bsc' | 'robinhood' | 'base' | 'ethereum';

/**
 * 链名 → 链号。**加链时先在这里加一行。**
 *
 * 链号是数字不是字符串：最大 792703809，float64 装得下。
 *
 * ⚠ **`ethereum` 与 Privy 的 `chain_type="ethereum"` 不是一回事。** 后者指
 * 整个 EVM 家族 —— bsc / robinhood / base / ethereum 四条链共用同一把
 * embedded 钥匙、同一个地址，Privy 那侧只有 `ethereum` 与 `solana` 两个取值。
 * 这里的 `ethereum` 是本域的一条具体的链（EVM 1）。后端在
 * `privysecurity/chains.go` 上把这个同名陷阱写成了一整段注释：照抄 Privy 的
 * 说法会让其余三条 EVM 链的每一笔下单都查不到钱包，而钱包明明就在回包里。
 *
 * ⚠ **Solana 的链号只能是 792703809，不是 101。** 它是结算方分配的，
 * 直接出现在报价请求里。
 */
export const CHAIN_IDS = {
  solana: 792703809,
  bsc: 56,
  robinhood: 4663,
  base: 8453,
  ethereum: 1,
} as const satisfies Record<Chain, number>;

/** 链的显示顺序，也是选择器里的顺序。Solana 在前：本域的出资腿永远是它。 */
export const CHAINS = Object.keys(CHAIN_IDS) as readonly Chain[];

/**
 * 这条链是不是 EVM。
 *
 * # 为什么要有这个函数，而不是继续写 `chain === 'bsc' || chain === ...`
 *
 * 那个析取式原先散在三处（出资腿、买入提示、卖出提示）。加第三条 EVM 链时
 * 漏掉其中任何一处都**不会报错**，而三处漏掉的后果完全不同：
 *
 *   - 漏了出资腿 → 买入不带 `funding.chain`，trade 侧回 `INVALID_FUNDING`
 *     「这条腿缺钱包」，报错指向请求格式，指不回「这里少列了一条链」；
 *   - 漏了两条提示 → 页面安静地少几句话，没有任何迹象。
 *
 * 收成一处之后，加链只改 `Chain` 那一行。判据写成「**不是 solana**」而不是
 * 穷举 EVM 那一侧：Solana 是本域唯一的非 EVM，而穷举 EVM 正是会漏的那个方向
 * —— 新链默认落进 EVM 一侧是对的，落进 Solana 一侧则会让它去签一笔
 * ed25519 交易。
 */
export function isEVM(chain: Chain): boolean {
  return chain !== 'solana';
}

/** Solana 在 v2 线上的 CAIP-2 标识。EVM 那一支是 `eip155:<链号>`。 */
export const SOLANA_CAIP = 'solana:mainnet';

/**
 * 链名 → v2 线上的链标识（CAIP-2 风格）。
 *
 * EVM 那一支的数字部分**就是链号本身**：写错一位不报错，只会把报价发到另一条
 * 链上去，而那笔钱是真的。后端 `fastswap/domain/chains.go` 用一段 init 断言把
 * 这件事钉死，这里从同一张 `CHAIN_IDS` 表派生，等于共用同一个真相源。
 */
export function caipOf(chain: Chain): string {
  return chain === 'solana' ? SOLANA_CAIP : `eip155:${CHAIN_IDS[chain]}`;
}

/** CAIP-2 标识 → 链名。**认不出返回 undefined，不猜**（同 chainOfID 的理由）。 */
export function chainOfCaip(caip: string): Chain | undefined {
  return CHAINS.find((c) => caipOf(c) === caip);
}

/**
 * 链号 → 链名。**认不出就返回 undefined，不猜一个默认值** —— 猜错的后果是
 * 把一笔 BSC 的卖单当成 Solana 发出去，而那笔请求本身完全合法。
 */
export function chainOfID(id: number): Chain | undefined {
  return CHAINS.find((c) => CHAIN_IDS[c] === id);
}
