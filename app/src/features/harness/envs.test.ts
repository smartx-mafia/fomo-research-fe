import {describe, expect, it} from 'vitest';

import {ENVS, pickEnv, type HarnessEnv} from './envs';
import {API_PREFIX, CURRENT_ENV} from './envs.browser';

// 这一组守的是**"选了却没生效"**这一类：它们全都不报错，只是页面对着另一个
// 后端跑，而下单那一步会真的花钱。所以每一条落空的路径都必须留下一句人话
// （`dropped`），而不是安静地退回默认档。

const LOCAL: HarnessEnv = {
  key: 'local',
  label: '本机',
  privyAppId: 'app-local',
  apiPrefix: '',
  originLabel: 'http://127.0.0.1:8080',
  missing: null,
};

const TEST: HarnessEnv = {
  key: 'test',
  label: '测试环境',
  privyAppId: 'app-test',
  apiPrefix: '/test-env',
  originLabel: 'https://sm-test-api.smartx.io',
  missing: null,
};

/** 没配 app id 的那一档。**总开关是 missing，不是 privyAppId 为空**。 */
const TEST_UNCONFIGURED: HarnessEnv = {...TEST, privyAppId: '', missing: 'VITE_TEST_PRIVY_APP_ID'};

describe('pickEnv', () => {
  it('没选过 = 默认档，且不算异常', () => {
    const r = pickEnv(null, [LOCAL, TEST]);
    expect(r.env).toBe(LOCAL);
    expect(r.dropped).toBeNull();
  });

  it('选了测试环境就给测试环境，前缀跟着换', () => {
    const r = pickEnv('test', [LOCAL, TEST]);
    expect(r.env).toBe(TEST);
    expect(r.env.apiPrefix).toBe('/test-env');
    expect(r.dropped).toBeNull();
  });

  // 存量键：localStorage 里那个串是上一版写下的，改档名/删档时它还在。
  it('认不出的键退回默认档，**并说出来**', () => {
    const r = pickEnv('staging', [LOCAL, TEST]);
    expect(r.env).toBe(LOCAL);
    expect(r.dropped).toContain('staging');
  });

  // 这一条是整组里最要紧的：人在页面上选过测试环境，之后 .env.local 里那行
  // 被删了/换机器了。静默退回的表现是"我明明选了测试环境，可单还是进了本机"，
  // 而顶栏显示的确实是本机 —— 两条信息不矛盾，于是没人会去怀疑它。
  it('选中的那一档缺配置：退回默认档，并写出缺的是哪个变量', () => {
    const r = pickEnv('test', [LOCAL, TEST_UNCONFIGURED]);
    expect(r.env).toBe(LOCAL);
    expect(r.dropped).toContain('VITE_TEST_PRIVY_APP_ID');
  });

  it('存的就是默认档时不去查表，也不产生 dropped', () => {
    const r = pickEnv('local', [LOCAL, TEST_UNCONFIGURED]);
    expect(r.env).toBe(LOCAL);
    expect(r.dropped).toBeNull();
  });
});

describe('环境表本身', () => {
  it('键不重复，且默认档的前缀是空串', () => {
    expect(new Set(ENVS.map((e) => e.key)).size).toBe(ENVS.length);
    expect(ENVS[0]!.apiPrefix).toBe('');
  });

  // 非默认档**必须有前缀**：前缀是它与默认档在网络上唯一的区别，空了就等于
  // 两档都打同一个后端，而页面上那个开关照样显示切过去了。
  it('非默认档都带一个非空前缀', () => {
    for (const e of ENVS.slice(1)) {
      expect(e.apiPrefix).not.toBe('');
      expect(e.apiPrefix.startsWith('/')).toBe(true);
    }
  });

  it('API_PREFIX 就是当前档的前缀（api.ts 只认这一个）', () => {
    expect(API_PREFIX).toBe(CURRENT_ENV.apiPrefix);
  });
});
