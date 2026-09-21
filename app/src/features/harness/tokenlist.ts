// 「这条链上有哪些币」——选币面板的取数与归一。**纯函数与取数分开放**，
// 理由与 `chains.ts` 那份一样：能在 node 环境里被枚举到的表才测得到。
//
// # 为什么要两个数据源
//
// 后端只有五个榜，**跨链混合、没有链变体、没有排序过滤参数**（见 `api.ts`
// 里 BOARDS 那一段），所以「某条链上的币」本来就只能靠拉全五榜再自己切。
// 更要命的是第二件事：行情域的链登记表（后端 `market/chains.go`）与交易域
// 的链表是**两张表**——2026-09-20 实测 arc 在交易域已经开了，而行情域对
// `/v1/tokens/arc/...` 回 `100305 chain unknown`，五榜 100 条里 arc 是 0 条。
//
// 也就是说：**新链在这个页面上能下单，却一个候选标的都列不出来**，而这正是
// 最需要候选标的的时候。所以榜单**拿不到可用的行**时（回了 0 条、或者整个
// 拉不到，比如本机行情域没起来时五榜齐刷刷 `500304 market not ready`）回退到
// GeckoTerminal 的链上池子榜 —— 它按链取数，新链当天就有数据。
//
// 回退**必须在界面上写明来源与原因**：两个源的口径不同（一个是后端清洗过的
// 榜，一个是原始池子聚合），混在一起看会得出错误结论；而「行情域没就绪」与
// 「这条链行情域没接」对下一步该做什么的指向也完全不同。

import {BOARDS, listBoard, type TokenMarket} from './api';
import type {Chain} from './chains';
import {dedupe} from './universe';

/** 这一行是从哪来的。**不要把它藏起来**（理由见文件头）。 */
export type TokenSource = 'board' | 'gecko';

/** 选币面板里的一行。金额一律 `number | null`：`0` 与「没这个字段」不是一回事。 */
export type TokenOption = {
  /** 合约地址 / mint。**原样保留大小写** —— Solana 的 base58 大小写有意义。 */
  address: string;
  symbol: string;
  name?: string;
  /** 池子深度（USD）。流动性接近零的死盘下单只会回错误码，所以它要能一眼看到。 */
  liquidityUsd: number | null;
  /** 24 小时成交额（USD）。**未经刷量清洗**，两个源都一样。 */
  volume24hUsd: number | null;
  source: TokenSource;
};

/**
 * 本域链名 → GeckoTerminal 的网络 id。
 *
 * **`satisfies Record<Chain, string>` 是这里的守卫**：加链时漏了这一行会当场
 * 编译失败，而不是等到有人在那条链上点「选币」才发现拉的是 404。
 *
 * 注意以太坊在那边叫 `eth` 不叫 `ethereum` —— 六个 id 全部实测过
 *（2026-09-20：eth / bsc / solana / base / robinhood / arc 都在）。
 */
export const GECKO_NETWORK = {
  solana: 'solana',
  bsc: 'bsc',
  robinhood: 'robinhood',
  base: 'base',
  ethereum: 'eth',
  arc: 'arc',
} as const satisfies Record<Chain, string>;

/**
 * 同源前缀。**不直连 api.geckoterminal.com**，经 dev 代理出去。
 *
 * 那个域名 CORS 是开的（`access-control-allow-origin: *`），所以这不是为了绕
 * CORS —— 是因为本机出网要走代理：2026-09-20 实测 node 直连 `fetch failed`，
 * 带 `NODE_USE_ENV_PROXY=1` 才 200。浏览器直连同样不通，而 fetch 抛的
 * `Failed to fetch` 与 CORS 被拒**长得一模一样**，照 CORS 去查会查错方向。
 *
 * 规则在 `api/harness/proxy/[...slug]/route.dev.ts` 的 "geckoterminal" 一条，
 * 与 next.config 的 rewrite 表一一对应 —— 改一边就要改另一边。
 */
export const GECKO_PREFIX = '/gecko';

/** 免费档实测约每分钟 30 次，超了回 429（见 `loadGeckoTokens` 的分支）。 */
export function geckoPoolsURL(chain: Chain): string {
  return `${GECKO_PREFIX}/api/v2/networks/${GECKO_NETWORK[chain]}/pools?sort=h24_volume_usd_desc`;
}

/** 有限数才是数，其余一律 null —— `NaN`/`Infinity` 进了排序会让顺序不稳定。 */
function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** 按 24h 量降序；量相同按地址升序兜底，**保证全序**（同 `universe.ts` 的理由）。 */
function byVolume(a: TokenOption, b: TokenOption): number {
  const d = (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0);
  return d !== 0 ? d : a.address < b.address ? -1 : 1;
}

/**
 * 五榜 → 某条链上的候选标的。
 *
 * 先去重再按链过滤（`dedupe` 里 EVM 地址归一到小写，Solana 原样），顺序与
 * 喂榜顺序一致 —— 同一只币出现在两个榜里时留先出现的那条。
 */
export function fromBoards(boards: readonly (readonly TokenMarket[])[], chain: Chain): TokenOption[] {
  return dedupe(boards)
    .filter((r) => r.chain === chain)
    .map((r) => ({
      address: r.address,
      symbol: r.symbol || '(无符号)',
      name: r.name || undefined,
      liquidityUsd: num(r.liquidity),
      volume24hUsd: num(r.volume_24h),
      source: 'board' as const,
    }))
    .sort(byVolume);
}

/**
 * GeckoTerminal 的池子榜 → 候选标的。**按 token 聚合，不是按池子列。**
 *
 * 一只币在同一条链上常有多个费率档的池（实测 arc 上的 ARGUS 有三个），
 * 逐池列出来的话，同一个地址会在面板里出现三行、而三行的流动性各只是一部分
 * —— 人会照着其中最小的那个数判断能不能下单。这里把同地址的量与流动性相加。
 *
 * 符号取自池子的 `name`（形如 `ARGUS / USDC 0.3%`）：走 `include=base_token`
 * 能拿到更规整的符号，但那要多一个查询参数与一段 included 索引，而免费档的
 * 限流很紧（429），能少一次请求就少一次。
 *
 * **丢掉解析不出地址、或地址前缀不是本链的条目**，不猜：前缀形如
 * `arc_0x…`，把别的链的条目混进来的后果是地址填进表单后报价被结算方拒绝，
 * 而那句错误指向的是「地址无效」。
 */
export function fromGeckoPools(payload: unknown, chain: Chain): TokenOption[] {
  const prefix = `${GECKO_NETWORK[chain]}_`;
  const rows = (payload as {data?: unknown})?.data;
  if (!Array.isArray(rows)) return [];

  const merged = new Map<string, TokenOption>();
  for (const row of rows) {
    const attrs = (row as {attributes?: Record<string, unknown>})?.attributes;
    const id = (row as {relationships?: {base_token?: {data?: {id?: unknown}}}})?.relationships?.base_token?.data?.id;
    if (!attrs || typeof id !== 'string' || !id.startsWith(prefix)) continue;
    const address = id.slice(prefix.length);
    if (!address) continue;

    const name = typeof attrs.name === 'string' ? attrs.name : '';
    // `ARGUS / USDC 0.3%` → `ARGUS`。取不到就写明取不到，不拿地址凑一个符号。
    const symbol = name.split('/')[0]?.trim() || '(无符号)';
    const vol = num((attrs.volume_usd as {h24?: unknown} | undefined)?.h24);
    const liq = num(attrs.reserve_in_usd);

    const prev = merged.get(address);
    merged.set(address, {
      address,
      symbol: prev?.symbol ?? symbol,
      liquidityUsd: prev ? (prev.liquidityUsd ?? 0) + (liq ?? 0) : liq,
      volume24hUsd: prev ? (prev.volume24hUsd ?? 0) + (vol ?? 0) : vol,
      source: 'gecko',
    });
  }
  return [...merged.values()].sort(byVolume);
}

/**
 * 拉五榜并切出这条链的候选。
 *
 * **一个榜挂掉不算全挂**：`allSettled` 之后只要还有榜回来就照常出名单 ——
 * 五榜里有一个偶发 500 的话，整块空掉比少几个候选糟得多。全挂才抛，且把
 * 第一条原因带出去（「拉不到」与「这条链上没有」在面板上是两句话）。
 */
export async function loadBoardTokens(token: string | null, chain: Chain): Promise<TokenOption[]> {
  const settled = await Promise.allSettled(BOARDS.map((b) => listBoard(token, b)));
  const ok = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  if (ok.length === 0) {
    const first = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined;
    throw new Error(`五个榜一个都没拉到：${first ? String(first.reason?.message ?? first.reason) : '未知原因'}`);
  }
  return fromBoards(ok, chain);
}

/**
 * 链上池子榜（回退源）。三种不好分别说，因为它们要做的事完全不同：
 *
 *   429      限流，等一分钟就好（免费档约每分钟 30 次）；
 *   502      dev 代理出不去 —— 正文里是目标 URL 与原因，多半是 dev server
 *            没带 `NODE_USE_ENV_PROXY=1` 起，而本机出网要走代理；
 *   抛异常   连 dev server 都没打到（页面与 dev server 之间的事）。
 */
export async function loadGeckoTokens(chain: Chain, signal?: AbortSignal): Promise<TokenOption[]> {
  let res: Response;
  try {
    res = await fetch(geckoPoolsURL(chain), {signal, headers: {accept: 'application/json'}});
  } catch (e) {
    throw new Error(
      `打不到同源的 ${GECKO_PREFIX} 代理（${e instanceof Error ? e.message : String(e)}）` +
        ' —— dev server 起了吗？这一条只在开发期存在（route.dev.ts）',
    );
  }
  if (res.status === 429) throw new Error('GeckoTerminal 限流（429）—— 免费档约每分钟 30 次，等一分钟再试');
  if (res.status === 502) {
    const why = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`dev 代理出不去（502）：${why || '无正文'} —— 本机出网要走代理时，用 NODE_USE_ENV_PROXY=1 启动 dev server`);
  }
  if (!res.ok) throw new Error(`GeckoTerminal 回了 ${res.status}`);
  return fromGeckoPools(await res.json(), chain);
}

/** 一次取数的结果。**来源与「榜单那侧出了什么事」一起交回**，面板要把它写在脸上。 */
export type TokenListResult = {
  rows: TokenOption[];
  source: TokenSource;
  /** 榜单这一侧的情况。null = 榜单正常出的数；非 null = 为什么没用榜单。 */
  boardIssue: string | null;
};

/**
 * 选币面板的唯一入口：**先榜单，不行就换链上池子榜**。
 *
 * # 「不行」有两种，它们都得回退
 *
 * 第一版只在「榜单回了 0 条」时回退，结果 2026-09-20 在本机撞上另一种：
 * 五个榜**全部** `500304 market not ready`（行情域没就绪），于是面板直接报错
 * 停在那里 —— 而那一刻链上池子榜是好的，候选明明取得到。
 *
 * 两种情况对人的意义是同一句话：「后端榜单这条路现在没有候选」。所以判据是
 * **拿不到可用的行，就换一个源**，而不是去区分空表与报错。但原因必须留着
 * 交回去（`boardIssue`）：「行情域没就绪」与「这条链行情域没接」是两件事，
 * 前者等会儿会好，后者要等后端加链。
 *
 * 两边都不行才抛，且**两条原因都带上** —— 只说后一条的话，人会以为问题出在
 * 外部源，跑去查网络。
 */
export async function loadTokenOptions(
  token: string | null,
  chain: Chain,
  forced: TokenSource | null = null,
  signal?: AbortSignal,
): Promise<TokenListResult> {
  if (forced === 'gecko') {
    return {rows: await loadGeckoTokens(chain, signal), source: 'gecko', boardIssue: null};
  }

  let boardIssue: string | null = null;
  let rows: TokenOption[] = [];
  try {
    rows = await loadBoardTokens(token, chain);
    if (rows.length === 0) boardIssue = `后端五榜里没有 ${chain} 的币（榜是跨链混合的，没有按链的变体）`;
  } catch (e) {
    boardIssue = `后端五榜拉不到：${e instanceof Error ? e.message : String(e)}`;
  }
  if (rows.length > 0) return {rows, source: 'board', boardIssue: null};

  try {
    return {rows: await loadGeckoTokens(chain, signal), source: 'gecko', boardIssue};
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(`${boardIssue}；链上池子榜也不行：${why}`);
  }
}

/** 面板里的搜索：符号或地址命中即可，**大小写不敏感**（EVM 地址两种写法都要能搜到）。 */
export function filterTokens(rows: readonly TokenOption[], q: string): TokenOption[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter(
    (r) => r.symbol.toLowerCase().includes(needle) || r.address.toLowerCase().includes(needle),
  );
}
