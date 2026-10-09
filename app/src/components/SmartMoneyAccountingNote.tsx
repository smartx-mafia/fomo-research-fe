import type {SmartMoneyAccounting} from '@/api/smartmoney-accounting';

const money = (value?: string) => typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) ? `$${value}` : '—';

function qualityLabel(reason: string): string {
  const [kind, chain] = reason.split(':');
  const scope = chain ? `${chain}：` : '';
  switch (kind) {
    case 'history_limit_suspected': return `${scope}历史记录可能尚未收全。`;
    case 'current_inventory_limit_suspected': return `${scope}当前资产可能尚未收全。`;
    case 'changed_during_capture': return `${scope}采集期间持仓发生变化，仍需核对。`;
    case 'native_scope_unproven': return `${scope}原生余额范围尚未核对完整。`;
    case 'native_performance_scope_unproven': return `${scope}原生余额是否计入收益尚未确认。`;
    case 'account_component_unallocated': return '账户收益尚未分配到当前链。';
    case 'source_all_anchor_unknown': return '来源尚未提供可用的全部收益。';
    case 'publication_missing': return '当前结果尚未发布。';
    case 'scope_rebuild_pending': return '当前账户范围正在重新核对。';
    case 'pending_replay': return '正在重新计算，以下为此前发布的结果。';
    case 'continuation_boundary_or_coverage_pending': return '后续交易与起点尚未衔接完整。';
    default: return '还有待核对的数据；不能据此认定覆盖完整。';
  }
}

export function SmartMoneyAccountingNote({accounting, showReferences = false, scopeChain}: {
  accounting?: SmartMoneyAccounting; showReferences?: boolean; scopeChain?: string;
}) {
  if (accounting?.source !== 'gmgn') return null;
  const status = accounting.window_status || accounting.total_status;
  const label = status === 'available' || status === 'source_available' || status === 'complete'
    ? '金额可用' : status === 'warming_up' ? '尚未覆盖完整窗口' : status === 'partial' || status === 'partial_day' ? '部分可用' : '金额未知';
  const method = accounting.method === 'event_replay' ? '增量计算' : accounting.method === 'source_snapshot' ? '起点快照' : '计算方式待确认';
  const reasons = [...new Set((accounting.reasons ?? []).map(qualityLabel))];
  const normalized = scopeChain === 'ethereum' ? 'eth' : scopeChain === 'solana' ? 'sol' : scopeChain;
  const references = (accounting.source_references ?? []).filter((ref) => !normalized || normalized === 'all' || ref.chain === normalized);
  const incomplete = status === 'warming_up' || status === 'partial_day' || status === 'partial';
  return <div className="mt-2 text-xs leading-5 text-muted" data-testid="gmgn-accounting-note">
    <p>GMGN · {method} · {label}{accounting.stale ? ' · 已过期' : ''}</p>
    <p>截止时间：{accounting.as_of || '未知'} · 余额观察：{accounting.balance_as_of || '未知'}</p>
    {accounting.continuation_status !== 'complete' ? <p>增量尚未核对完整；不会用旧金额补齐。</p> : null}
    {accounting.decomposition_status !== 'complete' ? <p>分项可能不完整，请以账户总额为准。</p> : null}
    {incomplete ? <p>实际覆盖开始：{accounting.effective_from || '未知'}；当前片段小计 {money(accounting.since_baseline_total)}，不代表完整窗口。</p> : null}
    {reasons.length > 0 ? <ul className="mt-1 list-inside list-disc">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
    {showReferences && references.length > 0 ? <details className="mt-2">
      <summary className="cursor-pointer text-accent">查看 GMGN 来源参考</summary>
      <p>窗口内已实现、当前浮盈和全部收益是三个不同范围，不能相加代替本页期间收益。</p>
      {references.map((ref, index) => <div key={`${ref.chain}:${ref.window}:${ref.evidence_hash}:${index}`} className="mt-2 border-t border-border pt-2">
        <p>{ref.chain || '链未知'} · {ref.window || '窗口未知'} · 观察时间 {ref.observed_at || '未知'}</p>
        <p>窗口内已实现 {money(ref.realized_profit_usd)} · 当前浮盈 {money(ref.current_unrealized_profit_usd)} · 该链全部收益 {money(ref.authoritative_total_profit_usd)}</p>
      </div>)}
    </details> : null}
  </div>;
}
