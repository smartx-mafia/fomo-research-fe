import {describe, expect, it} from 'vitest';
import {sign} from 'viem/accounts';

import {hash7702Authorization, recoverSigner, sameAddress} from './adr0017';

/** anvil 的 1 号账户 —— 公开测试密钥，与任何真实资产无关。 */
const GOLDEN_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const GOLDEN_USER = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

/** Calibur —— 用户 EOA 通过 EIP-7702 委托过去的账户实现。全小写，理由见 `normalizeAddress`。 */
const CALIBUR_ADDRESS = '0x000000009b1d0af20d8c6d0a44e162d11f9b8f00';

/** 服务端信封里那份 32 字节摘要的位置，值本身是什么无所谓。 */
const DIGEST_A = '0xf19c130ed6c8b261796d20233cf851096855d0158bb6f94a4ea6a9fbdc29a6d8';
const DIGEST_B = '0xf9c860505b7341bf3eee5388dfa2bfa7984a6d37dd60272ba8751c184d15e486';

describe('ecrecover：签名到底是谁签的、签的是哪一份', () => {
  it('对信封里那份摘要签名，恢复出的地址等于该私钥的地址', async () => {
    const signature = await sign({hash: DIGEST_A, privateKey: GOLDEN_KEY, to: 'hex'});
    expect(await recoverSigner(DIGEST_A, signature)).toBe(GOLDEN_USER);
  });

  it('签的是另一份摘要时，恢复出的地址对不上 —— 这一条是签完必验的理由', async () => {
    // 「Privy 签了，但签的不是我们要的那个摘要」是这条路上最坏的一种失败：
    // HTTP 200、签名合法、服务端收得下，要到链上 AA24 才暴露，而那句话不指向
    // 根因。这条用例证明「签完就地 ecrecover」真的能把它抓住。
    const signature = await sign({hash: DIGEST_B, privateKey: GOLDEN_KEY, to: 'hex'});
    expect(await recoverSigner(DIGEST_A, signature)).not.toBe(GOLDEN_USER);
  });

  it('sameAddress 只比字节，不比大小写', () => {
    expect(sameAddress(GOLDEN_USER, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8')).toBe(true);
    expect(sameAddress(GOLDEN_USER, CALIBUR_ADDRESS)).toBe(false);
    expect(sameAddress(undefined, GOLDEN_USER)).toBe(false);
  });
});

describe('EIP-7702 授权摘要', () => {
  it('就是 keccak(0x05 ‖ rlp([chainId, address, nonce]))，32 字节', () => {
    const h = hash7702Authorization({chainId: 56, nonce: 7, address: CALIBUR_ADDRESS});
    expect(h.length).toBe(66);
  });

  it('chainId 或 nonce 变一位，摘要就是另一个 —— 授权在链上会是废纸而不报错', () => {
    const base = {chainId: 56, nonce: 7, address: CALIBUR_ADDRESS};
    expect(hash7702Authorization({...base, nonce: 8})).not.toBe(hash7702Authorization(base));
    expect(hash7702Authorization({...base, chainId: 8453})).not.toBe(hash7702Authorization(base));
  });

  it('地址大小写不进摘要 —— checksum 形态算出同一个数', () => {
    const lower = hash7702Authorization({chainId: 56, nonce: 7, address: CALIBUR_ADDRESS});
    const upper = hash7702Authorization({
      chainId: 56,
      nonce: 7,
      address: '0x000000009B1d0Af20d8c6d0A44E162D11f9B8F00',
    });
    expect(upper).toBe(lower);
  });
});
