import {describe, expect, it} from 'vitest';

import {CHAINS, CHAIN_IDS, isEVM} from './chains';
import {
  ARC_RPC_URL,
  DOMAIN_EVM_CHAIN_IDS,
  HARNESS_EVM_CHAINS,
  SUPPORTED_EVM_CHAIN_IDS,
  arcMainnet,
} from './evmchains';

describe('交给 Privy 的链表', () => {
  // 这是本文件存在的理由。`supportedChains` 是**替换**而不是追加：
  // 漏一条链的症状是「那条链签不了」，而代码里看不出少了什么 ——
  // Privy 只是在本地把请求拒掉，链上什么都没发生。
  it('本域每一条 EVM 链都在表里', () => {
    const want = CHAINS.filter(isEVM).map((c) => CHAIN_IDS[c]);
    expect([...SUPPORTED_EVM_CHAIN_IDS].sort((a, b) => a - b)).toEqual([...want].sort((a, b) => a - b));
  });

  it('DOMAIN_EVM_CHAIN_IDS 与 chains.ts 同源（不是手抄的第二份）', () => {
    const want = CHAINS.filter(isEVM).map((c) => CHAIN_IDS[c]);
    expect([...DOMAIN_EVM_CHAIN_IDS].sort((a, b) => a - b)).toEqual([...want].sort((a, b) => a - b));
  });

  it('Solana 不在里面 —— 它不是 EVM，Privy 那侧由 config.solana 管', () => {
    expect(SUPPORTED_EVM_CHAIN_IDS).not.toContain(CHAIN_IDS.solana);
  });

  it('链号互不重复', () => {
    expect(new Set(SUPPORTED_EVM_CHAIN_IDS).size).toBe(SUPPORTED_EVM_CHAIN_IDS.length);
  });

  it('arc 与 robinhood 在表里 —— 它们正是 Privy 默认表里没有的两条', () => {
    expect(SUPPORTED_EVM_CHAIN_IDS).toContain(5042);
    expect(SUPPORTED_EVM_CHAIN_IDS).toContain(4663);
  });
});

describe('arc 的链定义', () => {
  // viem 2.56.0 里 arc.rpcUrls.default.http 是**空数组**（实测）。直接交给
  // Privy 等于给了一条连不上的链，而症状是签名时一直转圈。
  it('有可用的 RPC', () => {
    expect(arcMainnet.rpcUrls.default.http).toEqual([ARC_RPC_URL]);
    expect(ARC_RPC_URL.startsWith('https://')).toBe(true);
  });

  it('链号是 5042', () => {
    expect(arcMainnet.id).toBe(CHAIN_IDS.arc);
  });

  // 原生币是 USDC 不是 ETH。改成 ETH 的话 Privy 的手续费预估会把单位说成
  // 以太，而那个数字看起来完全正常。
  it('原生币是 18 位的 USDC', () => {
    expect(arcMainnet.nativeCurrency.symbol).toBe('USDC');
    expect(arcMainnet.nativeCurrency.decimals).toBe(18);
  });

  it('带着区块浏览器地址', () => {
    expect(arcMainnet.blockExplorers?.default.url).toBe('https://explorer.arc.io');
  });
});

describe('表里的每条链都成形', () => {
  for (const chain of HARNESS_EVM_CHAINS) {
    it(`${chain.name}（${chain.id}）有链号、货币与至少一个 RPC`, () => {
      expect(chain.id).toBeGreaterThan(0);
      expect(chain.nativeCurrency.symbol).toBeTruthy();
      expect(chain.rpcUrls.default.http.length).toBeGreaterThan(0);
    });
  }
});
