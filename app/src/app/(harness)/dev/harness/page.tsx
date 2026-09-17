import { notFound } from 'next/navigation';
import { ENABLE_HARNESS } from '@/config';
import { HarnessShellClient } from './HarnessShellClient';

/**
 * `/dev/harness`——内部调试工具的入口。
 *
 * 开关判断刻意留在 Server Component 里：`notFound()` 在这里抛出才能真的返回
 * HTTP 404（文档明确它适用于 Server Component / Server Function / Route Handler），
 * 关闭时不会把 harness 的任何代码发到浏览器。
 * 壳本身是纯客户端的，由 `HarnessShellClient` 用 `ssr: false` 挂载。
 *
 * 这个路由**不在**产品导航里，也不在 `(product)` 这个 route group 下。
 */
export default function DevHarnessPage() {
  if (!ENABLE_HARNESS) {
    notFound();
  }

  return <HarnessShellClient />;
}
