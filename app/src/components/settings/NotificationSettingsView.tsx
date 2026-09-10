'use client';

import {useCallback, useEffect, useState} from 'react';

import {ApiError} from '@/api/envelope';
import {
  getNotificationSettings,
  setFollowingEnabled,
  setPushEnabled,
  type NotificationSettings,
} from '@/api/settings';
import {ErrorPanel} from '@/components/ErrorPanel';
import {LoginGate} from '@/components/settings/LoginGate';
import {SettingsNav} from '@/components/settings/SettingsNav';
import {ToggleRow} from '@/components/settings/ToggleRow';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {useSession} from '@/session/storage';

/**
 * Notifications 页（settings-integration.md §4）：两个开关，回包整页。
 * 开关只是状态 —— 通知中心是否真按它过滤取决于服务端接线，前端不因此
 * 本地拦截 WS 推送。读到不认识的字段忽略。
 */
export function NotificationSettingsView() {
  const session = useSession();
  const jwt = session?.jwt ?? null;
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!jwt) return;
    try {
      const res = await getNotificationSettings(jwt);
      setSettings(res.data);
      setErr(null);
    } catch (e) {
      setErr(e as ApiError);
    }
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!jwt) return <LoginGate />;

  const toggle = (key: 'push' | 'following', fn: (b: string, v: boolean) => Promise<{data: NotificationSettings}>) => {
    if (!settings) return;
    const prev = settings;
    const next = {...settings, [key]: !settings[key]};
    setSettings(next);
    setBusy(true);
    void fn(jwt, !!next[key])
      .then((res) => setSettings(res.data))
      .catch((e: unknown) => {
        setSettings(prev);
        setErr(e as ApiError);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-4">
      <SettingsNav active="/settings/notifications" />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-muted-foreground text-sm">改一个开关回整页（POST 回包直接覆盖本地状态）。</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">通知</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <ToggleRow
            label="Push notifications"
            desc="系统推送总开关（默认开）。"
            checked={!!settings?.push}
            disabled={busy || !settings}
            onToggle={() => toggle('push', setPushEnabled)}
          />
          <ToggleRow
            label="People you follow"
            desc="「我关注的人」类通知（默认开）。"
            checked={!!settings?.following}
            disabled={busy || !settings}
            onToggle={() => toggle('following', setFollowingEnabled)}
          />
        </CardContent>
      </Card>

      {err && <ErrorPanel err={err} />}
    </div>
  );
}
