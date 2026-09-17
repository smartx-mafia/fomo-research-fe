import type { NextConfig } from "next";

// 开发模式判定只在这里做一次。`next dev` 会把 NODE_ENV 设成 development，
// `next build` 设成 production —— 下面两处分支都依赖它。
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // Privy 的 createOnLogin 是不幂等副作用，StrictMode 双跑 effect 会建两只钱包
  //（见 src/components/PrivyProviders.tsx 注释），与 privy-login-demo 保持一致关掉。
  reactStrictMode: false,

  // 开发期浏览器通过公网 IP / 本机回环访问 dev server，需放行 /_next 静态资源的跨域加载
  allowedDevOrigins: ["13.52.177.63", "127.0.0.1", "localhost"],

  // Cloudflare Pages 按纯静态站点托管（构建输出目录 out）。应用无 API 路由、
  // 无服务端取数，详情页路径式 URL 由 public/_redirects 重写到 /token、
  // /smart-money 壳页后客户端渲染（见 src/hooks/useDetailRouteParams.ts）。
  //
  // **开发期必须关掉它**（2026-09-18 实测）：`output: "export"` 一旦生效，
  // Route Handler 在 `next dev` 里也被硬拦，每一发请求回一个 HTTP 500 并在终端打
  //     ⨯ export const dynamic = "force-static"/export const revalidate not configured
  //       on route "/api/harness/proxy/[...slug]" with "output: export"
  // 那条报错读起来像"少写了一个 export"，照它去加 `dynamic` 只会换来另一条
  // （`force-dynamic ... cannot be used with "output: export"`）—— 两条互斥，
  // 在 output: export 下 Route Handler 无解。所以开发期让 output 回到默认值。
  //
  // 生产构建 NODE_ENV=production，这里仍然是 "export"，线上产物不受影响。
  output: isDev ? undefined : "export",

  // ==========================================================================
  // ⚠ 别删这一段，它是 /dev/harness 不被打进产品产物的**唯一**保证。
  //
  // 背景：HarnessShellClient.tsx 用
  //     process.env.NEXT_PUBLIC_ENABLE_HARNESS === 'true' ? dynamic(...) : () => null
  // 把 harness 整支藏在构建期开关后面。但 Next 只内联**环境里存在**的
  // NEXT_PUBLIC_* —— 变量完全未设置时，那个表达式原样留到运行期，打包器
  // 无从判死，134KB 的 harness UI（App/ui/SwapPanel）照样被打成 chunk 并从
  // out/dev/harness.html 的 react-loadable-manifest 引用，等于把一个主网签名
  // 调试台以可下载的静态文件形式放在产品域名上。page.tsx 里的 notFound()
  // 只挡渲染，不挡分发。
  //
  // 这里把它规整成确定的字面量 'true' / 'false'，于是无论部署环境配没配，
  // 打包器都能折叠那个三元。实测：加这段之前，变量未设置时 out/ 里能搜到
  // 「实跑台」「花真钱」「确认并执行」；加之后 0 命中。
  //
  // 也就是说：**留空现在等于关闭**。删掉这段就不再是了。
  // ==========================================================================
  env: {
    NEXT_PUBLIC_ENABLE_HARNESS:
      process.env.NEXT_PUBLIC_ENABLE_HARNESS === "true" ? "true" : "false",
  },
  images: {
    // 静态导出没有 Next 图片优化服务，直接输出原始 <img>
    unoptimized: true,
  },

  // ==========================================================================
  // ⚠⚠⚠ 别动这一行。⚠⚠⚠
  //
  // 这是 harness 开发代理（src/app/api/harness/proxy/[...slug]/route.dev.ts）
  // **唯一的**「只在开发期存在」开关，而它看起来只是一句无关痛痒的配置。
  //
  // 为什么需要它：上面 `output: "export"` 是纯静态导出，Next 的文档
  // （node_modules/next/dist/docs/01-app/02-guides/static-exports.md §Unsupported
  // Features）明确列着「依赖 Request 的 Route Handler」不被支持 —— 那个代理逐字段
  // 读请求（method / headers / body / query）并转发出去，是最"依赖 Request"的一种，
  // `next build` 会当场失败。而线上 Cloudflare Pages 上根本没有服务端运行时，
  // 就算构建过了它也不会工作。
  //
  // 它是怎么起作用的：Next 只把 `route.<pageExtensions 里的某一个>` 当成 Route
  // Handler（node_modules/next/dist/server/lib/find-page-file.js 的
  // createValidFileMatcher，正则是 `[\\/]route\.(?:<ext>|…)$`）。代理文件名叫
  // `route.dev.ts`：
  //   - 开发期 `dev.ts` 在名单里 → 它是一个正常注册的 Route Handler；
  //   - 生产构建时名单里没有 `dev.ts` → 整个文件对 Next 而言只是一个普通的同目录
  //     文件，不进路由表、不参与静态导出，`next build` 照常产出 out/。
  //
  // 三种「顺手清理」都会炸，且症状都不指向这里：
  //   - 把 `dev.ts` 从这个数组里删掉（"看着像没用的扩展名"）→ dev 下 /v1、
  //     /v2/swaps、/test-env/v1 全部 404，而页面上表现成后端没起来；
  //   - 把 pageExtensions 直接写成常量数组（"分支太绕"）→ `next build` 失败，
  //     报 Route Handler 与 output: export 不兼容；
  //   - 把 route.dev.ts 改名成 route.ts（"统一命名"）→ 同上，构建失败。
  //
  // 默认值 ["tsx","ts","jsx","js"] 抄自 Next 自己的默认，改动它会影响**所有**
  // page/layout 文件的识别，所以这里只做"追加"，不做替换。
  // ==========================================================================
  pageExtensions: isDev ? ["tsx", "ts", "jsx", "js", "dev.ts"] : ["tsx", "ts", "jsx", "js"],

  // 开发环境对齐生产的 _redirects 重写：路径式详情 URL 也走壳页。
  // 生产构建（NODE_ENV=production）返回空数组，不参与静态导出。
  async rewrites() {
    if (!isDev) return [];

    return [
      { source: "/token/:chain/:address", destination: "/token?chain=:chain&address=:address" },
      { source: "/smart-money/:chain/:address", destination: "/smart-money?chain=:chain&address=:address" },
      { source: "/user/:identifier", destination: "/user" },

      // harness 的后端调用全部走相对路径（`''` 或 `'/test-env'` 前缀，见
      // migration-spec §5.4），这三条把它们接到上面那个 Route Handler 上。
      // 目标源与「摘不摘 Origin」由 route.dev.ts 里的 RULES 决定，这里只负责把
      // 原始路径原样带过去 —— 两边的前缀必须一一对应，改一边就得改另一边。
      //
      // 顺序与 RULES 无关（三条前缀互不重叠），但 `/test-env/v1` 必须在
      // `/v1` 之前能被单独识别，所以它自带完整前缀、不复用 `/v1`。
      { source: "/test-env/v1/:path*", destination: "/api/harness/proxy/test-env/v1/:path*" },
      { source: "/v2/swaps/:path*", destination: "/api/harness/proxy/v2/swaps/:path*" },
      { source: "/v1/:path*", destination: "/api/harness/proxy/v1/:path*" },
    ];
  },
};

export default nextConfig;
