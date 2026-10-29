'use client';

import { useEffect, useState } from 'react';
import { SquareFeed, type SquareLaneSlug } from '@/components/SquareFeed';

const VALID_LANES: readonly SquareLaneSlug[] = ['for-you', 'newest', 'friends'];

/** 静态导出下无法在服务端读 searchParams，lane 初态挂载后从地址栏解析。 */
export default function SquarePage() {
  const [initialLane, setInitialLane] = useState<SquareLaneSlug>('for-you');

  useEffect(() => {
    const lane = new URLSearchParams(window.location.search).get('lane');
    if (lane && (VALID_LANES as readonly string[]).includes(lane)) {
      setInitialLane(lane as SquareLaneSlug);
    }
  }, []);

  // 沿用旧服务端实现的语义：lane 初态变化时强制重挂载，确保新参数成为真实初态。
  // SquareFeed 内部用 history.pushState 的 Lane 切换不会触发该重挂载。
  return <SquareFeed key={initialLane} initialLane={initialLane} />;
}
