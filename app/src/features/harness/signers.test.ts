import {describe, expect, it} from 'vitest';

import {
  keyQuorumMissing,
  signerStatusLabel,
  signerStatusOf,
  type LinkedWalletLike,
} from './signers';

/**
 * 这份形状抄自 `@privy-io/react-auth` 的 `Wallet`（`types-*.d.ts`）：
 * `id` 是服务端签名要用的 wallet id，注释原话是「Null if the wallet is not
 * delegated」—— 也就是说 `delegated` 与 `id` 是同一件事的两个面。
 *
 * 钉的是**字段名与取值含义**，不是具体的串。
 */
const SOL = {
  type: 'wallet',
  address: 'So1anaAddress1111111111111111111111111111111',
  chainType: 'solana',
  delegated: false,
  id: null,
} satisfies LinkedWalletLike;

const EVM_DELEGATED = {
  type: 'wallet',
  address: '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01',
  chainType: 'ethereum',
  delegated: true,
  id: 'wal_abc123',
} satisfies LinkedWalletLike;

const EMAIL: LinkedWalletLike = {type: 'email'};

describe('keyQuorumMissing', () => {
  it('配了就没话说', () => {
    expect(keyQuorumMissing('kq_123')).toBeNull();
  });

  it('没配时把变量名原样写出来 —— 「点不亮」必须能照着做', () => {
    const why = keyQuorumMissing('');
    expect(why).toContain('VITE_PRIVY_KEY_QUORUM_ID');
  });
});

describe('signerStatusOf', () => {
  it('读得出未授权钱包：delegated 假，wallet id 缺席', () => {
    const s = signerStatusOf([EMAIL, SOL], SOL.address);
    expect(s).toEqual({address: SOL.address, delegated: false, walletId: null});
  });

  it('读得出已授权钱包，并把 wallet id 交出来', () => {
    // wallet id 只有这一个地方看得见，而 Node 侧签名寻址要的就是它。
    const s = signerStatusOf([EMAIL, SOL, EVM_DELEGATED], EVM_DELEGATED.address);
    expect(s).toEqual({
      address: EVM_DELEGATED.address,
      delegated: true,
      walletId: 'wal_abc123',
    });
  });

  it('EVM 地址大小写不敏感 —— 逐字符比会把已授权的钱包判成没找到', () => {
    const s = signerStatusOf([EVM_DELEGATED], EVM_DELEGATED.address.toLowerCase());
    expect(s?.delegated).toBe(true);
  });

  it('非钱包类的账号一概跳过，不会被地址匹配误伤', () => {
    expect(signerStatusOf([EMAIL], 'whatever')).toBeNull();
  });

  it('查不到交回 null，而不是一个 delegated=false 的壳', () => {
    // 两者的处置不同：查不到是配置问题（钱包没建 / 换了环境换了一套用户），
    // 未授权点一下就好。混成一个值的话，前者会被人当后者去点按钮。
    expect(signerStatusOf([SOL], EVM_DELEGATED.address)).toBeNull();
  });

  it('地址为空时交回 null，不去猜第一只', () => {
    expect(signerStatusOf([SOL], undefined)).toBeNull();
  });

  it('账号列表缺席时不抛', () => {
    expect(signerStatusOf(undefined, SOL.address)).toBeNull();
  });

  it('delegated 字段缺席按未授权算，不按已授权算', () => {
    // 兜底方向必须保守：把未知当成已授权，人就不会去点那一下，
    // 然后在脚本跑起来之后才发现签不了。
    const s = signerStatusOf([{type: 'wallet', address: 'x'}], 'x');
    expect(s?.delegated).toBe(false);
  });
});

describe('signerStatusLabel', () => {
  it('查不到与未授权是两句话，不合并', () => {
    expect(signerStatusLabel(null)).toBe('查不到这只钱包');
    expect(signerStatusLabel({address: 'x', delegated: false, walletId: null})).toBe('未授权');
  });

  it('已授权就说已授权', () => {
    expect(signerStatusLabel({address: 'x', delegated: true, walletId: 'wal_1'})).toBe('已授权');
  });

  it('已授权但没拿到 wallet id 要单独说 —— 那时服务端签名会寻不到址', () => {
    const label = signerStatusLabel({address: 'x', delegated: true, walletId: null});
    expect(label).toContain('wallet id');
  });
});
