import { SquareFeed, type SquareLaneSlug } from '@/components/SquareFeed';

type SquarePageProps = {
  searchParams: Promise<{
    mode?: string | string[];
    lane?: string | string[];
  }>;
};

const VALID_LANES = new Set<SquareLaneSlug>(['for-you', 'newest', 'friends']);

export default async function SquarePage({searchParams}: SquarePageProps) {
  const query = await searchParams;
  const laneValue = Array.isArray(query.lane) ? query.lane[0] : query.lane;
  const initialLane = laneValue && VALID_LANES.has(laneValue as SquareLaneSlug)
    ? laneValue as SquareLaneSlug
    : 'for-you';

  // Next Link 到同一路由但不同 lane 时页面可能复用；key 确保新服务端参数成为真实初态。
  // SquareFeed 内部用 history.pushState 的 Lane 切换不会触发该重挂载。
  return <SquareFeed key={initialLane} initialLane={initialLane} />;
}
