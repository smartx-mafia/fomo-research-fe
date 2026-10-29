'use client';

import {useEffect, useState} from 'react';

import {LoginBench} from '@/components/LoginBench';
import {missingConfig} from '@/config';

/**
 * 登录台挂载门：Privy 的 useLoginWithOAuth 在 SSR/预渲染阶段会崩
 * （内部 ref 未初始化），且登录组件 render 时直接读 localStorage。
 * 整棵登录树必须等客户端挂载后再渲染 —— 服务端只出骨架。
 */
export function LoginScreen() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // PrivyProviders omits the provider without an app ID. Guard before mounting
  // LoginBench: its OAuth hooks require that provider even on the client.
  const missing = missingConfig();
  if (missing.length > 0) {
    return (
      <div role="alert" className="mx-auto max-w-2xl p-6 font-mono text-sm leading-7 text-red-500">
        登录暂不可用：缺少 {missing.join('、')}。请在部署平台设置构建环境变量后重新部署；本地开发请配置 .env.local。
      </div>
    );
  }
  if (!mounted) return <p className="p-6 font-mono text-sm text-muted">加载中…</p>;
  return <LoginBench />;
}
