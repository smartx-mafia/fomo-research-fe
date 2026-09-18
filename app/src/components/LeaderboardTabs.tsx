'use client';

import {Tabs} from 'radix-ui';
import {useEffect, useState} from 'react';
import {LeaderboardView} from './LeaderboardView';
import {UnifiedLeaderboardView} from './UnifiedLeaderboardView';

export function LeaderboardTabs() {
  const [tab, setTab] = useState('wallets');
  useEffect(() => {
    const sync = () => setTab(window.location.hash === '#unified' ? 'unified' : 'wallets');
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  return <Tabs.Root value={tab} onValueChange={(value) => {setTab(value); window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${value === 'unified' ? '#unified' : ''}`);}} className="space-y-5">
    <Tabs.List aria-label="榜单类型" className="inline-flex gap-1 rounded-lg border border-border bg-surface p-1">
      {[['wallets', '聪明钱榜单'], ['unified', '统一榜单']].map(([value, label]) => <Tabs.Trigger key={value} value={value} className="rounded-md px-4 py-2 text-sm text-muted outline-none focus-visible:ring-2 focus-visible:ring-accent data-[state=active]:bg-surface-2 data-[state=active]:text-foreground">{label}</Tabs.Trigger>)}
    </Tabs.List>
    <Tabs.Content value="wallets"><LeaderboardView /></Tabs.Content>
    <Tabs.Content value="unified"><UnifiedLeaderboardView /></Tabs.Content>
  </Tabs.Root>;
}
