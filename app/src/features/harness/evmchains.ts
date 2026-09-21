// harness 这一侧的入口：链表本身在 `@/lib/evm-chains`，**产品侧与这里共用同一份**
//（理由见那个文件的最后一节：harness 的东西不许被打进产品产物，所以共用的表
// 只能放在 lib 里，两侧各自 import）。
//
// 这个文件只多做一件事：把「本域有哪些 EVM 链」从 `chains.ts` 那张唯一的链表
// 派生出来，好让 `evmchains.test.ts` 拿它与 lib 那张表逐条对 —— 加链时漏改
// supportedChains 会红在这里，而不是等到那条链上签不出东西。

import {CHAIN_IDS} from './chains';

export {ARC_RPC_URL, arcMainnet, EVM_CHAINS as HARNESS_EVM_CHAINS, EVM_CHAIN_IDS as SUPPORTED_EVM_CHAIN_IDS} from '@/lib/evm-chains';

/** 本域 EVM 链的链号（从 `chains.ts` 那张唯一的表派生，不另立一份）。 */
export const DOMAIN_EVM_CHAIN_IDS: readonly number[] = Object.entries(CHAIN_IDS)
  .filter(([name]) => name !== 'solana')
  .map(([, id]) => id);
