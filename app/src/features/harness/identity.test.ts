import {describe, expect, it} from 'vitest';

import {readiness, type ReadinessInput} from './identity';

/**
 * `needsCustomAuthLink` 那一组用例连同函数一起删了（2026-09-03）。
 *
 * 它判的是"custom_auth 挂没挂上"，而后端已经改成按 `privy_did` 查钱包
 * （`6751d44 fix(business): resolve Privy wallets by stored DID`），
 * 那一步整个不需要了。理由与出处写在 `identity.ts` 的文件头上。
 *
 * **留这段注释是因为删掉的东西看不见。** 下一个人读到 App.tsx 里没有 link
 * 那一步时，会怀疑是不是漏了 —— 而漏与删是两回事。
 */

/** 四步齐了的基线。每条用例只推翻其中一格，好让"是哪一格"无可争议。 */
const OK: ReadinessInput = {
  ready: true,
  authenticated: true,
  hasToken: true,
  hasWallet: true,
};

describe('readiness：卡在哪一步要说得出来', () => {
  it('四步齐了才就绪，且就绪时不留话', () => {
    expect(readiness(OK)).toEqual({ready: true, blocker: ''});
  });

  // 顺序是有意义的：先说最靠前的那一步。一次性报四个"没做"没法照着做。
  it.each([
    ['ready', {...OK, ready: false}, 'Privy SDK 还在初始化'],
    ['authenticated', {...OK, authenticated: false}, '还没登录'],
    ['hasToken', {...OK, hasToken: false}, '/v1/auth/login'],
    ['hasWallet', {...OK, hasWallet: false}, '不会自动建'],
  ] as const)('缺 %s 时不就绪，且文案点到那一步', (_name, input, fragment) => {
    const r = readiness(input);
    expect(r.ready).toBe(false);
    expect(r.blocker).toContain(fragment);
  });

  it('多项都缺时，只报最靠前的那一步', () => {
    expect(readiness({ready: false, authenticated: false, hasToken: false, hasWallet: false}).blocker)
      .toContain('Privy SDK 还在初始化');
  });

  // **钱包那一格的文案不能写成"等一会儿"。** headless 登录不触发自动建钱包，
  // 等多久都不会有 —— 那句话会让人白等，然后判成页面坏了。
  it('没有钱包时明说"不会自动建"，不留"再等等"的余地', () => {
    const b = readiness({...OK, hasWallet: false}).blocker;
    expect(b).toContain('不会自动建');
    expect(b).not.toMatch(/稍等|等一会|稍候/);
  });

  // 改之前那个判据是 `ready && authenticated && wallets.length > 0` ——
  // 少了 hasToken，于是"已认证、有钱包、但没换到 token"会被放行，
  // 而它的第一条错误是下单时的 401。
  it('只有 ready+authenticated+hasWallet 时不放行（旧判据的漏网之鱼）', () => {
    expect(readiness({...OK, hasToken: false}).ready).toBe(false);
  });
});
