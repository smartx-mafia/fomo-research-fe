/**
 * 给 embedded 钱包挂一把 **signer**，让服务端能代替用户签名。
 *
 * # 这是「脚本不用开浏览器」的那把钥匙
 *
 * 钥匙在 Privy 的 embedded 钱包里，服务端拿 app 凭据直接去签会被回 401 ——
 * 但那个 401 的成因是**这只钱包上没有任何 signer**，不是架构上不可能。
 * 用户在浏览器里授权一次（就是本文件的 `addSigners`），把一个 key quorum
 * 挂到钱包上之后，服务端用那把授权私钥就能代签，用户不需要在线、也不需要
 * 每次确认。
 *
 * > 本仓 README 里「服务端签不动 embedded 钱包 / 绕不过一个真浏览器」那句
 * > 话据此是**错的**，它把「没授权」记成了「不可能」。留着这段注释是因为
 * > 那个结论曾经让整条无人值守的路被判了死刑。
 *
 * # 硬前提：app 必须是 TEE 模式
 *
 * Privy 要求 app 开启 TEE execution 才能用 signers。查法是打它的公开 app
 * 配置端点（`oauth.ts` 里已经在打同一个），看 `embedded_wallet_config.mode`
 * 是不是 `user-controlled-server-wallets-only`。本仓两个 app 都已经是。
 *
 * # 为什么两只钱包要各授权一次
 *
 * signer 挂在**钱包**上，不是挂在用户上。EVM 与 Solana 是两只独立的 embedded
 * 钱包，授权了一只不会让另一只也能被代签。只授权一只的症状是「买入能跑、
 * 卖出签不了」（买入的第一笔链上动作恒在 Solana，卖出才落到 EVM），
 * 而那看起来像卖出这条链路坏了。
 *
 * # 为什么状态读 `linkedAccounts` 而不是 `useWallets()`
 *
 * 与 `App.tsx` 里读 `walletIndex` 同一个理由：`delegated` 和 `id` 这两个字段
 * **不在 `useWallets()` 交回的对象上**，只在 `user.linkedAccounts` 里。
 * 其中 `id` 是服务端签名要用的 wallet id，而它**只有授权之后才有值** ——
 * 也就是说页面上那一行既是状态，又是下一个环节的输入。
 */

import {useCallback, useMemo} from 'react';
import {usePrivy, useSigners} from '@privy-io/react-auth';

/**
 * 要挂上去的 key quorum id。**不给默认值。**
 *
 * 填一个猜的值，症状是授权请求被 Privy 拒掉，而错误文案指向 Privy ——
 * 真相却是这一档根本没配。没配就禁用按钮并把变量名写在旁边，
 * 这是 `envs.ts` 那套做法，照抄。
 */
export const KEY_QUORUM_ID: string = process.env.NEXT_PUBLIC_HARNESS_KEY_QUORUM_ID ?? '';

/** 没配时按钮为什么点不亮 —— 一句能直接照着做的话。null = 配好了。 */
export function keyQuorumMissing(id: string = KEY_QUORUM_ID): string | null {
  return id
    ? null
    : '缺 VITE_PRIVY_KEY_QUORUM_ID —— 在 Privy 控制台 Authorization keys 里注册一个 key quorum，把它的 id 写进 .env.local 并重启 dev server';
}

/**
 * `user.linkedAccounts` 里一条钱包记录的**最小形状**。
 *
 * 刻意不引 Privy 的 `WalletWithMetadata`：那个类型跟着 SDK 版本走，而这里
 * 真正依赖的只有这四个字段。用结构类型让纯函数能在测试里被裸对象喂。
 */
export type LinkedWalletLike = {
  type: string;
  address?: string;
  chainType?: string;
  /** 有没有挂 signer。只对 embedded 钱包有意义。 */
  delegated?: boolean;
  /** 服务端签名要用的 wallet id。**没授权时为 null** —— 这是它的判据之一。 */
  id?: string | null;
};

export type SignerStatus = {
  address: string;
  /** 已授权 = 服务端可代签。 */
  delegated: boolean;
  /**
   * 服务端签名要用的 wallet id。未授权时为 null。
   *
   * 页面上要把它显示出来：03 号那条路（Node 侧调 Privy 签名接口）拿地址是
   * 寻不到址的，要的就是这个 id，而它除了这里没有别的地方看得见。
   */
  walletId: string | null;
};

/**
 * 按地址在 `linkedAccounts` 里找这只钱包的授权状态。
 *
 * 地址大小写不敏感：EVM 地址在不同来源里大小写混杂（校验和格式 vs 全小写），
 * 逐字符比的话会把同一只钱包判成「没找到」，而页面显示的是「未授权」——
 * 一个已经授权好的钱包被显示成没授权，人会去点第二次。
 *
 * 找不到交回 null，而不是一个 `delegated: false` 的壳：两者的处置不同，
 * 「这只钱包不在账号里」是配置问题，「在但没授权」点一下就好。
 */
export function signerStatusOf(
  accounts: readonly LinkedWalletLike[] | undefined,
  address: string | undefined,
): SignerStatus | null {
  if (!address) return null;
  const want = address.toLowerCase();
  for (const a of accounts ?? []) {
    if (a.type !== 'wallet' || !a.address) continue;
    if (a.address.toLowerCase() !== want) continue;
    return {address: a.address, delegated: a.delegated === true, walletId: a.id ?? null};
  }
  return null;
}

/**
 * 一句话概括当前状态，给徽章旁边用。
 *
 * **「查不到这只钱包」与「未授权」要分开说。** 合并成一句「未授权」的话，
 * 前者那种（钱包没建、或者切了环境所以换了一套用户）会被当成后者，
 * 人点授权按钮，然后得到一个指向 Privy 的报错。
 */
export function signerStatusLabel(s: SignerStatus | null): string {
  if (!s) return '查不到这只钱包';
  if (!s.delegated) return '未授权';
  return s.walletId ? '已授权' : '已授权（但没拿到 wallet id，服务端签名会寻不到址）';
}

export type WalletSigners = {
  /** 没配 key quorum 时的原因，null = 可用。 */
  missing: string | null;
  statusOf: (address: string | undefined) => SignerStatus | null;
  /** 给这只钱包挂上 signer。 */
  authorize: (address: string) => Promise<void>;
  /** 摘掉这只钱包上的 signer。**是全量摘除**，见下面注释。 */
  revoke: (address: string) => Promise<void>;
};

export function useWalletSigners(): WalletSigners {
  const {user} = usePrivy();
  const {addSigners, removeSigners} = useSigners();

  const accounts = user?.linkedAccounts as readonly LinkedWalletLike[] | undefined;

  const statusOf = useCallback(
    (address: string | undefined) => signerStatusOf(accounts, address),
    [accounts],
  );

  const authorize = useCallback(
    async (address: string) => {
      const why = keyQuorumMissing();
      // 在这里拦一道，而不是只靠按钮 disabled：按钮会被别的调用路径绕过，
      // 而绕过之后 Privy 收到的是一个空 signerId，回的错指向它那边。
      if (why) throw new Error(why);
      await addSigners({
        address,
        // **policyIds 留空 = 全权限。** 这里之所以还是交空数组，是因为策略
        // 建在 Privy 控制台上、按 key quorum 生效；真要限权就在控制台那条
        // 策略里限，而不是在这行代码里挑 —— 挑在这里的话，换一个调用点就
        // 漏一次，而漏掉的表现是「这把钥匙能签的东西比想的多」。
        signers: [{signerId: KEY_QUORUM_ID, policyIds: []}],
      });
    },
    [addSigners],
  );

  const revoke = useCallback(
    async (address: string) => {
      // **Privy 这个接口是全量摘除**：它摘掉这只钱包上的所有 signer，
      // 不是只摘我们挂的那一个。页面上要把这句写出来，否则多方共用一只
      // 钱包时，点一下会连别人的授权一起摘掉，而那件事不会有任何提示。
      await removeSigners({address});
    },
    [removeSigners],
  );

  return useMemo(
    () => ({missing: keyQuorumMissing(), statusOf, authorize, revoke}),
    [statusOf, authorize, revoke],
  );
}
