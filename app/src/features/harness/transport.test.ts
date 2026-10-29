import {afterEach, describe, expect, it, vi} from 'vitest';

import {ApiError, getUserInfo} from './api';
import {
  emitTiming,
  getBaseOrigin,
  resolveUrl,
  setBaseOrigin,
  setTimingHook,
  type RequestTiming,
} from './transport';

/**
 * 这个模块是**模块级可变状态**（理由见 `transport.ts` 头部），用例之间必须复位。
 * 漏了复位的症状是"单跑绿、全跑红"，而排查会从被污染的那个用例开始找，
 * 方向从一开始就是错的。
 */
afterEach(() => {
  setBaseOrigin('');
  setTimingHook(null);
  vi.unstubAllGlobals();
});

/** 与 `api.test.ts` 同一个桩：**交 `text()` 不交 `json()`**，理由见那边。 */
function stubFetch(body: unknown, status = 200) {
  const f = vi.fn(async (_url: string, _init?: unknown) => ({
    ok: status === 200,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }));
  vi.stubGlobal('fetch', f);
  return f;
}

const OK = {code: 200, msg: 'ok', trace_id: 'srv-trace', data: {identifier: 'abc'}};

/** 收集计时记录。返回数组本身，用例直接读。 */
function collectTimings(): RequestTiming[] {
  const got: RequestTiming[] = [];
  setTimingHook((t) => got.push(t));
  return got;
}

describe('setBaseOrigin', () => {
  it('默认是空串，也就是走代理的老行为', () => {
    expect(getBaseOrigin()).toBe('');
  });

  it('尾斜杠被削掉 —— 留着会拼出双斜杠，有的网关当成另一条路由', () => {
    setBaseOrigin('http://10.0.0.1///');
    expect(getBaseOrigin()).toBe('http://10.0.0.1');
  });

  it('没有 scheme 当场抛，不等到发请求才炸', () => {
    // 少写 scheme 时浏览器会把它当相对路径，打到的是当前页面的源 ——
    // 请求正常返回，只是数据来自另一个后端，没有一处会报错。
    expect(() => setBaseOrigin('10.0.0.1')).toThrow(/http:\/\/ 或 https:\/\//);
    expect(getBaseOrigin()).toBe('');
  });

  it('空串可以设回去（关掉直连）', () => {
    setBaseOrigin('https://api.example.com');
    setBaseOrigin('');
    expect(getBaseOrigin()).toBe('');
  });
});

describe('resolveUrl：前缀与 origin 互斥', () => {
  it('没设 origin 时加环境前缀，这是浏览器里的那条路', () => {
    expect(resolveUrl('/test-env', '/v1/user/info')).toBe('/test-env/v1/user/info');
  });

  it('默认档前缀是空串，路径原样', () => {
    expect(resolveUrl('', '/v1/user/info')).toBe('/v1/user/info');
  });

  it('设了 origin 就**不加**前缀 —— 前缀是代理的分流依据，不是后端路由的一部分', () => {
    // 带上它拿到的是 404，而 404 在恒 200 信封体系里会被判成 transport 类，
    // 报错说"检查代理"，指向代理，可直连这条路上根本没有代理。
    setBaseOrigin('http://10.0.0.1');
    expect(resolveUrl('/test-env', '/v1/user/info')).toBe('http://10.0.0.1/v1/user/info');
  });
});

describe('emitTiming', () => {
  it('没挂钩子时什么都不做', () => {
    expect(() => emitTiming({} as RequestTiming)).not.toThrow();
  });

  it('钩子自己抛错被吞掉 —— 观测不该把被观测者带崩', () => {
    setTimingHook(() => {
      throw new Error('记账那边炸了');
    });
    expect(() => emitTiming({} as RequestTiming)).not.toThrow();
  });
});

describe('call 用上了这两个注入点', () => {
  it('设了 origin 之后，真正打出去的是绝对 URL', async () => {
    const f = stubFetch(OK);
    setBaseOrigin('http://10.0.0.1');

    await getUserInfo('tok');

    expect(f.mock.calls[0]![0]).toBe('http://10.0.0.1/v1/user/info');
  });

  it('不设 origin 时与从前逐字节相同 —— 浏览器侧不受影响', async () => {
    const f = stubFetch(OK);

    await getUserInfo('tok');

    // 默认档 API_PREFIX 是空串。这条用例钉的是"这次改动没动浏览器的行为"。
    expect(f.mock.calls[0]![0]).toBe('/v1/user/info');
  });

  it('成功的请求报一条计时，三个时刻都在且单调不减', async () => {
    stubFetch(OK);
    const got = collectTimings();

    await getUserInfo('tok');

    expect(got).toHaveLength(1);
    const t = got[0]!;
    expect(t.ok).toBe(true);
    expect(t.failure).toBeUndefined();
    expect(t.method).toBe('GET');
    expect(t.url).toBe('/v1/user/info');
    expect(t.status).toBe(200);
    expect(t.code).toBe(200);
    expect(t.traceID).toBe('srv-trace');
    expect(t.sentRequestID).toMatch(/^[0-9a-f]{32}$/);
    expect(t.startedAtWall).toBeGreaterThan(0);
    expect(t.firstByteAt!).toBeGreaterThanOrEqual(t.startedAt);
    expect(t.completedAt).toBeGreaterThanOrEqual(t.firstByteAt!);
  });

  it('POST 的方法名记的是 POST，不是默认的 GET', async () => {
    stubFetch({code: 200, msg: 'ok', data: {}});
    const got = collectTimings();

    // 走一条 POST 端点。用 login 是因为它不需要 token，形状最简单。
    const {login} = await import('./api');
    await login('AUTH_METHOD_EMAIL', 'idt');

    expect(got[0]!.method).toBe('POST');
  });

  it('业务失败也报，且带着业务码与 trace —— 只报成功会让限流表现成样本变少', async () => {
    stubFetch({code: 400000, msg: '未认证', trace_id: 'srv-trace', error: 'BIZ_UNAUTHENTICATED'});
    const got = collectTimings();

    await expect(getUserInfo('tok')).rejects.toBeInstanceOf(ApiError);

    expect(got).toHaveLength(1);
    const t = got[0]!;
    expect(t.ok).toBe(false);
    expect(t.failure).toBe('business');
    expect(t.status).toBe(200);
    expect(t.code).toBe(400000);
    expect(t.traceID).toBe('srv-trace');
  });

  it('非 200 报成 transport，业务码缺席（信封根本没解出来）', async () => {
    stubFetch('<html>502 Bad Gateway</html>', 502);
    const got = collectTimings();

    await expect(getUserInfo('tok')).rejects.toBeInstanceOf(ApiError);

    const t = got[0]!;
    expect(t.failure).toBe('transport');
    expect(t.status).toBe(502);
    expect(t.code).toBeUndefined();
  });

  it('请求没发出去时 firstByteAt 缺席 —— 这正是它与"后端很慢"的分辨点', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const got = collectTimings();

    await expect(getUserInfo('tok')).rejects.toBeInstanceOf(ApiError);

    const t = got[0]!;
    expect(t.ok).toBe(false);
    expect(t.failure).toBe('network');
    expect(t.firstByteAt).toBeUndefined();
    expect(t.status).toBeUndefined();
    // 请求没到后端也要有我们发的那个 ID，那是这种失败下**唯一**的线索。
    expect(t.sentRequestID).toMatch(/^[0-9a-f]{32}$/);
  });

  it('钩子抛错不影响请求本身拿到结果', async () => {
    stubFetch(OK);
    setTimingHook(() => {
      throw new Error('记账那边炸了');
    });

    await expect(getUserInfo('tok')).resolves.toMatchObject({identifier: 'abc'});
  });
});
