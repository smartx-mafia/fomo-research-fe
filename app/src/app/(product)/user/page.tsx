'use client';

import {UserProfileView, useUserRouteIdentifier} from '@/components/UserProfileView';

/**
 * /user 壳页：静态导出（output: 'export'）下 /user/:identifier 没有构建产物，
 * public/_redirects 把路径式 URL 200 重写到这里（开发环境由 next.config
 * rewrites 对齐），浏览器地址保留原路径。参数从 location.pathname（/user 后
 * 第一段）或 ?identifier= 查询串解析 —— 挂载后才可读，因此有
 * pending → ready → invalid 三态（见 useUserRouteIdentifier，
 * 复制 useDetailRouteParams 的模式）。
 */
function UserRouteGate() {
  const route = useUserRouteIdentifier();
  if (route.status === 'ready') {
    return <UserProfileView identifier={route.identifier} />;
  }
  if (route.status === 'invalid') {
    return <p className="p-6 text-sm text-muted">缺少 identifier 参数</p>;
  }
  return null;
}

export default function UserPage() {
  return <UserRouteGate />;
}
