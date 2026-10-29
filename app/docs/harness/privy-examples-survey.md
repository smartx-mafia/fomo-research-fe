> **归档文档 —— 原样搬入，未逐句校订。**
>
> 来源：`web-embedded-harness` 仓库的 `privy-examples-survey.md`（归档时 HEAD `15670e5`），于 **2026-09-18** 迁入
> `fomo-research-fe/app/docs/harness/`。
>
> 正文**一个字未改**，为的是能与归档仓库逐行对照。代价是：其中关于 **Vite / `vite.config.ts` proxy /
> `import.meta.env.VITE_*` / `npm run dev` / dist 构建与部署**的描述**已不适用于本仓库**。
> 迁移后的现状、以及若干已被实测推翻的说法，一律以同目录的
> [`migration-notes.md`](./migration-notes.md) 为准；迁移方案见
> [`migration-spec.md`](./migration-spec.md)。
>
> ——以下为归档原文——

# privy-io/examples 调研：哪些能直接搬进这个 harness，哪些不能

> 这份文件放在 harness 仓根目录，不进 smartx-backend 的 `docs/research/` —— 那个目录的 README 第 2 条写着
> 「"我读了一遍某个库的源码"不进这里」，而本次调研正是读源码（逐个例子读 `package.json` 与 `.tsx`）。
> harness 仓的 markdown 惯例本来就是根目录（`README.md` 36KB 在这儿）。

**调研对象**：`https://github.com/privy-io/examples`，分支 `main`，commit
`cf0ef34ebb508aee153165d4ad7137315d1c0daa`（2026-09-01 `react-auth: use stable cards SDK release (#174)`）。
`git clone --depth 1` 到
`/private/tmp/claude-501/-Users-lucifer-workspace-smartx-meme-smartx-backend/d7bdbe38-8cbb-4812-b8b1-b6cedfbdea3b/scratchpad/examples`，
**没有删**（scratchpad 是会话级目录，会随会话回收；要复核可直接进去 grep）。
下文凡写 `文件:行号` 的都是那份 clone 或本仓 `node_modules` 里的真实行号，凡写 URL 的都指向上述 commit 所在的 `main`。

---

## ① 一句话结论

**P0（custom JWT 登录/link）在这个仓里是零覆盖 —— 一行都没有，省不到任何事；P1（Solana SPL 转账）只能省下"用 kit 组交易 + 调
`useSignTransaction`"那 30 行骨架，SPL / ATA / Token-2022 / 客户端广播四件事全部没有；P2 的第一问被一份类型定义当场答死（`useSignRawHash`
签不了 EVM 钱包，官方 starter 自己走的就是我们已经在用的 `secp256k1_sign`），第二问（7702）零覆盖。**

换算成工作量：这个仓能替我们省的大约是**半天的 kit API 摸索**，代价是要先绕开一个 license 坑（最像我们的那个 starter 没有 LICENSE 文件）。
它更大的价值在**反证**：三件我们没底的事（重复 link 怎么办、`useSignRawHash` 能不能签 EVM、7702 在无弹窗下怎么写），官方示例里两件没有、一件给出了
"不要用那条路"的答案 —— 这比"没查过"强得多。

仓库构成（`README.md` 与目录树）：根目录 9 个 starter + `examples/` 下 20 个专题例子，共 29 个工程。
其中 web + `@privy-io/react-auth` 的有 21 个，**纯客户端（非 Next.js）的只有 2 个**：`privy-react-starter` 与
`examples/privy-react-chrome-extension`（后者是前者的 Chrome 扩展改版，文件几乎逐字相同）。

---

## ② P0 —— custom JWT 的登录与 link

### 事实：零覆盖

在整个 clone 上跑 grep（排除 `node_modules`），以下关键词**命中数全部为 0**：

| 关键词 | 命中 |
|---|---|
| `linkWithCustomJwt` | 0 |
| `useLinkJwtAccount` | 0 |
| `useSubscribeToJwtAuthWithFlag` | 0 |
| `useSyncJwtBasedAuthState` | 0 |
| `useCustomAuth` | 0 |
| `customUserId` | 0 |

唯一与 custom auth 沾边的两处是 **Expo（移动端）** 的用户对象窄化：

- `privy-expo-starter/components/UserScreen.tsx:32-34` —— `if (x.type === "custom_auth") { return x.custom_user_id; }`
  （<https://github.com/privy-io/examples/blob/main/privy-expo-starter/components/UserScreen.tsx#L32-L34>）
- `privy-expo-bare-starter/components/UserScreen.tsx:27`（同形）

**这两行恰好是我们踩过的那条大小写坑的旁证，但方向要读对**（下面这段来自本仓 `node_modules`，是 3.38.0 的真实类型，不是猜）：

| 面 | 字段名 | 出处 |
|---|---|---|
| web SDK 的 `user.linkedAccounts` | `customUserId`（camelCase） | `node_modules/@privy-io/react-auth/dist/dts/types-Ck8tvlPZ.d.ts:1307-1310`，`interface CustomJwtAccount { /** The user ID given by the custom auth provider */ customUserId: string; }` |
| REST / 回包形状 | `custom_user_id`（snake_case），`type: 'custom_auth'` | `node_modules/@privy-io/react-auth/dist/dts/index.d.ts:1705-1711`，`interface ResponseCustomJwtAccount { type: 'custom_auth'; custom_user_id: string; ... }` |
| Expo SDK 的 `user.linked_accounts` | `custom_user_id` | 上面那两个 UserScreen |

也就是说：**判断"某个 custom_auth 账号存在"在 web 侧要写
`user.linkedAccounts.some(a => a.type === 'custom_auth' && a.customUserId === ourUserId)`，
而示例仓里能抄到的那一行是 Expo 的 snake_case 版本 —— 照抄进 web 会静默拿到 `undefined`**（TS 在 union 窄化后会报错，但如果谁写了
`as any` 或从 REST 回包里取，就不报错了）。这条坑示例仓不但没有帮我们避开，还提供了一个抄错就中招的样本。

**重复 link（已 link 过的用户再次登录）：整个仓库没有任何证据。** 官方 SDK 的类型只给了
`linkWithCustomJwt: (jwt: string) => Promise<{user: User}>`（`index.d.ts:3888-3900`）与一个 `state: JwtAuthFlowState`，
没有"已存在"分支的说明；`useLinkJwtAccount(callbacks?: PrivyEvents['linkAccount'])`（`index.d.ts:3911`）只有 onSuccess/onError。
**这一格仍然只能靠我们自己实跑**（预期：对已 link 的同一 subject 再调一次要么幂等成功、要么回一个 already-linked 错误 —— 【未确认】，
必须实测，且实测结果值得写进 README，因为它是这个仓里查不到的东西）。

### 可搬的最小单元（P0）

| 来源 | 行数 | 它给了什么 | 落进我们工程要改什么 |
|---|---|---|---|
| `privy-react-whitelabel-starter/app/components/OAuth.tsx:9-25,35-37` | 约 20 行 | **无 Privy 模态的 Google 登录**：`useLoginWithOAuth({onComplete, onError})` + `initOAuth({provider: 'google'})`，`onComplete` 回参含 `isNewUser` / `wasAlreadyAuthenticated` / `loginMethod` | ① 这是 **headless 重定向流**，不是 `usePrivy().login()` 模态 —— 两条路二选一，见下方注；② 去掉 `'use client'`；③ 该 starter 的 `useOAuthTokens`（27-31 行）我们不需要，删 |
| `examples/privy-next-permissionless/src/providers/providers.tsx:33-45` | 约 12 行 | `loginMethods: ["email","google"]` 与 `embeddedWallets.showWalletUIs:false` **同时**出现的一份真实配置 | 我们的 `src/main.tsx` 已有 `showWalletUIs:false`，只需补 `loginMethods: ['google']`；该文件里的 `defaultChain: baseSepolia` 与 `@ts-ignore` 不要抄 |

> **注（这是本节唯一需要做的决策）**：`usePrivy().login()` + `loginMethods:['google']` 弹的是 Privy 的登录模态；
> `useLoginWithOAuth().initOAuth({provider:'google'})` 是**整页跳走再跳回**的重定向流，没有 Privy UI。
> 我们已经把 `showWalletUIs:false` 定成产品语义（签名无感），但**登录那一步是不是也要无 UI 是另一件事** ——
> 重定向流会把页面状态（我们那些 `useState` 的日志、输入框）全部丢掉，而这个 harness 的价值恰恰在那份过程日志。
> 建议先用 `login()` 模态，把 `initOAuth` 留作备选。示例仓两条都有，选哪条它不替我们回答。

### 结论

P0 **没有可直接搬的实现代码**，只有登录那半段的两个 20 行以内的配置样板。
`linkWithCustomJwt` 这段要照着本仓 `node_modules/@privy-io/react-auth/dist/dts/index.d.ts:3883-3911` 的类型自己写，
重复 link 的行为必须实跑确认。

---

## ③ P1 —— Solana SPL token 转账、embedded 签名、客户端广播

### 事实：只有 SOL 原生转账，没有一行 SPL

grep 全仓（排除 `node_modules`）：

| 关键词 | 命中 |
|---|---|
| `from '@solana-program/token'`（任何 import） | **0** |
| `getAssociatedTokenAddress` / `AssociatedToken` | 0 |
| `TOKEN_2022` / `token-2022` | 0 |
| `sendRawTransaction` | 0 |
| `getTransferSolInstruction`（SOL 原生） | 6 处 |

**`@solana-program/token` 出现在 6 个 starter 的 `package.json` 里（例如 `privy-react-starter/package.json:17`
`"@solana-program/token": "0.6.0"`），但全仓没有任何文件 import 它** —— 它是官方模板里的一个未使用依赖。
（我们这个 harness 的 `package.json` 里也有同一条，来源大概率就是它。这条只是事实陈述，不动本仓的取舍。）

所有 Solana 交易组装都是同一段 `@solana/kit` pipeline 的复制粘贴（`privy-react-starter`、`privy-next-starter`、
`privy-next-solana`、`privy-next-funding`、`privy-next-wagmi`、`privy-next-smart-wallets`、`privy-next-farcaster*`、
`privy-react-chrome-extension`、`privy-react-whitelabel-starter` —— 逐字相同，只差 import 路径与 `"use client"`）。

**关于"客户端自己广播"：这个仓里没有一处这么做。** 所有例子要么只签不发（`useSignTransaction`），
要么把广播交给 Privy（`useSignAndSendTransaction`，如 `privy-react-starter/src/components/sections/wallet-actions.tsx:253-256`、
`privy-react-whitelabel-starter/app/components/SolanaWallet.tsx:60-63`）。
`sendTransaction` RPC、`confirmTransaction`、`getSignatureStatuses` 在整个仓库里 0 命中。
**广播 + 确认那一段我们只能自己写**（好消息是本仓 `src/balance.ts` 已经有直接打 RPC 的现成写法，广播照它的形状加一个 `sendTransaction` 即可）。

### 可搬的最小单元（P1）

| 来源 | 行数 | 它给了什么 | 落进我们工程要改什么 |
|---|---|---|---|
| `privy-next-starter/src/components/sections/wallet-actions.tsx:152-197`（`handleSignTransactionSolana`）<br><https://github.com/privy-io/examples/blob/main/privy-next-starter/src/components/sections/wallet-actions.tsx#L152-L197> | 46 行，实际有用的是 167-188 这 22 行 | kit 组装 + 签名的完整骨架：`createSolanaRpc → getLatestBlockhash → pipe(createTransactionMessage v0 → setTransactionMessageFeePayer → appendTransactionMessageInstruction → setTransactionMessageLifetimeUsingBlockhash → compileTransaction → getBase64EncodedWireTransaction)`，然后 `signTransaction({transaction, wallet})` | ① **`Buffer.from(transaction,'base64')` 必须换成 `fromBase64(...)`**（见下方"Buffer 陷阱"）；② `getTransferSolInstruction` 换成 `@solana-program/token` 的 transfer 指令 —— 那一步**没有样本**；③ devnet 硬编码换成 `import.meta.env.VITE_SOLANA_RPC_URL`；④ `wallet` 要用本仓 `App.tsx` 的 `pickByAddress` 挑（starter 用 `walletsSolana.find(v => v.address === ...)`，语义相同但没有"找不到就显式失败"）；⑤ 组完交易后加广播 |
| 同文件 `:9-14`（solana 子路径的 import 写法） | 6 行 | `import {useSignTransaction, useWallets} from "@privy-io/react-auth/solana"` 与 EVM 侧同名 hook 的 `as` 别名惯例 | 本仓 `App.tsx:7` 已经是这个写法，**不需要搬**，仅作为"我们没写错"的旁证 |

> **Buffer 陷阱（这是"能不能直接搬"的分水岭）**：
> starter 写的是 `signTransactionSolana({transaction: Buffer.from(transaction, "base64"), wallet})`
> （`privy-next-starter/.../wallet-actions.tsx:185-188`）。它能跑，是因为**那个 starter 的 Vite 配置装了 node polyfill**：
> `privy-react-starter/vite.config.ts:8` → `plugins: [react(), tailwindcss(), nodePolyfills()]`（`vite-plugin-node-polyfills`）。
> **本仓 `vite.config.ts:160` 是 `plugins: [react(), devToken(...)]`，没有任何 polyfill** —— 照搬那一行会在浏览器里
> `Buffer is not defined`。
> 而且 polyfill 根本不必要：3.38.0 的类型就是 `Uint8Array`
> （`node_modules/@privy-io/react-auth/dist/dts/solana.d.ts:242-252`：`type SignTransactionInput = {transaction: Uint8Array; wallet: ConnectedStandardSolanaWallet; chain?; options?}`，
> 返回 `type SignTransactionOutput = {signedTransaction: Uint8Array}`）。
> 本仓 `src/App.tsx:648` 已经是正确形态：`signTransaction({transaction: fromBase64(p.sign_data), wallet: signer})`。
> **结论：入参/回参形状这一问，答案在我们自己的代码里已经是对的，starter 那份反而是要"改一处才能用"的那份。**

### 这一节没人能替我们回答的三件事

1. **SPL transfer 指令**：`@solana-program/token@0.6` 的 `getTransferInstruction` / `getTransferCheckedInstruction` 用法，仓里 0 样本。
   （建议用 checked 版：它带 `decimals` 参数，mint 换了或精度记错会在链上直接失败，而不是转错数量 —— 【未确认，属于建议不是仓库证据】。）
2. **ATA 不存在时怎么办**：0 样本。要么先 `getAssociatedTokenAddress` + 查账户是否存在、不存在则在同一笔里插
   `getCreateAssociatedTokenIdempotentInstruction`，要么直接拒收。
3. **怎么判断 mint 是经典 SPL 还是 Token-2022**：0 样本。可用的判据是读 mint 账户的 `owner` 程序 id
   （`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` = 经典，`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` = Token-2022），
   本仓 `src/balance.ts` 已经在用 `getTokenAccountsByOwner` 打 RPC，加一个 `getAccountInfo` 判 owner 是同一条路上的事。
   **示例仓在这件事上完全帮不上忙。**

---

## ④ P2 —— 两条已登记的未验项

### (a) `useSignRawHash` 能不能对 EVM 钱包签 secp256k1 裸 hash

**能给出决定性答案，答案是"不能"，而且"不需要"。**

- **类型层面的死判据**（本仓 `node_modules`，非猜测）：
  `node_modules/@privy-io/react-auth/dist/dts/extended-chains.d.ts:57-77` 定义
  `SignRawHashInput = {address: string; chainType: CurveSigningChainType; hash: \`0x${string}\`}`，
  注释写着 "This is only supported for extended chains."
  而 `CurveSigningChainType` 的取值域在
  `node_modules/@privy-io/api-types/resources/wallets/wallets.d.ts:308`（api-types 0.20.0）：
  ```
  export type CurveSigningChainType = 'cosmos' | 'stellar' | 'sui' | 'aptos' | 'movement' | 'tron'
    | 'bitcoin-segwit' | 'bitcoin-taproot' | 'pearl' | 'near' | 'ton' | 'starknet';
  ```
  **没有 `'ethereum'`**。文档只举 cosmos/stellar/sui 不是举例不全，是取值域就这些。
- **示例仓的旁证**：`useSignRawHash` 在整个 clone 里 0 命中；而官方 starter 需要"对 EVM 钱包签裸 hash"时，
  走的是 **EIP-1193 provider 的 `secp256k1_sign`**：
  `privy-next-starter/src/components/sections/wallet-actions.tsx:316-351`（按钮名就叫 "Sign raw hash (EVM)"，
  `availableActions` 里 `disabled: !isEvmWallet`）：
  ```ts
  const provider = await (embeddedWallet as any).getProvider();
  const signature = await provider.request({ method: "secp256k1_sign", params: [rawHash] });
  ```
  <https://github.com/privy-io/examples/blob/main/privy-next-starter/src/components/sections/wallet-actions.tsx#L316-L351>
- **和我们的代码对上了**：本仓 `src/signature.ts:61-72` 的 `signEvmDigest` 就是这条路
  （`provider.request({method: 'secp256k1_sign', params: [toHex(digest)]})`）。
  **这一项可以从"未验"里划掉了：我们用的就是官方 starter 用的那条路，`useSignRawHash` 是另一族链的东西，不该出现在 EVM 路径上。**

**可搬的最小单元**：

| 来源 | 行数 | 它给了什么 | 落进我们工程要改什么 |
|---|---|---|---|
| `privy-next-starter/.../wallet-actions.tsx:320-333` | 14 行 | **挑钱包时先按 `walletClientType === "privy"` 过滤再按地址匹配，挑不到就显式报错**，然后才 `getProvider()` | 本仓 `pickByAddress` 已经做了更严的版本（按链分大小写规则 + 找不到时把两边都列出来）。**不搬，仅作为"官方也认为不能退而用第一只"的佐证** |

### (b) `useSign7702Authorization` 在 `showWalletUIs:false` 下的用法

**零覆盖，没有任何证据。**

- `useSign7702Authorization` / `7702` 在整个 clone 里 0 命中（3.38.0 的确导出了它 ——
  见 `node_modules/@privy-io/react-auth/dist/dts/index.d.ts:4200` 的导出列表 —— 但示例仓一个用例都没有）。
- 三个把 `showWalletUIs` 设成 false 的例子分别是
  `privy-react-whitelabel-starter/app/providers.tsx:18`、
  `examples/privy-next-tempo/src/providers/PrivyProvider.tsx:27`、
  `examples/privy-next-permissionless/src/providers/providers.tsx:45`，
  **三个都不碰 7702**：permissionless 走的是 ERC-4337 + permissionless.js 的 smart account，
  whitelabel 走的是 `@privy-io/react-auth/smart-wallets`。
- 与 7702 最近的一处是 `privy-react-whitelabel-starter/app/providers.tsx:17-19` 与
  `examples/privy-next-permissionless/src/providers/providers.tsx:40-45`：它们证明
  **`showWalletUIs:false` 与 `createOnLogin` 可以共存、且 Privy 官方自己就这么配** —— 仅此而已。

**本仓 `src/App.tsx` 已经在处理 `SIGN_KIND_EVM_7702_AUTHORIZATION`，那条路在这个仓里没有任何对照物，只能继续自己实跑。**

---

## ⑤ 不能搬的，以及为什么

### 5.1 版本原因

| 例子 | `@privy-io/react-auth` | 为什么不能直接搬 |
|---|---|---|
| `examples/privy-react-pwa` | **`^1.99.1`** | 1.x。`usePrivy()` 里还挂着 `signMessage` / `sendTransaction` / `exportWallet`（`pages/embedded-wallet.tsx:10`），3.x 已拆成独立 hook。**整个工程对我们零价值**，连"参考"都会误导 |
| `privy-react-whitelabel-starter` | `^3.5.0` | 3.x 早期。OAuth/providers 那两段（我们要抄的部分）在 3.38 上形状未变【未确认：只核了类型存在性，没编译过】；但它的 `SolanaWallet.tsx:61` 同样有 Buffer 问题 |
| `examples/privy-next-tempo` / `privy-next-permissionless` / `privy-next-solana` / `privy-next-fiat-onramp` | `^3.8.1` / `^3.9.0` / `^3.9.0` / `^3.9.0` | 同上，且 permissionless 与 fiat-onramp 还钉在 **React 18.2.0**（`react: 18.2.0`），我们是 19.2 |
| `privy-react-starter` / `privy-next-starter` / 多数 `examples/*` | `^3.12.0` | **离 3.38.0 最近的一档**，也是我们唯一真正要抄的那批。hook 名与形状我逐个核过（`useSignTransaction`、`useWallets`、`useLinkAccount`、`useSigners`）在 3.38 的 `.d.ts` 里都在 |
| `examples/privy-next-cards` | `^3.39.0` | 比我们**新**一个小版本。只做 cards（发卡），与三个 P 无关 |
| `privy-expo-starter` / `privy-expo-bare-starter` | `@privy-io/expo ^0.58.1` / `^0.55.4` | **不同 SDK 族**。`useEmbeddedEthereumWallet`、`getUserEmbeddedEthereumWallet`、`user.linked_accounts`（snake_case）在 web SDK 里都不存在。custom_auth 那两行就在这里 —— 抄字段名会中招 |
| `privy-vanilla-starter` | `@privy-io/js-sdk-core ^0.58.3` | 另一族。它的 Solana 签名要
`privy.embeddedWallet.getSolanaProvider(account, entropyId, entropyIdVerifier)`（`src/sections/wallet-actions.js:632-640`），
`entropyId` 这套在 react-auth 里没有对应物。**但它是全仓唯一用 `@solana/web3.js` 的 `Transaction`/`Connection` 组交易的 web 例子**（`:607-660`），如果我们要在 `signature.ts` 那一侧继续用 web3.js，它的组装形状可以看一眼 |
| `privy-flutter-starter` / `privy-swift-auth0` / `privy-node-*` | 非 JS 前端 / 服务端 | `privy-swift-auth0/README.md:85` 的 `loginWithCustomAccessToken()` 就是任务里提到的那个 —— **确认它是移动端 API，React 侧没有同名物**，不要按它去 SDK 里找 |

### 5.2 框架原因（Next.js vs 纯 Vite SPA）

29 个工程里 **17 个是 Next.js**（`next 15.5.7` 或 `16.1.6`），**纯客户端的只有 2 个**：
`privy-react-starter`（Vite 7 + React 19，与我们同栈）与 `examples/privy-react-chrome-extension`（同一份代码的扩展版）。

剥掉服务端之后还剩多少，分三档：

- **剥 2 行就能用**：`wallet-actions.tsx`、`link-accounts.tsx`、`user-object.tsx` 这类纯组件。
  实测 `diff privy-react-starter/.../wallet-actions.tsx privy-next-starter/.../wallet-actions.tsx` **只差 4 行**：
  Next 那份多了 `"use client";` + 空行、import 路径 `@/components/ui/custom-toast` vs `../ui/custom-toast`、
  以及一个 import 的排序。**Next 与 Vite 在这一层没有实质差别。**
- **剥掉之后剩一半**：`examples/privy-next-cross-app-provider`（`src/app/oauth/transact/page.tsx`，
  依赖 `next/navigation` 的路由与 `/oauth` 路径分段）。它的 `getAccessToken()` 用法（`:55,71,165...`）可以看，其余不可搬。
- **剥掉之后剩零**：`privy-next-yield-demo`、`privy-next-x402-agent-demo`、`privy-next-mpp-agent-demo`、
  `privy-next-fiat-onramp`、`privy-node-starter`、`privy-node-telegram-trading-bot`。
  核心逻辑全在 API route / Express handler 里，用 `@privy-io/node` 或 `@privy-io/server-auth` + **app secret**
  （例：`examples/privy-next-yield-demo/src/app/api/deposit/route.ts:26` 的
  `Authorization: Basic base64(appId:appSecret)`）。
  我们是纯 SPA，**没有能安全放 app secret 的地方**，这一档从原理上就不可搬。

### 5.3 License 原因（这一条会咬人，先读完再复制粘贴）

- **仓库根目录没有 LICENSE 文件**（`ls -a` 确认；`README.md` 与 `CONTRIBUTING.md` 也不含任何 license 声明）。
- 只有 **15 个子目录**各自带 LICENSE：13 份 MIT `Copyright (c) 2022 Privy`（`privy-next-starter` 与
  `examples/privy-next-{solana,funding,wagmi,cards,farcaster,farcaster-mini-app,cross-app-connect,cross-app-provider,smart-wallets,session-keys}`）、
  1 份 MIT `Copyright (c) 2025 Privy`（`privy-next-tempo`）、
  2 份 MIT `Copyright (c) 2026 Stripe, Inc.`（`privy-next-mpp-agent-demo`、`privy-next-x402-agent-demo`）、
  1 份 **Apache License 2.0**（`examples/privy-next-permissionless`）。
- **`privy-react-starter` 没有 LICENSE 文件**（`find privy-react-starter -iname 'LICENSE*'` 为空），
  `privy-react-whitelabel-starter`、`privy-vanilla-starter`、`privy-react-chrome-extension`、两个 expo starter 同样没有。
  它们的 `package.json` 也没有 `license` 字段。**根目录又没有兜底的 LICENSE** —— 严格讲这是"保留所有权利"。

**因此有一条必须遵守的操作规则：**

> **要抄 `wallet-actions.tsx`，从 `privy-next-starter/src/components/sections/wallet-actions.tsx` 抄，
> 不要从 `privy-react-starter/...` 抄。** 两份文件逐字相同（diff 只有上面说的 4 行），
> 但前者所在目录有 `privy-next-starter/LICENSE`（MIT, Copyright (c) 2022 Privy），后者所在目录**没有 license**。
> 白拿的合规性，代价是删掉一行 `"use client";`。

另外两条：
- `examples/privy-next-permissionless` 是 **Apache-2.0**（不是 MIT）—— 若将来抄它的 smart account 部分，
  归属声明与 NOTICE 的义务与 MIT 不同。本次要抄的只有它 12 行的 provider 配置（配置字面量，通常不构成可版权表达【未确认，非法律意见】），
  但记着这个目录的许可与其它不同。
- `mpp-agent-demo` / `x402-agent-demo` 的版权人是 **Stripe, Inc.** 而不是 Privy —— 与我们三个 P 都无关，不碰即可。

【未确认】以上是对文件事实的陈述，不是法律意见。真要大段照抄 `privy-react-starter` 里那些无 license 目录的代码，
应当先问 Privy 或改从 MIT 目录取同名文件。

---

## ⑥ 落地清单（把上面的结论压成动作）

1. **P0 登录半段**：抄 `privy-next-permissionless/src/providers/providers.tsx:33-45` 的 `loginMethods` 一行进 `src/main.tsx`；
   `usePrivy().login()` 直接用，不引入 `useLoginWithOAuth`（除非我们接受整页重定向丢日志）。
2. **P0 link 半段**：**自己写**，照 `node_modules/@privy-io/react-auth/dist/dts/index.d.ts:3883-3911` 的类型。
   判存在用 `linkedAccounts` 的 `type === 'custom_auth'` + **`customUserId`（camelCase）**。
   重复 link 的行为**必须实跑一次并把结果写进 README** —— 这是全网（至少是官方示例仓）查不到的一格。
3. **P1**：抄 `privy-next-starter/.../wallet-actions.tsx:167-188` 那 22 行 kit pipeline，
   把 `Buffer.from(x,'base64')` 换成本仓 `fromBase64`，把 `getTransferSolInstruction` 换成
   `@solana-program/token` 的 transfer（无样本），devnet 换成 `VITE_SOLANA_RPC_URL`，
   钱包用 `pickByAddress` 挑，末尾自己加广播（照 `src/balance.ts` 的 RPC 写法）。
   ATA 与 Token-2022 判定**从零写**。
4. **P2(a)**：把"`useSignRawHash` 能否签 EVM"从未验清单里划掉，结论是**不能**（`CurveSigningChainType` 不含 ethereum），
   我们现有的 `secp256k1_sign` 路径与官方 starter 一致。
5. **P2(b)**：7702 无外部证据，维持自证。

---

## ⑦ 参考链接

仓库与 commit：
- <https://github.com/privy-io/examples>（分支 `main`，本次读的是 `cf0ef34ebb508aee153165d4ad7137315d1c0daa`）

逐条引用（GitHub 路径 + 行号）：
- Solana 签名骨架（MIT 覆盖的那一份）：<https://github.com/privy-io/examples/blob/main/privy-next-starter/src/components/sections/wallet-actions.tsx#L152-L197>
- EVM 裸 hash = `secp256k1_sign`：<https://github.com/privy-io/examples/blob/main/privy-next-starter/src/components/sections/wallet-actions.tsx#L316-L351>
- 同一份文件的 Vite 版（**无 license**，只作对照）：<https://github.com/privy-io/examples/blob/main/privy-react-starter/src/components/sections/wallet-actions.tsx#L314-L349>
- Vite starter 靠 node polyfill 才有 Buffer：<https://github.com/privy-io/examples/blob/main/privy-react-starter/vite.config.ts#L8>
- 无 UI 的 Google 登录：<https://github.com/privy-io/examples/blob/main/privy-react-whitelabel-starter/app/components/OAuth.tsx#L9-L37>
- `showWalletUIs:false` 的三份真实配置：
  <https://github.com/privy-io/examples/blob/main/privy-react-whitelabel-starter/app/providers.tsx#L17-L19>、
  <https://github.com/privy-io/examples/blob/main/examples/privy-next-permissionless/src/providers/providers.tsx#L33-L45>、
  <https://github.com/privy-io/examples/blob/main/examples/privy-next-tempo/src/providers/PrivyProvider.tsx#L27>
- `custom_auth` 的唯一出现（Expo，snake_case）：<https://github.com/privy-io/examples/blob/main/privy-expo-starter/components/UserScreen.tsx#L32-L34>
- 移动端 `loginWithCustomAccessToken`（确认它不是 React API）：<https://github.com/privy-io/examples/blob/main/privy-swift-auth0/README.md#L85>
- MIT 许可（Privy）：<https://github.com/privy-io/examples/blob/main/privy-next-starter/LICENSE>
- Apache-2.0（唯一一份）：<https://github.com/privy-io/examples/blob/main/examples/privy-next-permissionless/LICENSE>

本地一手来源（本仓 `node_modules`，`@privy-io/react-auth@3.38.0` / `@privy-io/api-types@0.20.0`）：
- `dist/dts/index.d.ts:3883-3911` —— `useLinkJwtAccount` / `linkWithCustomJwt` 的完整签名
- `dist/dts/index.d.ts:1705-1711` —— `ResponseCustomJwtAccount`（`custom_user_id`）
- `dist/dts/types-Ck8tvlPZ.d.ts:1307-1310` —— `CustomJwtAccount`（`customUserId`）
- `dist/dts/index.d.ts:3866-3881` —— `useSubscribeToJwtAuthWithFlag` 的 JSDoc 示例（本仓 `App.tsx:359-369` 已按它写）
- `dist/dts/solana.d.ts:242-266` —— `SignTransactionInput/Output`（`Uint8Array`）
- `dist/dts/extended-chains.d.ts:57-79` —— `useSignRawHash` 与 "only supported for extended chains"
- `node_modules/@privy-io/api-types/resources/wallets/wallets.d.ts:308` —— `CurveSigningChainType` 的取值域（**无 ethereum**）
