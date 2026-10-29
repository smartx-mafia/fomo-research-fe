import type {PerformancePoint, PortfolioPart} from '@/api/portfolio-parts';

export type PairedPoint = {at: string; pnl_usd?: string; balance_usd?: string; roi_ratio?: string};
export function pairedPortfolioPoints(history?: PortfolioPart, current?: PortfolioPart): PairedPoint[] {
  const points: PairedPoint[] = (history?.pnl?.curve ?? []).map((p, i) => ({...p, balance_usd: history?.balance?.curve[i]?.balance_usd}));
  if (!history || !current || history.meta.read_id !== current.meta.read_id || history.meta.snapshot_id !== current.meta.snapshot_id || history.window !== current.window || !history.window_context || history.window_context !== current.window_context || !history.pnl_rules_version || history.pnl_rules_version !== current.pnl_rules_version || !['complete', 'partial'].includes(current.performance_status ?? '') || current.partial_errors.some(e => e.reason === 'pnl_rules_mismatch')) return points;
  const pnl = current.pnl_point, balance = current.balance_point;
  if (!pnl || !balance || Date.parse(pnl.at) !== Date.parse(balance.at)) return points;
  const point: PerformancePoint = {...pnl, balance_usd: balance.balance_usd};
  const last = points.at(-1);
  if (!last || Date.parse(point.at) > Date.parse(last.at)) points.push(point);
  else if (Date.parse(point.at) === Date.parse(last.at)) points[points.length - 1] = point;
  return points;
}
