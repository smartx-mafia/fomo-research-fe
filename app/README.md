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
