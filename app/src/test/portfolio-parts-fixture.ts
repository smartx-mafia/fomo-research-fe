import type {PortfolioReply} from '@/api/portfolio';
import type {PartName, PartRequest, PortfolioPart, PerformanceWindow} from '@/api/portfolio-parts';

/** Adapt existing presentation fixtures; production never reconstructs a full portfolio. */
export function partFixture(data: PortfolioReply, part: PartName, request: PartRequest): PortfolioPart {
  const key = request.window === '7d' ? 'd7' : request.window === '30d' ? 'd30' : request.window === 'all' ? 'all' : 'd1';
  const pnl = data.pnl?.[key], balance = data.balance?.[key];
  const performance = (value: typeof pnl | typeof balance): PerformanceWindow | undefined => value ? {...value, partial: false, simulated: !!value.simulated, curve: value.curve ?? []} : undefined;
  return {...data, meta: {read_id: request.read_id, snapshot_id: request.read_id, expires_at: {seconds: Math.floor(Date.now() / 1000) + 30}},
    total_assets_usd: data.total_assets_usd ?? balance?.amount_usd,
    window: request.window, window_context: key, pnl_rules_version: '1', performance_status: 'complete',
    pnl: performance(pnl), balance: performance(balance), positions: part === 'positions' ? data.positions : [],
    next_cursor: '', total_count: data.positions.length, page_expires_at: {seconds: Math.floor(Date.now() / 1000) + 120}};
}
export function fixtureReader(source: (identifier: string, bearer?: string) => Promise<PortfolioReply>) {
  const rounds = new Map<string, Promise<PortfolioReply>>();
  return async (identifier: string, part: PartName, request: PartRequest, bearer?: string) => {
    let data = rounds.get(request.read_id);
    if (!data) {data = source(identifier, bearer); rounds.set(request.read_id, data);}
    return partFixture(await data, part, request);
  };
}
