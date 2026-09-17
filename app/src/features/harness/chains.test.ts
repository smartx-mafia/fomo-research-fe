import {describe, expect, it} from 'vitest';

import {CHAIN_IDS, CHAINS, SOLANA_CAIP, caipOf, chainOfCaip, chainOfID, isEVM, type Chain} from './chains';

// 这个仓库在加 base 之前**没有任何一条用例枚举过链集合** —— 加一条链，
// `npm test` 照样全绿。当时那条守卫枚举的是代付表，代付面板删掉之后它也
// 一起没了；这一份枚举的是链集合本身，不依赖任何一块 UI。
//
// 所以这张表是本仓的"加链清单"：加链先来这里加一行，再让它变绿。

/** 本域五条链。加链时**先改这里**。 */
const EXPECTED: Record<Chain, {chainID: number; evm: boolean}> = {
  solana: {chainID: 792703809, evm: false},
  bsc: {chainID: 56, evm: true},
  robinhood: {chainID: 4663, evm: true},
  base: {chainID: 8453, evm: true},
  // EVM 1。**它与 Privy 的 chain_type="ethereum" 不是一回事** —— 后者指整个
  // EVM 家族，四条 EVM 链共用同一把 embedded 钥匙。
  ethereum: {chainID: 1, evm: true},
};

describe('链集合', () => {
  it('CHAINS 与这份清单逐条对得上，且没有重复', () => {
    expect([...CHAINS].sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(new Set(CHAINS).size).toBe(CHAINS.length);
  });

  // 两条链号撞在一起时 chainOfID 会稳定地只返回靠前的那条，而另一条从此
  // 在仓位列表里永远显示成别人的名字 —— 一个字都不报错。
  it('链号互不相同', () => {
    const ids = CHAINS.map((c) => CHAIN_IDS[c]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const chain of CHAINS) {
    const want = EXPECTED[chain];
    it(`${chain}：链号 ${want.chainID}，${want.evm ? '是' : '不是'} EVM`, () => {
      expect(CHAIN_IDS[chain]).toBe(want.chainID);
      expect(isEVM(chain)).toBe(want.evm);
      expect(chainOfID(want.chainID)).toBe(chain);
    });
  }
});

describe('chainOfID', () => {
  // 猜一个默认值的后果是把一笔 BSC 的卖单当成 Solana 发出去，而那笔请求
  // 本身完全合法。
  it('认不出的链号返回 undefined，不猜', () => {
    expect(chainOfID(0)).toBeUndefined();
    expect(chainOfID(137)).toBeUndefined(); // polygon，本域不接
    expect(chainOfID(101)).toBeUndefined(); // Solana 自己的常规编号，不是本域用的那个
  });

  // 101 与 792703809 都"是 Solana"，但只有后者是结算方认的那个：填 101 的
  // 部署每一笔都会被以 "Invalid chain ID" 拒收。这条断言把两者钉开。
  it('Solana 只认 792703809', () => {
    expect(chainOfID(792703809)).toBe('solana');
    expect(CHAIN_IDS.solana).not.toBe(101);
  });
});

describe('caipOf / chainOfCaip（v2 线上的链标识）', () => {
  // 后端 fastswap/domain/chains.go 的 init 里有一段断言：EVM 那一支的 CAIP-2
  // 数字部分必须**等于链号**。这一条是本仓这一侧的同一张表。
  for (const chain of CHAINS) {
    it(`${chain} 的 CAIP-2 与链号一致，且能翻回来`, () => {
      const caip = caipOf(chain);
      expect(caip).toBe(chain === 'solana' ? SOLANA_CAIP : `eip155:${CHAIN_IDS[chain]}`);
      expect(chainOfCaip(caip)).toBe(chain);
    });
  }

  it('Solana 不是 eip155:792703809 —— 那是一条不存在的 EVM 链', () => {
    expect(caipOf('solana')).toBe('solana:mainnet');
    expect(chainOfCaip('eip155:792703809')).toBeUndefined();
  });

  it('认不出的标识返回 undefined，不猜', () => {
    expect(chainOfCaip('eip155:137')).toBeUndefined();
    expect(chainOfCaip('Solana:Mainnet')).toBeUndefined(); // CAIP-2 的 namespace 是小写
    expect(chainOfCaip('')).toBeUndefined();
  });
});
