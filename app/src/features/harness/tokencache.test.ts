import {describe, expect, it} from 'vitest';

import {clearToken, expiresAt, loadToken, saveToken} from './tokencache';

/** 造一个能被 decodeJwtPayload 解开的 token。签名段是假的 —— 这一层从不验签。 */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({alg: 'HS256'})}.${b64(payload)}.sig`;
}

function memStore(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, v),
  } as Storage;
}

const NOW = 1_800_000_000_000;
const fresh = jwt({exp: NOW / 1000 + 3600, identifier: 'u1'});

describe('token 缓存', () => {
  it('存进去能按同一个环境 + 同一个 DID 取回来', () => {
    const s = memStore();
    saveToken('local', {token: fresh, did: 'did:privy:a', identifier: 'u1'}, s);
    expect(loadToken('local', 'did:privy:a', NOW, s)?.token).toBe(fresh);
  });

  it('换了 Privy 用户就不给 —— 否则会拿着别人的身份发请求', () => {
    const s = memStore();
    saveToken('local', {token: fresh, did: 'did:privy:a', identifier: 'u1'}, s);
    expect(loadToken('local', 'did:privy:b', NOW, s)).toBeNull();
  });

  it('换了环境就不给：键按环境分桶', () => {
    const s = memStore();
    saveToken('local', {token: fresh, did: 'did:privy:a', identifier: 'u1'}, s);
    expect(loadToken('test', 'did:privy:a', NOW, s)).toBeNull();
  });

  it('过期的不给', () => {
    const s = memStore();
    const old = jwt({exp: NOW / 1000 - 1, identifier: 'u1'});
    saveToken('local', {token: old, did: 'did:privy:a', identifier: 'u1'}, s);
    expect(loadToken('local', 'did:privy:a', NOW, s)).toBeNull();
  });

  it('只剩几秒的也不给 —— 一次下单跑不完就会在中途变成 400000', () => {
    const s = memStore();
    const soon = jwt({exp: NOW / 1000 + 30, identifier: 'u1'});
    saveToken('local', {token: soon, did: 'did:privy:a', identifier: 'u1'}, s);
    expect(loadToken('local', 'did:privy:a', NOW, s)).toBeNull();
  });

  it('解不出 exp 的当作不可用', () => {
    const s = memStore();
    saveToken('local', {token: jwt({identifier: 'u1'}), did: 'did:privy:a', identifier: 'u1'}, s);
    expect(loadToken('local', 'did:privy:a', NOW, s)).toBeNull();
    expect(expiresAt('不是一个 jwt')).toBeNull();
  });

  it('存的东西形状不对时不抛，只当作没有', () => {
    const s = memStore();
    s.setItem('harness.token.local', '{不是 json');
    expect(loadToken('local', 'did:privy:a', NOW, s)).toBeNull();
    s.setItem('harness.token.local', '{"token":123}');
    expect(loadToken('local', 'did:privy:a', NOW, s)).toBeNull();
  });

  it('清掉之后取不到', () => {
    const s = memStore();
    saveToken('local', {token: fresh, did: 'did:privy:a', identifier: 'u1'}, s);
    clearToken('local', s);
    expect(loadToken('local', 'did:privy:a', NOW, s)).toBeNull();
  });

  it('localStorage 不可用（null）时不抛，退回每次重换', () => {
    expect(() => saveToken('local', {token: fresh, did: 'd', identifier: 'u'}, null)).not.toThrow();
    expect(loadToken('local', 'd', NOW, null)).toBeNull();
    expect(() => clearToken('local', null)).not.toThrow();
  });
});
