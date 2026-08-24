import type { NextConfig } from "next";

const API_BASE = process.env.NEXT_PUBLIC_MARKET_API_BASE || "http://13.52.177.63:8080";

const nextConfig: NextConfig = {
  // 开发期浏览器通过公网 IP 访问 dev server，需放行 /_next 静态资源的跨域加载
  allowedDevOrigins: ["13.52.177.63"],

  // 后端 HTTP 面暂未返回 CORS 头，浏览器直连 :8080 会被拦。
  // 浏览器端统一走同源 /market-api，由 Next 透明转发（纯转发，无业务逻辑）；
  // WS 不受 CORS 约束，仍由浏览器直连 ws://…:8080/ws。
  // 后端加上 Access-Control-Allow-Origin 后可移除本条，恢复浏览器直连。
  async rewrites() {
    return [{ source: "/market-api/:path*", destination: `${API_BASE}/:path*` }];
  },
};

export default nextConfig;
