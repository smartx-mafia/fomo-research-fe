/**
 * 从五个榜里挑出一份压测用的标的名单。**全是纯函数**，好让它在没有网络的
 * 环境里被钉住 —— 名单一旦不确定，两次跑出来的耗时就没有可比性。
 *
 * # 为什么要自己拼一份名单
 *
 * 后端给不了「按链拉 token 并带活跃度指标」：只有五个榜、每个至多 100 条、
 * **跨链混合没有链变体**，也没有任何排序或过滤参数（见 `api.ts` 里 `listBoard`
 * 那一段）。所以「每链若干个不同活跃度的币」只能靠合并去重之后自己切。
 *
 * # 实测的分链数量（2026-09-11，测试环境）
 *
 *     五榜去重后 382 个，过流动性门槛（≥5000 USD）后 327 个
 *     solana 126 · robinhood 73 · bsc 66 · ethereum 36 · base 26
 *
 * 也就是说**「每链 100 个」只有 Solana 够得着**。这不是代码能解决的问题，
 * 所以这里的函数一律「有多少给多少」，由调用方把实际数量写进产物 ——
 * 静默凑不满而不说，报告里就会出现一个没人解释得了的样本数。
 */

import type {TokenMarket} from './api';

/**
 * 去重用的键。**EVM 地址归一到小写，其余链原样。**
 *
 * Solana 的地址是 base58，**大小写有意义**，归一化会把两个不同的 mint 合成
 * 一个；而 EVM 地址是十六进制、大小写只是校验和格式，不归一化的话同一只币
 * 在两个榜里的两种写法会被当成两只，于是名单里出现重复标的，而重复标的会
 * 在买入阶段撞上去重窗口，表现成一个莫名其妙的 `duplicate`。
 *
 * 判据写成「**不是 solana 就当 EVM**」，与 `chains.ts` 的 `isEVM` 同一个方向：
 * 新链默认落进 EVM 一侧是安全的（多归一化一次不会合错），落进 Solana 一侧
 * 才会合错。这里不复用 `isEVM` 是因为榜单的 `chain` 是后端给的裸字符串，
 * 可能出现本域还不认识的链名，而那个函数只吃已知的联合类型。
 */
export function tokenKey(chain: string, address: string): string {
  return chain === 'solana' ? `${chain}:${address}` : `${chain}:${address.toLowerCase()}`;
}

/**
 * 合并多个榜并去重。**先出现的那条胜出**，后面的丢掉。
 *
 * 同一只币在不同榜里的行是同一份行情快照的不同副本，字段值可能因为抓取时刻
 * 差几秒而不同。选谁都行，但必须**选得稳定** —— 调用方按固定顺序喂榜，
 * 这个函数按输入顺序留第一条，两者合起来才让同样的输入产出同样的名单。
 */
export function dedupe(boards: readonly (readonly TokenMarket[])[]): TokenMarket[] {
  const seen = new Set<string>();
  const out: TokenMarket[] = [];
  for (const board of boards) {
    for (const row of board) {
      const k = tokenKey(row.chain, row.address);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(row);
    }
  }
  return out;
}

/**
 * 流动性硬门槛。
 *
 * 尾部低活跃的币里混着大量流动性接近零的死盘，对它们下单拿到的是错误码而不是
 * 延迟 —— 那些码会淹没真正想看的信号。门槛是个参数而不是常量：它的合适取值
 * 取决于单笔下多少钱，写死在这里的话，改了金额不会有人想起来改它。
 */
export function byLiquidity(rows: readonly TokenMarket[], minUsd: number): TokenMarket[] {
  return rows.filter((r) => (r.liquidity ?? 0) >= minUsd);
}

export type Ranked = TokenMarket & {
  /** 这条链上按 24 小时成交量降序的名次，从 1 起。 */
  rank: number;
  /** 活跃度档位，**1 是最活跃那一档**。 */
  tier: number;
};

/**
 * 排序并分档。**排序必须是全序**，否则同样的输入会产出不同的名单。
 *
 * 成交量相同时按 `tokenKey` 升序兜底 —— 不兜底的话排序结果取决于输入顺序和
 * 引擎实现，而那正是「同一份输入产出同一份名单」这条验收会偷偷失守的地方。
 *
 * 分档是**等分连续段**：第 i 条（0 起）落在第 `⌊i·档数/总数⌋+1` 档。
 * 不按成交量的绝对值切，是因为不同链的量级差着数量级（实测 Solana 的中位数
 * 是 base 的一百多倍），按绝对值切会让某条链整条落进同一档。
 */
export function assignTiers(rows: readonly TokenMarket[], tierCount: number): Ranked[] {
  if (tierCount < 1) throw new Error(`档数必须 ≥1，收到 ${tierCount}`);
  const sorted = [...rows].sort((a, b) => {
    const d = (b.volume_24h ?? 0) - (a.volume_24h ?? 0);
    if (d !== 0) return d;
    return tokenKey(a.chain, a.address) < tokenKey(b.chain, b.address) ? -1 : 1;
  });
  const n = sorted.length;
  return sorted.map((r, i) => ({
    ...r,
    rank: i + 1,
    tier: n === 0 ? 1 : Math.min(tierCount, Math.floor((i * tierCount) / n) + 1),
  }));
}

/**
 * 每档取若干个。**在档内均匀取样，不是取档内前几名。**
 *
 * 取前几名会让每一档都偏向自己的高端，三档取出来的其实是"高、次高、中高"；
 * 均匀取样保住了每一档自身的跨度，而这对最低那一档尤其重要 —— 它的内部相对
 * 跨度最大，取前几名等于把真正冷的那些全扔了，而那些正是最可能暴露问题的。
 *
 * `perTier` 给 `Infinity` 表示这一档全要。
 */
export function takePerTier(ranked: readonly Ranked[], perTier: number): Ranked[] {
  const groups = new Map<number, Ranked[]>();
  for (const r of ranked) {
    const g = groups.get(r.tier);
    if (g) g.push(r);
    else groups.set(r.tier, [r]);
  }

  const out: Ranked[] = [];
  for (const tier of [...groups.keys()].sort((a, b) => a - b)) {
    const g = groups.get(tier)!;
    const k = Math.min(perTier, g.length);
    if (k <= 0) continue;
    if (k === g.length) {
      out.push(...g);
      continue;
    }
    if (k === 1) {
      out.push(g[0]!);
      continue;
    }
    // 均匀铺开：两端一定取到，中间按等距四舍五入。k<g.length 时不会撞号。
    for (let j = 0; j < k; j++) {
      out.push(g[Math.round((j * (g.length - 1)) / (k - 1))]!);
    }
  }
  // 交回时按名次升序，让产物本身就是一份可读的排行。
  return out.sort((a, b) => a.rank - b.rank);
}

/** 一条链要怎么取。 */
export type ChainPlan = {
  chain: string;
  /** 分几档。 */
  tiers: number;
  /** 每档取几个。`Infinity` = 全取（样本本来就少的链用它）。 */
  perTier: number;
};

export type ChainSelection = {
  chain: string;
  /** 这条链在去重后的总数（过门槛前）。 */
  total: number;
  /** 过流动性门槛之后还剩几个。 */
  eligible: number;
  rows: Ranked[];
};

/**
 * 按计划挑出名单。**每条链独立排序分档**（理由见 `assignTiers`）。
 *
 * 计划里没列到的链一概不要 —— 交回的选择里不会出现它们。宁可少给也不多给：
 * 多给的那条链会在下单阶段才暴露（比如 robinhood 装了发射台探针会拒单），
 * 而那时错误码已经混进统计了。
 */
export function selectUniverse(
  boards: readonly (readonly TokenMarket[])[],
  plans: readonly ChainPlan[],
  minLiquidityUsd: number,
): ChainSelection[] {
  const all = dedupe(boards);
  return plans.map((p) => {
    const onChain = all.filter((r) => r.chain === p.chain);
    const eligible = byLiquidity(onChain, minLiquidityUsd);
    return {
      chain: p.chain,
      total: onChain.length,
      eligible: eligible.length,
      rows: takePerTier(assignTiers(eligible, p.tiers), p.perTier),
    };
  });
}
