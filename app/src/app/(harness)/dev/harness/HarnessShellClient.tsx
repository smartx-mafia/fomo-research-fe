'use client';

import dynamic from 'next/dynamic';

/**
 * `ssr: false` 只能写在 Client Component 里（Server Component 里会直接报错，
 * 见 node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md）。
 * 所以这一层薄包装存在的唯一目的，就是把 `ssr: false` 放进客户端边界内。
 *
 * harness 全程依赖 `window` / `localStorage` / Privy 浏览器 SDK，
 * 在服务端跑一遍只会得到一次必然失败的渲染，因此彻底关掉 SSR 而不是靠
 * `typeof window` 之类的运行时判断绕。
 */
const HarnessShell = dynamic(() => import('@/features/harness/HarnessShell'), {
  ssr: false,
  loading: () => (
    <div className="p-8 text-center text-xs text-muted">Loading harness…</div>
  ),
});

export function HarnessShellClient() {
  return <HarnessShell />;
}
