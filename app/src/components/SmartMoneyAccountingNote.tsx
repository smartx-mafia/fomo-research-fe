import type {SmartMoneyAccounting} from '@/api/smartmoney-accounting';

export function SmartMoneyAccountingNote({accounting}: {accounting?: SmartMoneyAccounting}) {
  if (accounting?.source !== 'gmgn') return null;
  const status = accounting.window_status || accounting.total_status;
  const label = status === 'available' || status === 'source_available' || status === 'complete'
    ? '金额可用' : status === 'warming_up' ? '尚未覆盖完整窗口' : status === 'partial' ? '部分可用' : '金额未知';
  return <div className="mt-2 text-xs leading-5 text-muted" data-testid="gmgn-accounting-note">
    <p>GMGN · {accounting.method === 'event_replay' ? '增量计算' : '起点快照'} · {label}{accounting.stale ? ' · 已过期' : ''}</p>
    <p>截止时间：{accounting.as_of || '未知'} · 余额观察：{accounting.balance_as_of || '未知'}</p>
    {accounting.continuation_status !== 'complete' ? <p>增量尚未核对完整；不会用旧金额补齐。</p> : null}
    {accounting.decomposition_status !== 'complete' ? <p>分项可能不完整，请以账户总额为准。</p> : null}
    {status === 'warming_up' && accounting.since_baseline_total ? <p>接入以来：{accounting.since_baseline_total}</p> : null}
  </div>;
}
