'use client';

import {useCallback, useMemo, useRef, useState} from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import {getNotificationUnread, getNotifications, markAllNotificationsRead, markNotificationRead, type NotificationPage} from '@/api/notifications';

export function useNotifications(bearer: string, language: string) {
  const unread = useSWR(['notifications-unread', bearer], () => getNotificationUnread(bearer),
    {refreshInterval: 30000, shouldRetryOnError: false});
  const list = useSWRInfinite<NotificationPage>(
    (index, previous) => previous && previous.page * previous.page_size >= previous.total
      ? null : ['notifications-list', bearer, language, index + 1],
    ([, , , page]: readonly [string, string, string, number]) => getNotifications(bearer, page),
    {shouldRetryOnError: false, revalidateOnFocus: true, refreshInterval: 30000, revalidateAll: true},
  );
  const items = useMemo(() => {
    const unique = new Map<string, NotificationPage['list'][number]>();
    for (const page of list.data ?? []) for (const item of page.list) if (!unique.has(item.id)) unique.set(item.id, item);
    return [...unique.values()];
  }, [list.data]);
  const last = list.data?.at(-1);
  const hasMore = !!last && last.page * last.page_size < last.total;
  const loadingMore = !!list.data && list.data.length < list.size && !list.error;
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<unknown>();
  const locked = useRef(false);

  const read = useCallback(async (id?: string) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMutationError(undefined);
    try {
      if (id) await markNotificationRead(bearer, id); else await markAllNotificationsRead(bearer);
      // Only update after a successful write. A failed write leaves all dots intact.
      await list.mutate((pages) => pages?.map((page) => ({...page,
        list: page.list.map((item) => !id || item.id === id ? {...item, is_read: true} : item),
      })), {revalidate: false});
      await Promise.allSettled([unread.mutate(), list.mutate()]);
    } catch (error) { setMutationError(error); }
    finally { locked.current = false; setBusy(false); }
  }, [bearer, list.mutate, unread.mutate]);

  const refresh = useCallback(async () => {
    await list.setSize(1);
    await Promise.all([list.mutate(), unread.mutate()]);
  }, [list.setSize, list.mutate, unread.mutate]);

  return {items, list, unread, hasMore, loadingMore, busy, mutationError, read, refresh,
    loadMore: () => {if (hasMore && !loadingMore && !list.isValidating) void list.setSize(list.size + 1).catch(() => undefined);}};
}
