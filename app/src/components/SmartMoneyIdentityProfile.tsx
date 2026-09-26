'use client';

import useSWR from 'swr';
import {getSmartMoneyIdentityDetail} from '@/api/smartmoney-identity';
import {useSession} from '@/session/storage';
import type {SmartMoneyIdentityRoute} from '@/hooks/useSmartMoneyIdentityRoute';

export function SmartMoneyIdentityProfile({route}: {route: Extract<SmartMoneyIdentityRoute, {status: 'subject' | 'wallet'}>}) {
  const session = useSession();
  const identityKey = route.status === 'subject' ? `user:${route.subjectId}` : `wallet:${route.namespace}:${route.walletAddress}`;
  const detail = useSWR(['smartmoney-identity-detail', identityKey, session?.jwt ?? 'anonymous'], () => {
    const identity = route.status === 'subject' ? {subjectId: route.subjectId} : {namespace: route.namespace, walletAddress: route.walletAddress};
    return getSmartMoneyIdentityDetail(identity, session?.jwt).then((result) => result.data);
  }, {shouldRetryOnError: false, revalidateOnFocus: true});
  const profile = detail.data?.profile;
  const title = profile?.display_name || profile?.username || (route.status === 'subject' ? route.subjectId : route.walletAddress);

  if (detail.error) return <div role="alert" className="rounded-xl border border-down/40 bg-down/5 p-5 text-sm text-down">聪明钱资料加载失败。{detail.error instanceof Error ? ` ${detail.error.message}` : ''}<button onClick={() => void detail.mutate()} className="ml-3 underline">重试</button></div>;
  if (detail.isLoading || !detail.data) return <div className="h-36 animate-pulse rounded-xl bg-surface" />;

  return <div className="space-y-4">
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-muted">外部聪明钱</p><h1 className="mt-1 text-xl font-semibold text-foreground">{title}</h1></div><span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted">{detail.data.enabled ? '已收录' : '未收录'}</span></div>
      <p className="mt-2 break-all font-mono text-xs text-muted">{route.status === 'subject' ? route.subjectId : `${route.namespace}:${route.walletAddress}`}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">{(profile?.source_tags ?? []).filter((tag) => tag.code !== 'X').map((tag) => <span key={tag.code} className="rounded border border-border px-2 py-1 text-xs text-muted">{tag.code}</span>)}<span className="text-xs text-muted">{detail.data.follower_count} 位关注者</span></div>
      {profile?.x_handle ? <a className="mt-3 inline-block text-sm text-accent hover:underline" href={`https://x.com/${encodeURIComponent(profile.x_handle)}`} target="_blank" rel="noreferrer">@{profile.x_handle}</a> : null}
    </section>
    <div role="note" className="rounded-lg border border-accent/25 bg-accent/5 px-4 py-3 text-xs leading-5 text-muted">当前已接入身份资料。新链上仓位、逐笔交易和增量 PnL 接口尚未对 Web 开放，因此此页不会用旧单地址快照拼成跨链仓位或用户 PnL。</div>
  </div>;
}
