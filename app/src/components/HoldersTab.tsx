'use client';

import Link from 'next/link';
import {useState} from 'react';
import type {HolderSource, HolderScope} from '@/api/token-holder-list';
import {useSession} from '@/session/storage';
import {HolderListPanel} from './HolderListPanel';

const tabs: {id: string; label: string; source: HolderSource; scope: HolderScope}[] = [
  {id: 'smartx', label: 'SmartX', source: 'smartx', scope: 'all'},
  {id: 'smart-money', label: 'Smart Money', source: 'smart_money', scope: 'all'},
  {id: 'followed', label: 'Followed', source: 'all', scope: 'following'},
  {id: 'all', label: 'All tracked', source: 'all', scope: 'all'},
  {id: 'on-chain', label: 'On-Chain', source: 'onchain', scope: 'all'},
];
export default function HoldersTab({chain, address}: {chain: string; address: string}) {
  const session = useSession();
  const [tab, setTab] = useState(tabs[0]);
  const [followingOnly, setFollowingOnly] = useState(false);
  const scope = tab.id === 'smart-money' && followingOnly ? 'following' : tab.scope;
  const needsLogin = scope === 'following' && !session;
  return <section aria-label="Token holders">
    <div role="tablist" aria-label="Holder source" className="flex gap-2 overflow-x-auto px-4 py-3">
      {tabs.map((item) => <button key={item.id} type="button" id={`holder-tab-${item.id}`} role="tab" aria-selected={tab.id === item.id} aria-controls="holder-panel" onClick={() => setTab(item)} className={`shrink-0 rounded-full px-3 py-2 text-xs ${tab.id === item.id ? 'bg-surface-2 text-foreground' : 'text-muted'}`}>{item.label}</button>)}
    </div>
    {tab.id === 'smart-money' ? <div role="group" aria-label="Holder scope" className="flex gap-3 px-4 pb-3"><button type="button" aria-pressed={!followingOnly} onClick={() => setFollowingOnly(false)}>All</button><button type="button" aria-pressed={followingOnly} onClick={() => setFollowingOnly(true)}>Following</button></div> : null}
    <div id="holder-panel" role="tabpanel" aria-labelledby={`holder-tab-${tab.id}`}>
      {needsLogin ? <p className="p-4 text-sm text-muted"><Link href="/login" className="text-accent">Sign in</Link> to see holders you follow.</p> : <HolderListPanel key={`${chain}:${address}:${tab.source}:${scope}:${session?.jwt ?? ''}`} chain={chain} address={address} source={tab.source} scope={scope} bearer={session?.jwt} />}
    </div>
  </section>;
}
