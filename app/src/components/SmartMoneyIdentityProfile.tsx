'use client';

import useSWR from 'swr';
import {getSmartMoneyIdentityDetail} from '@/api/smartmoney-identity';
import {SmartMoneySourcePanels} from '@/components/SmartMoneySourcePanels';
import {useSession} from '@/session/storage';
import type {SmartMoneyIdentityRoute} from '@/hooks/useSmartMoneyIdentityRoute';

export function SmartMoneyIdentityProfile({route}: {route: Extract<SmartMoneyIdentityRoute, {status: 'subject' | 'wallet'}>}) {
  const session = useSession();
  const identityKey = route.status === 'subject' ? `user:${route.subjectId}` : `wallet:${route.namespace}:${route.walletAddress}`;
  const sourceKey = route.status === 'wallet' ? `${identityKey}:${route.sourceChain ?? ''}` : identityKey;
  const detail = useSWR(['smartmoney-identity-detail', identityKey, session?.jwt ?? 'anonymous'], () => {
    const identity = route.status === 'subject' ? {subjectId: route.subjectId} : {namespace: route.namespace, walletAddress: route.walletAddress};
    return getSmartMoneyIdentityDetail(identity, session?.jwt).then((result) => result.data);
  }, {shouldRetryOnError: false, revalidateOnFocus: true});
  const profile = detail.data?.profile;
  const title = profile?.display_name || profile?.username || (route.status === 'subject' ? route.subjectId : route.walletAddress);

  return <div className="space-y-4">
    {detail.error ? <div role="alert" className="rounded-xl border border-down/40 bg-down/5 p-5 text-sm text-down">聪明钱资料加载失败。<button type="button" onClick={() => void detail.mutate()} className="ml-3 underline">重试</button></div> : null}
    {detail.isLoading && !detail.data ? <div className="h-36 animate-pulse rounded-xl bg-surface" /> : null}
    {!detail.isLoading ? <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-muted">外部聪明钱</p><h1 className="mt-1 text-xl font-semibold text-foreground">{title}</h1></div>{detail.data ? <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted">{detail.data.enabled ? '已收录' : '未收录'}</span> : null}</div>
      <p className="mt-2 break-all font-mono text-xs text-muted">{route.status === 'subject' ? route.subjectId : `${route.namespace}:${route.walletAddress}`}</p>
      {detail.data ? <div className="mt-3 flex flex-wrap items-center gap-2">{(profile?.source_tags ?? []).filter((tag) => tag.code !== 'X').map((tag) => <span key={tag.code} className="rounded border border-border px-2 py-1 text-xs text-muted">{tag.code}</span>)}<span className="text-xs text-muted">{detail.data.follower_count} 位关注者</span></div> : null}
      {profile?.x_handle ? <a className="mt-3 inline-block text-sm text-accent hover:underline" href={`https://x.com/${encodeURIComponent(profile.x_handle)}`} target="_blank" rel="noreferrer">@{profile.x_handle}</a> : null}
    </section> : null}
    <SmartMoneySourcePanels key={sourceKey} route={route} />
  </div>;
}
