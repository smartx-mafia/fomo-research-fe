'use client';

import {useEffect, useState} from 'react';

import {LoginBench} from '@/components/LoginBench';

/**
 * 登录台挂载门：Privy 的 useLoginWithOAuth 在 SSR/预渲染阶段会崩
 * （内部 ref 未初始化），且登录组件 render 时直接读 localStorage。
 * 整棵登录树必须等客户端挂载后再渲染 —— 服务端只出骨架。
 */
export function LoginScreen() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <p className="p-6 font-mono text-sm text-muted">加载中…</p>;
  return <LoginBench />;
}
