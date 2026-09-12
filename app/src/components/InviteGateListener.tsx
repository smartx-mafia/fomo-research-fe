'use client';

import {useRouter} from 'next/navigation';
import {useEffect} from 'react';

/**
 * 准入门禁的全局出口（invite.md §4.7 / §5）。
 *
 * 未准入账号调任何非豁免端点都会回 430114 —— 那是新用户「登录后、绑定前」
 * 的正常态：不要弹「服务异常」、不要清 token、不要重试原请求，处置是回到
 * /status 按 next_action 重走。广播源在 envelope.call()（业务失败统一流经
 * 的唯一位置），本监听器把用户带去邀请页完成绑定。
 *
 * 邀请域 / 引导 / 设置 / 用户资料这些豁免端点永远不会回 430114，所以在
 * /invite、/onboarding、/login、/settings 自身收不到本事件；防御性地忽略
 * 一次，避免自我跳转。
 */
export function InviteGateListener() {
  const router = useRouter();

  useEffect(() => {
    const onGate = () => {
      const path = window.location.pathname;
      if (path.startsWith('/invite') || path.startsWith('/onboarding') || path.startsWith('/login') || path.startsWith('/settings')) {
        return;
      }
      router.push('/invite');
    };
    window.addEventListener('smartx:invite-gate', onGate);
    return () => window.removeEventListener('smartx:invite-gate', onGate);
  }, [router]);

  return null;
}
