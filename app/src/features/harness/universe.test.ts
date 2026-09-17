import {describe, expect, it} from 'vitest';

import type {TokenMarket} from './api';
import {
  assignTiers,
  byLiquidity,
  dedupe,
  selectUniverse,
  takePerTier,
  tokenKey,
} from './universe';

/**
 * 只给这些函数真正读的字段。**不造一份完整的 TokenMarket** —— 造全了的话，
 * 后端加字段时这份 fixture 会显得"过时"，而它跟那些字段一点关系都没有。
 */
function tok(chain: string, address: string, volume_24h: number, liquidity = 1e6): TokenMarket {
  return {chain, address, volume_24h, liquidity} as unknown as TokenMarket;
}

describe('tokenKey', () => {
  it('EVM 地址归一到小写 —— 同一只币的两种写法不能算两只', () => {
    expect(tokenKey('bsc', '0xAbCd')).toBe(tokenKey('bsc', '0xabcd'));
  });

  it('Solana 地址原样保留 —— base58 的大小写有意义，归一化会合错两只币', () => {
    expect(tokenKey('solana', 'AbCd')).not.toBe(tokenKey('solana', 'abcd'));
  });

  it('没见过的链名按 EVM 处理（多归一化一次不会合错，落错另一边才会）', () => {
    expect(tokenKey('newchain', '0xAB')).toBe('newchain:0xab');
  });
});

describe('dedupe', () => {
  it('跨榜重复的只留第一次出现的那条', () => {
    const a = tok('bsc', '0xaa', 100);
    const b = tok('bsc', '0xAA', 999); // 同一只币，另一种写法，另一份快照
    const c = tok('solana', 'So1', 50);
    expect(dedupe([[a], [b, c]])).toEqual([a, c]);
  });

  it('按输入顺序稳定 —— 这是「同样的输入产出同样的名单」的一半', () => {
    const a = tok('bsc', '0xaa', 1);
    const b = tok('bsc', '0xbb', 2);
    expect(dedupe([[a, b]]).map((r) => r.address)).toEqual(['0xaa', '0xbb']);
  });

  it('空榜不影响结果', () => {
    const a = tok('bsc', '0xaa', 1);
    expect(dedupe([[], [a], []])).toEqual([a]);
  });
});

describe('byLiquidity', () => {
  it('门槛是「大于等于」，边界上的那个留下', () => {
    const rows = [tok('bsc', '0x1', 1, 5000), tok('bsc', '0x2', 1, 4999)];
    expect(byLiquidity(rows, 5000).map((r) => r.address)).toEqual(['0x1']);
  });

  it('流动性字段缺席按 0 算，会被门槛挡掉', () => {
    // 保守方向：缺席当成"没有流动性"。反过来放行的话，死盘会混进名单，
    // 而它产出的是错误码，不是延迟。
    const rows = [{chain: 'bsc', address: '0x1', volume_24h: 1} as unknown as TokenMarket];
    expect(byLiquidity(rows, 1)).toEqual([]);
  });
});

describe('assignTiers', () => {
  it('按成交量降序排，名次从 1 起', () => {
    const r = assignTiers([tok('s', 'a', 10), tok('s', 'b', 30), tok('s', 'c', 20)], 3);
    expect(r.map((x) => x.address)).toEqual(['b', 'c', 'a']);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3]);
  });

  it('成交量相同时按 key 升序兜底 —— 不兜底就不是全序，名单会漂', () => {
    const asc = assignTiers([tok('s', 'b', 5), tok('s', 'a', 5)], 1);
    const desc = assignTiers([tok('s', 'a', 5), tok('s', 'b', 5)], 1);
    expect(asc.map((x) => x.address)).toEqual(['a', 'b']);
    expect(desc.map((x) => x.address)).toEqual(['a', 'b']);
  });

  it('九条切三档就是三三三，1 是最活跃那一档', () => {
    const rows = Array.from({length: 9}, (_, i) => tok('s', `t${i}`, 100 - i));
    const tiers = assignTiers(rows, 3).map((x) => x.tier);
    expect(tiers).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
  });

  it('除不尽时不会溢出到第四档', () => {
    const rows = Array.from({length: 10}, (_, i) => tok('s', `t${i}`, 100 - i));
    const tiers = assignTiers(rows, 3).map((x) => x.tier);
    expect(Math.max(...tiers)).toBe(3);
    expect(tiers.filter((t) => t === 1).length).toBeGreaterThan(0);
    expect(tiers.filter((t) => t === 3).length).toBeGreaterThan(0);
  });

  it('不改输入数组', () => {
    const rows = [tok('s', 'a', 1), tok('s', 'b', 9)];
    assignTiers(rows, 2);
    expect(rows.map((r) => r.address)).toEqual(['a', 'b']);
  });

  it('空列表不抛', () => {
    expect(assignTiers([], 3)).toEqual([]);
  });

  it('档数小于 1 当场抛', () => {
    expect(() => assignTiers([], 0)).toThrow(/档数/);
  });
});

describe('takePerTier', () => {
  it('每档要的比有的多时，全给', () => {
    const ranked = assignTiers([tok('s', 'a', 3), tok('s', 'b', 2), tok('s', 'c', 1)], 3);
    expect(takePerTier(ranked, 5)).toHaveLength(3);
  });

  it('档内均匀取样，两端一定取到 —— 取前几名会让每档都偏向高端', () => {
    // 一档九个里取三个：应当是首、中、尾，而不是前三个。
    const ranked = assignTiers(
      Array.from({length: 9}, (_, i) => tok('s', `t${i}`, 100 - i)),
      1,
    );
    expect(takePerTier(ranked, 3).map((r) => r.address)).toEqual(['t0', 't4', 't8']);
  });

  it('每档取一个时取该档最活跃的那个', () => {
    const ranked = assignTiers(
      Array.from({length: 6}, (_, i) => tok('s', `t${i}`, 100 - i)),
      3,
    );
    expect(takePerTier(ranked, 1).map((r) => r.address)).toEqual(['t0', 't2', 't4']);
  });

  it('产出按名次升序，本身就是一份可读的排行', () => {
    const ranked = assignTiers(
      Array.from({length: 12}, (_, i) => tok('s', `t${i}`, 100 - i)),
      3,
    );
    const got = takePerTier(ranked, 2);
    expect(got.map((r) => r.rank)).toEqual([...got.map((r) => r.rank)].sort((a, b) => a - b));
  });

  it('不产生重复标的', () => {
    const ranked = assignTiers(
      Array.from({length: 7}, (_, i) => tok('s', `t${i}`, 100 - i)),
      2,
    );
    const got = takePerTier(ranked, 3).map((r) => r.address);
    expect(new Set(got).size).toBe(got.length);
  });

  it('perTier 给 Infinity 就是全取', () => {
    const ranked = assignTiers(
      Array.from({length: 5}, (_, i) => tok('s', `t${i}`, 100 - i)),
      2,
    );
    expect(takePerTier(ranked, Infinity)).toHaveLength(5);
  });
});

describe('selectUniverse', () => {
  const BOARDS = [
    [tok('solana', 'S1', 900), tok('bsc', '0xb1', 800), tok('ethereum', '0xe1', 700)],
    [tok('solana', 'S2', 600), tok('solana', 'S3', 500, 10), tok('bsc', '0xB1', 999)],
  ];

  it('只产出计划里列到的链 —— 多给的那条会在下单阶段才暴露', () => {
    const sel = selectUniverse(BOARDS, [{chain: 'solana', tiers: 2, perTier: 9}], 100);
    expect(sel.map((s) => s.chain)).toEqual(['solana']);
  });

  it('把「去重后总数」与「过门槛后」分开报，凑不满时不静默', () => {
    const sel = selectUniverse(BOARDS, [{chain: 'solana', tiers: 1, perTier: 9}], 100);
    // S3 的流动性只有 10，过不了门槛。
    expect(sel[0]).toMatchObject({total: 3, eligible: 2});
    expect(sel[0]!.rows.map((r) => r.address)).toEqual(['S1', 'S2']);
  });

  it('每条链独立分档 —— 不同链的量级差着数量级，混在一起切会让整条链落进同一档', () => {
    const sel = selectUniverse(BOARDS, [
      {chain: 'solana', tiers: 2, perTier: 9},
      {chain: 'bsc', tiers: 2, perTier: 9},
    ], 100);
    expect(sel[1]!.rows.every((r) => r.tier >= 1)).toBe(true);
    // bsc 那只币两个榜各有一份快照，去重后只剩一只。
    expect(sel[1]!.rows).toHaveLength(1);
  });

  it('同一份输入产出同一份名单', () => {
    const plans = [{chain: 'solana', tiers: 2, perTier: 2}];
    const a = selectUniverse(BOARDS, plans, 100);
    const b = selectUniverse(BOARDS, plans, 100);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
