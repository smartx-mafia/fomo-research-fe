import {afterEach, describe, expect, it, vi} from 'vitest';

import {SwapApiError, createSwapClient, type HttpTiming} from './client';
import {createSwapStore, LockBusyError, withSwapLock} from './store';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown, status = 200) {
  const f = vi.fn(async (_url: string, _init?: RequestInit) => ({
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }));
  vi.stubGlobal('fetch', f);
  return f;
}

const ok = (data: object) => ({code: 200, msg: 'success', trace_id: 't', data: {contract_version: 'fast-swap.v1', ...data}});

describe('createSwapClient', () => {
  it('建单带 Idempotency-Key 与 Bearer；展示报价不带幂等键', async () => {
    const f = stubFetch(ok({swap: {swap_id: 'sw1'}}));
    const c = createSwapClient({token: 'tok'});
    await c.create({client_intent_id: 'cid'} as never, 'key-1');
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('/v2/swaps');
    const h = init!.headers as Record<string, string>;
    expect(h['Idempotency-Key']).toBe('key-1');
    expect(h.Authorization).toBe('Bearer tok');

    await c.quote({} as never);
    expect((f.mock.calls[1]![1]!.headers as Record<string, string>)['Idempotency-Key']).toBeUndefined();
  });

  it('失败信封：保留 metadata，按 recovery_action 归一；认不得的值当 get_snapshot', async () => {
    stubFetch({code: 420606, msg: 'x', error: 'FASTSWAP_IDEMPOTENCY_CONFLICT', metadata: {recovery_action: 'new_idempotency_key'}});
    const c = createSwapClient({token: 't'});
    const e = (await c.get('sw1').catch((x) => x)) as SwapApiError;
    expect(e).toBeInstanceOf(SwapApiError);
    expect(e.kind).toBe('business');
    expect(e.recovery).toBe('new_idempotency_key');

    stubFetch({code: 420603, msg: 'x', metadata: {recovery_action: 'brand_new_action', retry_after_ms: '14000', related_swap_id: 'sw0'}});
    const e2 = (await c.get('sw1').catch((x) => x)) as SwapApiError;
    expect(e2.recovery).toBe('get_snapshot');
    expect(e2.retryAfterMs).toBe(14000);
    expect(e2.meta.related_swap_id).toBe('sw0');
  });

  it('contract_version 不对就停，不解析出一堆零值', async () => {
    stubFetch({code: 200, msg: 'success', data: {contract_version: 'fast-swap.v2'}});
    const e = (await createSwapClient({token: 't'}).capabilities().catch((x) => x)) as SwapApiError;
    expect(e.message).toContain('fast-swap.v2');
  });

  it('裸 403 归为 transport，并提示 Origin 白名单', async () => {
    stubFetch('', 403);
    const e = (await createSwapClient({token: 't'}).capabilities().catch((x) => x)) as SwapApiError;
    expect(e.kind).toBe('transport');
    expect(e.message).toContain('Origin');
  });

  it('计时回调拿到四个点（成功路径）', async () => {
    stubFetch(ok({swap: {}}));
    const seen: HttpTiming[] = [];
    await createSwapClient({token: 't', onTiming: (t) => seen.push(t)}).execute('sw1', {} as never, 'k');
    expect(seen).toHaveLength(1);
    const t = seen[0]!;
    expect(t.path).toBe('/v2/swaps/sw1/executions');
    expect(t.ok).toBe(true);
    expect([t.headersAt, t.bodyAt, t.parsedAt].every((x) => typeof x === 'number')).toBe(true);
  });
});

describe('createSwapStore', () => {
  it('按账户分桶；写不进 localStorage 时退回内存并报告不持久', () => {
    const m = new Map<string, string>();
    const good = {getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v)};
    const a = createSwapStore('local:u1', good);
    a.put({client_intent_id: 'c1', swap_id: 'sw1'} as never);
    expect(createSwapStore('local:u1', good).bySwap('sw1')?.client_intent_id).toBe('c1');
    expect(createSwapStore('test:u1', good).list()).toEqual([]);
    expect(a.durable()).toBe(true);

    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    const b = createSwapStore('local:u1', broken);
    b.put({client_intent_id: 'c1', swap_id: 'sw1'} as never);
    expect(b.durable()).toBe(false);
  });
});

describe('withSwapLock', () => {
  // null = 进程内集合那条退路；不传 = 运行环境的 Web Locks（Node 与浏览器都有）
  it.each([
    ['进程内退路', null],
    ['Web Locks', undefined],
  ])('%s：同名锁被占时立刻失败，不排队；释放后可再取', async (_name, locks) => {
    let release!: () => void;
    const first = withSwapLock('L', () => new Promise<void>((r) => (release = r)), locks as never);
    await new Promise((r) => setTimeout(r, 0));
    await expect(withSwapLock('L', async () => 1, locks as never)).rejects.toBeInstanceOf(LockBusyError);
    release();
    await first;
    await expect(withSwapLock('L', async () => 2, locks as never)).resolves.toBe(2);
  });
});
