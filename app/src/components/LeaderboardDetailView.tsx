'use client';

import {useEffect, useState} from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import {getPlatformHoldings} from '@/api/platform-holdings';
import {getPlatformUserTrades, isTradeCursorStale, type PlatformTrades} from '@/api/platform-trades';
import {getUserPortfolio} from '@/api/user-portfolio';
import {ApiError} from '@/api/envelope';
import {PortfolioDataError} from '@/api/portfolio';
import type {LeaderboardDetailTarget} from '@/lib/leaderboard-detail';
import {decimalSign, formatBaseUnitsExact, formatDecimalExact} from '@/lib/exact-decimal';
import {chainLabel, shortAddr} from '@/lib/format';
import {PortfolioTokenIdentity} from './PortfolioTokenIdentity';
import {SmartMoneyProfile, SmartMoneyHoldingsTable, PlatformTradesTable} from './SmartMoneyProfile';
import {SmartMoneyDetailHeader} from './SmartMoneyDetailHeader';
import {SmartMoneyPnlSummary} from './SmartMoneyPnlSummary';

const backHref = '/leaderboard#leaderboard';
const chainName = (chain: string) => chain === 'all' ? '全部链' : chain === 'sol' ? 'Solana' : chainLabel(chain);
const usd = (value?: string) => value === undefined || value === '' ? '—' : `${decimalSign(value) === -1 ? '-' : ''}$${formatDecimalExact(value, 2).replace(/^-/, '')}`;
const time = (value: number) => value > 0 ? new Date(value * 1000).toLocaleString() : '—';

type HoldingRow = {key: string; chain: string; address: string; symbol?: string; name?: string; logo?: string; quantity: string; value?: string; cost?: string; realized?: string; unrealized?: string; snapshot?: number};
function HoldingTable({rows}: {rows: HoldingRow[]}) {
  if (!rows.length) return <p className="rounded-xl border border-border p-10 text-center text-muted">暂无持仓记录。</p>;
  return <div className="overflow-x-auto rounded-xl border border-border bg-surface"><table className="w-full min-w-[920px] text-left text-xs">
    <thead className="text-muted"><tr>{['Token', '链', '持仓量', '持仓市值', '成本', '已实现盈亏', '未实现盈亏', '观测时间'].map((label, index) => <th key={label} className={`p-3 ${index > 1 ? 'text-right' : ''}`}>{label}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.key} className="border-t border-border">
      <td className="p-3"><PortfolioTokenIdentity chain={row.chain} address={row.address} symbol={row.symbol || undefined} name={row.name || undefined} logo={row.logo} /></td>
      <td className="p-3 text-muted">{chainName(row.chain)}</td><td className="p-3 text-right font-mono">{row.quantity}</td>
      {[row.value, row.cost, row.realized, row.unrealized].map((value, index) => <td key={index} className={`p-3 text-right font-mono ${index > 1 ? decimalSign(value) === 1 ? 'text-up' : decimalSign(value) === -1 ? 'text-down' : 'text-muted' : ''}`}>{usd(value)}</td>)}
      <td className="p-3 text-right text-muted">{row.snapshot ? time(row.snapshot) : '—'}</td>
    </tr>)}</tbody>
  </table></div>;
}

function DetailError({error, retry}: {error: unknown; retry: () => void}) {
  const trace = error instanceof ApiError || error instanceof PortfolioDataError ? error.traceID : undefined;
  return <div role="alert" className="rounded-lg border border-down/40 bg-down/5 p-4 text-sm text-down">持仓加载失败，请稍后重试。<button type="button" className="ml-2 underline" onClick={retry}>重试</button>{trace ? <p className="mt-1 break-all text-xs">Trace {trace}</p> : null}</div>;
}

function ChainFilter({chains, selected, select}: {chains: string[]; selected: string; select: (chain: string) => void}) {
  return <div aria-label="持仓链筛选" className="flex flex-wrap gap-2">{chains.map((chain) => <button type="button" key={chain} aria-pressed={chain === selected} onClick={() => select(chain)} className={`rounded-md border px-3 py-1.5 text-sm ${chain === selected ? 'border-accent/50 bg-accent/10 text-accent' : 'border-border text-muted'}`}>{chainName(chain)}</button>)}</div>;
}

function ExternalUserDetail({target}: {target: Extract<LeaderboardDetailTarget, {type: 'external_user'}>}) {
  const holdings = useSWR(['platform-user-holdings', target.platform, target.id], ([, platform, id]) => getPlatformHoldings(platform as 'fomo' | 'pump', id), {shouldRetryOnError: false, refreshInterval: 60_000});
  const tradeKey = (index: number, previous: PlatformTrades | null) => index > 0 && !previous?.next_cursor ? null : ['platform-user-trades', target.id, index === 0 ? '' : previous!.next_cursor!] as const;
  const trades = useSWRInfinite(tradeKey, ([, id, cursor]) => getPlatformUserTrades(id, cursor), {revalidateOnFocus: false, shouldRetryOnError: false});
  const [chain, setChain] = useState('all');
  const [tab, setTab] = useState<'holdings' | 'trades'>('holdings');
  const data = holdings.data;
  const [holdingTab, setHoldingTab] = useState<'open' | 'closed'>('open');
  const positions = [...(data?.open ?? []), ...(data?.closed ?? [])];
  const chains = ['all', ...new Set([...(data?.wallets.map((wallet) => wallet.chain) ?? []), ...positions.map((row) => row.chain)])];
  const selectedChain = chains.includes(chain) ? chain : 'all';
  const open = (data?.open ?? []).filter((row) => selectedChain === 'all' || row.chain === selectedChain);
  const closed = (data?.closed ?? []).filter((row) => selectedChain === 'all' || row.chain === selectedChain);
  const rows = holdingTab === 'open' ? open : closed;
  const tradeRows = trades.data?.flatMap((page) => page.list ?? []) ?? [];
  const tradesIncomplete = (trades.data ?? []).some((page) => (page.wallets ?? []).some((wallet) => wallet.coverage !== 'complete'));
  const name = data?.pnl_windows.find((window) => window.username)?.username || target.id;
  const refreshing = tab === 'holdings' ? holdings.isValidating : trades.isValidating;
  const refresh = () => { if (tab === 'holdings') void holdings.mutate(); else void trades.mutate(); };
  const reloadTrades = () => { void trades.setSize(1).then(() => trades.mutate()); };
  // 游标失效只在"已经不是第一页"时才可能：第一页不带游标，100110 就只能是参数
  // 本身非法，重置只会无限重试同一个失败请求。加了这个条件就不会成环。
  const staleCursor = isTradeCursorStale(trades.error) && trades.size > 1;
  const setTradesSize = trades.setSize;
  useEffect(() => { if (staleCursor) void setTradesSize(1); }, [staleCursor, setTradesSize]);
  return <div className="space-y-5">
    <a href={backHref} className="text-sm text-muted hover:text-accent">← 返回 leaderboard</a>
    <SmartMoneyDetailHeader query={{identity_type: 'user', user_id: target.id}} fallbackName={name} subtitle={<>{target.id} · 全链用户持仓与交易</>} actions={<button type="button" disabled={refreshing} onClick={refresh} className="text-sm text-accent disabled:opacity-50">{refreshing ? '刷新中…' : '刷新'}</button>} />
    {holdings.error ? <DetailError error={holdings.error} retry={() => void holdings.mutate()} /> : null}
    {holdings.isLoading ? <p role="status" className="p-8 text-center text-muted">正在加载用户持仓…</p> : null}
    {data ? <>
      {data.coverage !== 'complete' ? <p role="status" className="rounded-lg bg-accent/10 p-3 text-sm text-accent">持仓数据不完整，当前仅展示已获取的部分，不代表完整资产情况。</p> : null}
      {data.stale || data.wallets.some((wallet) => wallet.stale) ? <p role="status" className="text-sm text-accent">部分持仓数据更新延迟。</p> : null}
      <p className="text-xs text-muted">以下盈亏为全链用户统计；链筛选只影响持仓列表，交易始终为全链用户聚合。榜单与持仓的采集时间可能不同。</p>
      <SmartMoneyPnlSummary data={data.pnl_windows} />
      <div className="flex rounded-lg border border-border bg-surface p-1">
        <button type="button" aria-pressed={tab === 'holdings'} onClick={() => setTab('holdings')} className={`rounded-md px-4 py-2 text-sm ${tab === 'holdings' ? 'bg-surface-2 text-foreground' : 'text-muted'}`}>持仓 {positions.length}</button>
        <button type="button" aria-pressed={tab === 'trades'} onClick={() => setTab('trades')} className={`rounded-md px-4 py-2 text-sm ${tab === 'trades' ? 'bg-surface-2 text-foreground' : 'text-muted'}`}>交易 {tradeRows.length}</button>
      </div>
      {tab === 'holdings' ? <>
        <ChainFilter chains={chains} selected={selectedChain} select={setChain} />
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex gap-1 border-b border-border p-3">{(['open', 'closed'] as const).map((value) => <button key={value} type="button" aria-pressed={holdingTab === value} onClick={() => setHoldingTab(value)} className={`rounded px-3 py-1.5 text-xs ${holdingTab === value ? 'bg-accent/10 text-accent' : 'text-muted'}`}>{value === 'open' ? '持仓中' : '已清仓'} {value === 'open' ? open.length : closed.length}</button>)}</div>
          {rows.length ? <SmartMoneyHoldingsTable key={`${selectedChain}:${holdingTab}`} list={rows} variant={holdingTab} chain={selectedChain} userID={target.id} /> : <p className="p-10 text-center text-sm text-muted">暂无{holdingTab === 'open' ? '持仓中' : '已清仓'}记录。</p>}
        </section>
      </> : <section className="overflow-hidden rounded-xl border border-border bg-surface">
        {trades.error ? <p role="alert" className="p-5 text-sm text-down">{staleCursor ? '分页游标已失效（关联钱包集合已变化），正在从第一页重新加载。' : '交易加载失败，请稍后重试。'}<button type="button" className="ml-2 underline" onClick={reloadTrades}>重试</button></p> : null}
        {trades.isLoading ? <p role="status" className="p-10 text-center text-sm text-muted">正在加载用户交易…</p> : null}
        {!trades.isLoading && !trades.error && tradeRows.length === 0 ? <p className="p-10 text-center text-sm text-muted">暂无交易记录。</p> : null}
        {tradeRows.length ? <><PlatformTradesTable list={tradeRows} source />{tradesIncomplete ? <p className="border-t border-border px-3 py-3 text-xs text-accent">部分钱包的交易覆盖不完整，当前仅展示已采集记录。</p> : null}</> : null}
        {trades.data?.at(-1)?.next_cursor ? <div className="border-t border-border p-3"><button type="button" disabled={trades.isValidating} onClick={() => void trades.setSize(trades.size + 1)} className="rounded border border-border px-3 py-1.5 text-xs text-accent disabled:opacity-50">{trades.isValidating ? '加载中…' : '加载更多'}</button></div> : null}
      </section>}
      <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm text-muted">关联链钱包（{data.wallets.length}）</summary><div className="mt-3 space-y-2">{data.wallets.map((wallet) => <p key={JSON.stringify([wallet.chain, wallet.address])} className="break-all text-xs text-muted">{chainName(wallet.chain)} · {wallet.address} · {wallet.coverage === 'complete' ? '完整' : '数据不完整'} · {time(wallet.snapshot_at)}</p>)}</div></details>
    </> : null}
  </div>;
}

function WalletDetail({target}: {target: Extract<LeaderboardDetailTarget, {type: 'wallet'}>}) {
  const [chain, setChain] = useState(target.chains[0]);
  return <div className="space-y-5"><SmartMoneyDetailHeader query={{identity_type: 'wallet', namespace: target.namespace, wallet_address: target.address}} fallbackName={shortAddr(target.address, 10, 8)} subtitle={<>GMGN 钱包 · {target.namespace}</>} /><p className="text-sm text-muted">榜单可能汇总多条链的收益；下方展示所选链的持仓与交易。</p><ChainFilter chains={target.chains} selected={chain} select={setChain} /><SmartMoneyProfile key={`${chain}:${target.address}`} chain={chain} address={target.address} backHref={backHref} /></div>;
}

function SmartXUserDetail({id}: {id: string}) {
  const portfolio = useSWR(['public-user-portfolio', id], ([, id]) => getUserPortfolio(id), {shouldRetryOnError: false, refreshInterval: 60_000});
  const data = portfolio.data;
  const rows = (data?.positions ?? []).map((row): HoldingRow => ({key: JSON.stringify([row.asset.chain, row.asset.token_address, row.opened_entry_id]), chain: row.asset.chain, address: row.asset.token_address, symbol: row.symbol, logo: row.logo, quantity: formatBaseUnitsExact(row.shares_raw, row.decimals), value: row.market_value_usd, cost: row.cost_basis_usd, realized: row.realized_pnl_usd, unrealized: row.unrealized_pnl_usd, snapshot: data?.observed_at ? Number(data.observed_at.seconds) : undefined}));
  return <div className="space-y-5"><a href={backHref} className="text-sm text-muted hover:text-accent">← 返回统一榜单</a><header className="rounded-xl border border-border bg-surface p-5"><p className="text-xs text-accent">SmartX</p><h1 className="mt-2 text-xl font-semibold">用户持仓</h1><p className="mt-1 break-all text-xs text-muted">{id} · 本站账本组合</p><button type="button" disabled={portfolio.isValidating} onClick={() => void portfolio.mutate()} className="mt-3 text-sm text-accent disabled:opacity-50">{portfolio.isValidating ? '刷新中…' : '刷新'}</button></header>
    {portfolio.error ? <DetailError error={portfolio.error} retry={() => void portfolio.mutate()} /> : null}
    {portfolio.isLoading ? <p role="status" className="p-8 text-center text-muted">正在加载本站用户持仓…</p> : null}
    {data ? <>{data.partial_errors.length > 0 || (data.completeness && data.completeness !== 'complete') ? <p role="status" className="text-sm text-accent">部分组合数据尚不完整。</p> : null}<p className="text-sm text-muted">当前持仓市值 <span className="font-mono text-foreground">{usd(data.total_value_usd)}</span></p><HoldingTable rows={rows} /></> : null}
  </div>;
}

export function LeaderboardDetailView({target}: {target: LeaderboardDetailTarget}) {
  if (target.type === 'external_user') return <ExternalUserDetail target={target} />;
  if (target.type === 'wallet') return <WalletDetail target={target} />;
  return <SmartXUserDetail id={target.id} />;
}
