import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Privy 的 createOnLogin 是不幂等副作用，StrictMode 双跑 effect 会建两只钱包
  //（见 src/components/PrivyProviders.tsx 注释），与 privy-login-demo 保持一致关掉。
  reactStrictMode: false,

  // 开发期浏览器通过公网 IP / 本机回环访问 dev server，需放行 /_next 静态资源的跨域加载
  allowedDevOrigins: ["13.52.177.63", "127.0.0.1", "localhost"],

};

export default nextConfig;
