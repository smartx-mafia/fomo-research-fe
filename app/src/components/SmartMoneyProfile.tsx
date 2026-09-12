'use client';

import {Fragment, useEffect, useState} from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import {ApiError} from '@/api/envelope';
import {followTarget, getRelations, setRemark, unfollowTarget, type SmartMoneyRelation} from '@/api/social';
import {getSmartMoneyHoldings, getSmartMoneyTokenTrades, getSmartMoneyTrades, type SmartMoneyHolding, type SmartMoneyTokenTrades, type SmartMoneyTrade} from '@/api/smartmoney';
import {useSession} from '@/session/storage';
import {ErrorPanel} from './ErrorPanel';
import {decimalSign, formatDecimalExact, marketValueFromBaseUnits} from '@/lib/exact-decimal';
import {chainLabel, shortAddr, fmtUsd} from '@/lib/format';
import {SmartMoneyTokenMetadata} from './SmartMoneyTokenMetadata';
import {SmartMoneyTokenFdv} from './SmartMoneyTokenFdv';
import {holdingRoi} from '@/lib/holding-roi';
import {averageSellPrice} from '@/lib/average-sell-price';
import {SmartMoneyPnlSummary} from './SmartMoneyPnlSummary';
import {TokenAvatarView, useTokenDisplay} from './TokenAvatar';

function money(value?: string) {return value ? `${decimalSign(value) === -1 ? '-' : ''}$${formatDecimalExact(value.replace(/^-/, ''), 2)}` : '—';}
function price(value?: string) {return value ? `$${formatDecimalExact(value, 12)}` : '—';}
function ratio(value?: string) {return value ? `${formatDecimalExact(marketValueFromBaseUnits('100', 0, value), 2)}%` : '—';}
function qty(value?: string) {return value ? formatDecimalExact(value, 4) : '—';}
function when(seconds?: number) {return seconds ? new Date(seconds * 1000).toLocaleString() : '—';}
function tone(value?: string) {return decimalSign(value) === 1 ? 'text-up' : decimalSign(value) === -1 ? 'text-down' : 'text-muted';}
function chainName(chain: string) {return chain === 'sol' ? 'Solana' : chainLabel(chain);}

function Token({entry, chain, showAverage = false, tradeTime}: {entry: Pick<SmartMoneyHolding, 'symbol'|'name'|'logo'|'token_address'|'is_honeypot'|'chain'|'launchpad'|'avg_cost_market_cap_usd'>; chain?: string; showAverage?: boolean; tradeTime?: string}) {
  const tokenChain = entry.chain || chain || '';
  const tokenAddress = entry.token_address ?? '';
  const {info, isFavorited, personalReady} = useTokenDisplay(tokenChain, tokenAddress);
  const symbol = info?.symbol ?? entry.symbol;
  const name = info?.name ?? entry.name;
  const label = symbol ?? name ?? shortAddr(tokenAddress, 6, 4);
  return <div className="flex min-w-[150px] items-center gap-2.5">
    <TokenAvatarView info={info} isFavorited={isFavorited} personalReady={personalReady} size={32} fallbackLogo={entry.logo}
      fallbackSymbol={entry.symbol} fallbackName={entry.name} />
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><p className="truncate font-medium text-foreground">{label}</p></div><p className="truncate text-[10px] text-muted">{entry.is_honeypot ? '风险标记 · ' : ''}{name ?? tokenAddress ?? '未知 Token'}</p>{chain ? <SmartMoneyTokenMetadata chain={tokenChain} platform={info?.launchpad_name ?? entry.launchpad} averageEntry={showAverage ? fmtUsd(entry.avg_cost_market_cap_usd) : undefined} tradeTime={tradeTime} /> : null}</div>
  </div>;
}

function EventBadge({type}: {type?: string}) {
  const style = type === 'buy' ? 'bg-up/10 text-up' : type === 'sell' ? 'bg-down/10 text-down' : 'bg-surface-2 text-muted';
  return <span className={`rounded px-2 py-1 text-[10px] font-semibold ${style}`}>{type ?? '—'}</span>;
}

function TokenHistory({chain, address, token, entry, variant}: {chain: string; address: string; token: string; entry: SmartMoneyHolding; variant: 'open'|'closed'}) {
  const getKey = (index: number, previous: SmartMoneyTokenTrades | null) => index > 0 && !previous?.next_cursor ? null : ['smart-token-trades', chain, address, token, index === 0 ? '' : previous!.next_cursor!] as const;
  const history = useSWRInfinite(getKey, async ([, c, wallet, asset, cursor]) => (await getSmartMoneyTokenTrades(c, wallet, asset, cursor)).data,
    {revalidateOnFocus: false, shouldRetryOnError: false});
  const rows = history.data?.flatMap((page) => page.list ?? []) ?? [];
  return <div className="border-t border-border bg-background/40 p-4">
    <div className="mb-3 flex flex-wrap gap-6 text-xs"><span>当前持仓价值 <b>{money(entry.usd_value)}</b></span><span>总盈亏 <b className={tone(entry.total_profit)}>{money(entry.total_profit)}</b></span><span>总市值 <SmartMoneyTokenFdv chain={entry.chain || chain} address={token} /></span>{variant === 'closed' ? <span title="平均持仓成本乘以采集时点总供应量，并非历史买入时市值">平均买入市值 <b>{money(entry.avg_cost_market_cap_usd)}</b></span> : null}<span>累积买入 <b>{money(entry.history_bought_cost)}</b></span><span>买入均价 <b>{price(entry.avg_bought_price)}</b></span>{variant === 'closed' ? <><span>累积卖出 <b>{money(entry.history_sold_income)}</b></span><span>累积卖出份额 <b>{qty(entry.history_sold_amount)}</b></span><span title="累积卖出金额 ÷ 累积卖出份额（USD/枚）">卖出均价 <b>{price(averageSellPrice(entry.history_sold_income, entry.history_sold_amount))}</b></span></> : null}</div>
    {history.error ? <p className="py-4 text-sm text-down">交易历史加载失败。<button onClick={() => void history.mutate()} className="ml-2 underline">重试</button></p> : null}
    {history.isLoading ? <p className="py-4 text-sm text-muted">正在加载该 Token 的交易历史…</p> : null}
    {!history.isLoading && !history.error && rows.length === 0 ? <p className="py-4 text-sm text-muted">该 Token 暂无交易历史。</p> : null}
    {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-xs"><thead className="text-muted"><tr><th className="p-2 text-left">时间</th><th className="p-2 text-left">类型</th><th className="p-2 text-right">数量</th><th className="p-2 text-right">计价</th><th className="p-2 text-right">成交价</th><th className="p-2 text-right">金额</th><th className="p-2 text-right">轮次</th><th className="p-2 text-right">Tx</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.tx_hash ?? ''}:${index}`} className="border-t border-border"><td className="p-2">{when(row.occurred_at)}</td><td className="p-2"><EventBadge type={row.event_type} />{(row.legs ?? 0) > 1 ? <span className="ml-1 text-muted">×{row.legs}</span> : null}</td><td className="p-2 text-right font-mono">{qty(row.token_amount)}</td><td className="p-2 text-right font-mono">{qty(row.quote_amount)} {row.quote_symbol ?? ''}</td><td className="p-2 text-right font-mono">{price(row.price_usd)}</td><td className="p-2 text-right font-mono">{money(row.cost_usd)}</td><td className="p-2 text-right">{row.round ? `#${row.round}` : '—'}</td><td className="p-2 text-right font-mono" title={row.tx_hash}>{shortAddr(row.tx_hash ?? '', 6, 4) || '—'}</td></tr>)}</tbody></table></div> : null}
    {history.data?.at(-1)?.next_cursor ? <button type="button" disabled={history.isValidating} onClick={() => void history.setSize(history.size + 1)} className="mt-3 rounded border border-border px-3 py-1.5 text-xs text-accent disabled:opacity-50">{history.isValidating ? '加载中…' : '加载更多'}</button> : null}
    {history.data?.some((page) => page.complete === false) ? <p className="mt-3 text-xs text-accent">历史尚未完整，仅展示当前已回填记录。</p> : null}
  </div>;
}

function HoldingsTable({list, variant, chain, address}: {list: SmartMoneyHolding[]; variant: 'open'|'closed'; chain: string; address: string}) {
  const [expanded, setExpanded] = useState<string>();
  return <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead className="text-muted"><tr><th className="p-3">Token</th><th className="min-w-[130px] px-6 py-3" aria-label={variant === 'closed' ? '总盈亏与ROI' : '当前持仓价值与ROI'} />{variant === 'open' ? <th className="p-3 text-right">持仓量</th> : null}<th className="p-3 text-right">已实现</th><th className="p-3 text-right">未实现</th><th className="p-3 text-right">总盈亏</th></tr></thead><tbody>{list.map((entry, index) => {
    const roi = holdingRoi(entry.total_profit, entry.history_bought_cost);
    const token = entry.token_address ?? ''; const open = token !== '' && expanded === token;
    return <Fragment key={`${token}:${index}`}><tr onClick={() => token && setExpanded(open ? undefined : token)} className="cursor-pointer border-t border-border hover:bg-surface-2/50"><td className="p-3"><div className="flex items-center gap-2"><span className={`text-muted transition ${open ? 'rotate-90' : ''}`}>›</span><Token entry={entry} chain={chain} showAverage={variant === 'open'} tradeTime={variant === 'closed' ? when(entry.last_active_at) : undefined} /></div></td><td className="min-w-[130px] px-6 py-3 text-right font-mono font-semibold"><div className="flex flex-col items-end gap-1"><span title={variant === 'closed' ? '总盈亏（USD）' : '当前持仓价值（USD）'} className={`whitespace-nowrap ${variant === 'closed' ? tone(entry.total_profit) : 'text-foreground'}`}>{money(variant === 'closed' ? entry.total_profit : entry.usd_value)}</span><span title="ROI：总盈亏 ÷ 生涯累计买入成本" className={`text-[10px] ${roi.direction > 0 ? 'text-up' : roi.direction < 0 ? 'text-down' : 'text-muted'}`}>{roi.text}</span></div></td>{variant === 'open' ? <td className="p-3 text-right font-mono">{qty(entry.balance)}</td> : null}<td className={`p-3 text-right font-mono ${tone(entry.realized_profit)}`}>{money(entry.realized_profit)}<p className="text-[10px]">{ratio(entry.realized_profit_pnl)}</p></td><td className={`p-3 text-right font-mono ${tone(entry.unrealized_profit)}`}>{money(entry.unrealized_profit)}<p className="text-[10px]">{ratio(entry.unrealized_profit_pnl)}</p></td><td className={`p-3 text-right font-mono font-semibold ${tone(entry.total_profit)}`}>{money(entry.total_profit)}</td></tr>{open ? <tr><td colSpan={variant === 'open' ? 6 : 5} className="p-0"><TokenHistory chain={chain} address={address} token={token} entry={entry} variant={variant} /></td></tr> : null}</Fragment>;
  })}</tbody></table></div>;
}

function RecentTrades({list, chain}: {list: SmartMoneyTrade[]; chain: string}) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="text-muted"><tr><th className="p-3">时间</th><th className="p-3">类型</th><th className="p-3">Token</th><th className="p-3 text-right">数量</th><th className="p-3 text-right">计价</th><th className="p-3 text-right">成交价</th><th className="p-3 text-right">金额</th><th className="p-3 text-right">Tx</th></tr></thead><tbody>{list.map((trade, index) => <tr key={`${trade.tx_hash ?? ''}:${index}`} className="border-t border-border"><td className="p-3">{when(trade.occurred_at)}</td><td className="p-3"><EventBadge type={trade.event_type} /></td><td className="p-3"><Token chain={chain} entry={{token_address: trade.token_address, symbol: trade.token_symbol, logo: trade.token_logo}} /></td><td className="p-3 text-right font-mono">{qty(trade.token_amount)}</td><td className="p-3 text-right font-mono">{qty(trade.quote_amount)} {trade.quote_symbol ?? ''}</td><td className="p-3 text-right font-mono">{price(trade.price_usd)}</td><td className="p-3 text-right font-mono">{money(trade.cost_usd)}</td><td className="p-3 text-right font-mono" title={trade.tx_hash}>{shortAddr(trade.tx_hash ?? '', 6, 4) || '—'}</td></tr>)}</tbody></table></div>;
}

/**
 * 聪明钱客态页的头部 + 关注行（social.md §5 / §5.1 / §5.2）。
 * 聪明钱的身份键只有地址不带链：关注 / 备注 / 关系批查都把地址**原样**传，
 * 不改大小写（§5.1）。登录前只显示一句灰字，不挡页面内容。
 */
function SmartMoneyFollowHeader({chain, address}: {chain: string; address: string}) {
  const session = useSession();
  const jwt = session?.jwt ?? null;
  // undefined = 批查进行中；null = 回包里没有该地址的占位（按未关注处理）。
  const [relation, setRelation] = useState<SmartMoneyRelation | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState<ApiError | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [pending, setPending] = useState(false);
  const [remarkEditing, setRemarkEditing] = useState(false);
  const [remarkDraft, setRemarkDraft] = useState('');
  const [remarkSaving, setRemarkSaving] = useState(false);
  const [actionErr, setActionErr] = useState<ApiError | null>(null);

  // 登录后按 §5 关系批查拉「已关注 + 备注」；单目标就传单元素数组（没有单查端点）。
  useEffect(() => {
    if (!jwt) return;
    let cancelled = false;
    setRelation(undefined);
    setLoadErr(null);
    getRelations(jwt, {userIdentifiers: [], addresses: [address]})
      .then((res) => {
        if (!cancelled) setRelation(res.data.smart_money?.[0] ?? null);
      })
      .catch((error: unknown) => {
        // call() 的失败恒为 ApiError（三类之一），与 RecommendedTradersCard 同口径直接收下。
        if (!cancelled) setLoadErr(error as ApiError);
      });
    return () => {
      cancelled = true;
    };
  }, [jwt, address, reloadNonce]);

  const following = !!relation?.following;
  const remark = relation?.remark ?? '';

  /** 乐观切换，失败回滚；成功后本页没有别的计数要刷新（§5.1）。 */
  async function toggleFollow() {
    if (!jwt || pending || relation === undefined) return;
    setActionErr(null);
    setPending(true);
    setRelation((current) => (current ? {...current, following: !following} : current));
    try {
      const res = following
        ? await unfollowTarget(jwt, 'smart_money', address)
        : await followTarget(jwt, 'smart_money', address);
      setRelation((current) => ({
        address,
        following: !!res.data.following,
        chains: res.data.chains ?? current?.chains,
        remark: current?.remark,
      }));
    } catch (error) {
      setRelation((current) => (current ? {...current, following} : current));
      setActionErr(error as ApiError);
    } finally {
      setPending(false);
    }
  }

  /** 备注与关注完全解耦（§5.2）：value 为空串 = 清除（逻辑删除，可再设）。 */
  async function saveRemark(value: string) {
    if (!jwt || remarkSaving) return;
    setActionErr(null);
    setRemarkSaving(true);
    try {
      const res = await setRemark(jwt, 'smart_money', address, value);
      // 清除成功回包 remark 缺席 → 折叠成空串。
      setRelation((current) => ({
        address,
        following: current?.following,
        chains: current?.chains,
        remark: res.data.remark ?? '',
      }));
      setRemarkEditing(false);
    } catch (error) {
      setActionErr(error as ApiError);
    } finally {
      setRemarkSaving(false);
    }
  }

  return (
    <>
      <header className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2"><span className="rounded-full bg-accent/10 px-2 py-1 text-xs font-semibold text-accent">Smart Money</span><span className="text-xs text-muted">{chainName(chain)}</span></div>
        {/* 备注徽标与地址刻意不同样式：地址是 mono 正文，备注是我起的名字（accent 胶囊）。 */}
        <h1 className="mt-3 flex flex-wrap items-center gap-2 font-mono text-lg font-semibold">
          {shortAddr(address, 10, 8)}
          {remark ? <span title="我给这个地址起的备注" className="rounded-full bg-accent/10 px-2 py-0.5 font-sans text-[11px] font-medium text-accent">{remark}</span> : null}
        </h1>
        <p className="break-all text-xs text-muted">{address}</p>
      </header>
      {!jwt ? (
        // 未登录不挡页面：一行灰字说明，正文照常。
        <section className="rounded-xl border border-border bg-surface px-5 py-3 text-xs text-muted">登录后可关注</section>
      ) : (
        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleFollow()}
              disabled={pending || relation === undefined}
              className={`rounded px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                following ? 'bg-surface-2 text-muted hover:text-foreground' : 'border border-border text-foreground hover:border-accent/60'
              }`}
            >
              {relation === undefined ? '…' : following ? 'Following' : 'Follow'}
            </button>
            <button
              type="button"
              onClick={() => {
                setRemarkDraft(remark);
                setRemarkEditing((open) => !open);
              }}
              className="rounded px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              备注
            </button>
            {relation === undefined && !loadErr ? <span className="text-xs text-muted">正在获取关注状态…</span> : null}
          </div>
          {remarkEditing ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={remarkDraft}
                maxLength={64}
                placeholder="只有自己可见的备注（1–64 字）"
                onChange={(event) => setRemarkDraft(event.target.value)}
                className="w-64 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent/60"
              />
              <button
                type="button"
                disabled={remarkSaving || remarkDraft.trim().length === 0}
                onClick={() => void saveRemark(remarkDraft.trim())}
                className="rounded border border-border px-3 py-1.5 text-xs text-accent disabled:opacity-50"
              >
                {remarkSaving ? '保存中…' : '保存'}
              </button>
              <button type="button" disabled={remarkSaving} onClick={() => void saveRemark('')} className="rounded px-2 py-1.5 text-xs text-muted hover:text-down">
                清除
              </button>
              <button type="button" disabled={remarkSaving} onClick={() => setRemarkEditing(false)} className="rounded px-2 py-1.5 text-xs text-muted hover:text-foreground">
                取消
              </button>
            </div>
          ) : null}
          {loadErr ? (
            <div className="mt-3 space-y-2">
              <button type="button" onClick={() => setReloadNonce((value) => value + 1)} className="text-xs text-accent hover:underline">
                重试
              </button>
              <ErrorPanel err={loadErr} />
            </div>
          ) : null}
          {actionErr ? <div className="mt-3"><ErrorPanel err={actionErr} /></div> : null}
        </section>
      )}
    </>
  );
}

export function SmartMoneyProfile({chain, address}: {chain: string; address: string}) {
  const holdings = useSWR(['smart-money-holdings-v2', chain, address], ([, c, a]) => getSmartMoneyHoldings(c, a).then((result) => result.data), {refreshInterval: 10_000, shouldRetryOnError: false});
  const trades = useSWR(['smart-money-trades-v2', chain, address], ([, c, a]) => getSmartMoneyTrades(c, a).then((result) => result.data), {shouldRetryOnError: false});
  const [tab, setTab] = useState<'holdings'|'trades'>('holdings');
  const [holdingTab, setHoldingTab] = useState<'open'|'closed'>('open');
  const list = holdingTab === 'open' ? holdings.data?.open ?? [] : holdings.data?.closed ?? [];
  const active = tab === 'holdings' ? holdings : trades;
  return <div className="space-y-5">
    <a href="/leaderboard" className="text-sm text-muted hover:text-foreground">← 返回榜单</a>
    <SmartMoneyFollowHeader chain={chain} address={address} />
    <SmartMoneyPnlSummary key={`${chain}:${address}`} data={holdings.data?.pnl_windows} />
    <div className="flex items-center justify-between gap-3"><div className="flex rounded-lg border border-border bg-surface p-1"><button onClick={() => setTab('holdings')} className={`rounded-md px-4 py-2 text-sm ${tab === 'holdings' ? 'bg-surface-2 text-foreground' : 'text-muted'}`}>持仓 {(holdings.data?.open?.length ?? 0) + (holdings.data?.closed?.length ?? 0)}</button><button onClick={() => setTab('trades')} className={`rounded-md px-4 py-2 text-sm ${tab === 'trades' ? 'bg-surface-2 text-foreground' : 'text-muted'}`}>交易 {trades.data?.list?.length ?? 0}</button></div><button onClick={() => void active.mutate()} disabled={active.isValidating} className="text-sm text-accent disabled:opacity-50">{active.isValidating ? '刷新中…' : '刷新'}</button></div>
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      {active.error ? <p className="p-5 text-sm text-down">数据加载失败：{active.error instanceof Error ? active.error.message : '未知错误'}</p> : null}
      {active.isLoading ? <p className="p-10 text-center text-sm text-muted">加载中…</p> : null}
      {tab === 'holdings' && !holdings.isLoading ? <><div className="flex gap-1 border-b border-border p-3"><button onClick={() => setHoldingTab('open')} className={`rounded px-3 py-1.5 text-xs ${holdingTab === 'open' ? 'bg-up/10 text-up' : 'text-muted'}`}>持仓中 {holdings.data?.open?.length ?? 0}</button><button onClick={() => setHoldingTab('closed')} className={`rounded px-3 py-1.5 text-xs ${holdingTab === 'closed' ? 'bg-surface-2 text-foreground' : 'text-muted'}`}>已清仓 {holdings.data?.closed?.length ?? 0}</button></div>{list.length ? <HoldingsTable list={list} variant={holdingTab} chain={chain} address={address} /> : <p className="p-10 text-center text-sm text-muted">暂无{holdingTab === 'open' ? '持仓中' : '已清仓'}记录。</p>}</> : null}
      {tab === 'trades' && !trades.isLoading ? trades.data?.list?.length ? <RecentTrades list={trades.data.list} chain={trades.data.chain || chain} /> : <p className="p-10 text-center text-sm text-muted">暂无最新交易。</p> : null}
    </section>
  </div>;
}
