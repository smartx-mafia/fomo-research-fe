import {createPublicKey, createVerify, generateKeyPairSync} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';

import {
  authPayload,
  authorizationSignature,
  canonicalize,
  configFromEnv,
  createPrivySigner,
  type PrivySignerConfig,
} from './privySign';

/**
 * 这两行**是 Go 那侧的真实输出**，不是照着规范推的。
 *
 * 产出办法：把后端仓 `privyLiveAuthSignature` 里那段规范化（`json.Encoder`
 * 加 `SetEscapeHTML(false)`，去掉尾部换行）单独跑一遍，打印结果。
 * 两侧必须逐字节一致，否则 Privy 只回一句「签名无效」，指不回键序这件事。
 *
 * 特意在 payload 里塞了 `<&>`：Go 默认会把它们转义成 `<` 这类，
 * 而那正是那边要关掉 HTML 转义的原因。这条用例把它钉住。
 */
const GO_SOLANA =
  '{"body":{"method":"signTransaction","params":{"encoding":"base64","transaction":"AAEC<&>"}},' +
  '"headers":{"privy-app-id":"app_1"},"method":"POST",' +
  '"url":"https://api.privy.io/v1/wallets/wal_1/rpc","version":1}';

const GO_EVM =
  '{"body":{"method":"secp256k1_sign","params":{"hash":"0xdeadBEEF"}},' +
  '"headers":{"privy-app-id":"app_2"},"method":"POST",' +
  '"url":"https://api.privy.io/v1/wallets/wal_2/rpc","version":1}';

describe('canonicalize 与 Go 那侧逐字节一致', () => {
  it('Solana 那份（含 < & > ，验的是不做 HTML 转义）', () => {
    const got = canonicalize(
      authPayload('https://api.privy.io/v1/wallets/wal_1/rpc', {
        method: 'signTransaction',
        params: {transaction: 'AAEC<&>', encoding: 'base64'},
      }, 'app_1'),
    );
    expect(got).toBe(GO_SOLANA);
  });

  it('EVM 那份', () => {
    const got = canonicalize(
      authPayload('https://api.privy.io/v1/wallets/wal_2/rpc', {
        method: 'secp256k1_sign',
        params: {hash: '0xdeadBEEF'},
      }, 'app_2'),
    );
    expect(got).toBe(GO_EVM);
  });

  it('键按字典序递归排序 —— JS 的 stringify 保持插入顺序，不排就对不上', () => {
    expect(canonicalize({b: 1, a: {d: 2, c: 3}})).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('数组保持原序，不排序', () => {
    expect(canonicalize({x: [3, 1, 2]})).toBe('{"x":[3,1,2]}');
  });

  it('undefined 的键整个消失，不编成 null', () => {
    expect(canonicalize({a: 1, b: undefined})).toBe('{"a":1}');
  });

  it('null 编成 null，不当成缺席', () => {
    expect(canonicalize({a: null})).toBe('{"a":null}');
  });

  it('字符串里的引号与反斜杠照 JSON 规则转义', () => {
    expect(canonicalize({a: 'x"y\\z'})).toBe('{"a":"x\\"y\\\\z"}');
  });
});

describe('authorizationSignature', () => {
  const {privateKey, publicKey} = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
    publicKeyEncoding: {type: 'spki', format: 'pem'},
  });

  it('签出来的东西用公钥验得过 —— 同时钉住「没有二次哈希」', () => {
    // Go 那侧是 sha256 之后 SignASN1(sum)；Node 的 createSign('SHA256') 自己
    // 做那一次哈希。要是这里先自己哈希一遍再签，验签在这条用例上就会红。
    const canonical = canonicalize(authPayload('https://x/y', {a: 1}, 'app'));
    const sig = authorizationSignature(canonical, privateKey);

    const v = createVerify('SHA256');
    v.update(canonical);
    v.end();
    expect(v.verify(createPublicKey(publicKey), sig, 'base64')).toBe(true);
  });

  it('改一个字节就验不过', () => {
    const sig = authorizationSignature('hello', privateKey);
    const v = createVerify('SHA256');
    v.update('hellp');
    v.end();
    expect(v.verify(createPublicKey(publicKey), sig, 'base64')).toBe(false);
  });

  it('产出是 base64，不是 hex', () => {
    expect(authorizationSignature('x', privateKey)).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

describe('configFromEnv', () => {
  it('三个都在就交回配置', () => {
    const cfg = configFromEnv({
      PRIVY_APP_ID: 'a',
      PRIVY_APP_SECRET: 'b',
      PRIVY_AUTHZ_KEY_PEM: 'c',
    });
    expect(cfg).toMatchObject({appId: 'a', appSecret: 'b', authzKeyPem: 'c'});
  });

  it('缺哪个说哪个 —— 只说「配置不全」的话人得回来读源码', () => {
    try {
      configFromEnv({PRIVY_APP_ID: 'a'});
      expect.unreachable();
    } catch (e) {
      const msg = String(e);
      expect(msg).toContain('PRIVY_APP_SECRET');
      expect(msg).toContain('PRIVY_AUTHZ_KEY_PEM');
      expect(msg).not.toContain('PRIVY_APP_ID  ');
    }
  });
});

describe('createPrivySigner', () => {
  const {privateKey} = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
    publicKeyEncoding: {type: 'spki', format: 'pem'},
  });

  const CFG: PrivySignerConfig = {
    appId: 'app_1',
    appSecret: 'secret_1',
    authzKeyPem: privateKey,
    apiBase: 'https://api.example.com/',
  };

  function stub(status: number, body: unknown) {
    return vi.fn(async () => ({
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    })) as unknown as typeof fetch;
  }

  it('EVM：打对 URL、带齐三个头、params 用的是 hash', async () => {
    const f = stub(200, {method: 'secp256k1_sign', data: {encoding: 'hex', signature: '0xsig'}});
    const s = createPrivySigner(CFG, {fetchImpl: f});

    await expect(s.signEvmDigest('wal_9', '0xdead')).resolves.toBe('0xsig');

    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    // 尾斜杠被削掉，不会拼出双斜杠。
    expect(call[0]).toBe('https://api.example.com/v1/wallets/wal_9/rpc');
    const init = call[1] as {headers: Record<string, string>; body: string};
    expect(init.headers['privy-app-id']).toBe('app_1');
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('app_1:secret_1').toString('base64')}`,
    );
    expect(init.headers['privy-authorization-signature']).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(JSON.parse(init.body)).toEqual({method: 'secp256k1_sign', params: {hash: '0xdead'}});
  });

  it('EVM：摘要少了 0x 当场拒，不发出去', async () => {
    // 发出去的话 Privy 报的是参数格式，看起来像摘要算错了。
    const f = stub(200, {data: {}});
    const s = createPrivySigner(CFG, {fetchImpl: f});
    await expect(s.signEvmDigest('wal_9', 'dead')).rejects.toThrow(/0x/);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('Solana：交回的是签好的整笔交易，不是那 64 字节', async () => {
    const f = stub(200, {data: {encoding: 'base64', signed_transaction: 'c2lnbmVk'}});
    const s = createPrivySigner(CFG, {fetchImpl: f});

    await expect(s.signSolanaTransaction('wal_8', 'dHg=')).resolves.toBe('c2lnbmVk');

    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {body: string};
    expect(JSON.parse(init.body)).toEqual({
      method: 'signTransaction',
      params: {transaction: 'dHg=', encoding: 'base64'},
    });
  });

  it('发出去的正文与被签的那份逐字节相同（键序一致）', async () => {
    const f = stub(200, {data: {signature: '0x1'}});
    const s = createPrivySigner(CFG, {fetchImpl: f});
    await s.signEvmDigest('wal_9', '0xaa');
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {body: string};
    expect(init.body).toBe(canonicalize({method: 'secp256k1_sign', params: {hash: '0xaa'}}));
  });

  it('401 带上「去补一次授权」的提示 —— 它的处置不是重试', async () => {
    const f = stub(401, '{"error":"unauthorized"}');
    const s = createPrivySigner(CFG, {fetchImpl: f});
    await expect(s.signEvmDigest('wal_9', '0xaa')).rejects.toThrow(/没挂 signer/);
  });

  it('别的非 200 不给那条提示，免得把人指向错的方向', async () => {
    const f = stub(500, 'boom');
    const s = createPrivySigner(CFG, {fetchImpl: f});
    await expect(s.signEvmDigest('wal_9', '0xaa')).rejects.toThrow(/HTTP 500/);
    await expect(s.signEvmDigest('wal_9', '0xaa')).rejects.not.toThrow(/没挂 signer/);
  });

  it('回包里没有想要的字段时报出原文，不交回 undefined', async () => {
    const f = stub(200, {data: {encoding: 'hex'}});
    const s = createPrivySigner(CFG, {fetchImpl: f});
    await expect(s.signEvmDigest('wal_9', '0xaa')).rejects.toThrow(/signature/);
  });

  it('成败都报一条耗时，且 Privy 这一段单独成类', async () => {
    const got: {method: string; ok: boolean; status?: number}[] = [];
    const okSigner = createPrivySigner(CFG, {
      fetchImpl: stub(200, {data: {signature: '0x1'}}),
      onTiming: (t) => got.push({method: t.method, ok: t.ok, status: t.status}),
    });
    await okSigner.signEvmDigest('wal_9', '0xaa');

    const badSigner = createPrivySigner(CFG, {
      fetchImpl: stub(500, 'boom'),
      onTiming: (t) => got.push({method: t.method, ok: t.ok, status: t.status}),
    });
    await expect(badSigner.signEvmDigest('wal_9', '0xaa')).rejects.toThrow();

    expect(got).toEqual([
      {method: 'secp256k1_sign', ok: true, status: 200},
      {method: 'secp256k1_sign', ok: false, status: 500},
    ]);
  });

  it('计时钩子抛错不影响签名本身', async () => {
    const s = createPrivySigner(CFG, {
      fetchImpl: stub(200, {data: {signature: '0x1'}}),
      onTiming: () => {
        throw new Error('记账那边炸了');
      },
    });
    await expect(s.signEvmDigest('wal_9', '0xaa')).resolves.toBe('0x1');
  });
});
