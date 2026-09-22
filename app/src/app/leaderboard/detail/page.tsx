'use client';

import {Suspense} from 'react';
import {useSearchParams} from 'next/navigation';
import {parseLeaderboardDetail} from '@/lib/leaderboard-detail';
import {LeaderboardDetailView} from '@/components/LeaderboardDetailView';

function DetailGate() {
  const query = useSearchParams();
  const target = parseLeaderboardDetail(new URLSearchParams(query.toString()));
  if (!target) return <div className="space-y-4"><a href="/leaderboard#leaderboard" className="text-accent">← 返回 leaderboard</a><p role="alert">详情链接不完整，请从榜单重新进入。</p></div>;
  return <LeaderboardDetailView key={query.toString()} target={target} />;
}

export default function LeaderboardDetailPage() {
  return <Suspense fallback={<p className="p-6 text-muted">加载详情…</p>}><DetailGate /></Suspense>;
}
