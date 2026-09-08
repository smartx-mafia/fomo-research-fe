'use client';

// Must run before Privy/Solana signing code; the browser SDK reads the Node Buffer global.
import '@/lib/buffer-shim';

import {PrivyProvider} from '@privy-io/react-auth';
import {createSolanaRpc, createSolanaRpcSubscriptions} from '@solana/kit';
import {Component, type ReactNode} from 'react';

import {PRIVY_APP_ID, PRIVY_CLIENT_ID, SOLANA_RPC_URL, missingConfig} from '@/config';

/**
 * 把 Privy/登录组件的异常挡在页面之外（自 privy-login-demo 的 Boundary 迁移）。
 *
 * 没有它的时候，Privy 组件内部抛一个异常就会把**整个页面**白掉 ——
 * 连同过程日志一起消失，而那份日志正是当时唯一能说清"走到哪一步"的东西。
 */
class Boundary extends Component<{children: ReactNode}, {err: Error | null}> {
  state = {err: null as Error | null};

  static getDerivedStateFromError(err: Error) {
    return {err};
  }

  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="p-6 font-mono text-sm leading-7 text-red-600">
        <p>页面里抛了一个异常，已被挡住（刷新即可重来）：</p>
        <pre className="mt-2 whitespace-pre-wrap">
          {String(this.state.err.stack ?? this.state.err)}
        </pre>
      </div>
    );
  }
}

/**
 * 全站 Privy 上下文（迁移自 privy-login-demo 的 main.tsx）。
 *
 * 不用 React StrictMode（next.config 里 reactStrictMode:false）：StrictMode
 * 在开发模式下故意把 effect 跑两遍，而 Privy 的 createOnLogin 是不幂等的
 * 副作用 —— 跑两遍就建两只钱包，代价永久。与 demo 仓保持一致。
 */
export function PrivyProviders({children}: {children: ReactNode}) {
  const missing = missingConfig();
  if (missing.length > 0) {
    // 缺配置不挡整个站点 —— 行情页照常可用；fail-loud 由 /login 页自己负责
    // （那里才是真正需要 Privy 的地方）。
    return <Boundary>{children}</Boundary>;
  }
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      clientId={PRIVY_CLIENT_ID}
      config={{
        // 只做登录验证，不建钱包 —— 显式写出来而不是靠 dashboard 默认值。
        embeddedWallets: {
          // Trade confirmation is implemented by our explicit review step; signatures stay headless.
          showWalletUIs: false,
          ethereum: {createOnLogin: 'off'},
          solana: {createOnLogin: 'off'},
        },
        ...(SOLANA_RPC_URL ? {
          solana: {
            rpcs: {
              'solana:mainnet': {
                rpc: createSolanaRpc(SOLANA_RPC_URL) as never,
                rpcSubscriptions: createSolanaRpcSubscriptions(SOLANA_RPC_URL.replace(/^http/, 'ws')) as never,
                blockExplorerUrl: 'https://explorer.solana.com',
              },
            },
          },
        } : {}),
      }}
    >
      <Boundary>{children}</Boundary>
    </PrivyProvider>
  );
}
