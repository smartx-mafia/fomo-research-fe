"use client";

import { Suspense } from "react";
import { SmartMoneyProfile } from "@/components/SmartMoneyProfile";
import {SmartMoneyIdentityProfile} from '@/components/SmartMoneyIdentityProfile';
import {useSmartMoneyIdentityRoute} from '@/hooks/useSmartMoneyIdentityRoute';

/**
 * /smart-money 壳页：静态导出下 /smart-money/:chain/:address 没有构建产物，
 * 由 public/_redirects 重写到这里（开发环境由 next.config rewrites 对齐）；
 * 老地址路径和新的 subject_id / namespace 查询路由都由客户端解析。
 */
function SmartMoneyGate() {
  const route = useSmartMoneyIdentityRoute();
  if (route.status === 'subject' || route.status === 'wallet') {
    return <SmartMoneyIdentityProfile route={route} />;
  }
  if (route.status === 'legacy') {
    return <SmartMoneyProfile chain={route.chain} address={route.address} />;
  }
  if (route.status === "invalid") {
    return <p className="p-6 text-sm text-muted-foreground">聪明钱身份参数无效或不完整</p>;
  }
  return null;
}

export default function SmartMoneyPage() {
  return (
    <Suspense fallback={null}>
      <SmartMoneyGate />
    </Suspense>
  );
}
