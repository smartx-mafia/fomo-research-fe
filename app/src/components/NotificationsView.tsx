'use client';

import {useEffect, useState} from 'react';
import useSWR from 'swr';
import {ArrowLeft, DollarSign, Eye, LoaderCircle, Megaphone, MessageCircle, RefreshCw, Settings, UserRound, Users} from 'lucide-react';
import type {NotificationItem} from '@/api/notifications';
import {getPreferences} from '@/api/settings';
import {useNotifications} from '@/hooks/useNotifications';
import {notificationAge, notificationLabels, notificationLanguage} from '@/lib/notification-labels';
import {useSession} from '@/session/storage';
import {NotificationBadge} from './NotificationBadge';

export function NotificationsView() {
  const session = useSession();
  if (!session) return <section className="mx-auto max-w-lg py-20 text-center">
    <h1 className="text-xl font-semibold">Notifications</h1>
    <p className="mt-3 text-sm text-muted">登录后查看你的通知 / Sign in to view your notifications.</p>
    <a href="/login" className="mt-5 inline-block text-sm text-[#00c9ad]">登录 / Sign in</a>
  </section>;
  return <NotificationAccount key={`${session.user?.identifier ?? ''}:${session.jwt}`} bearer={session.jwt} initialLanguage={session.user?.language} />;
}

function NotificationAccount({bearer, initialLanguage}: {bearer: string; initialLanguage?: string}) {
  const preferences = useSWR(['notification-language', bearer], () => getPreferences(bearer), {shouldRetryOnError: false});
  const requestLanguage = notificationLanguage(preferences.data?.data.language ?? initialLanguage);
  const state = useNotifications(bearer, requestLanguage);
  const language = notificationLanguage(state.items[0]?.presentation?.language ?? requestLanguage);
  const labels = notificationLabels(language);
  const [now, setNow] = useState(Date.now);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer);}, []);
  const total = state.unread.error ? undefined : state.unread.data?.total;
  const refresh = async () => {
    setRefreshing(true);
    try {await Promise.all([state.refresh(), preferences.mutate()]);} catch {/* SWR retains the error for the retry UI. */}
    finally {setRefreshing(false);}
  };

  return <section className="mx-auto min-h-[70vh] w-full max-w-xl overflow-hidden rounded-xl bg-black text-[#f4f4f4]" aria-label={labels.title}>
    <header className="flex items-center justify-between gap-3 px-5 py-6 sm:px-7">
      <a href="/portfolio" aria-label={labels.back} title={labels.back} className="rounded p-1 text-white hover:text-[#00c9ad]"><ArrowLeft className="size-5" /></a>
      <h1 className="text-xl font-semibold tracking-tight">{labels.title}</h1>
      <a href="/settings/notifications" aria-label={labels.settings} title={labels.settings} className="rounded p-1 text-white hover:text-[#00c9ad]"><Settings className="size-5" /></a>
    </header>
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-white/[0.08] px-5 pb-3 sm:px-7">
      <span className="text-sm text-[#878787]">{labels.recent}</span>
      <div className="flex items-center gap-3">
        <button type="button" aria-label={labels.refresh} title={labels.refresh} disabled={refreshing || state.busy} onClick={() => void refresh()} className="rounded p-1 text-[#878787] hover:text-white disabled:opacity-50">
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
        {total === undefined ? <span role="status" className="text-xs text-[#878787]">{state.unread.error ? labels.countFailed : labels.loading}</span>
          : total === 0 ? <span role="status" className="text-sm text-[#878787]">{labels.allRead}</span>
          : <button type="button" onClick={() => void state.read()} disabled={state.busy} className="text-right text-sm font-medium text-[#00c9ad] disabled:opacity-50">{labels.markAll}</button>}
      </div>
    </div>
    {state.mutationError ? <p role="alert" className="px-5 py-3 text-sm text-red-400 sm:px-7">{labels.mutationFailed}</p> : null}
    {state.list.isLoading ? <div role="status" aria-label={labels.loading} className="space-y-7 px-5 py-6 sm:px-7">{[0,1,2,3].map((key) => <div key={key} className="flex animate-pulse gap-3"><div className="size-12 rounded-full bg-white/10" /><div className="flex-1 space-y-3 py-1"><div className="h-3 w-3/4 rounded bg-white/10" /><div className="h-3 w-1/2 rounded bg-white/5" /></div></div>)}</div> : null}
    {state.list.error ? <div role="alert" className="flex items-center justify-between gap-3 px-5 py-4 text-sm text-red-400 sm:px-7"><span>{labels.failed}</span><button type="button" onClick={() => void refresh()} disabled={refreshing} className="text-[#00c9ad]">{labels.retry}</button></div> : null}
    {!state.list.isLoading && !state.list.error && state.items.length === 0 ? <div className="px-6 py-20 text-center"><Megaphone className="mx-auto mb-4 size-8 text-[#878787]" /><h2>{labels.empty}</h2><p className="mt-2 text-sm text-[#878787]">{labels.emptyBody}</p></div> : null}
    <ul aria-label={labels.recent} className="py-2">{state.items.map((item) => <NotificationRow key={item.id} item={item} language={language} now={now} disabled={state.busy} onRead={() => void state.read(item.id)} />)}</ul>
    {state.hasMore ? <div className="px-5 py-5 text-center"><button type="button" disabled={state.loadingMore || state.list.isValidating} onClick={state.loadMore} className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-5 py-2 text-sm text-[#00c9ad] disabled:opacity-50">{state.loadingMore ? <LoaderCircle className="size-4 animate-spin" /> : null}{state.loadingMore ? labels.loading : labels.more}</button></div> : null}
  </section>;
}

function NotificationAvatar({item}: {item: NotificationItem}) {
  const view = item.presentation;
  const [failed, setFailed] = useState<string>();
  const actor = view?.actor;
  const avatar = actor?.avatar_url;
  const Icon = view?.icon === 'followers' ? Users : view?.icon === 'wallet' ? DollarSign : view?.icon === 'opinion' ? MessageCircle
    : view?.icon === 'trade' ? RefreshCw : view?.icon === 'price_alert' ? Eye : Megaphone;
  return <div className="relative size-12 shrink-0" aria-hidden="true">
    <div className="flex size-full items-center justify-center overflow-hidden rounded-full bg-[#252525] text-[#efefef]">
      {avatar && failed !== avatar ? <img src={avatar} alt="" className="size-full object-cover" onError={() => setFailed(avatar)} /> : actor ? <UserRound className="size-6" /> : <Icon className="size-6" />}
    </div>
    <NotificationBadge kind={view?.badge} />
  </div>;
}

function NotificationRow({item, language, now, disabled, onRead}: {item: NotificationItem; language: string; now: number; disabled: boolean; onRead: () => void}) {
  const labels = notificationLabels(language);
  const view = item.presentation;
  const subtitle = view ? view.subtitle : item.content;
  const status = view?.status;
  // Intentionally no URL consumption: clicking only acknowledges this notification.
  return <li><button type="button" aria-label={item.is_read ? item.title : `${labels.read}: ${item.title}`} disabled={disabled || item.is_read} onClick={onRead}
    className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors enabled:hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#00c9ad] sm:px-7">
    <NotificationAvatar item={item} />
    <div className="min-w-0 flex-1 pt-0.5"><p className="break-words text-[15px] font-medium leading-5">{item.title}</p>
      {subtitle || status ? <p className="mt-1 break-words text-[13px] leading-5 text-[#878787]">{subtitle}{subtitle && status ? ' · ' : ''}{status ? <span className={status.tone === 'warning' ? 'text-yellow-400' : undefined}>{status.text}</span> : null}</p> : null}
    </div>
    <div className="flex min-w-8 shrink-0 flex-col items-end gap-2 pt-1">
      {!item.is_read ? <span aria-label={labels.unread} className="size-2 rounded-full bg-[#00c9ad]" /> : null}
      <time dateTime={new Date(item.created_at * 1000).toISOString()} title={new Date(item.created_at * 1000).toLocaleString(notificationLanguage(language))} className="whitespace-nowrap text-[11px] leading-4 text-[#878787]">{notificationAge(item.created_at, language, now)}</time>
    </div>
  </button></li>;
}
