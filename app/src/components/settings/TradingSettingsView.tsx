'use client';

import {useCallback, useEffect, useState} from 'react';

import {ApiError} from '@/api/envelope';
import {
  CURRENCIES,
  getTradingSettings,
  setCurrency,
  setSlippage,
  setTradeConfirmation,
  validateSlippage,
  type TradingSettings,
} from '@/api/settings';
import {ErrorPanel} from '@/components/ErrorPanel';
import {LoginGate} from '@/components/settings/LoginGate';
import {SettingsNav} from '@/components/settings/SettingsNav';
import {ToggleRow} from '@/components/settings/ToggleRow';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {cn} from '@/lib/utils';
import {useSession} from '@/session/storage';

/** 预设档位（settings-integration.md §5）；值域 0.0001~1、最多 6 位小数。 */
const SLIPPAGE_PRESETS = [
  {label: '0.5%', value: '0.005'},
  {label: '1%', value: '0.01'},
  {label: '2%', value: '0.02'},
  {label: '10%', value: '0.1'},
];

/**
 * Trading 页（settings-integration.md §5）。展示用 default_slippage、
 * 下单用 slippage_bps（显式传给交易接口，不依赖服务端兜底）。
 */
export function TradingSettingsView() {
  const session = useSession();
  const jwt = session?.jwt ?? null;
  const [settings, setSettings] = useState<TradingSettings | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState('');
  const [customMode, setCustomMode] = useState(false);

  const load = useCallback(async () => {
    if (!jwt) return;
    try {
      const res = await getTradingSettings(jwt);
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

  const apply = (fn: () => Promise<{data: TradingSettings}>) => {
    setBusy(true);
    setErr(null);
    void fn()
      .then((res) => setSettings(res.data)) // 回整页，直接覆盖
      .catch((e: unknown) => setErr(e as ApiError))
      .finally(() => setBusy(false));
  };

  const currentPct = settings ? (Number(settings.default_slippage) * 100).toFixed(Number(settings.default_slippage) < 0.01 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, '') : '';
  const customInvalid = custom !== '' ? validateSlippage(custom) : null;

  return (
    <div className="space-y-4">
      <SettingsNav active="/settings/trading" />
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Trading</h1>
        <p className="text-muted-foreground text-sm">
          展示用 default_slippage、下单用 slippage_bps（已是万分之一整数）。
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Default slippage
            {settings && (
              <>
                <Badge variant="secondary">{currentPct}%</Badge>
                <Badge variant="outline">{settings.slippage_bps} bps</Badge>
                {settings.explicit ? (
                  <span className="text-muted-foreground text-[11px]">已显式设置</span>
                ) : (
                  <span className="text-muted-foreground text-[11px]">服务端默认（未设过）</span>
                )}
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {SLIPPAGE_PRESETS.map((p) => (
              <Button
                key={p.value}
                size="sm"
                variant={settings?.default_slippage === p.value ? 'default' : 'outline'}
                disabled={busy}
                onClick={() => apply(() => setSlippage(jwt, p.value))}
              >
                {p.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant={customMode ? 'default' : 'outline'}
              onClick={() => {
                setCustomMode((v) => !v);
                if (!customMode) setCustom(settings?.default_slippage ?? '');
              }}
            >
              Custom
            </Button>
          </div>
          {customMode && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="0.0001 ~ 1（十进制，最多 6 位小数）"
                className="max-w-xs font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <Button size="sm" disabled={busy || !!customInvalid} onClick={() => apply(() => setSlippage(jwt, custom.trim()))}>
                保存自定义滑点
              </Button>
              {customInvalid && <span className="text-xs text-red-500">{customInvalid}</span>}
            </div>
          )}
          <p className="text-muted-foreground text-[11px]">
            0 不合法（交易服务把 0 当「没传」）；第 5、6 位小数在交易侧无效（向下取整到 bps）。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">下单</CardTitle>
        </CardHeader>
        <CardContent>
          <ToggleRow
            label="Trade confirmation"
            desc="下单前滑动确认条（默认开）。"
            checked={!!settings?.trade_confirmation}
            disabled={busy || !settings}
            onToggle={(v) => apply(() => setTradeConfirmation(jwt, v))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Currency</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {CURRENCIES.map((c) => (
              <Button
                key={c}
                size="sm"
                variant={settings?.currency === c ? 'default' : 'outline'}
                disabled={busy}
                onClick={() => apply(() => setCurrency(jwt, c))}
              >
                {c}
              </Button>
            ))}
          </div>
          <p className="text-muted-foreground text-[11px]">展示单位；金额换算由前端做，服务端只存状态。</p>
        </CardContent>
      </Card>

      {err && <ErrorPanel err={err} />}
    </div>
  );
}
