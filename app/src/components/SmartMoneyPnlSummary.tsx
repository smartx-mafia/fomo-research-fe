'use client';

import {useState} from 'react';
import type {SmartMoneyPnlWindow} from '@/api/smartmoney';
import {decimalSign, formatDecimalExact} from '@/lib/exact-decimal';

const windows = [['1d', '24H'], ['7d', '7D'], ['30d', '30D'], ['all', '全部']] as const;

export function SmartMoneyPnlSummary({data}: {data?: SmartMoneyPnlWindow[]}) {
  const [window, setWindow] = useState<string>('all');
  const selected = data?.find((item) => item.window === window);
  return <section className="space-y-3" aria-label="钱包盈亏">
    <div className="flex gap-1" aria-label="盈亏时间窗口">{windows.map(([value, label]) => <button key={value} type="button" aria-pressed={window === value} onClick={() => setWindow(value)} className={`rounded-md px-3 py-1.5 text-xs ${window === value ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-surface-2'}`}>{label}</button>)}</div>
    <div className="grid gap-3 sm:grid-cols-2">{([['总盈亏', selected?.total_profit], ['已实现盈亏', selected?.realized_profit]] as const).map(([label, amount]) => {
      const sign = decimalSign(amount);
      const formatted = formatDecimalExact(amount, 2);
      return <div key={label} className="rounded-xl border border-border bg-surface p-4"><p className="text-xs text-muted">{label}</p><p className={`mt-2 font-mono text-xl font-semibold ${sign === 1 ? 'text-up' : sign === -1 ? 'text-down' : 'text-muted'}`}>{formatted === '—' ? '—' : `${sign === -1 ? '-' : ''}$${formatted.replace(/^-/, '')}`}</p></div>;
    })}</div>
  </section>;
}
