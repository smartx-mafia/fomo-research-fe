const labels = {
  en: {title: 'Notifications', recent: 'Recent', markAll: 'Mark all read', allRead: 'All read', back: 'Back to profile', settings: 'Notification settings', refresh: 'Refresh', loading: 'Loading…', more: 'Load more', empty: 'No notifications yet', emptyBody: 'New activity will appear here.', retry: 'Retry', failed: 'Could not load notifications', countFailed: 'Unread count unavailable', mutationFailed: 'Could not update read status', read: 'Mark as read', unread: 'Unread', now: 'now'},
  'zh-CN': {title: '通知', recent: '最近', markAll: '全部标为已读', allRead: '全部已读', back: '返回个人主页', settings: '通知设置', refresh: '刷新', loading: '加载中…', more: '加载更多', empty: '暂无通知', emptyBody: '新的动态会显示在这里。', retry: '重试', failed: '通知加载失败', countFailed: '未读数暂不可用', mutationFailed: '更新已读状态失败', read: '标为已读', unread: '未读', now: '刚刚'},
  'zh-TW': {title: '通知', recent: '最近', markAll: '全部標為已讀', allRead: '全部已讀', back: '返回個人主頁', settings: '通知設定', refresh: '重新整理', loading: '載入中…', more: '載入更多', empty: '暫無通知', emptyBody: '新的動態會顯示在這裡。', retry: '重試', failed: '通知載入失敗', countFailed: '未讀數暫不可用', mutationFailed: '更新已讀狀態失敗', read: '標為已讀', unread: '未讀', now: '剛剛'},
  ja: {title: '通知', recent: '最近', markAll: 'すべて既読', allRead: 'すべて既読です', back: 'プロフィールに戻る', settings: '通知設定', refresh: '更新', loading: '読み込み中…', more: 'さらに表示', empty: '通知はありません', emptyBody: '新しいアクティビティがここに表示されます。', retry: '再試行', failed: '通知を読み込めませんでした', countFailed: '未読件数を取得できません', mutationFailed: '既読状態を更新できませんでした', read: '既読にする', unread: '未読', now: 'たった今'},
  ko: {title: '알림', recent: '최근', markAll: '모두 읽음', allRead: '모두 읽었습니다', back: '프로필로 돌아가기', settings: '알림 설정', refresh: '새로 고침', loading: '불러오는 중…', more: '더 보기', empty: '알림이 없습니다', emptyBody: '새 활동이 여기에 표시됩니다.', retry: '다시 시도', failed: '알림을 불러오지 못했습니다', countFailed: '읽지 않은 알림 수를 가져올 수 없습니다', mutationFailed: '읽음 상태를 업데이트하지 못했습니다', read: '읽음으로 표시', unread: '읽지 않음', now: '방금'},
  es: {title: 'Notificaciones', recent: 'Recientes', markAll: 'Marcar todo como leído', allRead: 'Todo leído', back: 'Volver al perfil', settings: 'Ajustes de notificaciones', refresh: 'Actualizar', loading: 'Cargando…', more: 'Cargar más', empty: 'No hay notificaciones', emptyBody: 'La actividad nueva aparecerá aquí.', retry: 'Reintentar', failed: 'No se pudieron cargar las notificaciones', countFailed: 'Recuento no disponible', mutationFailed: 'No se pudo actualizar el estado', read: 'Marcar como leído', unread: 'Sin leer', now: 'ahora'},
};

export function notificationLanguage(value?: string) {
  const language = (value ?? 'en').trim().replaceAll('_', '-').toLowerCase();
  if (['zh-tw', 'zh-hant', 'zh-hk'].includes(language)) return 'zh-TW';
  if (['zh', 'zh-cn', 'zh-hans'].includes(language)) return 'zh-CN';
  const base = language.split('-')[0];
  return Object.hasOwn(labels, base) ? base as keyof typeof labels : 'en';
}

export function notificationLabels(language?: string) { return labels[notificationLanguage(language)]; }

export function notificationAge(seconds: number, language: string, now = Date.now()): string {
  const elapsed = Math.max(0, Math.floor((now - seconds * 1000) / 1000));
  if (elapsed < 60) return notificationLabels(language).now;
  // The English design uses compact labels (8m / 2h), not phrases such as "8m ago".
  if (notificationLanguage(language) === 'en') {
    if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m`;
    if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h`;
    if (elapsed < 604800) return `${Math.floor(elapsed / 86400)}d`;
    return `${Math.floor(elapsed / 604800)}w`;
  }
  const [size, unit]: [number, Intl.RelativeTimeFormatUnit] = elapsed < 3600 ? [60, 'minute'] : elapsed < 86400 ? [3600, 'hour'] : [86400, 'day'];
  return new Intl.RelativeTimeFormat(notificationLanguage(language), {numeric: 'auto', style: 'narrow'}).format(-Math.floor(elapsed / size), unit);
}
