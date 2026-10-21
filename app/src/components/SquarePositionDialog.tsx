'use client';

import {Dialog} from 'radix-ui';
import {useState} from 'react';
import {X} from 'lucide-react';
import dynamic from 'next/dynamic';
import {useSession} from '@/session/storage';
import {ApiError} from '@/api/envelope';
import {PortfolioDataError} from '@/api/portfolio';
import {useSquarePositionData} from '@/hooks/useSquarePositionData';
import {decimalSign, formatDecimalExact, formatPriceExact} from '@/lib/exact-decimal';
import {opinionCycleReturn} from '@/lib/opinion-card-display';
import {squarePositionKey, type SquarePositionTarget} from '@/lib/square-position';
import {TokenAvatar} from './TokenAvatar';
const PriceChart = dynamic(() => import('./PriceChart'), {ssr: false, loading: () => <p className="p-4 text-sm text-muted">正在加载价格图表…</p>});
const usd = (value?: string) => {
  const formatted = formatDecimalExact(value);
  return formatted === '—' ? '—' : formatted.startsWith('-') ? `-$${formatted.slice(1)}` : `$${formatted}`;
};
const price = (value?: string) => value === undefined ? '—' : `$${formatPriceExact(value)}`;

export function SquarePositionDialog({target, onClose}: {target: SquarePositionTarget; onClose: () => void}) {
  const session = useSession();
  return <Dialog.Root open onOpenChange={(open) => {if (!open) onClose();}}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/65" />
    <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
      <header className="relative border-b border-border px-5 py-4"><Dialog.Title className="pr-10 text-lg font-semibold">持仓详情</Dialog.Title><Dialog.Description className="mt-1 truncate text-sm text-muted">{target.name} · {target.symbol || 'Token'} · {target.chain}</Dialog.Description><Dialog.Close aria-label="关闭持仓详情" className="absolute right-4 top-4 rounded-md p-2 text-muted hover:bg-surface-2"><X size={18} /></Dialog.Close></header>
      <div className="overflow-y-auto overscroll-contain p-4 sm:p-5"><SquarePositionContent key={`${squarePositionKey(target)}:${session?.jwt ?? ''}`} target={target} bearer={session?.jwt} /></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

function SquarePositionContent({target, bearer}: {target: SquarePositionTarget; bearer?: string}) {
  const data = useSquarePositionData(target, bearer);
  const [selectedRecordKey, selectRecord] = useState('');
  const records = data.closedRecords;
  const selectedRecord = records?.find((record) => record.key === selectedRecordKey);
  const retainedHolding = records?.length ? selectedRecord?.holding : data.holding;
  const pendingAfterClose = target.kind !== 'user' && target.closedHint !== true && !selectedRecord && (records?.length ? records.some((record) => record.holding.observation?.status === 'pending_source_refresh') : retainedHolding?.state === 'closed' && retainedHolding.observation?.status === 'pending_source_refresh');
  // 旧清仓快照不能代表后续活动后的当前仓位；历史记录仍由明确选择保留。
  const holding = pendingAfterClose ? {state: 'pending' as const, observation: retainedHolding?.observation} : retainedHolding;
  const sourceStateUnconfirmed = holding?.state === 'open' && holding.financeStatus === 'unavailable' && holding.quantity === undefined;
  const awaitingSnapshot = holding?.state === 'pending' || sourceStateUnconfirmed;
  const closed = awaitingSnapshot ? undefined : holding ? holding.state === 'closed' : records?.length ? true : target.closedHint;
  const observation = holding?.observation;
  const observedValue = (key: string, legacy?: string) => observation?.metrics
    ? observation.metrics[key]?.status === 'available' ? observation.metrics[key].value : undefined
    : legacy;
  const observedBuyPrice = observedValue('avg_bought_price'), observedSellPrice = observedValue('avg_sold_price');
  // 只能在非历史仓位使用明确标注的观察均价；正式零值仍优先。
  const buyFromObservation = !closed && !pendingAfterClose && holding?.avgBuyPrice === undefined && observedBuyPrice !== undefined;
  const sellFromObservation = !closed && !pendingAfterClose && holding?.avgSellPrice === undefined && observedSellPrice !== undefined;
  const pnl = holding?.pnlUSD, sign = decimalSign(pnl);
  const roi = opinionCycleReturn(holding?.ratio);
  const ratioText = roi.text === '—' ? '—' : `${roi.direction === 'down' ? '-' : roi.direction === 'up' ? '+' : ''}${roi.text}`;
  const profileHref = target.kind === 'user' ? `/user?identifier=${encodeURIComponent(target.identifier)}`
    : target.kind === 'external_user' ? `/smart-money?subject_id=${encodeURIComponent(target.identifier)}`
    : `/smart-money?${new URLSearchParams({namespace: target.chain === 'solana' || target.chain === 'sol' ? 'solana' : 'evm', wallet_address: target.identifier, source_chain: target.chain === 'sol' ? 'solana' : target.chain === 'eth' ? 'ethereum' : target.chain})}`;
  const authExpired = [data.positionError, data.historyError].some((error) => error instanceof ApiError && error.code === 400000);
  const metrics = [
    {label: '持仓市值', value: closed ? '—' : usd(holding?.valueUSD)},
    {label: '持仓数量', value: closed ? '—' : holding?.quantity === undefined ? '—' : `${formatQuantity(holding.quantity)} ${target.symbol || ''}`},
    {label: closed ? '已实现收益' : '总收益', value: pnl === undefined ? '—' : `${sign === 1 ? '+' : ''}${usd(pnl)}`, tone: sign === -1 ? 'text-down' : sign === 1 ? 'text-up' : ''},
    {label: '收益率', value: ratioText},
    {label: holding?.buyAmountScope === 'record' ? '记录买入金额' : '累计买入金额', value: usd(holding?.investedUSD)},
    {label: buyFromObservation ? '平均买入价（已记录交易）' : '平均买入价', value: price(buyFromObservation ? observedBuyPrice : holding?.avgBuyPrice)},
    {label: sellFromObservation ? '平均卖出价（已记录交易）' : '平均卖出价', value: price(sellFromObservation ? observedSellPrice : holding?.avgSellPrice)},
    {label: '当前价格', value: closed ? '—' : price(holding?.currentPrice)},
  ];
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><TokenAvatar chain={target.chain} address={target.address} fallbackLogo={target.logo} fallbackSymbol={target.symbol} size={36} /><div><a href={profileHref} className="break-all text-sm font-semibold hover:underline">{target.name}</a><p className="text-xs text-muted">{target.kind === 'user' ? '平台用户' : '聪明钱'} · {sourceStateUnconfirmed ? '状态待确认' : awaitingSnapshot ? '待回扫确认' : closed === undefined ? '状态待确认' : closed ? '已平仓' : '持仓中'}</p></div></div><button type="button" onClick={data.refresh} disabled={data.pending || data.historyPending} className="rounded-md border border-border px-3 py-2 text-xs text-accent disabled:opacity-50">刷新持仓</button></div>
    {authExpired ? <p role="alert" className="text-sm text-muted">登录已过期，请<a href="/login" className="text-accent underline">重新登录</a>后查看。</p> : <>
      {data.pending ? <p role="status" className="text-sm text-muted">正在读取作者持仓…</p> : null}
      {data.positionError ? <PositionError error={data.positionError} retry={data.refresh} /> : null}
      {data.unavailable ? <p role="status" className="text-sm text-muted">{data.unavailable}</p> : null}
      {data.stale ? <p role="status" className="text-sm text-down">当前持仓快照较旧，请刷新后再查看。</p> : null}
      {data.coverage && data.coverage !== 'complete' ? <p role="status" className="text-sm text-muted">持仓或交易记录覆盖不完整（{data.coverage}），缺失数值以 — 展示。</p> : null}
      {records?.length ? <div className="space-y-2 rounded-xl border border-border p-4">
        <label htmlFor="closed-position-record" className="block text-sm font-semibold">已平仓记录（{records.length}）</label>
        <select id="closed-position-record" value={selectedRecord?.key ?? ''} onChange={(event) => selectRecord(event.target.value)} className="w-full rounded-md border border-border bg-surface p-2 text-sm">
          <option value="">请选择要查看的记录</option>
          {records.map((record, index) => <option key={record.key} value={record.key}>记录 {index + 1} · {record.at ? tradeTime(record.at) : '时间未知'}</option>)}
        </select>
        <p className="text-xs text-muted">指标按所选历史记录展示。下方交易历史为该币已采集交易，不代表所选记录的完整周期。</p>
      </div> : null}
      {sourceStateUnconfirmed ? <p role="status" className="text-sm text-muted">上次来源记录为持仓中，当前状态、数量和收益尚未确认。来源快照时间：{tradeTime(holding?.financeAsOf)}。已记录交易均价与收支差继续单独展示。</p> : null}
      {pendingAfterClose ? <p role="status" className="text-sm text-muted">上次来源记录已平仓，但后续有新交易或修订。当前数量、市值和盈亏等待新快照确认；旧平仓收益不作为本次持仓收益。</p> : null}
      {awaitingSnapshot || observation?.status === 'pending_source_refresh' ? <p role="status" className="text-sm text-muted">已采集到交易，正在等待持仓来源回扫更新。持仓数量、成本和盈亏以回扫结果为准。</p> : null}
      {observation ? <section aria-label="已观测交易小计" className="rounded-xl border border-border p-4">
        <h2 className="text-sm font-semibold">已观测交易</h2>
        <p className="mt-1 text-xs text-muted">仅汇总该币已采集的买卖，不代表完整历史累计或所选历史仓位；转账不计入，未知金额显示 —。买卖收支差不等于持仓收益。</p>
        <dl className="mt-3 grid grid-cols-2 gap-4">
          <div><dt className="text-xs text-muted">已观测买入金额</dt><dd className="break-all font-mono text-sm">{usd(observedValue('bought_usd', observation.boughtUSD))}</dd></div>
          <div><dt className="text-xs text-muted">已观测卖出金额</dt><dd className="break-all font-mono text-sm">{usd(observedValue('sold_usd', observation.soldUSD))}</dd></div>
          <div><dt className="text-xs text-muted">已观测买入数量</dt><dd className="break-all font-mono text-sm">{observedValue('bought_amount', observation.boughtQuantity) === undefined ? '—' : formatQuantity(observedValue('bought_amount', observation.boughtQuantity)!)}</dd></div>
          <div><dt className="text-xs text-muted">已观测卖出数量</dt><dd className="break-all font-mono text-sm">{observedValue('sold_amount', observation.soldQuantity) === undefined ? '—' : formatQuantity(observedValue('sold_amount', observation.soldQuantity)!)}</dd></div>
          {observation.metrics ? <>
            <div><dt className="text-xs text-muted">已记录平均买入价</dt><dd className="break-all font-mono text-sm">{price(observedBuyPrice)}</dd></div>
            <div><dt className="text-xs text-muted">已记录平均卖出价</dt><dd className="break-all font-mono text-sm">{price(observedSellPrice)}</dd></div>
            <div><dt className="text-xs text-muted">买卖收支差（非收益）</dt><dd className="break-all font-mono text-sm">{usd(observedValue('cash_flow_difference'))}</dd></div>
          </> : null}
        </dl>
        {observation.buyCount !== undefined || observation.sellCount !== undefined ? <p className="mt-3 text-xs text-muted">买入 {observation.buyCount ?? '—'} 笔 · 卖出 {observation.sellCount ?? '—'} 笔</p> : null}
        {observation.firstObservedAt || observation.lastObservedAt ? <p className="mt-1 text-xs text-muted">记录范围：{tradeTime(observation.firstObservedAt)} 至 {tradeTime(observation.lastObservedAt)}</p> : null}
      </section> : null}
      <dl aria-label="持仓指标" className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-surface-2/40 p-4 sm:grid-cols-4">{metrics.map((metric) => <div key={metric.label}><dt className="text-xs text-muted">{metric.label}</dt><dd className={`mt-1 break-all font-mono text-sm ${metric.tone || 'text-foreground'}`}>{metric.value}</dd></div>)}</dl>
      {(['transferIn', 'transferOut'] as const).map((field) => decimalSign(holding?.[field]) === 1 ? <p key={field} className="text-sm text-muted">{field === 'transferIn' ? '外部转入' : '外部转出'}：{formatQuantity(holding![field]!)} {target.symbol}</p> : null)}
    </>}
    <PriceChart chain={target.chain === 'sol' ? 'solana' : target.chain === 'eth' ? 'ethereum' : target.chain} address={target.address} />
    {target.opinionBody ? <section className="rounded-xl border border-border p-4"><h2 className="mb-2 text-sm font-semibold">作者观点</h2><p className="whitespace-pre-wrap break-words text-sm text-muted">{target.opinionBody}</p></section> : null}
    {!authExpired ? <section aria-label="持仓交易历史" className="rounded-xl border border-border p-4"><h2 className="mb-3 text-sm font-semibold">交易历史</h2>
      {data.historyError && data.historyError !== data.positionError ? <PositionError error={data.historyError} retry={data.refresh} /> : null}
      {data.historyPending ? <p role="status" className="text-sm text-muted">正在读取交易记录…</p> : data.trades?.length === 0 ? <p className="text-sm text-muted">暂无已采集的交易记录。</p> : data.trades ? <ul className="divide-y divide-border">{data.trades.map((trade, index) => <li key={`${trade.wallet ?? ''}:${trade.txHash ?? ''}:${index}`} className="flex items-start justify-between gap-3 py-3 text-sm"><div className="min-w-0"><p className={trade.event.toLowerCase() === 'buy' ? 'text-up' : trade.event.toLowerCase() === 'sell' ? 'text-down' : 'text-muted'}>{trade.event.toLowerCase() === 'buy' ? '买入' : trade.event.toLowerCase() === 'sell' ? '卖出' : trade.event.toUpperCase()}</p><p className="text-xs text-muted">{tradeTime(trade.at)}</p>{trade.wallet ? <p title={trade.wallet} className="max-w-48 truncate text-xs text-muted">{trade.wallet}</p> : null}</div><div className="text-right font-mono"><p>{usd(trade.amountUSD)}</p><p className="text-xs text-muted">@ {price(trade.priceUSD)}</p></div></li>)}</ul> : <p className="text-sm text-muted">该持仓的交易记录暂不可用。</p>}
    </section> : null}
    <a href={`/token/${encodeURIComponent(target.chain)}/${encodeURIComponent(target.address)}`} className="block rounded-lg bg-accent px-4 py-3 text-center text-sm font-semibold text-white">查看代币详情与交易</a>
  </div>;
}

function formatQuantity(value: string) {return value.endsWith(' base units') ? value : formatPriceExact(value, 12);}
function tradeTime(value?: string | number) {
  if (value === undefined) return '—';
  const at = typeof value === 'string' && value.includes('T') ? Date.parse(value) : Number(value) * 1000;
  return Number.isSafeInteger(at) && at > 0 && Number.isFinite(new Date(at).getTime()) ? new Date(at).toLocaleString() : '—';
}
function PositionError({error, retry}: {error: unknown; retry: () => void}) {
  const trace = error instanceof ApiError || error instanceof PortfolioDataError ? error.traceID : undefined;
  return <div role="alert" className="rounded-md border border-down/40 p-3 text-sm text-down">持仓数据读取失败，请重试。{error instanceof ApiError ? ` code ${error.code}` : ''}{trace ? ` · trace ${trace}` : ''}<button type="button" onClick={retry} className="ml-3 underline">重试</button></div>;
}
