'use client';

import {useCallback, useEffect, useState} from 'react';

import {ApiError} from '@/api/envelope';
import {
  deletePushDevice,
  getNotificationSettings,
  listPushDevices,
  setDeviceEnabled,
  setFollowingEnabled,
  setPushEnabled,
  type NotificationSettings,
  type PushDevice,
} from '@/api/settings';
import {ErrorPanel} from '@/components/ErrorPanel';
import {LoginGate} from '@/components/settings/LoginGate';
import {SettingsNav} from '@/components/settings/SettingsNav';
import {ToggleRow} from '@/components/settings/ToggleRow';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {useSession} from '@/session/storage';

/**
 * last_active_at / created_at 可能是 Unix 秒数字、int64 被引号包成的字符串
 * （envelope 层 preserveInt64），也可能整个缺席 —— 三种都兜成 '—'。
 */
function fmtTs(ts?: number | string): string {
  if (ts === undefined || ts === '') return '—';
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return new Date(n * 1000).toLocaleString();
}

/** 设备行展示名：device_name 优先，退到型号，再退到占位（settings.md §2.2 示例）。 */
function deviceLabel(d: PushDevice): string {
  return d.device_name || d.model || '(未命名设备)';
}

/**
 * Notifications 页（settings-integration.md §4）：两个开关，回包整页。
 * 开关只是状态 —— 通知中心是否真按它过滤取决于服务端接线，前端不因此
 * 本地拦截 WS 推送。读到不认识的字段忽略。
 *
 * 下方另附「推送设备」管理卡（settings.md §2）：注册只能由移动端 App 完成
 * （Web 端拿不到 Expo push token），Web 这里只做列表 / 开关 / 删除。
 */
export function NotificationSettingsView() {
  const session = useSession();
  const jwt = session?.jwt ?? null;
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  // ── 推送设备（settings.md §2）状态 ──────────────────────────────────────
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | string | undefined>(undefined);
  const [devLoading, setDevLoading] = useState(false);
  /** 正在被开/关或删除的行 id —— 一次只动一台，其余行不受影响。 */
  const [rowBusyId, setRowBusyId] = useState<number | null>(null);
  const [devErr, setDevErr] = useState<ApiError | null>(null);

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

  /**
   * 设备列表（settings.md §2.2）：limit 恒 100（上限即 100，超过直接报错不截断）；
   * 翻页把上一页的 next_cursor 原样带回。首次与「加载更多」共用，cursor 缺席 =
   * 回第一页（覆盖），cursor 在场 = 追加。
   */
  const loadDevices = useCallback(
    async (cursor?: number | string) => {
      if (!jwt) return;
      setDevLoading(true);
      try {
        const res = await listPushDevices(jwt, cursor === undefined ? {limit: 100} : {limit: 100, cursor});
        const list = res.data.list ?? [];
        setDevices((prev) => (cursor === undefined ? list : [...prev, ...list]));
        setHasMore(!!res.data.has_more);
        setNextCursor(res.data.next_cursor);
        setDevErr(null);
      } catch (e) {
        setDevErr(e as ApiError);
      } finally {
        setDevLoading(false);
      }
    },
    [jwt],
  );

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

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

  /**
   * 开/关一台设备（settings.md §2.3）：乐观改该行，回包就是改后的整条记录，
   * 直接替换该行；失败回滚并经 ErrorPanel 呈现。与删除是两回事 —— 关掉的
   * 设备仍留在列表里。
   */
  const toggleDevice = (d: PushDevice) => {
    if (!jwt || rowBusyId !== null) return;
    const nextEnabled = !(d.enabled !== false); // enabled 缺席 = 开（默认 true）
    setDevices((rows) => rows.map((r) => (r.id === d.id ? {...r, enabled: nextEnabled} : r)));
    setRowBusyId(d.id);
    void setDeviceEnabled(jwt, d.id, nextEnabled)
      .then((res) => {
        setDevices((rows) => rows.map((r) => (r.id === d.id ? res.data : r)));
        setDevErr(null);
      })
      .catch((e: unknown) => {
        setDevices((rows) => rows.map((r) => (r.id === d.id ? {...r, enabled: !nextEnabled} : r)));
        setDevErr(e as ApiError);
      })
      .finally(() => setRowBusyId(null));
  };

  /** 删除设备（settings.md §2.4）：删除后同一台重新注册会得到新 id，确认文案点明。 */
  const removeDevice = (d: PushDevice) => {
    if (!jwt || rowBusyId !== null) return;
    if (!window.confirm('确定删除这台设备？删除后重新注册会得到新 id')) return;
    setRowBusyId(d.id);
    void deletePushDevice(jwt, d.id)
      .then(() => {
        setDevices((rows) => rows.filter((r) => r.id !== d.id));
        setDevErr(null);
      })
      .catch((e: unknown) => {
        const apiErr = e as ApiError;
        if (apiErr.code === 200109) {
          // 200109 = 设备不存在或不是你的（并发删除 / 列表已过期）——不当错误，
          // 重拉列表让 UI 与服务端对齐，而不是重试同一个删除。
          void loadDevices();
          return;
        }
        setDevErr(apiErr);
      })
      .finally(() => setRowBusyId(null));
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">推送设备</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {devices.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              暂无设备。设备注册由移动端 App 完成（Web 端拿不到 Expo push token，这里只做管理）。
            </p>
          ) : (
            <div className="divide-y divide-border">
              {devices.map((d) => (
                <div key={d.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <ToggleRow
                      label={
                        <span className="flex items-center gap-2">
                          <Badge variant={d.platform === 'android' ? 'secondary' : 'outline'}>
                            {d.platform ?? '—'}
                          </Badge>
                          <span className="truncate">{deviceLabel(d)}</span>
                        </span>
                      }
                      desc={
                        <>
                          OS {d.os_version ?? '—'} · token {d.token_masked ?? '—'}
                          <br />
                          最近活跃 {fmtTs(d.last_active_at)} · 注册于 {fmtTs(d.created_at)}
                        </>
                      }
                      checked={d.enabled !== false}
                      disabled={rowBusyId !== null || devLoading}
                      onToggle={() => toggleDevice(d)}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive shrink-0"
                    disabled={rowBusyId !== null || devLoading}
                    onClick={() => removeDevice(d)}
                  >
                    删除
                  </Button>
                </div>
              ))}
            </div>
          )}
          {hasMore && (
            <Button
              size="sm"
              variant="outline"
              disabled={devLoading || rowBusyId !== null}
              onClick={() => void loadDevices(nextCursor)}
            >
              {devLoading ? '加载中…' : '加载更多'}
            </Button>
          )}
          <p className="text-muted-foreground text-[11px]">
            开关只是停用（设备仍留在列表里，随时能开回来）；删除才会从列表消失，删除后重新注册会得到新 id。
          </p>
        </CardContent>
      </Card>

      {devErr && <ErrorPanel err={devErr} />}
      {err && <ErrorPanel err={err} />}
    </div>
  );
}
