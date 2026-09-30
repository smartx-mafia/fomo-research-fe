import {beforeEach, describe, expect, it} from 'vitest';
import {ApiError} from '@/api/envelope';
import {addRule, adminCall, describeError, getToken, listRules, setToken} from '@/api/admin-moderation';

function fakeFetch(body: unknown, status = 200) {
  const calls: {url: string; init: RequestInit}[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({url, init});
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {status});
  }) as unknown as typeof fetch;
  return {f, calls};
}

beforeEach(() => setToken(''));

describe('admin moderation client', () => {
  it('HTTP 200 不等于成功：code != 200 抛业务错误并带上 metadata', async () => {
    const {f} = fakeFetch({code: 430131, msg: 'x', error: 'BIZ_ADMIN_OPS_PRECONDITION', metadata: {reason: 'recent_authors', sample_opinion_ids: '1,2'}, trace_id: 't1'});
    const err = await addRule({locale: 'zh', term: 'x', reason: 'r', evidence_opinion_ids: []}, f).then(() => undefined, (e: unknown) => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect(err?.kind).toBe('business');
    expect(err?.metadata?.reason).toBe('recent_authors');
    expect(describeError(err)).toContain('不同作者');
    expect(describeError(err)).toContain('trace t1');
  });

  it('会话失效清掉本地 token（唯一动作是回登录页）', async () => {
    setToken('tok');
    const {f} = fakeFetch({code: 400700, msg: 'session invalid'});
    await adminCall('/moderation/status', {}, f).catch(() => undefined);
    expect(getToken()).toBe('');
  });

  it('请求带 Bearer 与点号分页参数，走 /admin/api/v1 前缀', async () => {
    setToken('tok');
    const {f, calls} = fakeFetch({code: 200, msg: 'ok', data: {items: [], page: {page: 2, size: 20, total: 0, total_capped: false}, counts_available: true}});
    await listRules({page: 2, size: 20, includeRetired: true}, f);
    expect(calls[0].url).toBe('/admin/api/v1/moderation/rules?page.page=2&page.size=20&include_retired=true');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('非 200 的 HTTP 是没到信封层（transport），不当业务失败', async () => {
    const {f} = fakeFetch('origin not allowed', 403);
    const err = await adminCall('/moderation/status', {}, f).then(() => undefined, (e: unknown) => e as ApiError);
    expect(err?.kind).toBe('transport');
    expect(describeError(err)).toContain('HTTP 403');
  });

  it('未登记的 reason 原样显示，不吞成「未知错误」', () => {
    const e = new ApiError('business', 430131, 'moderation rule rejected: brand_new', 'X', undefined, undefined, undefined, {reason: 'brand_new'});
    expect(describeError(e)).toContain('brand_new');
  });

  it('频控给出多久后可再提交', () => {
    const e = new ApiError('business', 420000, 'rate', 'SYS_RATE_LIMITED', undefined, undefined, undefined, {reason: 'moderation_write_quota', retry_after_ms: '90000'});
    expect(describeError(e)).toContain('约 2 分钟后');
  });
});
