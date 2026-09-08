'use client';

import Link from 'next/link';
import {useCallback, useEffect, useState} from 'react';

import {getUserInfo} from '@/api/auth';
import {ApiError} from '@/api/envelope';
import {
  getSecuritySettings,
  recordKeyExport,
  setAuthenticator,
  setFaceId,
  setFaceIdExportKey,
  setFaceIdOpenApp,
  setFaceIdWithdraw,
  type KeyChain,
  type SecuritySettings,
} from '@/api/settings';
import {ErrorPanel} from '@/components/ErrorPanel';
import {LoginGate} from '@/components/settings/LoginGate';
import {SettingsNav} from '@/components/settings/SettingsNav';
import {ToggleRow} from '@/components/settings/ToggleRow';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {useSession} from '@/session/storage';

const KEY_CHAINS: KeyChain[] = ['ethereum', 'bsc', 'base', 'solana'];

/**
 * Security 页（settings-integration.md §3）：五个开关只是状态位（多设备同步 UI，
 * 服务端不据此拦截），回包整页覆盖；私钥导出由 Privy SDK 完成、这里只打记录。
 */
export function SecuritySettingsView() {
  const session = useSession();
  const jwt = session?.jwt ?? null;

  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportChain, setExportChain] = useState<KeyChain>('solana');
  const [exportAddr, setExportAddr] = useState('');

  const load = useCallback(async () => {
    if (!jwt) return;
    try {
      const [sec, info] = await Promise.all([getSecuritySettings(jwt), getUserInfo(jwt)]);
      setSettings(sec.data);
      setEmail(info.data.email ?? '');
      setErr(null);
    } catch (e) {
      setErr(e as ApiError);
    }
  }, [jwt]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!jwt) return <LoginGate />;

  /** 乐观更新 + POST，回包整页覆盖；失败回滚到旧值。 */
  const toggle = (
    key: 'face_id' | 'authenticator' | 'face_id_withdraw' | 'face_id_export_key' | 'face_id_open_app',
    fn: (bearer: string, enabled: boolean) => Promise<{data: SecuritySettings}>,
  ) => {
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

  const ke = settings?.key_export;

  return (
    <div className="space-y-4">
      <SettingsNav active="/settings/security" />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Security</h1>
        <p className="text-muted-foreground text-sm">
          五个开关只是状态位：服务端不据此拦截动作，Face ID 校验发生在客户端。
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">账号与验证</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
            <span>Present（登录邮箱）</span>
            <code className="font-mono text-xs break-all">{email || '(未提供)'}</code>
          </div>
          <ToggleRow
            label="Face ID"
            desc="总开关（默认关）。关着时下面三项仍可独立设置，服务端不联动。"
            checked={!!settings?.face_id}
            disabled={busy || !settings}
            onToggle={() => toggle('face_id', setFaceId)}
          />
          <ToggleRow
            label="Authenticator"
            desc="状态位；TOTP 校验流程本期不在本域。"
            checked={!!settings?.authenticator}
            disabled={busy || !settings}
            onToggle={() => toggle('authenticator', setAuthenticator)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Require Face ID for</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <ToggleRow
            label="Withdrawing funds"
            checked={!!settings?.face_id_withdraw}
            disabled={busy || !settings}
            onToggle={() => toggle('face_id_withdraw', setFaceIdWithdraw)}
          />
          <ToggleRow
            label="Exporting key"
            checked={!!settings?.face_id_export_key}
            disabled={busy || !settings}
            onToggle={() => toggle('face_id_export_key', setFaceIdExportKey)}
          />
          <ToggleRow
            label="Opening app"
            checked={!!settings?.face_id_open_app}
            disabled={busy || !settings}
            onToggle={() => toggle('face_id_open_app', setFaceIdOpenApp)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export（私钥导出记录）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-xs">
            导出在 Privy SDK 里完成；每完成一次打一条记录（链名 + 钱包地址，
            <strong> 绝不上传私钥</strong>）。记录只增不减、没有撤销。
          </p>
          {ke?.exported ? (
            <p className="text-xs">
              已导出过 · 共 {ke.count ?? 0} 次 · 最近一次{' '}
              {ke.last_at ? new Date(Number(ke.last_at) * 1000).toLocaleString() : '—'}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">从未导出（key_export 为空对象）。</p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="ke-chain">链</Label>
              <select
                id="ke-chain"
                value={exportChain}
                onChange={(e) => setExportChain(e.target.value as KeyChain)}
                className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
              >
                {KEY_CHAINS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ke-addr">托管钱包地址</Label>
              <Input
                id="ke-addr"
                value={exportAddr}
                onChange={(e) => setExportAddr(e.target.value)}
                placeholder="本人的 Privy 托管钱包地址"
                className="max-w-md font-mono text-xs"
              />
            </div>
            <Button
              size="sm"
              disabled={busy || exportAddr.trim() === ''}
              onClick={() => {
                setBusy(true);
                void recordKeyExport(jwt, exportChain, exportAddr.trim())
                  .then((res) => setSettings((s) => (s ? {...s, key_export: res.data} : s)))
                  .catch((e: unknown) => setErr(e as ApiError))
                  .finally(() => setBusy(false));
              }}
            >
              记录一次导出
            </Button>
          </div>
          <p className="text-muted-foreground text-[11px]">
            地址必须是本人的 Privy 托管钱包（服务端按账户表校验），否则 100123。
          </p>
        </CardContent>
      </Card>

      {err && <ErrorPanel err={err} />}
    </div>
  );
}

