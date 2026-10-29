import {describe, expect, it} from 'vitest';

import {decodeJwtPayload, humanDuration, secondsLeft} from './jwt';

/** 拼一个只有 payload 有意义的 JWT。**签名段是假的** —— 这里从不验签。 */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))))
    // base64url：JWT 用的是 url-safe 变体。
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${b64}.signature`;
}

describe('decodeJwtPayload', () => {
  it('解得出 identifier —— 本站 JWT 没有 sub，用户键叫这个', () => {
    const p = decodeJwtPayload(fakeJwt({identifier: 'abc123', exp: 42}));
    expect(p?.identifier).toBe('abc123');
    expect(p?.exp).toBe(42);
  });

  // base64url 里的 - 与 _ 直接喂 atob 会抛 InvalidCharacterError。
  // 不处理的话，只有**部分** token 解不开 —— 而那种间歇性最难查。
  it('吃得下 base64url 的 - 与 _', () => {
    // 这个 payload 编出来必然含 url-safe 字符。
    const p = decodeJwtPayload(fakeJwt({identifier: '~~~???>>><<<', n: 1}));
    expect(p?.identifier).toBe('~~~???>>><<<');
  });

  it('非 ASCII 不乱码', () => {
    expect(decodeJwtPayload(fakeJwt({nickname: '中文昵称'}))?.nickname).toBe('中文昵称');
  });

  it.each(['', 'notajwt', 'a.b', 'a.!!!.c'])('解不出来一律 null：%j', (bad) => {
    expect(decodeJwtPayload(bad)).toBeNull();
  });
});

describe('secondsLeft', () => {
  it('按给定的 now 算，不依赖真实时钟', () => {
    const p = decodeJwtPayload(fakeJwt({exp: 1_000_100}));
    expect(secondsLeft(p, 1_000_000_000)).toBe(100);
  });

  // **没有 exp 不等于已过期。** 折成 0 的话页面会显示"已过期"，
  // 然后人去重新登录 —— 而那个 token 好好的。
  it('没有 exp 交回 null，不是 0', () => {
    expect(secondsLeft(decodeJwtPayload(fakeJwt({identifier: 'x'})))).toBeNull();
    expect(secondsLeft(null)).toBeNull();
  });
});

describe('humanDuration', () => {
  it.each([
    [null, '未知'],
    [0, '已过期'],
    [-5, '已过期'],
    [30, '30 秒'],
    [90, '1 分钟'],
    [3_700, '1 小时 1 分'],
    [90_000, '1 天 1 小时'],
  ])('%s → %s', (sec, want) => {
    expect(humanDuration(sec)).toBe(want);
  });
});
