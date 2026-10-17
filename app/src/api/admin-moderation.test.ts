import {beforeEach, describe, expect, it} from 'vitest';
import {ApiError} from '@/api/envelope';
import {addRule, adminCall, changePassword, checkText, configureAdmin, describeError, getToken, isPasswordChangeRequired, listRules, login, setToken} from '@/api/admin-moderation';

function fakeFetch(body: unknown, status = 200) {
  const calls: {url: string; init: RequestInit}[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({url, init});
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {status});
  }) as unknown as typeof fetch;
  return {f, calls};
}

beforeEach(() => {
  configureAdmin({prefix: '', sessionKey: 'local'});
  setToken('');
});

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

  it('切到测试环境：请求带 /test-env 前缀，会话与本机分开存（两边是两套管理员）', async () => {
    setToken('local-tok');
    configureAdmin({prefix: '/test-env', sessionKey: 'test'});
    expect(getToken()).toBe('');
    setToken('test-tok');
    const {f, calls} = fakeFetch({code: 200, msg: 'ok', data: {blocked: false}});
    await checkText('今天行情不错', f);
    expect(calls[0].url).toBe('/test-env/admin/api/v1/moderation/check');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer test-tok');
    configureAdmin({prefix: '', sessionKey: 'local'});
    expect(getToken()).toBe('local-tok');
  });

  it('正文试判：POST 原文，不在前端做任何规整（规整只在后端一处）', async () => {
    const {f, calls} = fakeFetch({code: 200, msg: 'ok', data: {blocked: true, rule_id: 'dyn-3', stage: 'gap'}});
    const r = await checkText('  真是下  贱啊 ', f);
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({text: '  真是下  贱啊 '});
    expect(r.rule_id).toBe('dyn-3');
  });

  it('正文的空 / 超长按正文说，不套用「词条最多 64 字」', () => {
    const tooLong = new ApiError('business', 100136, 'x', 'BIZ_ADMIN_OPS_INVALID_ARGUMENT', 't', undefined, undefined, {field: 'text', reason: 'too_long'});
    expect(describeError(tooLong)).toContain('正文超长');
    expect(describeError(tooLong)).not.toContain('64');
    const empty = new ApiError('business', 100136, 'x', 'BIZ_ADMIN_OPS_INVALID_ARGUMENT', 't', undefined, undefined, {field: 'text', reason: 'empty'});
    expect(describeError(empty)).toContain('正文为空');
  });

  it('首次登录：回包 must_change_password=true 时如实告诉调用方（此时除了改口令什么都会 400704）', async () => {
    const {f} = fakeFetch({code: 200, msg: 'ok', data: {token: 't1', me: {admin: {must_change_password: true}}}});
    expect(await login('u', 'p', f)).toEqual({mustChangePassword: true});
    expect(getToken()).toBe('t1');
    const {f: f2} = fakeFetch({code: 200, msg: 'ok', data: {token: 't2', me: {admin: {must_change_password: false}}}});
    expect(await login('u', 'p', f2)).toEqual({mustChangePassword: false});
  });

  it('改口令：带旧 / 新口令 POST /auth/password，并换上回包里的新会话', async () => {
    setToken('old');
    const {f, calls} = fakeFetch({code: 200, msg: 'ok', data: {token: 'fresh', me: {admin: {must_change_password: false}}}});
    await changePassword('Old-pass-1234', 'New-pass-5678', f);
    expect(calls[0].url).toBe('/admin/api/v1/auth/password');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({old_password: 'Old-pass-1234', new_password: 'New-pass-5678'});
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer old');
    expect(getToken()).toBe('fresh');
  });

  it('400704 分两种：缺权限点不是「要改口令」，只有 password change required 才是', () => {
    const must = new ApiError('business', 400704, 'password change required', 'ADMIN_FORBIDDEN');
    const perm = new ApiError('business', 400704, 'forbidden', 'ADMIN_FORBIDDEN', undefined, undefined, undefined, {permission: 'moderation:write'});
    expect(isPasswordChangeRequired(must)).toBe(true);
    expect(isPasswordChangeRequired(perm)).toBe(false);
    expect(describeError(must)).toContain('先改口令');
  });
});
