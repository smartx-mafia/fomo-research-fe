import {afterEach, describe, expect, it, vi} from 'vitest';

import {fetchUsdcBalance, formatUnits, USDC_MINT} from './balance';

const OWNER = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';

/** 造一个 getTokenAccountsByOwner 的回包。形状抄自 2026-08-29 的实测回包。 */
function reply(accounts: {amount: string; decimals?: number}[]) {
  return {
    jsonrpc: '2.0',
    result: {
      context: {slot: 442542657},
      value: accounts.map((a) => ({
        pubkey: '2ocS3orPq3jyszjsJ4NozKWyhdotr3csDjAizmkj65aH',
        account: {
          data: {
            parsed: {
              info: {
                mint: USDC_MINT,
                owner: OWNER,
                tokenAmount: {amount: a.amount, decimals: a.decimals ?? 6},
              },
              type: 'account',
            },
            program: 'spl-token',
          },
        },
      })),
    },
  };
}

function stubFetch(body: unknown, init?: {ok?: boolean; status?: number}) {
  const f = vi.fn(async () => ({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  }));
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe('formatUnits', () => {
  it('整数不带小数点', () => {
    expect(formatUnits(12_000_000n, 6)).toBe('12');
    expect(formatUnits(0n, 6)).toBe('0');
  });

  it('去掉尾零，但前导零一个都不能少', () => {
    expect(formatUnits(12_340_000n, 6)).toBe('12.34');
    // 1 个最小单位 = 0.000001。掉一个前导零就变成 0.1 —— 差五个数量级。
    expect(formatUnits(1n, 6)).toBe('0.000001');
    expect(formatUnits(100_000n, 6)).toBe('0.1');
  });

  it('大到 number 装不下也不失真', () => {
    // 2^53 之外。走 Number 的实现会在这里悄悄改掉末几位。
    expect(formatUnits(123_456_789_012_345_678_901n, 6)).toBe('123456789012345.678901');
  });
});

describe('fetchUsdcBalance', () => {
  it('把同一个 owner 名下的多个 USDC 账户加起来', async () => {
    // 实测那个地址就有两个 USDC account：只读第一个会少算一大半。
    stubFetch(reply([{amount: '204613300'}, {amount: '2839940216'}]));
    const b = await fetchUsdcBalance(OWNER);
    expect(b.raw).toBe(3_044_553_516n);
    expect(b.ui).toBe('3044.553516');
    expect(b.accounts).toBe(2);
  });

  it('一个 token account 都没有时是 0，且 accounts=0', async () => {
    stubFetch(reply([]));
    const b = await fetchUsdcBalance(OWNER);
    expect(b.raw).toBe(0n);
    expect(b.ui).toBe('0');
    expect(b.accounts).toBe(0);
  });

  it('按 owner + mint 过滤，commitment 用 confirmed', async () => {
    const f = stubFetch(reply([]));
    await fetchUsdcBalance(OWNER);
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, {body: string}])[1].body);
    expect(body.method).toBe('getTokenAccountsByOwner');
    expect(body.params[0]).toBe(OWNER);
    expect(body.params[1]).toEqual({mint: USDC_MINT});
    // finalized 会让刚广播完那一刻读到扣款前的数 —— 而那长得像"交易没成功"。
    expect(body.params[2].commitment).toBe('confirmed');
  });

  it('HTTP 错误显式抛，带上状态码', async () => {
    stubFetch({}, {ok: false, status: 429});
    await expect(fetchUsdcBalance(OWNER)).rejects.toThrow('429');
  });

  it('JSON-RPC 的错误在 200 里，一样要抛', async () => {
    stubFetch({jsonrpc: '2.0', error: {code: -32602, message: 'Invalid param'}});
    await expect(fetchUsdcBalance(OWNER)).rejects.toThrow('-32602 Invalid param');
  });
});
