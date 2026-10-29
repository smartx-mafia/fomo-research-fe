'use client';

import dynamic from 'next/dynamic';

/**
 * 开关关着时连 `import()` 都不留下（理由同 `(harness)/dev/harness/HarnessShellClient.tsx`）：
 * 直接写 `process.env.NEXT_PUBLIC_ENABLE_HARNESS`，打包器在构建期把它折成字面量，另一支连同
 * 控制台代码一起被删掉 —— 一个能改全站审查词库的控制台不能以静态 chunk 躺在产品域名上。
 */
const Console =
  process.env.NEXT_PUBLIC_ENABLE_HARNESS === 'true'
    ? dynamic(() => import('@/features/moderation/ModerationConsole'), {
        ssr: false,
        loading: () => <div className="p-8 text-center text-xs text-muted">Loading…</div>,
      })
    : () => null;

export function ModerationClient() {
  return <Console />;
}
