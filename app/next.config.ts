import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Privy 的 createOnLogin 是不幂等副作用，StrictMode 双跑 effect 会建两只钱包
  //（见 src/components/PrivyProviders.tsx 注释），与 privy-login-demo 保持一致关掉。
  reactStrictMode: false,

  // 开发期浏览器通过公网 IP / 本机回环访问 dev server，需放行 /_next 静态资源的跨域加载
  allowedDevOrigins: ["13.52.177.63", "127.0.0.1", "localhost"],

  // Cloudflare Pages 按纯静态站点托管（构建输出目录 out）。应用无 API 路由、
  // 无服务端取数，详情页路径式 URL 由 public/_redirects 重写到 /token、
  // /smart-money 壳页后客户端渲染（见 src/hooks/useDetailRouteParams.ts）。
  output: "export",
  images: {
    // 静态导出没有 Next 图片优化服务，直接输出原始 <img>
    unoptimized: true,
  },

  // 开发环境对齐生产的 _redirects 重写：路径式详情 URL 也走壳页。
  // 生产构建（NODE_ENV=production）返回空数组，不参与静态导出。
  async rewrites() {
    if (process.env.NODE_ENV === "development") {
      return [
        { source: "/token/:chain/:address", destination: "/token?chain=:chain&address=:address" },
        { source: "/smart-money/:chain/:address", destination: "/smart-money?chain=:chain&address=:address" },
      ];
    }
    return [];
  },
};

export default nextConfig;
