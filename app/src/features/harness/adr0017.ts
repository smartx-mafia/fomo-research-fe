// EVM 签名的通用小工具：地址比对、ecrecover、EIP-7702 授权摘要。
//
// 文件名是历史（v1 时这里是 ADR-0017 的 `sign_kind=5` 信封）。v1 的信封解析与回签
// 已随 v1 一起删掉（2026-09-17）；Fast Swap v2 的签前 / 签后核对在
// `src/fastswap/verify.ts`，它复用这里的三个原语。
//
// # 为什么签完必须 ecrecover
//
// 「Privy 签了，但签的不是我们要的那个摘要」HTTP 200、签名格式合法、页面上一片绿，
// **要到链上才暴露**。所以每一次签名后都要恢复出签名者，必须等于钱包地址。
//
// # 依赖：viem 从哪儿来
//
// viem 不在 package.json 里，它是 `@privy-io/react-auth` 的**直接依赖**，被 npm
// 提升到顶层，package-lock 里钉在 `node_modules/viem`。故意不往 package.json 里
// 加一行：那会让 package.json 与 lock 失去同步，`npm ci` 当场拒绝安装。

import {recoverAddress, type Hex} from 'viem';
import {hashAuthorization} from 'viem/utils';

/**
 * 地址一律小写化后再比对或交给 viem。
 *
 * **不是风格选择。** viem 对**混合大小写**的地址做 EIP-55 校验，对不上就抛
 * `InvalidAddressError`，而从文档/回包里抄来的地址大小写未必是合法 checksum。
 * 全小写在 EIP-55 下恒合法，且**地址的大小写根本不进摘要**（ABI 编码只认那
 * 20 个字节），所以小写化不改变任何一个 hash。
 */
export function normalizeAddress(a: string): string {
  return a.toLowerCase();
}

/**
 * 对**我们自己算出来的摘要**做 ecrecover。
 *
 * 刻意不用 viem 的 `recoverTypedDataAddress`：那个函数会自己再算一遍摘要，
 * 于是"Privy 签的是不是我们算的那一份"这个问题被它绕过去了 —— 我们要验的
 * 恰恰是这一条。传进来的 `digest` 必须是服务端信封里那一份（`digestFromBase64`
 * 解出来的），不是照着 message 重算的另一个。
 */
export async function recoverSigner(digest: Hex, signature: string): Promise<string> {
  return normalizeAddress(await recoverAddress({hash: digest, signature: signature as Hex}));
}

/** 两个地址是不是同一个。大小写不算差异 —— EIP-55 只是显示层的校验码。 */
export function sameAddress(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && normalizeAddress(a) === normalizeAddress(b);
}

// ---------------------------------------------------------------------------
// EIP-7702 授权
// ---------------------------------------------------------------------------

/**
 * 一张 7702 授权的三件套。
 *
 * `address` 是**被委托的合约地址**（Calibur），不是签名者 —— viem 的
 * `Authorization` 类型原话是 "Address of the contract to delegate to"。
 * 把它当成钱包地址去比对，会得到一个恒不相等的结论，然后有人去查密钥。
 */
export type Authorization7702 = {
  chainId: number;
  nonce: number;
  address: string;
};

/**
 * 授权摘要 `keccak256(0x05 ‖ rlp([chainId, address, nonce]))`。
 *
 * Fast Swap v2 签后核对用它恢复 7702 授权的签名者（`src/fastswap/verify.ts` 的 evmPostSign）。
 * 三件套里任一项不对，授权在链上就是一张废纸，而它**不会报错**。
 */
export function hash7702Authorization(auth: Authorization7702): Hex {
  return hashAuthorization({
    address: normalizeAddress(auth.address) as Hex,
    chainId: auth.chainId,
    nonce: auth.nonce,
  });
}
