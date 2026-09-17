'use client';

// **必须是第一个 import**：它给 Privy SDK 补 Buffer。
// 源仓库是 `src/buffer-shim.ts`（main.tsx 的第一行），迁移后复用宿主那一份
// —— 两份文件的可执行代码逐字符相同（`globalThis.Buffer ??= Buffer`），
// 为什么需要它见 `src/lib/buffer-shim.ts` 与源仓库那个文件的注释。
import '@/lib/buffer-shim';

import {Component, type ReactNode} from 'react';
import {PrivyProvider} from '@privy-io/react-auth';
// **kit 与 web3.js 在这个包里是并存的，各管一段，不是迁移没做完。**
//
// 这一处是 kit 的全部职责：Privy 的 web SDK 把 `config.solana.rpcs` 的类型
// 钉死在 kit 的 `Rpc` 上（SDK 类型注释原话："@solana/kit RPC configuration
// objects"），web3.js 的 `Connection` 塞不进去 —— 删了它 Privy 的签名路径
// 起不来。
//
// 另一段（**解析交易、取签名**，也就是所有与交易语义有关的代码）在
// signature.ts，那边是 web3.js，因为 App 端只有 web3.js，两端要抄同一份。
//
// App 端（`@privy-io/expo`）根本没有这一处 —— Expo SDK 不提供签名界面，
// 也就不需要 RPC 去模拟交易。所以这一行不是前端要抄的东西，
// 但也不是可以顺手清理掉的东西（README「Solana 的两套 SDK 是并存的」）。
import {createSolanaRpc, createSolanaRpcSubscriptions} from '@solana/kit';

import {ENABLE_HARNESS, SOLANA_RPC_URL} from '@/config';
import {CURRENT_ENV} from '@/features/harness/envs.browser';

/**
 * harness 侧的 layout —— 源仓库 `src/main.tsx` 的落点。
 *
 * 刻意**不**渲染产品页头/导航/页脚：harness 是开发工具，不是产品页面，
 * `/dev/harness` 也不出现在产品导航里。
 *
 * 只有这一层挂 harness 自己的 `PrivyProvider`，与 `(product)` 那套永不嵌套
 * （同 appId 的两个 PrivyProvider 实例会争抢同一批 `privy:` localStorage key，
 * SDK 行为未定义）。两套配置**刻意不同**，最扎眼的一条是 `createOnLogin`：
 * 产品那边是 `'off'`，这边是 `'users-without-wallets'`（源仓库原样）。
 */

// **appId 跟着顶栏那个环境开关走，不直接读 NEXT_PUBLIC_HARNESS_PRIVY_APP_ID。**
//
// 它是 PrivyProvider 的 prop，也就是"这一次页面加载对着哪个 Privy app"。
// 换环境必须连它一起换：business 拿自己的 privy.app_id 校验 identity token
// 的 aud，两边不一致时登录一律 400100 —— 而那个码指向 identity token，
// 看起来像 Privy 出了问题。切换靠整页刷新，理由见 `envs.ts` 的文件头。
const appId = CURRENT_ENV.privyAppId;
const clientId = process.env.NEXT_PUBLIC_HARNESS_PRIVY_CLIENT_ID || undefined;
const rpcURL = SOLANA_RPC_URL;

/**
 * 把 React 树里的异常挡在页面之外。
 *
 * 没有它的时候，Privy 签名界面内部抛一个异常就会把**整个页面**白掉 ——
 * 连同过程日志一起消失，而那份日志正是当时唯一能说清"走到哪一步"的东西。
 * 白屏比错误信息难查得多：它长得像"页面没加载出来"。
 */
class Boundary extends Component<{children: ReactNode}, {err: Error | null}> {
  state = {err: null as Error | null};

  static getDerivedStateFromError(err: Error) {
    return {err};
  }

  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{fontFamily: 'monospace', padding: 24, color: '#b00', lineHeight: 1.8}}>
        <p>页面里抛了一个异常，已被挡住（刷新即可重来）：</p>
        <pre style={{whiteSpace: 'pre-wrap'}}>{String(this.state.err.stack ?? this.state.err)}</pre>
      </div>
    );
  }
}

// fail-loud：两个必需配置缺一不可，而缺了都**不会**在启动时表现成错误 ——
// 缺 appId 是每次登录静默失败；缺 RPC 是**签名那一刻**才炸（Privy 的签名
// 界面自己要一个 Solana RPC 客户端，拿不到就抛，而那个异常发生在它的
// 组件内部，会把整个页面白掉）。都在这里一次说清楚。
//
// 缺 appId 时报的是**当前环境**缺的那个变量名（本机是
// NEXT_PUBLIC_HARNESS_PRIVY_APP_ID，测试环境是
// NEXT_PUBLIC_HARNESS_TEST_PRIVY_APP_ID）—— 报错里写一个不需要配的变量名，
// 照着做的人会一直配不对。
const missing = [
  !appId && (CURRENT_ENV.missing ?? 'NEXT_PUBLIC_HARNESS_PRIVY_APP_ID'),
  !rpcURL && 'NEXT_PUBLIC_SOLANA_RPC_URL',
].filter(Boolean);

export default function HarnessLayout({children}: {children: ReactNode}) {
  // **`.harness-root` 是这份 CSS 的作用域根**（migration-spec §5.6）。
  // harness 的设计 token 从前挂在 `:root` 上，与宿主 `globals.css` 同名冲突；
  // 收到这个类名之后，`--accent` 那抹绿只在这棵子树里生效。
  // 它挂在 layout 这一层而不是更里面：这个容器在 flex 列里撑满视口高度，
  // 而 `--bg` 那个底色需要铺满整页才与源仓库看起来一样。
  return (
    <div className="harness-root flex min-h-0 flex-1 flex-col">
      {renderHarness(children)}
    </div>
  );
}

function renderHarness(children: ReactNode) {
  // 开关关着时这一层什么都不做：页面自己 `notFound()`，而 not-found 界面
  // 是渲染在这个 layout 里面的 —— 在那上面顶一句"缺配置"只会让人去查一个
  // 根本没打算开的功能。
  if (!ENABLE_HARNESS) return children;

  if (missing.length > 0) {
    return (
      <p style={{fontFamily: 'monospace', padding: 24, color: '#b00', lineHeight: 1.8}}>
        环境「{CURRENT_ENV.label}」缺配置：{missing.join('、')}
        <br />
        复制 .env.example 成 .env.local 并填上，说明见其中的注释。
      </p>
    );
  }

  // **不用 StrictMode**，而这一条要写清楚，因为它反直觉。
  //
  // StrictMode 在开发模式下故意把 effect 跑两遍，用来暴露不幂等的副作用。
  // 而 Privy 的 `createOnLogin` 正好是一个不幂等的副作用 —— 它跑在 effect
  // 里，跑两遍就**建两只钱包**。
  //
  // 2026-08-28 实测撞到：同一个用户多出一只 EVM 钱包，两只的
  // first_verified_at 相差 1 秒。代价是永久的 —— Privy 的钱包删不掉，
  // 而服务端按 wallet_index 最小挑一只，于是另一只永远躺在那里，
  // 每次列出来都要解释一遍。
  //
  // 所以这里的取舍不是"要不要严格模式"，是"多一次 effect 的代价是什么"：
  // 通常是零，这里是一只真实存在、无法回收的链上账户。
  //
  // 迁移后这条约束落在 `next.config.ts` 的 `reactStrictMode: false` 上
  // （宿主本来就是 false，理由同上）。**不要把它改回 true。**
  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId}
      config={{
        // **登录方式在代码里锁死，不跟 Dashboard 走。**
        //
        // 不写这一行的话，modal 里出现哪些登录方式取决于 Privy Dashboard
        // 上的设置 —— 与 showWalletUIs 同一个毛病：一个不在仓库里、改了
        // 也不会有人知道的外部开关，决定着这个页面的行为。
        //
        // **2026-09-03 从只留 email 放开到三种**（照 ../privy-login-demo，
        // 那边 email 与 OAuth 两条路都接好了）。放开的同时，`api.ts` 的
        // `login()` 也把 auth_method 从写死的常量改成了参数 ——
        // **这两处必须一起改**：契约要求 auth_method 与 identity token 里
        // 真实存在的绑定一致，不一致回 100107。放开登录方式而漏改那边的
        // 症状是"用另一种方式登录的人一律登不进去"，而错误码指向的是
        // "auth_method 不支持"，看起来像后端没开这种登录。
        //
        // 写在这里**不等于点得亮**：Google / Apple 还要 Privy 控制台开了
        // （`google_oauth` / `apple_oauth`）、`.env.local` 里的硬闸也置成
        // true，两道闸都合上才行 —— 见 `oauth.ts`。默认两道都是关的。
        //
        // **页面用的是 headless 接口，不走 Privy 的 modal**
        // （`useLoginWithEmail` / `useLoginWithOAuth`）。这一行仍然要写：
        // 它约束的是这个 app 允许哪些登录方式，与用不用 modal 无关。
        loginMethods: ['email', 'google', 'apple'],
        embeddedWallets: {
          // **这一行决定签名弹不弹窗，而它的默认值不在代码里。**
          //
          // 不写的话，`showWalletUIs` 取的是 Privy Dashboard 上的开关
          // （SDK 类型注释原话："Defaults to the wallet UI setting enabled
          // for your app in the Privy Dashboard"）—— 也就是说，这个页面
          // 会不会弹确认框，取决于一个不在仓库里、改了也不会有人知道的设置。
          //
          // **这一个开关就是"无弹窗"的全部**，与选哪个签名原语无关。
          // 2026-08-28 实测：设成 false 之后 `signTransaction` 也不再弹窗，
          // 2 秒签完并成功上链。在那之前我们以为"要想无弹窗就必须改用
          // signMessage"，那个因果是错的 —— 换原语既不必要、也不充分。
          //
          // 设成 false 是这个 harness 的产品语义（一键下单 = 签名无感），
          // 也让 Solana 与 EVM 两条路一致 —— EVM 那条走 EIP-1193 provider
          // 的 secp256k1_sign，本来就没有任何 UI。
          //
          // 代价写在 ADR-0010 的追记里：用户看不见自己签了什么。页面上那行
          // 「将要执行」是仅剩的那次知情确认，不要删。
          showWalletUIs: false,
          // **下面这两行 `createOnLogin` 在当前这条路上不生效。**
          //
          // Privy 的自动建钱包只对走它自己 modal 的登录生效，而这个页面
          // 用的是 headless 的 `useLoginWithEmail` / `useLoginWithOAuth`
          //（上面 loginMethods 那段）—— **两条路都不触发**。
          // 钱包由页面上的「创建 embedded 钱包」按钮显式建 —— 完整的证据
          // 与两个 app 的线上配置对照写在 `App.tsx` 的 doCreateWallets 上面。
          //
          // 留着不删：将来若改回 Privy modal，它们就是对的默认值；而删掉
          // 之后那一天没有人会想起要加回来。
          //
          // **与宿主 `PrivyProviders.tsx` 的 `'off'` 不一样，这是刻意的**，
          // 不要"顺手对齐"：那边不建钱包，这边建。
          solana: {createOnLogin: 'users-without-wallets'},
          // **EVM 钱包是买 BSC 上的币需要的，不是卖。**
          //
          // 买 BSC 上的 token 是跨链买入：钱从 Solana 的 USDC 出，用户
          // 签的是一笔 **Solana** 交易，而 BSC 那条腿只是收货地址 ——
          // 所以这个钱包在买入路径上从头到尾不签任何东西，但 business
          // 必须问得到它，否则下单在 resolveWallets 就被拒。
          //
          // **卖 BSC 上的 token 仍然走不通**，而且卡在这个钱包上：
          // 我们的账户合约要的是裸 userOpHash 签名（对着主网一笔被
          // EntryPoint 接受的交易验证过），而 Privy 的 embedded EVM 钱包
          // 只给 EIP-191 包装的 signMessage 与 EIP-712 的 signTypedData,
          // 没有裸摘要签名。前缀错了本地一路正常，链上回一句 AA24。
          ethereum: {createOnLogin: 'users-without-wallets'},
        },
        solana: {
          // **必须显式给。** Privy 的签名界面要用它模拟交易、估手续费。
          // 不给的话它会去问 defaultSolanaRpcsPlugin，而我们没注册那个
          // 插件 —— 于是点"签名"时抛
          // `No RPC configuration found for chain solana:mainnet`，
          // 整个页面白屏。2026-08-27 实测撞过。
          //
          // 用我们自己的端点而不是公共 RPC：公共节点限流，而限流的表现
          // 是签名界面转圈然后失败，看起来像"Privy 挂了"。
          rpcs: {
            // 这一处 cast 是**类型层面的**，不是行为层面的：Privy 把
            // rpc 声明成了带 requestAirdrop 的测试网形状，而
            // createSolanaRpc 对主网端点推出来的类型没有那个方法。
            // 不收窄编译不过；收窄不改变任何运行时行为。
            'solana:mainnet': {
              rpc: createSolanaRpc(rpcURL) as never,
              // 订阅走 wss。同一个端点换协议头，不另外配一个 —— 两个
              // 值分开配就会有一天只改了一个，而那种不一致不报错。
              rpcSubscriptions: createSolanaRpcSubscriptions(
                rpcURL.replace(/^http/, 'ws'),
              ) as never,
              blockExplorerUrl: 'https://explorer.solana.com',
            },
          },
        },
      }}
    >
      <Boundary>{children}</Boundary>
    </PrivyProvider>
  );
}
