import {call} from './envelope';

export type NotificationActor = {type: string; id: string; user_type: number; display_name: string; avatar_url: string};
export type NotificationPresentation = {
  version: number; language: string; kind: string; icon: string; badge: string;
  actor: NotificationActor | null;
  subtitle: string;
  status: {code: string; text: string; tone: string} | null;
};
export type NotificationItem = {
  id: string; code: string; title: string; content: string; is_read: boolean; created_at: number;
  presentation: NotificationPresentation | null;
};
export type NotificationPage = {list: NotificationItem[]; total: number; page: number; page_size: number};
export type NotificationUnread = {total: number; tabs: Record<string, number>};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeItem(value: unknown): NotificationItem {
  if (!record(value) || !/^[1-9]\d*$/.test(String(value.id)) || typeof value.title !== 'string' ||
      typeof value.content !== 'string' || typeof value.code !== 'string' || typeof value.is_read !== 'boolean' ||
      typeof value.created_at !== 'number' || !Number.isFinite(value.created_at) || value.created_at < 0 || value.created_at > 8.64e12) throw new Error('Invalid notification data');
  const p = value.presentation;
  let presentation: NotificationPresentation | null = null;
  // Future display versions fall back to the existing complete title/content.
  if (record(p) && p.version === 1 && typeof p.language === 'string' && typeof p.subtitle === 'string') {
    const a = p.actor;
    const actor = record(a) && [1, 2].includes(Number(a.user_type)) && typeof a.id === 'string' &&
      typeof a.display_name === 'string' && typeof a.avatar_url === 'string'
      ? {type: String(a.type ?? ''), id: a.id, user_type: Number(a.user_type), display_name: a.display_name, avatar_url: a.avatar_url} : null;
    const s = p.status;
    presentation = {version: 1, language: p.language, kind: String(p.kind ?? value.code), icon: String(p.icon ?? ''),
      badge: String(p.badge ?? ''), actor, subtitle: p.subtitle,
      status: record(s) && typeof s.text === 'string' && typeof s.code === 'string'
        ? {code: s.code, text: s.text, tone: String(s.tone ?? '')} : null};
  }
  return {id: String(value.id), code: value.code, title: value.title, content: value.content,
    is_read: value.is_read, created_at: value.created_at, presentation};
}

export async function getNotifications(bearer: string, page = 1, signal?: AbortSignal): Promise<NotificationPage> {
  const result = await call<unknown>(`/notification/list?page=${page}&page_size=20&mark_read=false`,
    {bearer, signal, preserveInt64Fields: ['id']});
  const data = result.data;
  if (!record(data) || !Array.isArray(data.list) || !Number.isInteger(data.total) || Number(data.total) < 0 ||
      !Number.isInteger(data.page) || Number(data.page) < 1 || !Number.isInteger(data.page_size) || Number(data.page_size) < 1) {
    throw new Error('Invalid notification page');
  }
  return {list: data.list.map(normalizeItem), total: Number(data.total), page: Number(data.page), page_size: Number(data.page_size)};
}

export async function getNotificationUnread(bearer: string, signal?: AbortSignal): Promise<NotificationUnread> {
  const {data} = await call<NotificationUnread>('/notification/unread_count', {bearer, signal});
  if (!record(data) || !Number.isInteger(data.total) || data.total < 0) throw new Error('Invalid unread count');
  return data;
}

export async function markNotificationRead(bearer: string, id: string) {
  if (!/^[1-9]\d*$/.test(id)) throw new Error('Invalid notification id');
  await call(`/notification/read?id=${id}`, {bearer});
}

export async function markAllNotificationsRead(bearer: string) {
  await call('/notification/read_all', {bearer});
}
