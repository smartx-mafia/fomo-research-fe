import {describe, expect, it} from 'vitest';

import {formatUnits} from './balance';
import {
  checkDestination,
  decodeBase58,
  encodeBase58,
  isSolanaAddress,
  parseUnits,
} from './transfer';

// 这一批用例守的是**转错钱**，不是"函数写得对不对"。每条断言的失败信息
// 都写清了放过它会亏在哪里。

const WALLET = 'D89B3RvG2UChpSyPkg7FNC3NC3hdZq79JLCwRfk25Tdu';
const DEST = 'AR3DWmCyV17KRqbaKtEMKwgi1hQWFmNSUDTojMhuEafc';
/** 系统 program：32 个零字节，base58 写出来是 32 个 `1`。前导零的边界样本。 */
const SYSTEM = '11111111111111111111111111111111';

describe('parseUnits：小数位', () => {
  it('整数与小数都按 decimals 补齐到最小单位', () => {
    expect(parseUnits('6.486828', 6)).toBe(6486828n);
    expect(parseUnits('1', 6)).toBe(1000000n);
    expect(parseUnits('0.000001', 6)).toBe(1n);
    expect(parseUnits('.5', 6)).toBe(500000n);
  });

  it('小数位超过 decimals 必须报错，不能截断', () => {
    // 截断是这里唯一会**少转钱**的错法，而它不报错：页面正常、链上成功，
    // 只是到账比用户输的少。宁可让他重输一次。
    expect(() => parseUnits('1.2345678', 6)).toThrow(/只有 6 位/);
  });

  it('与 formatUnits 互为逆运算', () => {
    // 两个方向各写各的话，迟早只有一个是对的。
    for (const raw of [0n, 1n, 999999n, 6486828n, 165527778286n]) {
      expect(parseUnits(formatUnits(raw, 6), 6)).toBe(raw);
    }
  });

  it('decimals 为 0 的 token 不接受任何小数位', () => {
    expect(parseUnits('42', 0)).toBe(42n);
    expect(() => parseUnits('4.2', 0)).toThrow(/只有 0 位/);
  });

  it('大数不经过浮点', () => {
    // 21 位十进制装不进 JS 的 number。走 Number 的实现会在这里丢末几位，
    // 而丢掉的部分看起来像手续费。
    expect(parseUnits('123456789012345.678901', 6)).toBe(123456789012345678901n);
  });
});

describe('parseUnits：拒绝会被猜错的输入', () => {
  it.each([
    ['', /不能为空/],
    ['   ', /不能为空/],
    ['abc', /不是十进制数字/],
    ['-1', /不是十进制数字/],
    ['1e6', /不是十进制数字/],
    ['1,000', /不是十进制数字/],
    ['1.2.3', /不是十进制数字/],
    ['.', /不是十进制数字/],
  ])('拒绝 %o', (input, want) => {
    // 这些输入都有"看起来解析对了"的解法（-1 取绝对值、1e6 展开、
    // 千分位去逗号），而任何一种猜测都可能把金额改成另一个数。
    expect(() => parseUnits(input, 6)).toThrow(want);
  });

  it('前后空白允许，中间不允许', () => {
    expect(parseUnits('  1.5  ', 6)).toBe(1500000n);
    expect(() => parseUnits('1 5', 6)).toThrow(/不是十进制数字/);
  });
});

describe('decodeBase58：前导零', () => {
  it('前导 1 必须解成零字节，不能被大整数吃掉', () => {
    // 按权展开算出来是 0（一个字节）。漏了数前导 1 的那一步，
    // 这个合法地址会被判成非法 —— 而它恰恰是最特殊的那几个之一。
    const b = decodeBase58(SYSTEM);
    expect(b).not.toBeNull();
    expect(b!.length).toBe(32);
    expect([...b!].every((x) => x === 0)).toBe(true);
  });

  it('普通地址解出 32 字节', () => {
    expect(decodeBase58(DEST)!.length).toBe(32);
    expect(decodeBase58(WALLET)!.length).toBe(32);
  });

  it('非 base58 字符回 null 而不是抛', () => {
    // 输入框每按一次键都会问它，抛异常会把页面打崩。
    expect(decodeBase58('0OIl')).toBeNull();
    expect(decodeBase58('')).toBeNull();
  });
});

describe('isSolanaAddress', () => {
  it('认合法地址', () => {
    expect(isSolanaAddress(DEST)).toBe(true);
    expect(isSolanaAddress(SYSTEM)).toBe(true);
    expect(isSolanaAddress(`  ${DEST}  `)).toBe(true);
  });

  it('拒绝长度不是 32 字节的东西', () => {
    expect(isSolanaAddress(`${DEST}A`)).toBe(false); // 33 字节
    expect(isSolanaAddress(DEST.slice(0, 30))).toBe(false); // 太短
    expect(isSolanaAddress('deadbeef')).toBe(false);
  });

  it('**挡不住「粘贴少一位」** —— 这条用例记录的是缺口，不是能力', () => {
    // 44 个 base58 字符去掉一个，解出来**仍然可能是 32 字节**：43 个字符
    // 最大约 2^251.8，照样落在 32 字节区间里。所以「长度对」不等于
    // 「地址是你想的那个」。
    //
    // 这不是可以修的 —— 任意 32 字节都是一个语法合法的 Solana 地址，
    // 离线无从判断它是不是收款人想要的那个。真正挡这一类错的是
    // fetchDestInfo 的**链上存在性**：手滑出来的地址几乎必然查无此账户。
    // 那道闸在 UI 上必须显眼，否则这里就是个洞。
    expect(isSolanaAddress(DEST.slice(0, -1))).toBe(true);
    expect(decodeBase58(DEST.slice(0, -1))!.length).toBe(32);
  });
});

describe('checkDestination：转错钱之前唯一的一道闸', () => {
  it('放行一个合法的、不是自己的地址', () => {
    expect(checkDestination(DEST, WALLET)).toEqual({ok: true});
  });

  it('拒绝自转', () => {
    // 自转不亏本金，但会白付手续费，且表现成"转成功了、余额没变"——
    // 那看起来像转账没生效，人会再点一次。
    const r = checkDestination(WALLET, WALLET);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.why).toMatch(/自己/);
  });

  it('自转判定忽略前后空白', () => {
    // 粘贴常常带空白。不 trim 的话这道闸会被一个空格绕过去。
    expect(checkDestination(`  ${WALLET}`, `${WALLET}  `).ok).toBe(false);
  });

  it('拒绝空地址与非法地址', () => {
    expect(checkDestination('', WALLET).ok).toBe(false);
    expect(checkDestination(DEST.slice(0, 30), WALLET).ok).toBe(false);
  });
});

describe('encodeBase58：与解码互为逆运算', () => {
  it('往返闭合，含前导零字节', () => {
    // 前导零只有一侧处理的话，往返不闭合，而症状是**偶尔**有一笔交易链接
    // 点不开（零字节开头的签名约 1/256）—— 这种偶发最难查。
    for (const s of [DEST, WALLET, SYSTEM]) {
      expect(encodeBase58(decodeBase58(s)!)).toBe(s);
    }
    const withZeros = new Uint8Array([0, 0, 7, 255, 1]);
    expect(decodeBase58(encodeBase58(withZeros))).toEqual(withZeros);
  });

  it('空字节数组编成空串', () => {
    expect(encodeBase58(new Uint8Array())).toBe('');
  });
});
