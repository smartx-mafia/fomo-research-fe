import type { ReactNode } from "react";

/**
 * harness 侧的 layout。
 *
 * 刻意**不**渲染产品页头/导航/页脚——harness 是开发工具，不是产品页面，
 * `/dev/harness` 也不出现在产品导航里。
 *
 * 这里目前不挂任何 Provider。harness 自己的 `PrivyProvider`
 * （`createOnLogin: users-without-wallets`、本机/测试双 appId）由下一张票配置，
 * 届时只加在这一层，永远不与 `(product)` 的那套嵌套。
 */
export default function HarnessLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}
