'use client';

import {useState, type ReactNode} from 'react';
import useSWR from 'swr';
import {getSmartMoneyDetail, smartMoneyDetailQueryKey, type SmartMoneyDetailQuery} from '@/api/smartmoney-detail';

/**
 * 新榜详情页的身份头部：/v1/smartmoney/detail 返回的资料、来源标签与
 * 关注者数。身份加载失败不阻塞下方持仓/交易内容。
 */
export function SmartMoneyDetailHeader({query, fallbackName, subtitle, actions}: {
  query: SmartMoneyDetailQuery;
  fallbackName: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  const detail = useSWR(['smartmoney-detail', smartMoneyDetailQueryKey(query)], () => getSmartMoneyDetail(query), {shouldRetryOnError: false});
  const [failedAvatar, setFailedAvatar] = useState<string>();
  const data = detail.data;
  const profile = data?.profile;
  const name = profile?.display_name || profile?.username || fallbackName;
  const avatar = profile?.avatar_url && /^https?:\/\//i.test(profile.avatar_url) && failedAvatar !== profile.avatar_url ? profile.avatar_url : undefined;
  const tags = profile?.source_tags?.length ? profile.source_tags : (profile?.tags ?? []).map((code) => ({code, logo_url: ''}));
  return <header className="rounded-xl border border-border bg-surface p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-sm font-semibold text-muted">
          {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" onError={() => setFailedAvatar(avatar)} /> : name.slice(0, 1).toUpperCase() || '?'}
        </div>
        <div className="min-w-0">
          <h1 className="break-all text-xl font-semibold" title={name}>{name}</h1>
          {subtitle ? <p className="mt-1 break-all text-xs text-muted">{subtitle}</p> : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
            {tags.map((tag) => <SourceTag key={tag.code} code={tag.code} logo={tag.logo_url} />)}
            {profile?.x_handle ? <a className="text-accent hover:underline" href={`https://x.com/${encodeURIComponent(profile.x_handle)}`} target="_blank" rel="noopener noreferrer">@{profile.x_handle}</a> : null}
            {data ? <span>关注者 {data.follower_count ?? 0}</span> : null}
          </div>
        </div>
      </div>
      {actions}
    </div>
    {detail.error ? <p role="alert" className="mt-3 text-xs text-down">身份详情加载失败。<button type="button" className="ml-1 underline" onClick={() => void detail.mutate()}>重试</button></p> : null}
    {data?.enabled === false ? <p role="status" className="mt-3 text-xs text-accent">该聪明钱身份已停用，下方为历史数据。</p> : null}
  </header>;
}

function SourceTag({code, logo}: {code: string; logo: string}) {
  const [failed, setFailed] = useState(false);
  const src = !failed && /^https?:\/\//i.test(logo) ? logo : undefined;
  return <span className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5">
    {src ? <img src={src} alt="" className="h-3.5 w-3.5 rounded-sm object-cover" onError={() => setFailed(true)} /> : null}
    {code}
  </span>;
}
