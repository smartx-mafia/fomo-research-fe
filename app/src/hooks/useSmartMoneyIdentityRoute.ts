'use client';

import {usePathname, useSearchParams} from 'next/navigation';
import {useEffect, useState} from 'react';
import {parseSmartMoneyIdentityRoute, type SmartMoneyIdentityRoute} from '@/lib/smartmoney-identity';

export type {SmartMoneyIdentityRoute} from '@/lib/smartmoney-identity';

export function useSmartMoneyIdentityRoute(): SmartMoneyIdentityRoute {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const routeKey = `${pathname}?${search}`;
  const [location, setLocation] = useState<{key: string; pathname: string; search: string} | null>(null);

  // Read the address bar after hydration: static-host rewrites keep the wallet path.
  // Key the captured URL so soft navigation cannot briefly render the previous identity.
  useEffect(() => {
    setLocation({key: routeKey, pathname: window.location.pathname, search});
  }, [routeKey, search]);

  if (!location || location.key !== routeKey) return {status: 'pending'};
  return parseSmartMoneyIdentityRoute(location.pathname, new URLSearchParams(location.search));
}
