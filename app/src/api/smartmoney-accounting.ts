/** Additive external-account publication metadata. All amounts stay decimal strings. */
export type SmartMoneyAccounting = {
  source?: string;
  generation_id?: string;
  publication_revision?: string;
  method?: string;
  engine_version?: string;
  formula_version?: string;
  policy_version?: string;
  effective_from?: string;
  economic_reconciliation_status?: string;
  quote_status?: string;
  ranking_basis_id?: string;
  total_status?: string;
  decomposition_status?: string;
  continuation_status?: string;
  window_status?: string;
  as_of?: string;
  balance_as_of?: string;
  stale?: boolean;
  current_unrealized?: string;
  unrealized_change?: string;
  since_baseline_total?: string;
  reasons?: string[];
  source_references?: {
    chain?: string; window?: string; realized_profit_usd?: string;
    current_unrealized_profit_usd?: string; authoritative_total_profit_usd?: string;
    realized_cost_usd?: string; observed_at?: string; evidence_hash?: string;
  }[];
};

/** New-owner periods contain U change, while ALL contains current U. */
export function unrealizedLabel(window: string, accounting?: SmartMoneyAccounting): string {
  if (accounting?.source !== 'gmgn') return '未实现';
  return window !== 'all' ? '未实现变化' : '当前未实现';
}

export function rankingBasisLabel(basis?: string): string {
  const labels: Record<string, string> = {
    'gmgn_source_v1:source_snapshot': 'GMGN 起点快照',
    'gmgn_source_v1:accounting_replay': 'GMGN 增量会计',
    'fomo_profile_v1:source_snapshot': 'FOMO 起点快照',
    'fomo_profile_v1:accounting_replay': 'FOMO 增量会计',
    window_realized_plus_current_unrealized: '窗口已实现与当前浮盈',
    period_mark_to_market: '期间收益', snapshot_delta: '快照变化',
  };
  return basis ? labels[basis] ?? `收益口径：${basis}` : '收益口径未知';
}
