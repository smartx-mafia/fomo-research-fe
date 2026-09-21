import {describe, expect, it} from 'vitest';

import {ARC_RPC_URL, EVM_CHAINS, EVM_CHAIN_IDS, arcMainnet} from './evm-chains';
import {CHAINS} from './types';

// harness 那侧的守卫（`features/harness/evmchains.test.ts`）拿的是交易域的链表；
// 这一条拿的是**产品侧的链词汇表**（`lib/types.ts` 的 CHAINS）。两张表各自
// 演化过一次，所以两边都要有人盯着 —— 产品侧加了链却没加进 supportedChains
// 的症状是「那条链上签不出东西」，而链名在代码里样样都在。
describe('supportedChains 与产品侧链词汇表', () => {
  it('EVM 链的条数对得上（CHAINS 去掉 solana）', () => {
    expect(EVM_CHAINS.length).toBe(CHAINS.filter((c) => c !== 'solana').length);
  });

  it('链号互不重复，且都是正数', () => {
    expect(new Set(EVM_CHAIN_IDS).size).toBe(EVM_CHAIN_IDS.length);
    expect(EVM_CHAIN_IDS.every((id) => id > 0)).toBe(true);
  });

  // 这两条正是 Privy 内置默认表里没有的 —— 不列出来就签不了。
  it('arc(5042) 与 robinhood(4663) 都在', () => {
    expect(EVM_CHAIN_IDS).toContain(5042);
    expect(EVM_CHAIN_IDS).toContain(4663);
  });

  // viem 2.56.0 里 arc.rpcUrls.default.http 是空数组（实测）。
  it('arc 带着可用的 RPC 与浏览器地址', () => {
    expect(arcMainnet.rpcUrls.default.http).toEqual([ARC_RPC_URL]);
    expect(arcMainnet.blockExplorers?.default.url).toBe('https://explorer.arc.io');
  });
});
