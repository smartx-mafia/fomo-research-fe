// 交给 Privy 的 EVM 链表（`PrivyProvider` 的 `config.supportedChains`）。
// **产品侧与 harness 共用这一份**，理由在最后一节。
//
// # 不写这张表会怎样
//
// 不给 `supportedChains` 时 Privy 用它内置的默认链表，而那张表里**没有本域的
// robinhood(4663) 与 arc(5042)** —— 于是在这两条链上要签的东西（卖出腿的
// EIP-712 / EIP-7702 授权）会被 SDK 在**本地**拒掉：链上什么都没发生，后端那侧
// 看起来一切正常。2026-09-20 的 Arc 卖出就卡在这儿，fastswap 的 evm 列表里
// arc 早就在了。
//
// # 写了之后的第二个坑：它是**替换**，不是追加
//
// 一旦显式给出，Privy 只认这一张表。所以本域**全部** EVM 链都得列全 ——
// 漏一条的症状是「那条链昨天还能卖，今天签不了」，而代码里看不出少了什么。
// 守卫用例在 `src/features/harness/evmchains.test.ts`：它拿 `harness/chains.ts`
// 那张唯一的链表逐条对，加链时漏在这里会红。
//
// # 为什么从 viem 取而不是自己写
//
// 链号、货币符号、浏览器地址 viem 已经维护了一份，自己再写一遍就会有两份各自
// 演化。唯一要覆盖的是 **arc 的 RPC**：viem 2.56.0 里 `arc.rpcUrls.default.http`
// 是**空数组**（实测），直接交给 Privy 等于给了一条连不上的链，而症状是签名时
// 一直转圈。
//
// # 为什么放在 lib 而不是 features/harness
//
// 产品侧的 `PrivyProviders.tsx` 也要这张表，而 **harness 的任何东西都不许被打进
// 产品产物**（见 `next.config.ts` 里 `NEXT_PUBLIC_ENABLE_HARNESS` 那一整段）。
// 放在这里之后两侧各自 import，没有跨界引用，也不必抄第二份。

import {defineChain} from 'viem';
import {arc, base, bsc, mainnet, robinhood} from 'viem/chains';

/** Arc 主网 RPC（docs.arc.io 的 Connect to Arc）。viem 自带的定义里没有。 */
export const ARC_RPC_URL = 'https://rpc.mainnet.arc.io';

/**
 * 补上 RPC 与浏览器的 arc。
 *
 * **原生币是 USDC 不是 ETH**（18 位），viem 的定义里已经是对的，这里不动它 ——
 * 改成 ETH 会让 Privy 的手续费预估把单位说成以太，而那个数字看起来完全正常。
 */
export const arcMainnet = defineChain({
  ...arc,
  rpcUrls: {default: {http: [ARC_RPC_URL]}},
  blockExplorers: {default: {name: 'Arc Explorer', url: 'https://explorer.arc.io'}},
});

/**
 * 本域的五条 EVM 链。顺序不影响行为，按 `harness/chains.ts` 的顺序排，方便对照。
 *
 * Solana 不在这里：它不是 EVM，Privy 那侧由 `config.solana` 管。
 */
export const EVM_CHAINS = [bsc, robinhood, base, mainnet, arcMainnet] as const;

/** 这张表覆盖的链号，给守卫用例与调试用。 */
export const EVM_CHAIN_IDS: readonly number[] = EVM_CHAINS.map((c) => c.id);
