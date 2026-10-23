This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Cloudflare Pages（静态导出）

本项目按纯静态站点部署在 Cloudflare Pages（根目录 `app`，构建命令 `npx next build`，输出目录 `out`）：

- `next.config.ts` 开启 `output: 'export'`，构建产物为静态文件，无服务端运行时。
- 详情页路径式 URL（`/token/:chain/:address`、`/smart-money/:chain/:address`）在导出时没有产物，由 `public/_redirects` 重写（200，保留原地址）到 `/token`、`/smart-money` 壳页，参数由客户端从地址栏解析（`src/hooks/useDetailRouteParams.ts`）。
- 开发环境由 `next.config.ts` 中 dev-only 的 `rewrites` 提供相同行为，`/token/eth/0x...` 在 `pnpm dev` 下直接可用。
- 跳转到详情页请用整页导航（`<a href>` / `window.location.assign`，如 TokenTable、SearchBox），不要用 `next/link` 软导航：这些路径不在客户端路由表里。

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=next.js&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## 挂单测试页面（开发中）

路径 `/limit-orders`。沿用本站登录、Privy provider、精确金额转换和业务信封；正式 React Native 前端没有改动。

配置 `NEXT_PUBLIC_LIMIT_ORDER_API_BASE` 为独立挂单服务 HTTP 根地址，`NEXT_PUBLIC_LIMIT_ORDER_SIGNER_ID` 为该服务配置的 Privy additional signer 公共 ID。不要把 authorization key、app secret 或服务 JWT 放进 NEXT_PUBLIC 变量。挂单服务 CORS 必须允许当前测试站点；HTTPS 页面需要 HTTPS API。服务未部署时不要把业务网关当作默认挂单地址。

页面使用现有 Solana USDC 现金资产；支持 Solana、Base、Ethereum、BSC 的四种触发场景。数量字符串复用精确转换，比例交给服务端一次性换算，留空滑点为 AUTO。授权成功仍由服务端查询确认；撤销按钮明确移除所选钱包全部 additional signers（当前安装 SDK 的语义），不冒充单 signer 撤销。

创建提交前把同一幂等键与输入保存在账号/服务地址隔离的本地恢复记录中；响应丢失、刷新后用相同请求恢复。记录没有 JWT/密钥。收到确定创建结果后清除；明确的准入拒绝可返回修改。查询和事件恢复以服务端状态为准，取消请求不等于已取消。

风险确认使用 TokenData 的当前评估和后端返回的精确 flow；用户明确确认后仍以同一请求重试。修改响应不明时查询原订单，只有原版本失效才结束旧请求，不声称修改已成功。已确认失败的订单可复制固定条件为新草稿，需填写新有效期并再次确认。

尚待完成：实际页面和进程联调，以及实际费用能力核实。当前接口只提供报价费用及退款差额，页面不会把报价标为实付。

验证：`npm test -- src/lib/limit-order-input.test.ts src/api/limit-orders.test.ts src/components/LimitOrdersView.test.tsx`，`npx next typegen`，`npx tsc --noEmit`。完整静态导出需要原站点的 Privy app 配置；没有配置时，既有 onboarding 页面会在 prerender 调用 Privy hook 时失败。

挂单详情直接展示服务端换算后的固定原子数量、输入/输出资产、USD 目标与整单费用上限；比例预览不标成原子单位。执行版本的滑点字段表示容忍值，不是实际成交滑点。报价费用单独列出付款方、资产精度与美元估值；未知精度保留原子单位，未知估值不写零。实际成交/退款数取 settlement，空值显示未确认，真实字符串 `0` 保留。已入账费用取 settled_fees，四条用户侧费用使用明示链/资产的原子单位，负兑换成本原样保留；平台承担的源链 Gas 单列。缺少已入账记录时保持未知提示，仍不能证明失败交易的全部网络成本。
