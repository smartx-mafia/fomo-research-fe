import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  ApiError,
  listPositions,
  login,
  positionKey,
  positionsMark,
  timestampMs,
  type Position,
} from './api';

/**
 * 这份 fixture 是 **2026-09-16 对 `sm-test-api.smartx.io` 实测的原文**
 * （`GET /v1/portfolio`，16 行仓位里挑了两行），不是照文档誊的。
 *
 * 挑这两行是因为它们各自钉住一类边界：
 *
 *   · WBTC   —— 买过也卖过，七个 USD 字段全都有值，`realized_pnl_usd` 为负；
 *   · Sealook —— **从没卖过**，`avg_sell_price_usd` 是空串 `""` 而不是 `"0"`。
 *
 * 顶层那一大堆字段（pnl / cash_balances / total_assets_usd / balance …）
 * **原样留着一部分**，不是忘了删：`listPositions` 只取 `positions`，而这份
 * fixture 要能证明"只取一个字段"这件事在一条**完整**的回包上也成立。
 */
const WIRE = {
  code: 200,
  msg: 'success',
  trace_id: '196ca0920318d97e6df049717da31420',
  data: {
    total_value_usd: '7.71881314',
    cash_balance_usd: '105.16348800',
    total_assets_usd: '112.88230114',
    completeness: 'complete',
    quantity_completeness: 'complete',
    history_epoch: '20',
    pnl_rules_version: '1',
    partial_errors: [],
    observed_at: {seconds: 1789530619, nanos: 84509233},
    positions: [
      {
        asset: {
          chain: 'ethereum',
          chain_id: 1,
          kind: 'erc20',
          token_address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
        },
        symbol: 'WBTC',
        decimals: 8,
        price_usd: '75637.5385917',
        price_as_of: {seconds: 1789530601, nanos: 0},
        shares_raw: '48',
        pending_shares: '0',
        sellable_shares: '48',
        opened_entry_id: 374,
        opened_at: {seconds: 1789263079, nanos: 0},
        cost_basis_usd: '0.05660400',
        buy_amount_raw: '848',
        sell_amount_raw: '800',
        buy_value_usd: '1.00000000',
        sell_value_usd: '0.58975100',
        realized_pnl_usd: '-0.35364500',
        market_value_usd: '0.03630602',
        unrealized_pnl_usd: '-0.02029798',
        total_pnl_usd: '-0.37394298',
        pnl_ratio: '-0.373942981476',
        avg_buy_price_usd: '117924.52830188679245283019',
        avg_sell_price_usd: '73718.87500000000000000000',
        cycle_status: 'ready',
        input_revision: '2',
        applied_revision: '2',
        valuation_status: 'ready',
        cycle_key: 'ledger:32c5d9fc-339c-4216-be9e-d95f46fccdd7',
        history_epoch: '20',
        quantity_status: 'ledger',
        verified_block: '',
        logo: '',
      },
      {
        asset: {
          chain: 'solana',
          chain_id: 792703809,
          kind: 'spl',
          token_address: '25zzknGkWqt7hAU3Ns1H9CUhVVykKmDWnShHq5L2pump',
        },
        symbol: 'Sealook',
        decimals: 6,
        price_usd: '0.00000873893571481',
        price_as_of: {seconds: 1789530504, nanos: 0},
        shares_raw: '400260836116',
        pending_shares: '0',
        sellable_shares: '400260836116',
        opened_entry_id: 767,
        opened_at: {seconds: 1789462935, nanos: 0},
        cost_basis_usd: '5.00000000',
        buy_amount_raw: '400260836116',
        sell_amount_raw: '0',
        buy_value_usd: '5.00000000',
        sell_value_usd: '0.00000000',
        realized_pnl_usd: '0.00000000',
        market_value_usd: '3.49785372',
        unrealized_pnl_usd: '-1.50214628',
        total_pnl_usd: '-1.50214628',
        pnl_ratio: '-0.300429256805',
        avg_buy_price_usd: '0.00001249185418318305',
        // **空串，不是 "0"。** 从没卖过的行长这样。
        avg_sell_price_usd: '',
        cycle_status: 'ready',
        input_revision: '1',
        applied_revision: '1',
        valuation_status: 'ready',
        cycle_key: 'ledger:4b82bcf1-f026-497b-8bc2-2a924da119ec',
        history_epoch: '20',
        quantity_status: 'ledger',
        verified_block: '',
        logo: 'https://static.smartx.io/app/ext/tokens/solana/25zzknGkWqt7hAU3Ns1H9CUhVVykKmDWnShHq5L2pump-22f6d592.png',
      },
    ],
  },
};

/**
 * **交回的是 `text()` 不是 `json()`。**
 *
 * `call()` 一律先读 text 再自己 `JSON.parse` —— 非 200 时 body 多半是一段
 * HTML（nginx / vite 的错误页），而 `resp.json()` 在那上面抛的是一句
 * "Unexpected token <"，指向 JSON，而真相是路由不存在。桩要跟真实那条路
 * 走同一个方法，否则这些用例验的就不是线上跑的那段代码。
 */
function stubFetch(body: unknown) {
  const f = vi.fn(async (_url: string, _init?: unknown) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', f);
  return f;
}

/** 取第一行。`!` 是刻意的：fixture 里就是有一行，取不到该让测试当场炸。 */
async function first(): Promise<Position> {
  const rows = await listPositions('t');
  return rows[0]!;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listPositions 的线格式', () => {
  it('打的是 /v1/portfolio —— 旧的 /v1/meme/positions 已经 404', async () => {
    const f = stubFetch(WIRE);
    await listPositions('t');
    // 这一条钉的是 2026-09-16 那次换接口本身。旧路由从后端下线之后，页面上
    // 的症状是「持仓重查失败：404」—— 一句指向代理与进程的话，指不回
    // "这个接口换了"。
    expect(f.mock.calls[0]?.[0]).toBe('/v1/portfolio');
  });

  it('不往查询串里塞身份 —— 查谁的仓位由 JWT 决定', async () => {
    const f = stubFetch(WIRE);
    await listPositions('t');
    expect(f.mock.calls[0]?.[0]).not.toContain('?');
  });

  it('资产标识是嵌套对象，不是平铺的三个字段', async () => {
    stubFetch(WIRE);
    const p = await first();
    // 旧版是 asset_chain_id / asset_kind / asset(string)。照旧写读到的是
    // undefined —— 而 `${undefined}` 在模板串里是 "undefined"，一路发到
    // 结算方那里才失败。
    expect(p.asset.chain_id).toBe(1);
    expect(p.asset.kind).toBe('erc20');
    expect(p.asset.token_address).toBe('0x2260fac5e5542a773aa44fbcfedf7c193bc2c599');
    expect(p.asset.chain).toBe('ethereum');
    expect(typeof p.asset).toBe('object');
  });

  it('三组数量字段全都读得出来，且全是字符串', async () => {
    stubFetch(WIRE);
    const p = await first();

    // 一个一个点名，而不是 toEqual 整只：整只比较在**加**字段时也会红，
    // 而加字段是兼容的。这里要拦的是**改名与删除**。
    for (const k of [
      'shares_raw',
      'pending_shares',
      'sellable_shares',
      'buy_amount_raw',
      'sell_amount_raw',
      'cost_basis_usd',
      'buy_value_usd',
      'sell_value_usd',
      'realized_pnl_usd',
      'market_value_usd',
      'unrealized_pnl_usd',
      'total_pnl_usd',
      'pnl_ratio',
      'price_usd',
      'input_revision',
      'applied_revision',
    ] as const) {
      expect(p[k], `${k} 读不出来 —— 后端改名了？`).toBeTypeOf('string');
    }
  });

  it('旧接口那一版的字段名**一个都读不到**', async () => {
    stubFetch(WIRE);
    const p = await first();
    const raw = p as unknown as Record<string, unknown>;
    // 这一组是这次换形的**症状本身**：旧名字不报错，只是没有值。留着它是为了
    // 让下一个照旧代码写的人在测试里先撞见，而不是在页面上看到一列 undefined。
    for (const k of [
      'shares',
      'cost_basis',
      'total_buy_shares',
      'total_buy_quote',
      'total_sell_shares',
      'total_sell_quote',
      'total_realized_pnl',
      'updated_at',
      'asset_chain_id',
      'asset_kind',
      'quote_chain_id',
      'quote_asset',
    ]) {
      expect(raw[k], `${k} 竟然还在？那这次换形没有想的那么彻底`).toBeUndefined();
    }
  });

  it('时刻是 {seconds, nanos}，不是 RFC3339 串', async () => {
    stubFetch(WIRE);
    const p = await first();
    expect(p.opened_at.seconds).toBe(1789263079);
    expect(p.opened_at.nanos).toBe(0);
    // Date.parse(对象) 是 NaN，而 NaN 参与排序不抛错，只让结果变成未定义顺序。
    expect(Date.parse(p.opened_at as unknown as string)).toBeNaN();
  });

  it('没卖过的行 avg_sell_price_usd 是空串，不是 "0"', async () => {
    stubFetch(WIRE);
    const rows = await listPositions('t');
    const sealook = rows[1]!;
    expect(sealook.avg_sell_price_usd).toBe('');
    // Number('') 是 0 —— 任何"按数值判正负"的写法都会把"从没卖过"渲染成
    // "卖价是 0"。这一条把那个陷阱钉在这儿。
    expect(Number(sealook.avg_sell_price_usd)).toBe(0);
  });

  it('只取 positions，顶层那一整套资产总览一概不带出来', async () => {
    stubFetch(WIRE);
    const rows = await listPositions('t');
    // 交回的就是数组本身，不是包着 pnl / cash_balances 的对象。
    // 这是**有意的**（见 listPositions 的注释）：harness 不做资产页。
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);
    expect((rows as unknown as Record<string, unknown>).pnl).toBeUndefined();
  });

  it('positions 缺席时给空数组，不炸在 .map 上', async () => {
    stubFetch({code: 200, msg: 'ok', data: {}});
    await expect(listPositions('t')).resolves.toEqual([]);
  });
});

describe('positionKey', () => {
  const base: Position = WIRE.data.positions[0]!;

  it('三项自然键唯一确定一行', () => {
    expect(positionKey(base)).toBe('1:erc20:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599');
  });

  it('同一个地址在两条链上是两行，key 不同', () => {
    const other: Position = {...base, asset: {...base.asset, chain_id: 56, chain: 'bsc'}};
    expect(positionKey(other)).not.toBe(positionKey(base));
  });

  it('key 里不含 undefined —— 那是所有行塌成一行的样子', () => {
    // 旧版的 key 含 quote_chain_id / quote_asset，而 portfolio 回包里没有这两段。
    // 照旧拼出来的是 "...:undefined:undefined"，仍然唯一、仍然能渲染，
    // 于是错得悄无声息。
    expect(positionKey(base)).not.toContain('undefined');
    expect(positionKey(WIRE.data.positions[1]!)).not.toContain('undefined');
  });

  it('两行的 key 互不相同', () => {
    expect(positionKey(WIRE.data.positions[0]!)).not.toBe(positionKey(WIRE.data.positions[1]!));
  });
});

describe('positionsMark', () => {
  const base: Position = WIRE.data.positions[0]!;

  it('**加仓不会多一行** —— 只比行数的话这种成交永远判成"没变"', () => {
    // 这是成交后自动重查仓位那条路上唯一会静默失效的判据：在已有的币上加仓
    // 是最常见的成交，而它一行都不会多。指纹含 shares_raw，所以抓得住。
    const after: Position = {...base, shares_raw: '96'};
    expect(positionsMark([after])).not.toBe(positionsMark([base]));
  });

  it('量恰好没变、但这一行被重写过，也算变了', () => {
    // 清仓再买回同一个数、或一次反转，shares_raw 可能回到原值 —— 那时只有
    // 修订号还记得发生过什么。旧版这一格靠的是 updated_at，而它没了。
    const after: Position = {...base, applied_revision: '3'};
    expect(positionsMark([after])).not.toBe(positionsMark([base]));
  });

  it('账本收到了、估值还没跟上，也算变了', () => {
    // input / applied 分叉正是补查要等的那一刻。只取其中一个就会漏掉它，
    // 而漏掉的样子是"盯满 90 秒仍没变"——看起来像这笔没成交。
    const after: Position = {...base, input_revision: '3'};
    expect(positionsMark([after])).not.toBe(positionsMark([base]));
  });

  it('**价格动了不算变** —— 这是这条路上最容易误判的一处', () => {
    // 2026-09-16 实测：同一份仓位连打两发 /v1/portfolio，在没有任何成交的
    // 情况下，这六个字段就全变了。把它们中的任何一个放进指纹，补查第一跳
    // 就判成"已看到本次成交带来的变化"，于是停在入账之前 —— 而日志上写的
    // 是一句报喜的话。
    const after: Position = {
      ...base,
      price_usd: '80000.0',
      price_as_of: {seconds: 1789530999, nanos: 0},
      market_value_usd: '0.03840000',
      unrealized_pnl_usd: '-0.01820402',
      total_pnl_usd: '-0.37184902',
      pnl_ratio: '-0.371849020000',
    };
    expect(positionsMark([after])).toBe(positionsMark([base]));
  });

  it('一模一样的两份列表指纹相同', () => {
    expect(positionsMark([base])).toBe(positionsMark([{...base}]));
  });

  it('空列表有指纹，不是 undefined', () => {
    expect(positionsMark([])).toBe('');
  });
});

describe('timestampMs', () => {
  it('{seconds, nanos} 换成毫秒', () => {
    expect(timestampMs({seconds: 1789263079, nanos: 0})).toBe(1789263079000);
    expect(timestampMs({seconds: 1789530619, nanos: 84509233})).toBe(1789530619084);
  });

  it('取不到就是 0，不是 NaN', () => {
    // NaN 参与排序不抛错，只让 sort 的结果变成未定义顺序 —— 看起来像后端乱回。
    expect(timestampMs(undefined)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// status（三态摘要）与 lifecycle（七态）
// ---------------------------------------------------------------------------
//
// 2026-08-30 后端把七态从 status 挪到了 lifecycle，status 换成三态数字枚举，
// **而字段名一个字没改**。这一组用例钉的就是这次换名的每一处坑：它们全都
// 不会在运行时报错，只会让某个分支永远不命中。

function sentBody(f: ReturnType<typeof stubFetch>): Record<string, unknown> {
  const init = f.mock.calls[0]![1] as {body: string};
  return JSON.parse(init.body) as Record<string, unknown>;
}


function stubRaw(status: number, body: string) {
  const f = vi.fn(async (_url: string, _init?: unknown) => ({
    ok: status === 200,
    status,
    text: async () => body,
  }));
  vi.stubGlobal('fetch', f);
  return f;
}

describe('call 的三类失败', () => {
  it('业务拒绝 = business，带六位码、reason 与 trace_id', async () => {
    stubRaw(200, JSON.stringify({code: 400100, msg: '无效', error: 'BIZ_X', trace_id: 'tid'}));
    const err = (await listPositions('t').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('business');
    expect(err.code).toBe(400100);
    expect(err.reason).toBe('BIZ_X');
    expect(err.traceID).toBe('tid');
  });

  // 404 的判据是「没到信封层」。归成 business 的话，页面会去码表里查
  // "404"，查不到就说"未知业务码"—— 而真相是这条路由不在这个后端上。
  it('HTTP 404 = transport，且留下响应体原文认出 HTML 错误页', async () => {
    stubRaw(404, '<html><body>404 not found</body></html>');
    const err = (await listPositions('t').catch((e: unknown) => e)) as ApiError;
    expect(err.kind).toBe('transport');
    expect(err.code).toBe(404);
    expect(err.rawBody).toContain('404 not found');
  });

  // 200 但不是 JSON：被中间层换掉了。仍然算没到信封层。
  it('200 但不是 JSON = transport，不是"回包形状不对"', async () => {
    stubRaw(200, '<html>gateway</html>');
    const err = (await listPositions('t').catch((e: unknown) => e)) as ApiError;
    expect(err.kind).toBe('transport');
    expect(err.rawBody).toContain('gateway');
  });

  it('fetch 自己抛 = network，而不是让浏览器那句 Failed to fetch 直接冒出去', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const err = (await listPositions('t').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('network');
    expect(err.code).toBe(0);
  });
});

describe('x-request-id', () => {
  /** 契约：32 位小写 hex。不合法的值被后端**静默丢弃**，所以形态要钉住。 */
  const HEX32 = /^[0-9a-f]{32}$/;

  it('每个请求都带，且是 32 位小写 hex', async () => {
    const f = stubFetch(WIRE);
    await listPositions('t');
    const headers = (f.mock.calls[0]![1] as {headers: Record<string, string>}).headers;
    expect(headers['x-request-id']).toMatch(HEX32);
  });

  it('**每次新生成，不复用** —— 复用会把所有请求在后端日志里挤成一条链路', async () => {
    const f = stubFetch(WIRE);
    await listPositions('t');
    await listPositions('t');
    const ids = f.mock.calls.map(
      (c) => (c[1] as {headers: Record<string, string>}).headers['x-request-id'],
    );
    expect(ids[0]).not.toBe(ids[1]);
  });

  // 请求根本没到后端时是拿不到 trace_id 的 —— 自己生成就是为了这一刻
  // 也有 ID 可报（见 trace.ts）。
  it('network 类失败也带得出我们发的那个 ID', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const err = (await listPositions('t').catch((e: unknown) => e)) as ApiError;
    expect(err.sentRequestID).toMatch(HEX32);
    expect(err.traceID).toBeUndefined();
  });
});

describe('login 的 auth_method 是参数', () => {
  // 写死成常量时，用 Google 登进来的人会被声称成 email 登的，后端回 100107
  // 说"登录方式不支持"—— 而登录方式明明是支持的，只是我们说错了。
  it.each([
    ['AUTH_METHOD_EMAIL'],
    ['AUTH_METHOD_GOOGLE'],
    ['AUTH_METHOD_APPLE'],
  ] as const)('%s 原样发出去', async (m) => {
    const f = stubFetch({code: 200, msg: 'ok', data: {token: 'jwt', user: {identifier: 'i'}}});
    await login(m, 'idt');
    expect(sentBody(f).auth_method).toBe(m);
  });

  // 登录端点对无头请求放行，但带了坏/过期 token 一律 400000，绝不降级成
  // 匿名。而登录恰恰是"手上那个 token 已经不能用了"的时刻。
  it('绝不带 Authorization 头', async () => {
    const f = stubFetch({code: 200, msg: 'ok', data: {token: 'jwt', user: {identifier: 'i'}}});
    await login('AUTH_METHOD_EMAIL', 'idt');
    const headers = (f.mock.calls[0]![1] as {headers: Record<string, string>}).headers;
    expect(headers).not.toHaveProperty('Authorization');
  });
});
