import type { NextConfig } from "next";

// 临时联调：直连 13.52.177.63:8080（HTTP，非 https）
const API_BASE = process.env.NEXT_PUBLIC_MARKET_API_BASE || "http://13.52.177.63:8080";
// 用户域登录后端（privy-login-demo 迁移）。浏览器一律打相对路径 /v1，
// 由同源 rewrites 转发绕 CORS（后端不发 Access-Control-Allow-Origin）。
const BUSINESS_ORIGIN = process.env.BUSINESS_ORIGIN || "http://13.231.246.26:8080";

const nextConfig: NextConfig = {
  // Privy 的 createOnLogin 是不幂等副作用，StrictMode 双跑 effect 会建两只钱包
  //（见 src/components/PrivyProviders.tsx 注释），与 privy-login-demo 保持一致关掉。
  reactStrictMode: false,

  // 开发期浏览器通过公网 IP / 本机回环访问 dev server，需放行 /_next 静态资源的跨域加载
  allowedDevOrigins: ["13.52.177.63", "127.0.0.1", "localhost"],

  // 后端 HTTP 面暂未返回 CORS 头，浏览器直连 :8080 会被拦。
  // 浏览器端统一走同源 /market-api，由 Next 透明转发（纯转发，无业务逻辑）；
  // WS 不受 CORS 约束，仍由浏览器直连 ws://…:8080/ws。
  // 后端加上 Access-Control-Allow-Origin 后可移除本条，恢复浏览器直连。
  async rewrites() {
    return [
      { source: "/market-api/:path*", destination: `${API_BASE}/:path*` },
      { source: "/v1/:path*", destination: `${BUSINESS_ORIGIN}/v1/:path*` },
    ];
  },
};

export default nextConfig;
