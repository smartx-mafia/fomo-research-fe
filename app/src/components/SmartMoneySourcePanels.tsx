'use client';

import {useState} from 'react';
import useSWR from 'swr';
import {
  getSourceActions,
  getSourceCapabilities,
  getSourcePnL,
  getSourcePositions,
  sourceRefreshMs,
  sourceSurfaceReady,
  type FomoAccounting,
  type SourceAction,
  type SourceIdentity,
  type SourceMeta,
  type SourcePosition,
} from '@/api/smartmoney-source';
import type {SmartMoneyIdentityRoute} from '@/hooks/useSmartMoneyIdentityRoute';

type IdentityRoute = Extract<SmartMoneyIdentityRoute, {status: 'subject' | 'wallet'}>;
const evmChains = ['base', 'ethereum', 'bsc', 'robinhood'] as const;

function value(raw?: string): string {
  return raw === undefined || raw === '' ? '—' : raw;
}

function money(raw?: string): string {
  return raw === undefined || raw === '' ? '—' : `$${raw}`;
}

function eventTime(raw?: string | number): string {
  if (raw === undefined || raw === '' || String(raw) === '0') return '—';
  const text = String(raw);
  if (!/^\d+$/.test(text)) return text;
  const seconds = BigInt(text);
  if (seconds > BigInt(8_640_000_000_000)) return `${text}（Unix 秒）`;
  const date = new Date(Number(seconds) * 1000);
  return Number.isNaN(date.getTime()) ? `${text}（Unix 秒）` : date.toLocaleString();
}

function sourceName(raw: string): string {
  if (raw === 'mixed') return '多个来源';
  if (raw === 'wallet') return '钱包快照';
  if (raw === 'unknown' || !raw) return '未知';
  return raw.toUpperCase();
}

function coverageName(raw: SourceMeta['coverage']): string {
  return {complete: '完整', partial: '部分', unknown: '未知', ranked_selection: '仅榜单筛选范围'}[raw] ?? raw;
}

function FomoStatus({accounting}: {accounting?: FomoAccounting}) {
  if (!accounting) return null;
  return <div className="mt-2 space-y-1 text-xs text-muted" data-testid="fomo-accounting-status">
    <p>{accounting.method === 'source_snapshot' ? 'FOMO 个人页起点' : accounting.method === 'event_replay' ? 'FOMO 起点＋本代事件增量' : 'FOMO 发布状态未知'} · 观测时间：{accounting.as_of || '未知'}</p>
    {accounting.total_status === 'unavailable' ? <p>本范围的账户总收益暂不可用。</p> : null}
    {accounting.balance_as_of ? <p>余额观测时间：{accounting.balance_as_of}（独立于绩效更新）</p> : null}
    {accounting.window_status === 'warming_up' ? <p>完整周期尚未覆盖，接入以来收益 {money(accounting.since_baseline_total)}；开始时间 {accounting.effective_from || '待确认'}</p> : null}
    {accounting.decomposition_status === 'partial' ? <p>账户总额与历史分项分别展示；尚未分配到币的金额不计入已实现小计。</p> : null}
    {accounting.stale || accounting.continuation_status === 'pending_replay' ? <p className="text-amber-500">当前展示保留时点的数据，最新结果待核对。</p> : null}
  </div>;
}
function Provenance({meta}: {meta: SourceMeta}) {
  return <div className="mt-2 text-xs leading-5 text-muted">
    <p>身份来源：{sourceName(meta.source)} · 数据提供方：{sourceName(meta.data_provider)} · 观测时间：{meta.as_of || '未知'}
      {' · '}覆盖状态：{coverageName(meta.coverage)} · {meta.accounting ? '来源基线与本代计算，未经链上账本核验' : '供应商快照，未经链上账本核验'}</p>
    <FomoStatus accounting={meta.accounting} />
    {!meta.accounting && (meta.coverage !== 'complete' || !meta.as_of) ?
      <p className="text-amber-500">观测时间或覆盖范围不完整；下方记录不能代表全部仓位、成交或收益。</p> : null}
  </div>;
}

function PanelError({retry}: {retry: () => void}) {
  return <div role="alert" className="mt-3 text-sm text-down">供应商快照暂不可用。
    <button type="button" onClick={retry} className="ml-2 underline">重试</button>
  </div>;
}

function PositionRows({title, rows, coverage}: {title: string; rows: SourcePosition[]; coverage: SourceMeta['coverage']}) {
  return <div className="mt-4">
    <h3 className="text-sm font-medium text-foreground">{title}</h3>
    {rows.length === 0 ? <p className="mt-2 text-sm text-muted">
      {coverage === 'complete' ? '当前快照没有记录。' : '当前未返回记录；快照覆盖不足时不能据此判断为零。'}
    </p> : <div className="mt-2 divide-y divide-border/60">{rows.map((position, index) =>
      <div key={`${position.chain ?? ''}:${position.token_address ?? ''}:${index}`} className="flex flex-wrap justify-between gap-3 py-3 text-sm">
        <div className="min-w-0">
          <p className="font-medium">{position.symbol || position.name || value(position.token_address)}</p>
          <p className="break-all font-mono text-xs text-muted">{value(position.chain)} · {value(position.token_address)}</p>
          <p className="text-xs text-muted">{position.position_quantity ? '盈亏仓位数量' : '数量'} {value(position.position_quantity || position.balance)}</p>
          {position.balance_quantity ? <p className="text-xs text-muted">余额数量 {value(position.balance_quantity)} · 余额估值 {money(position.balance_market_value)}</p> : null}
        </div>
        <div className="text-right text-xs text-muted">
          <p>{position.position_quantity ? '盈亏仓位估值' : '估值'} {money(position.usd_value)}</p>
          <p>成本 {money(position.accu_cost || position.cost)}</p>
          <p>仓位收益 {money(position.total_profit)}</p>
          {position.position_pnl_basis ? <p>导入轮次已实现 {money(position.current_round_realized)} · 接入以来已实现 {money(position.realized_since_baseline)}</p> : <p>已实现 {money(position.realized_profit)}</p>}
          <p>未实现 {money(position.unrealized_profit)}</p>
        </div>
      </div>)}</div>}
  </div>;
}

function ActionRow({action}: {action: SourceAction}) {
  return <div className="flex flex-wrap justify-between gap-3 py-3 text-sm">
    <div className="min-w-0">
      <p className="font-medium">{value(action.event_type)} · {action.token_symbol || value(action.token_address)}</p>
      <p className="break-all font-mono text-xs text-muted">{value(action.chain)} · {value(action.wallet_address)} · {value(action.tx_hash)}</p>
      <p className="text-xs text-muted">数量 {value(action.token_amount)} · 计价 {value(action.quote_amount)} {value(action.quote_symbol)}</p>
    </div>
    <div className="text-right text-xs text-muted"><p>供应商金额 {money(action.cost_usd)}</p><p>{eventTime(action.occurred_at)}</p></div>
  </div>;
}

export function SmartMoneySourcePanels({route}: {route: IdentityRoute}) {
  const [evmChain, setEvmChain] = useState<string>(route.status === 'wallet' ? route.sourceChain ?? 'base' : 'base');
  const [actionPages, setActionPages] = useState<string[]>(['']);
  const capabilities = useSWR('smartmoney-source-capabilities-v1', () => getSourceCapabilities(), {
    shouldRetryOnError: false,
    refreshInterval: (latest) => {
      const intervals = (['positions', 'actions', 'pnl'] as const)
        .map((name) => sourceRefreshMs(latest, name)).filter((ms) => ms > 0);
      return intervals.length ? Math.min(...intervals) : 0;
    },
    refreshWhenHidden: false, refreshWhenOffline: false,
  });
  const cap = capabilities.data;
  const availableEvm = evmChains.filter((candidate) => cap?.supported_chains.includes(candidate));
  const identity: SourceIdentity = route.status === 'subject'
    ? {type: 'user', userId: route.subjectId}
    : {type: 'wallet', namespace: route.namespace, address: route.walletAddress};
  const identityKey = route.status === 'subject' ? `user:${route.subjectId}` : `wallet:${route.namespace}:${route.walletAddress}:${route.sourceChain ?? ''}`;
  const chain = route.status === 'subject' ? undefined : route.namespace === 'solana' ? 'solana' :
    availableEvm.includes(evmChain as typeof evmChains[number]) ? evmChain : availableEvm[0];
  const scopeReady = route.status === 'subject' || (route.namespace === 'solana'
    ? cap?.supported_chains.includes('solana') === true : availableEvm.length > 0);
  const cursor = actionPages[actionPages.length - 1];
  const positionsReady = cap && scopeReady ? sourceSurfaceReady(cap, 'positions') : false;
  const actionsReady = cap && scopeReady ? sourceSurfaceReady(cap, 'actions') : false;
  const pnlReady = cap && scopeReady ? sourceSurfaceReady(cap, 'pnl') : false;
  const positions = useSWR(positionsReady ? ['smartmoney-source-positions', identityKey, chain] : null,
    () => getSourcePositions(identity, chain), {shouldRetryOnError: false, revalidateOnFocus: true,
      refreshInterval: sourceRefreshMs(cap, 'positions'), refreshWhenHidden: false, refreshWhenOffline: false});
  const actions = useSWR(actionsReady ? ['smartmoney-source-actions', identityKey, chain, cursor] : null,
    () => getSourceActions(identity, chain, cursor), {shouldRetryOnError: false, revalidateOnFocus: true,
      refreshInterval: sourceRefreshMs(cap, 'actions'), refreshWhenHidden: false, refreshWhenOffline: false});
  const pnl = useSWR(pnlReady ? ['smartmoney-source-pnl', identityKey, chain] : null,
    () => getSourcePnL(identity, chain), {shouldRetryOnError: false, revalidateOnFocus: true,
      refreshInterval: sourceRefreshMs(cap, 'pnl'), refreshWhenHidden: false, refreshWhenOffline: false});

  const wallet = positions.data?.snapshot.wallet;
  const user = positions.data?.snapshot.user;
  const open = wallet?.open ?? user?.open ?? user?.list ?? [];
  const closed = wallet?.closed ?? user?.closed ?? [];

  return <div className="space-y-4">
    <div role="note" className="rounded-lg border border-accent/25 bg-accent/5 px-4 py-3 text-xs leading-5 text-muted">
      持仓与盈亏以服务端发布为准。FOMO 账户总额、盈亏仓位与余额分别展示；未知分项不补零。
    </div>
    {route.status === 'wallet' && route.namespace === 'evm' && availableEvm.length > 0 ?
      <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-muted">链</span>{availableEvm.map((candidate) =>
        <button key={candidate} type="button" aria-pressed={chain === candidate}
          className={`rounded-md border px-2.5 py-1 ${chain === candidate ? 'border-accent text-accent' : 'border-border text-muted'}`}
          onClick={() => { setEvmChain(candidate); setActionPages(['']); }}>{candidate}</button>)}</div> : null}
    {capabilities.error ? <PanelError retry={() => void capabilities.mutate()} /> : null}
    {!cap && !capabilities.error ? <p className="text-sm text-muted">正在检查供应商快照能力…</p> : null}
    {cap && !scopeReady ? <p className="text-sm text-muted">当前钱包的链尚未开放供应商快照读取。</p> : null}
    {cap && !positionsReady && !actionsReady && !pnlReady ? <p className="text-sm text-muted">供应商快照读面暂未开放。</p> : null}

    {positionsReady ? <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="font-semibold">仓位快照</h2>
      {positions.error ? <PanelError retry={() => void positions.mutate()} /> : null}
      {!positions.data && !positions.error ? <p className="mt-3 text-sm text-muted">正在加载仓位…</p> : null}
      {positions.data ? <><Provenance meta={positions.data.meta} />
        <PositionRows title="持有中" rows={open} coverage={positions.data.meta.coverage} />
        {cap && sourceSurfaceReady(cap, 'closed_positions') ?
          <PositionRows title="已清仓" rows={closed} coverage={positions.data.meta.coverage} /> : null}</> : null}
    </section> : null}

    {actionsReady ? <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="font-semibold">供应商成交记录</h2>
      {actions.error ? <PanelError retry={() => void actions.mutate()} /> : null}
      {!actions.data && !actions.error ? <p className="mt-3 text-sm text-muted">正在加载成交…</p> : null}
      {actions.data ? <><Provenance meta={actions.data.meta} />
        <p className="mt-2 text-xs text-muted">成交方向由供应商报告；原始买卖词汇不代表已验证成本或内部转仓。</p>
        {actions.data.snapshot.list.length === 0 ? <p className="mt-3 text-sm text-muted">当前页没有成交记录；这不证明历史为空。</p> :
          <div className="mt-3 divide-y divide-border/60">{actions.data.snapshot.list.map((action, index) => <ActionRow key={`${action.tx_hash ?? ''}:${index}`} action={action} />)}</div>}
        <div className="mt-3 flex gap-3 text-xs">
          {actionPages.length > 1 ? <button type="button" className="text-accent underline" onClick={() => setActionPages((pages) => pages.slice(0, -1))}>上一页</button> : null}
          {actions.data.snapshot.next_cursor ? <button type="button" className="text-accent underline" onClick={() => setActionPages((pages) => [...pages, actions.data!.snapshot.next_cursor])}>下一页</button> : null}
        </div></> : null}
    </section> : null}

    {pnlReady ? <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="font-semibold">收益窗口</h2>
      {pnl.error ? <PanelError retry={() => void pnl.mutate()} /> : null}
      {!pnl.data && !pnl.error ? <p className="mt-3 text-sm text-muted">正在加载收益…</p> : null}
      {pnl.data ? <><Provenance meta={pnl.data.meta} />
        {pnl.data.windows.length === 0 ? <p className="mt-3 text-sm text-muted">当前没有可用窗口；未知值不会记作零。</p> :
          <div className="mt-3 grid gap-3 md:grid-cols-2">{pnl.data.windows.map((entry) =>
            <div key={entry.window} className="rounded-lg border border-border/70 p-3 text-sm">
              <p className="font-medium">{entry.window}</p>
              <p className="mt-2">总收益 {money(entry.total_profit_usd)}</p>
              <p className="text-xs text-muted">{entry.window === 'all' ? '完整历史已实现' : '期间已实现'} {money(entry.realized_profit_usd)} · {entry.accounting && entry.window !== 'all' ? '未实现变化' : '当前未实现'} {money(entry.unrealized_profit_usd)}</p>
              <FomoStatus accounting={entry.accounting} />
              {entry.window === 'all' && entry.accounting ? <div className="mt-2 text-xs text-muted"><p>导入轮次已实现 {money(entry.accounting.current_round_realized)} · 接入以来已实现 {money(entry.accounting.realized_since_baseline)}</p><p>FOMO 账户其他起点金额 {money(entry.accounting.other_account_baseline)}（归属未拆分，不是历史已实现） · 合约起点 {money(entry.accounting.perpetual_baseline)}</p><p>转账调整 {money(entry.accounting.transfer_adjustment)} · 费用币处置 {money(entry.accounting.fee_disposal)} · 费用 {money(entry.accounting.expenses)}</p><p>合约增量 {money(entry.accounting.perpetual_delta)} · 其他增量 {money(entry.accounting.other_delta)}</p></div> : null}
              <p className="text-xs text-muted">已实现成本 {money(entry.realized_cost_usd)}</p>
              <p className="text-xs text-muted">买入 {value(entry.buy_count)} · 卖出 {value(entry.sell_count)}</p>
              <p className="mt-1 text-xs text-muted">覆盖状态：{entry.coverage ? coverageName(entry.coverage as SourceMeta['coverage']) : '未知'} · 观测时间：{entry.as_of || '未知'}</p>
            </div>)}</div>}</> : null}
    </section> : null}
  </div>;
}
