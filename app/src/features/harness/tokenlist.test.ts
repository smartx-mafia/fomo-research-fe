import {afterEach, describe, expect, it, vi} from 'vitest';

import {listBoard, type TokenMarket} from './api';
import {CHAINS} from './chains';
import {
  GECKO_NETWORK,
  filterTokens,
  fromBoards,
  fromGeckoPools,
  geckoPoolsURL,
  loadGeckoTokens,
  loadTokenOptions,
  type TokenOption,
} from './tokenlist';

// 榜单那一侧整个打桩：这几条用例问的是「拿不到的时候会不会换源」，
// 而不是榜单本身怎么拉（那由 fromBoards / loadBoardTokens 的用例覆盖）。
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listBoard: vi.fn(),
}));

/** 榜单条目只有这几个字段参与选币，其余照默认填 —— 用例里不写无关字段。 */
function market(p: Partial<TokenMarket> & {chain: string; address: string}): TokenMarket {
  return {
    symbol: 'X',
    name: 'X token',
    price: 0,
    market_cap: 0,
    market_cap_diluted: 0,
    liquidity: 0,
    total_supply: '0',
    circulating_supply: '0',
    volume_1h: 0,
    volume_24h: 0,
    price_change_5min: 0,
    price_change_1h: 0,
    ...p,
  } as TokenMarket;
}

/** 一条 GeckoTerminal 池子。`name` 的形状是 `符号 / 计价 费率`，实测如此。 */
function pool(net: string, addr: string, name: string, vol: string, liq: string) {
  return {
    attributes: {name, volume_usd: {h24: vol}, reserve_in_usd: liq},
    relationships: {base_token: {data: {id: `${net}_${addr}`}}},
  };
}

describe('GECKO_NETWORK（加链守卫）', () => {
  // 漏一条链的后果不是报错，是那条链上点「选币」拉了个 404 回来。
  // `satisfies Record<Chain, string>` 已经在编译期挡住漏写，这一条挡的是
  // 「写了但写错」——以太坊在那边叫 eth 不叫 ethereum。
  it('六条链全部有网络 id，且互不重复', () => {
    const ids = CHAINS.map((c) => GECKO_NETWORK[c]);
    expect(ids.every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('以太坊是 eth，arc 是 arc', () => {
    expect(GECKO_NETWORK.ethereum).toBe('eth');
    expect(GECKO_NETWORK.arc).toBe('arc');
    expect(geckoPoolsURL('arc')).toContain('/networks/arc/pools');
  });

  // 直连那个域名在本机出不去（`Failed to fetch`，且与 CORS 被拒长得一样），
  // 所以这一发必须走同源的 dev 代理。写死断言是为了挡住"顺手改回绝对 URL"。
  it('请求走同源的 /gecko 代理，不是绝对 URL', () => {
    expect(geckoPoolsURL('arc').startsWith('/gecko/')).toBe(true);
    expect(geckoPoolsURL('arc')).not.toContain('api.geckoterminal.com');
  });
});

describe('fromBoards', () => {
  const boards = [
    [
      market({chain: 'arc', address: '0xAAA', symbol: 'A', volume_24h: 10, liquidity: 100}),
      market({chain: 'bsc', address: '0xBBB', symbol: 'B', volume_24h: 999}),
    ],
    [
      // 同一只币的另一种大小写写法：EVM 上是同一个地址，不该出现两行。
      market({chain: 'arc', address: '0xaaa', symbol: 'A', volume_24h: 10}),
      market({chain: 'arc', address: '0xCCC', symbol: 'C', volume_24h: 50, liquidity: 7}),
    ],
  ];

  it('只留这条链的，并按 24h 量降序', () => {
    const rows = fromBoards(boards, 'arc');
    expect(rows.map((r) => r.symbol)).toEqual(['C', 'A']);
    expect(rows.every((r) => r.source === 'board')).toBe(true);
  });

  it('同一只币在两个榜里只出一行', () => {
    expect(fromBoards(boards, 'arc').filter((r) => r.symbol === 'A')).toHaveLength(1);
  });

  it('别的链一条都不带过来', () => {
    expect(fromBoards(boards, 'bsc').map((r) => r.symbol)).toEqual(['B']);
  });

  // 行情域没接这条链时五榜里一条都没有（2026-09-20 的 arc 就是这样）。
  // 这不是错误，面板要把它与「拉不到」分开说，所以这里必须是空数组而不是抛。
  it('这条链在榜里一条都没有时返回空数组', () => {
    expect(fromBoards(boards, 'ethereum')).toEqual([]);
  });
});

describe('fromGeckoPools', () => {
  it('从池子名里取符号，剥掉地址上的网络前缀', () => {
    const rows = fromGeckoPools({data: [pool('arc', '0x972b', 'ARGUS / USDC 0.3%', '100', '50')]}, 'arc');
    expect(rows).toEqual<TokenOption[]>([
      {address: '0x972b', symbol: 'ARGUS', liquidityUsd: 50, volume24hUsd: 100, source: 'gecko'},
    ]);
  });

  // 同一只币的多个费率档池。逐池列出来的话，人会照着其中最小的那份流动性
  // 判断能不能下单。
  it('同一个地址的多个池子合并成一行，量与流动性相加', () => {
    const rows = fromGeckoPools(
      {
        data: [
          pool('arc', '0x972b', 'ARGUS / USDC 0.3%', '100', '50'),
          pool('arc', '0x972b', 'ARGUS / USDC 1%', '20', '5'),
        ],
      },
      'arc',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({volume24hUsd: 120, liquidityUsd: 55});
  });

  it('前缀不是本链的条目一概丢掉，不猜', () => {
    const rows = fromGeckoPools({data: [pool('base', '0xbbb', 'B / USDC', '9', '9')]}, 'arc');
    expect(rows).toEqual([]);
  });

  it('缺字段的脏条目丢掉而不是炸', () => {
    const rows = fromGeckoPools({data: [{}, {attributes: {}}, {relationships: {}}, null]}, 'arc');
    expect(rows).toEqual([]);
  });

  it('回包不是预期形状时返回空数组', () => {
    expect(fromGeckoPools(undefined, 'arc')).toEqual([]);
    expect(fromGeckoPools({status: {error_code: 429}}, 'arc')).toEqual([]);
  });

  it('按 24h 量降序', () => {
    const rows = fromGeckoPools(
      {
        data: [
          pool('arc', '0x1', 'ONE / USDC', '5', '1'),
          pool('arc', '0x2', 'TWO / USDC', '500', '1'),
        ],
      },
      'arc',
    );
    expect(rows.map((r) => r.symbol)).toEqual(['TWO', 'ONE']);
  });
});

describe('loadGeckoTokens', () => {
  // 429 是「等一会儿」，不是「坏了」。两者在面板上该说不同的话。
  it('429 说的是限流，不是失败', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {status: 429})));
    await expect(loadGeckoTokens('arc')).rejects.toThrow(/限流|429/);
    vi.unstubAllGlobals();
  });

  it('正常回包解析成候选列表', async () => {
    const body = JSON.stringify({data: [pool('arc', '0xabc', 'MEME / USDC 1%', '1000', '200')]});
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {status: 200})));
    await expect(loadGeckoTokens('arc')).resolves.toEqual([
      {address: '0xabc', symbol: 'MEME', liquidityUsd: 200, volume24hUsd: 1000, source: 'gecko'},
    ]);
    vi.unstubAllGlobals();
  });
});

describe('filterTokens', () => {
  const rows: TokenOption[] = [
    {address: '0xAbCd', symbol: 'ARGUS', liquidityUsd: 1, volume24hUsd: 1, source: 'gecko'},
    {address: 'So1111', symbol: 'WSOL', liquidityUsd: 1, volume24hUsd: 1, source: 'board'},
  ];

  it('空串不过滤', () => {
    expect(filterTokens(rows, '   ')).toHaveLength(2);
  });

  // EVM 地址在两个源里的大小写写法不同，搜的时候不该分大小写。
  it('符号与地址都能搜，且不分大小写', () => {
    expect(filterTokens(rows, 'argus').map((r) => r.symbol)).toEqual(['ARGUS']);
    expect(filterTokens(rows, '0XABCD').map((r) => r.symbol)).toEqual(['ARGUS']);
    expect(filterTokens(rows, 'so1').map((r) => r.symbol)).toEqual(['WSOL']);
  });

  it('搜不到就是空，不回退成全量', () => {
    expect(filterTokens(rows, 'zzz')).toEqual([]);
  });
});

describe('loadTokenOptions（榜单 → 链上池子榜的回退）', () => {
  const geckoBody = JSON.stringify({data: [pool('arc', '0xabc', 'MEME / USDC 1%', '1000', '200')]});
  const okFetch = () => vi.stubGlobal('fetch', vi.fn(async () => new Response(geckoBody, {status: 200})));

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(listBoard).mockReset();
  });

  // 2026-09-20 本机实际撞到的那一种：五个榜齐刷刷 500304 market not ready。
  // 第一版只在「榜单空」时回退，于是面板停在报错上，而链上池子榜当时是好的。
  it('五个榜全部拉不到时照样换源，并把原因带出来', async () => {
    vi.mocked(listBoard).mockRejectedValue(new Error('500304 market not ready'));
    okFetch();
    const got = await loadTokenOptions(null, 'arc');
    expect(got.source).toBe('gecko');
    expect(got.rows.map((r) => r.symbol)).toEqual(['MEME']);
    expect(got.boardIssue).toContain('500304');
  });

  it('榜单回了 0 条时也换源，原因说的是另一件事', async () => {
    vi.mocked(listBoard).mockResolvedValue([]);
    okFetch();
    const got = await loadTokenOptions(null, 'arc');
    expect(got.source).toBe('gecko');
    expect(got.boardIssue).toContain('arc');
    expect(got.boardIssue).not.toContain('拉不到');
  });

  // 榜单能用时**不碰外部源**：免费档限流很紧，白打一发就少一次能用的。
  it('榜单有行时用榜单，且一次外部请求都不发', async () => {
    vi.mocked(listBoard).mockResolvedValue([
      market({chain: 'arc', address: '0xAAA', symbol: 'A', volume_24h: 1}),
    ]);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const got = await loadTokenOptions(null, 'arc');
    expect(got.source).toBe('board');
    expect(got.boardIssue).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('指定了 gecko 就不去打榜单', async () => {
    okFetch();
    const got = await loadTokenOptions(null, 'arc', 'gecko');
    expect(got.source).toBe('gecko');
    expect(vi.mocked(listBoard)).not.toHaveBeenCalled();
  });

  // 只说后一条的话，人会以为问题出在外部源，跑去查网络。
  it('两边都不行时抛错，且两条原因都在', async () => {
    vi.mocked(listBoard).mockRejectedValue(new Error('500304 market not ready'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {status: 429})));
    await expect(loadTokenOptions(null, 'arc')).rejects.toThrow(/500304[\s\S]*429|500304[\s\S]*限流/);
  });
});
