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

/**
 * **开关关着时连 `import()` 都不留下。**
 *
 * `page.tsx` 那道 `notFound()` 只管"访问不到"，管不住"下发不下发"：动态
 * import 照样会被打成一个 chunk 放进 `out/`，于是一份会连主网、签真交易的
 * 调试台以静态文件的形式躺在产品域名上 —— 而 `.env.example` 上写着的是
 * 「harness 代码也不会下发到浏览器」。
 *
 * 这里直接写 `process.env.NEXT_PUBLIC_ENABLE_HARNESS`（而不是 `@/config`
 * 的 `ENABLE_HARNESS`）是**刻意的**：打包器在构建期把这个表达式替换成字面量，
 * 三元的另一支随即成为死代码，`import()` 连同它拉起的整棵 harness 依赖树
 * 一起被删掉。换成跨模块的常量就指望打包器做常量传播，那件事没有保证。
 * 判据写在验收里：`NEXT_PUBLIC_ENABLE_HARNESS` 未设置时 `out/` 里不得有
 * harness chunk。
 */
const HarnessShell =
  process.env.NEXT_PUBLIC_ENABLE_HARNESS === 'true'
    ? dynamic(() => import('@/features/harness/HarnessShell'), {
        ssr: false,
        loading: () => (
          <div className="p-8 text-center text-xs text-muted">Loading harness…</div>
        ),
      })
    : () => null;

export function HarnessShellClient() {
  return <HarnessShell />;
}
