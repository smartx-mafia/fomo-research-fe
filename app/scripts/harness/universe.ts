/**
 * 拉五个榜，合并去重、按链切分、按活跃度分档，产出一份压测用的标的名单。
 *
 * # 怎么跑
 *
 *     HARNESS_API_ORIGIN=https://sm-test-api.smartx.io npx pnpm@10 run harness:universe
 *
 * （源仓库这一行是 `npx vite-node scripts/universe.ts`，换 tsx 的理由见 `probe.ts` 头部。）
 *
 * 可调（都有默认值）：
 *
 *     HARNESS_OUT              产物路径，默认 .harness-out/universe.json
 *     HARNESS_MIN_LIQUIDITY    流动性门槛（USD），默认 5000
 *     HARNESS_PER_TIER         Solana 每档取几个，默认 33
 *     HARNESS_TIERS            分几档，默认 3
 *
 * # 为什么拉榜**不带 token**
 *
 * 行情面的鉴权是可选的，但**坏 token 不会降级成匿名，一律回 400000**。
 * 带一个过期 token 去拉榜，拿到的失败文案说的是「未认证」，看起来像登录出了
 * 问题，而这一步压根不需要登录。不带，就没有这个失败模式。
 *
 * # 为什么 BSC 全取而 Solana 要取样
 *
 * 实测五榜去重、过门槛之后 Solana 有 126 个、BSC 只有 66 个。对 BSC 取样等于
 * 把本来就不够的样本再砍一刀。这不是偏心，是「有多少用多少」。
 */

import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

import {ApiError, BOARDS, listBoard, type Board, type TokenMarket} from '../../src/features/harness/api';
import {setBaseOrigin} from '../../src/features/harness/transport';
import {selectUniverse, type ChainPlan} from '../../src/features/harness/universe';

const origin = process.env.HARNESS_API_ORIGIN ?? '';
if (!origin) {
  console.error('缺 HARNESS_API_ORIGIN（后端地址，如 http://10.0.0.1）');
  process.exit(2);
}
setBaseOrigin(origin);

/**
 * 产物路径。**默认值由源仓库的 `out/universe.json` 改成了 `.harness-out/universe.json`。**
 *
 * 不是换个好看的名字：宿主是 `output: "export"` 的 Next 应用，`app/out/` 是
 * `next build` 的**静态导出目录**，每次构建都会被整个重写。名单落在那儿的表现是
 * 「昨天跑出来的 universe.json 今天没了」，而那时没有任何一处会说是构建删的。
 */
const out = process.env.HARNESS_OUT ?? '.harness-out/universe.json';
const minLiquidity = Number(process.env.HARNESS_MIN_LIQUIDITY ?? 5000);
const tiers = Number(process.env.HARNESS_TIERS ?? 3);
const perTier = Number(process.env.HARNESS_PER_TIER ?? 33);

/**
 * 本次要跑的链。**只有这两条。**
 *
 * ethereum 与 base 实测各只有二三十个样本，统计上说不出任何事；robinhood 与
 * BSC 一样装了发射台探针会拒单（回 100286），先不碰，等两条主链的数据干净了
 * 再加。多列一条的代价不是多跑几笔，是错误码混进统计。
 */
const PLANS: ChainPlan[] = [
  {chain: 'solana', tiers, perTier},
  // BSC 样本本来就少，全取。
  {chain: 'bsc', tiers, perTier: Infinity},
];

/** `500304 market not ready` —— 行情面还没就绪。**实测是间歇性的**，见下。 */
const MARKET_NOT_READY = 500304;

const ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 拉全五个榜，单个榜失败就重试几次。
 *
 * # 为什么要重试
 *
 * 2026-09-11 实测：同一个后端连着打两轮，第一轮五个榜全回 200，第二轮
 * `graduated` / `crypto` / `most_held` 三个回 `500304 market not ready`，
 * 再一轮换成 `bonding` 失败 —— **哪个榜失败每次都不同**。这不是某个榜坏了，
 * 是行情面的缓存在重建。不重试的话这个脚本基本跑不完一次。
 *
 * # 为什么重试之后仍然可能整体失败，而不是用剩下的凑
 *
 * 少一个榜就少一整类币（`bonding` 是曲线期的、`graduated` 是刚毕业的），
 * 而那份名单看起来完全正常，只是这一类一个都没有。报告里没有任何一处会提到
 * 这件事，于是"低活跃档位的数据不对劲"会被归因到别的地方。
 */
async function fetchBoards(): Promise<{board: Board; rows: TokenMarket[]}[]> {
  const got: {board: Board; rows: TokenMarket[]}[] = [];
  for (const board of BOARDS) {
    let last: unknown;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        // **串行拉，不并发。** 五发请求省不下多少时间，却要多一套限流处理；
        // 而这一步一旦撞上 420000，名单会少掉整整一个榜，且没有任何迹象。
        got.push({board, rows: await listBoard(null, board)});
        last = undefined;
        break;
      } catch (e) {
        last = e;
        // 只对"还没就绪"退避重试。别的失败（路由不存在、限流、网络不通）
        // 重试也不会好，多等几秒只是把真正的原因往后拖。
        if (!(e instanceof ApiError && e.code === MARKET_NOT_READY)) break;
        if (attempt === ATTEMPTS) break;
        const wait = 2000 * 2 ** (attempt - 1);
        console.log(`  ${board} 行情面没就绪，${wait / 1000}s 后重试（第 ${attempt}/${ATTEMPTS - 1} 次）`);
        await sleep(wait);
      }
    }
    if (last !== undefined) {
      const why = last instanceof ApiError ? `${last.code} ${last.message}` : String(last);
      throw new Error(
        `拉榜单 ${board} 失败（重试 ${ATTEMPTS} 次）：${why}\n` +
          `  五个榜必须全部拿到才产出名单 —— 少一个榜就少一整类币，而那在名单里看不出来。\n` +
          `  500304（market not ready）是后端行情面在重建缓存，通常等一会儿就好；一直不好就换个后端。`,
      );
    }
  }
  return got;
}

async function main(): Promise<void> {
  console.log(`后端：${origin}`);
  const boards = await fetchBoards();

  for (const b of boards) {
    console.log(`  ${b.board.padEnd(10)} ${String(b.rows.length).padStart(3)} 条`);
  }

  const total = boards.reduce((n, b) => n + b.rows.length, 0);
  if (total === 0) {
    // 五个榜都回 200 但都是空的。信封层活着、路由也对，所以上面那条错误路径
    // 抓不到它 —— 而静默产出一份空名单，下游会表现成"一笔都没跑"。
    throw new Error('五个榜全部为空 —— 后端行情面没有数据，不产出名单');
  }

  const selections = selectUniverse(
    boards.map((b) => b.rows),
    PLANS,
    minLiquidity,
  );

  console.log('');
  for (const s of selections) {
    const perTierCount = new Map<number, number>();
    for (const r of s.rows) perTierCount.set(r.tier, (perTierCount.get(r.tier) ?? 0) + 1);
    const spread = [...perTierCount.keys()]
      .sort((a, b) => a - b)
      .map((t) => `档${t}=${perTierCount.get(t)}`)
      .join(' ');
    console.log(
      `${s.chain.padEnd(8)} 去重后 ${String(s.total).padStart(3)} · ` +
        `过门槛 ${String(s.eligible).padStart(3)} · 选中 ${String(s.rows.length).padStart(3)}  ${spread}`,
    );
    if (s.eligible === 0) {
      console.log(`  ⚠ 这条链一个都没选上 —— 要么后端没有它的数据，要么门槛太高`);
    }
  }

  const doc = {
    // 产物自带出处：换了后端、改了门槛之后跑出来的名单不是同一份东西，
    // 而两份名单长得一模一样，只有这些字段能分辨。
    generated_at: new Date().toISOString(),
    origin,
    min_liquidity_usd: minLiquidity,
    plans: PLANS.map((p) => ({...p, perTier: p.perTier === Infinity ? 'all' : p.perTier})),
    boards: boards.map((b) => ({board: b.board, count: b.rows.length})),
    caveats: [
      '这是一份快照，不是可复现的名单：榜单是活数据，隔几分钟再跑出来的标的就不完全一样。' +
        '要让两轮压测跑同一批标的，请复用同一个产物文件，而不是重跑这个脚本。',
      'volume_24h 是未经清洗的原始成交额，后端不做刷量过滤 —— 高档里混着刷出来的量。',
      '五个榜是跨链混合的聚合榜，每个至多 100 条；这份名单的上限由此而来，不是取样策略定的。',
      'security_score 恒为 0，没有这项数据，没有用它筛过。',
    ],
    chains: selections.map((s) => ({
      chain: s.chain,
      total: s.total,
      eligible: s.eligible,
      selected: s.rows.length,
    })),
    tokens: selections.flatMap((s) =>
      s.rows.map((r) => ({
        chain: r.chain,
        address: r.address,
        symbol: r.symbol,
        name: r.name,
        tier: r.tier,
        rank: r.rank,
        volume_24h: r.volume_24h,
        liquidity: r.liquidity,
        holders_count: r.holders_count,
        bonded: r.bonded,
      })),
    ),
  };

  mkdirSync(dirname(out), {recursive: true});
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  console.log('');
  console.log(`共 ${doc.tokens.length} 个标的，已写入 ${out}`);
}

main().catch((e: unknown) => {
  console.error('');
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
