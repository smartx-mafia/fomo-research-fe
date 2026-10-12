'use client';

import {useState} from 'react';
import {unrealizedLabel} from '@/api/smartmoney-accounting';
import {SmartMoneyAccountingNote} from './SmartMoneyAccountingNote';
import useSWR from 'swr';
import {
  getSourceActions,
  getSourceCapabilities,
  getSourcePnL,
  getSourcePositions,
  sourceRefreshMs,
  sourceSurfaceReady,
  type SourceAction,
  type SourceIdentity,
  type SourceMeta,
  type SourcePosition,
} from '@/api/smartmoney-source';
import {normalizeSmartMoneySourceChain} from '@/lib/smartmoney-identity';
import type {SmartMoneyIdentityRoute} from '@/hooks/useSmartMoneyIdentityRoute';

type IdentityRoute = Extract<SmartMoneyIdentityRoute, {status: 'subject' | 'wallet'}>;

function value(raw?: string): string {
  return typeof raw !== 'string' || raw === '' ? '—' : raw;
}

function money(raw?: string): string {
  return typeof raw !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(raw) ? '—' : `$${raw}`;
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

function Provenance({meta, scopeChain, showReferences = false}: {meta: SourceMeta; scopeChain?: string; showReferences?: boolean}) {
  return <div className="mt-2 text-xs leading-5 text-muted">
    <p>身份来源：{sourceName(meta.source)} · 数据提供方：{sourceName(meta.data_provider)} · 观测时间：{meta.as_of || '未知'}
      {' · '}覆盖状态：{coverageName(meta.coverage)} · 未经完整链上核验</p>
    <SmartMoneyAccountingNote accounting={meta.accounting} scopeChain={scopeChain} showReferences={showReferences} />
    {meta.coverage !== 'complete' || !meta.as_of ?
      <p className="text-amber-500">观测时间或覆盖范围不完整；下方记录不能代表全部仓位、成交或收益。</p> : null}
  </div>;
}

function PanelError({retry}: {retry: () => void}) {
  return <div role="alert" className="mt-3 text-sm text-down">供应商快照暂不可用。
    <button type="button" onClick={retry} className="ml-2 underline">重试</button>
  </div>;
}

function PositionRows({title, rows, coverage, accountingSource}: {title: string; rows: SourcePosition[]; coverage: SourceMeta['coverage']; accountingSource?: string}) {
  return <div className="mt-4">
    <h3 className="text-sm font-medium text-foreground">{title}</h3>
    {rows.length === 0 ? <p className="mt-2 text-sm text-muted">
      {coverage === 'complete' ? '当前快照没有记录。' : '当前未返回记录；快照覆盖不足时不能据此判断为零。'}
    </p> : <div className="mt-2 divide-y divide-border/60">{rows.map((position, index) =>
      <div key={`${position.chain ?? ''}:${position.token_address ?? ''}:${index}`} className="flex flex-wrap justify-between gap-3 py-3 text-sm" style={{contentVisibility: 'auto', containIntrinsicSize: 'auto 120px'}}>
        <div className="min-w-0">
          <p className="font-medium">{position.symbol || position.name || value(position.token_address)}</p>
          <p className="break-all font-mono text-xs text-muted">{value(position.chain)} · {value(position.token_address)}</p>
          <p className="text-xs text-muted">数量 {value(position.balance)}</p>
          {position.balance_quantity !== undefined && position.balance_quantity !== '' ? <p className="text-xs text-muted">余额观察 {value(position.balance_quantity)} · 绩效库存 {value(position.position_quantity)}</p> : null}
          {position.asset_role === 'native_observation' ? <p className="text-xs text-muted">原生余额观察 · 未计入绩效</p> : null}
        </div>
        <div className="text-right text-xs text-muted">
          <p>估值 {money(position.usd_value)}</p>
          <p>成本 {money(accountingSource === 'gmgn' ? position.accu_cost : (position.accu_cost || position.cost))}</p>
          <p>已实现 {money(position.realized_profit)} · 未实现 {money(position.unrealized_profit)}</p>
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
  const [evmChain, setEvmChain] = useState<string>(route.status === 'wallet' ? route.sourceChain ?? '' : '');
  const [actionHistory, setActionHistory] = useState<{chain?: string; pages: string[]}>({pages: ['']});
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
  const namespace = route.status === 'wallet' ? route.namespace : 'evm';
  const availableChains = [...new Set((cap?.supported_chains ?? [])
    .map((candidate) => normalizeSmartMoneySourceChain(candidate, namespace)).filter((candidate) => candidate !== undefined))];
  const identity: SourceIdentity = route.status === 'subject'
    ? {type: 'user', userId: route.subjectId}
    : {type: 'wallet', namespace: route.namespace, address: route.walletAddress};
  const identityKey = route.status === 'subject' ? `user:${route.subjectId}` : `wallet:${route.namespace}:${route.walletAddress}:${route.sourceChain ?? ''}`;
  const initialChain = route.status === 'subject' ? undefined :
    route.sourceChain && availableChains.includes(route.sourceChain) ? route.sourceChain : availableChains[0];
  const scopeReady = route.status === 'subject' || availableChains.length > 0;
  const pnlReady = Boolean(cap && scopeReady && sourceSurfaceReady(cap, 'pnl'));
  // This small, same-key-deduplicated read establishes ownership and declared
  // chain scope. Global capabilities alone cannot establish a wallet's chains.
  const scope = useSWR(pnlReady ? ['smartmoney-source-pnl', identityKey, initialChain] : null,
    () => getSourcePnL(identity, initialChain), {shouldRetryOnError: false, revalidateOnFocus: true,
      refreshInterval: sourceRefreshMs(cap, 'pnl'), refreshWhenHidden: false, refreshWhenOffline: false});
  const gmgnOwner = scope.data?.meta.accounting?.source === 'gmgn';
  const declaredChains = [...new Set((scope.data?.meta.accounting?.source_references ?? [])
    .filter((ref) => ref.window === 'all')
    .map((ref) => normalizeSmartMoneySourceChain(ref.chain ?? '', namespace)).filter((candidate) => candidate !== undefined))];
  const selectedChains = gmgnOwner ? declaredChains : availableChains;
  const chain = route.status === 'subject' ? undefined : gmgnOwner && evmChain === 'all' ? 'all' :
    selectedChains.includes(evmChain as typeof selectedChains[number]) ? evmChain :
      selectedChains[0] ?? (gmgnOwner ? 'all' : initialChain);
  const actionPages = actionHistory.chain === chain ? actionHistory.pages : [''];
  const cursor = actionPages[actionPages.length - 1];
  const positionsReady = Boolean(cap && scopeReady && sourceSurfaceReady(cap, 'positions'));
  // Actions have their own concrete-chain contract; an account-wide PnL read
  // does not authorize merging transaction lists across chains.
  const actionsReady = Boolean(cap && scopeReady && chain !== 'all' && sourceSurfaceReady(cap, 'actions'));
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
      各接口的观测时间和覆盖范围独立。请以服务端公布的金额及状态为准，不从可见仓位相加推算账户收益。
    </div>
    {route.status === 'wallet' && (selectedChains.length > 0 || gmgnOwner) ?
      <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-muted">范围</span>{(gmgnOwner ? ['all', ...selectedChains] : selectedChains).map((candidate) =>
        <button key={candidate} type="button" aria-pressed={chain === candidate}
          className={`rounded-md border px-2.5 py-1 ${chain === candidate ? 'border-accent text-accent' : 'border-border text-muted'}`}
          onClick={() => { setEvmChain(candidate); setActionHistory({chain: candidate, pages: ['']}); }}>{candidate === 'all' ? '全部已纳入链' : candidate}</button>)}</div> : null}
    {capabilities.error ? <PanelError retry={() => void capabilities.mutate()} /> : null}
    {!cap && !capabilities.error ? <p className="text-sm text-muted">正在检查供应商快照能力…</p> : null}
    {cap && !scopeReady ? <p className="text-sm text-muted">当前钱包的链尚未开放供应商快照读取。</p> : null}
    {cap && !positionsReady && !actionsReady && !pnlReady ? <p className="text-sm text-muted">供应商快照读面暂未开放。</p> : null}

    {positionsReady ? <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="font-semibold">仓位快照</h2>
      {positions.error ? <PanelError retry={() => void positions.mutate()} /> : null}
      {!positions.data && !positions.error ? <p className="mt-3 text-sm text-muted">正在加载仓位…</p> : null}
      {positions.data ? <><Provenance meta={positions.data.meta} />
        <PositionRows title="持有中" rows={open} coverage={positions.data.meta.coverage} accountingSource={positions.data.meta.accounting?.source} />
        {cap && sourceSurfaceReady(cap, 'closed_positions') ?
          <PositionRows title="已清仓" rows={closed} coverage={positions.data.meta.coverage} accountingSource={positions.data.meta.accounting?.source} /> : null}</> : null}
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
          {actionPages.length > 1 ? <button type="button" className="text-accent underline" onClick={() => setActionHistory({chain, pages: actionPages.slice(0, -1)})}>上一页</button> : null}
          {actions.data.snapshot.next_cursor ? <button type="button" className="text-accent underline" onClick={() => setActionHistory({chain, pages: [...actionPages, actions.data!.snapshot.next_cursor]})}>下一页</button> : null}
        </div></> : null}
    </section> : null}

    {pnlReady ? <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="font-semibold">收益窗口{gmgnOwner ? chain === 'all' ? ' · 全部已纳入链' : ` · ${chain}` : ''}</h2>
      {pnl.error ? <PanelError retry={() => void pnl.mutate()} /> : null}
      {!pnl.data && !pnl.error ? <p className="mt-3 text-sm text-muted">正在加载收益…</p> : null}
      {pnl.data ? <><Provenance meta={pnl.data.meta} scopeChain={chain} showReferences />
        {pnl.data.windows.length === 0 ? <p className="mt-3 text-sm text-muted">当前没有可用窗口；未知值不会记作零。</p> :
          <div className="mt-3 grid gap-3 md:grid-cols-2">{pnl.data.windows.map((entry) =>
            <div key={entry.window} className="rounded-lg border border-border/70 p-3 text-sm">
              <p className="font-medium">{entry.window}</p>
              <p className="mt-2">总收益 {money(entry.total_profit_usd)}</p>
              <SmartMoneyAccountingNote accounting={entry.accounting} />
              <p className="text-xs text-muted">{entry.accounting?.source === 'gmgn' && ['warming_up', 'partial', 'partial_day'].includes(entry.accounting.window_status ?? '') ? '当前片段已实现' : '已实现'} {money(entry.realized_profit_usd)} · {unrealizedLabel(entry.window, entry.accounting)} {money(entry.unrealized_profit_usd)}</p>
              <p className="text-xs text-muted">已实现成本 {money(entry.realized_cost_usd)}</p>
              <p className="text-xs text-muted">买入 {value(entry.buy_count)} · 卖出 {value(entry.sell_count)}</p>
              <p className="mt-1 text-xs text-muted">覆盖状态：{entry.coverage ? coverageName(entry.coverage as SourceMeta['coverage']) : '未知'} · 观测时间：{entry.as_of || '未知'}</p>
            </div>)}</div>}
        {pnl.data.meta.accounting?.source === 'gmgn' ? <details className="mt-4">
          <summary className="cursor-pointer text-accent">每日收益（UTC 自然日）</summary>
          {(pnl.data.daily_windows ?? []).length === 0 ? <p className="mt-2 text-sm text-muted">尚未发布每日收益，不代表每日收益为零。</p> :
            pnl.data.daily_windows!.map((day) => <div key={day.window} className="mt-2 border-t border-border pt-2">
              <p>{day.window.replace(/^day:/, '')} · 总收益 {money(day.total_profit_usd)}</p>
              <SmartMoneyAccountingNote accounting={day.accounting} />
            </div>)}
        </details> : null}</> : null}
    </section> : null}
    {gmgnOwner && chain === 'all' ? <p className="text-xs text-muted">查看成交记录请先选择一条已纳入的链。</p> : null}
  </div>;
}
