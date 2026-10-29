import {describe, expect, it} from 'vitest';

import {ApiError} from './api';
import {readEnvelopeProbe, readRouteProbe} from './selfcheck';

/**
 * 这两个探针的全部价值就在"什么算通过"这几行判据上，而其中最要紧的一条
 * 是反直觉的：**它们期望失败**。埋在 JSX 里的话没人验得了它。
 */
describe('探针1 · 匿名 GET /v1/user/info', () => {
  it('400000 是通过 —— 拒绝本身证明了代理通、信封层活着、路由存在', () => {
    const p = readEnvelopeProbe(new ApiError('business', 400000, '未认证'));
    expect(p.ok).toBe(true);
  });

  // 该端点是 Required 档。匿名请求成功说明鉴权中间件没挂上，
  // 那比"后端够不着"严重得多，绝不能因为"没抛异常"就当成通过。
  it('成功反而是异常', () => {
    expect(readEnvelopeProbe(null).ok).toBe(false);
  });

  it('network 类要指向 BUSINESS_ORIGIN 与重启，而不是让人去查后端', () => {
    const p = readEnvelopeProbe(new ApiError('network', 0, 'Failed to fetch'));
    expect(p.ok).toBe(false);
    expect(p.detail).toContain('BUSINESS_ORIGIN');
  });

  it('别的业务码不算通过 —— 只有 400000 才证明得了那三件事', () => {
    expect(readEnvelopeProbe(new ApiError('business', 500097, '上游未接入')).ok).toBe(false);
  });
});

describe('探针2 · POST /v1/auth/login 是否存在', () => {
  it.each([400100, 100108])('%d 是通过：路由存在且 Privy 验签在跑', (code) => {
    expect(readRouteProbe(new ApiError('business', code, 'x')).ok).toBe(true);
  });

  // 这是区分新旧构建唯一的廉价办法。判成"网络问题"的话，人会去查代理，
  // 而代理是好的 —— 这条路根本不在那个后端上。
  it('HTTP 404 判成"旧构建没有这条路由"，并指向 BUSINESS_ORIGIN', () => {
    const p = readRouteProbe(new ApiError('transport', 404, 'HTTP 404'));
    expect(p.ok).toBe(false);
    expect(p.text).toContain('旧构建');
    expect(p.detail).toContain('重启 dev server');
  });

  // 500097 与 404 长得都像"这里没有登录"，但一个是没配、一个是没有路由，
  // 改的地方完全不同（configs/business.secret.yaml vs 换一个后端）。
  it('500097 单独一格，说的是这台 business 没配 Privy', () => {
    const p = readRouteProbe(new ApiError('business', 500097, '上游未接入'));
    expect(p.ok).toBe(false);
    expect(p.text).toContain('没配');
  });

  it('假 token 登录成功是异常', () => {
    expect(readRouteProbe(null).ok).toBe(false);
  });

  it('不是 ApiError 的东西也要有话说，不能崩', () => {
    const p = readRouteProbe(new TypeError('boom'));
    expect(p.ok).toBe(false);
    expect(p.text).toContain('boom');
  });
});

/**
 * business 的对外面**恒 200**，所以 HTTP 500 一定不是它说的话 —— 只可能是
 * dev server 的代理自己没转发出去。2026-09-03 实测撞到：BUSINESS_ORIGIN 指了
 * 一个 https 域名，Node 默认不用系统 CA，代理在 TLS 握手就断了，而同一台机器
 * 上 curl 打那个域名是 200。那个反差会让人认定后端是好的、回头怀疑前端。
 */
describe('HTTP 500 且响应体是空的 = 代理自己失败了', () => {
  it.each([
    ['探针1', readEnvelopeProbe],
    ['探针2', readRouteProbe],
  ] as const)('%s 把它指向 dev server 的终端，而不是三个猜测', (_n, read) => {
    const p = read(new ApiError('transport', 500, 'HTTP 500', {rawBody: ''}));
    expect(p.ok).toBe(false);
    expect(p.text).toContain('代理自己没转发出去');
    expect(p.detail).toContain('http proxy error');
  });

  // 有正文的 500 是另一回事（某个中间层真回了一段东西），别一起吞掉 ——
  // 那段正文本身就是线索。
  it('500 但有正文时不套这条，正文要留着当线索', () => {
    const p = readEnvelopeProbe(
      new ApiError('transport', 500, 'HTTP 500', {rawBody: '<html>upstream boom</html>'}),
    );
    expect(p.text).not.toContain('代理自己没转发出去');
    expect(p.detail).toContain('upstream boom');
  });

  // 404 有它自己的判读（旧构建），不能被 5xx 这条盖掉。
  it('404 仍然判成旧构建', () => {
    expect(readRouteProbe(new ApiError('transport', 404, 'HTTP 404')).text).toContain('旧构建');
  });
});
