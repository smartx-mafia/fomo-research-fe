'use client';

import {App} from './App';

/**
 * harness 的挂载点。
 *
 * 源仓库 `src/main.tsx` 里 `root.render(<PrivyProvider><Boundary><App/></Boundary></PrivyProvider>)`
 * 这一段，迁移后一分为二：Provider / fail-loud / 错误边界在
 * `src/app/(harness)/layout.tsx`，剩下的「把 App 挂起来」就是这个文件。
 *
 * 它单独存在是因为 `next/dynamic({ ssr: false })` 需要一个**默认导出**的
 * 模块作为动态边界（`App` 是具名导出），而那条边界必须在这里而不是更外层：
 * harness 全程依赖 `window` / `localStorage` / Privy 浏览器 SDK。
 *
 * CSS 的作用域根 `.harness-root` 在 layout 那一层（见那边的注释）。
 */
export default function HarnessShell() {
  return <App />;
}
