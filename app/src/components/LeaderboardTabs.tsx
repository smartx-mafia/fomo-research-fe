'use client';

import {Tabs} from 'radix-ui';
import {useEffect, useState} from 'react';
import {UnifiedLeaderboardView} from './UnifiedLeaderboardView';
import {FollowingNewView} from './FollowingNewView';

export function LeaderboardTabs() {
  const [tab, setTab] = useState('people');
  useEffect(() => {
    const sync = () => setTab(window.location.hash === '#leaderboard' || window.location.hash === '#unified' ? 'leaderboard' : 'people');
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  return <Tabs.Root value={tab} onValueChange={(value) => {setTab(value); window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${value === 'leaderboard' ? '#leaderboard' : ''}`);}} className="space-y-5">
    <Tabs.List aria-label="榜单类型" className="inline-flex gap-1 rounded-lg border border-border bg-surface p-1">
      {[['people', 'People'], ['leaderboard', 'leaderboard']].map(([value, label]) => <Tabs.Trigger key={value} value={value} className="rounded-md px-4 py-2 text-sm text-muted outline-none focus-visible:ring-2 focus-visible:ring-accent data-[state=active]:bg-surface-2 data-[state=active]:text-foreground">{label}</Tabs.Trigger>)}
    </Tabs.List>
    <Tabs.Content value="people"><FollowingNewView /></Tabs.Content>
    <Tabs.Content value="leaderboard"><UnifiedLeaderboardView /></Tabs.Content>
  </Tabs.Root>;
}
