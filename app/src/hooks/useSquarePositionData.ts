'use client';

import {useEffect, useRef} from 'react';
import useSWR from 'swr';
import {ApiError} from '@/api/envelope';
import {getUserPortfolio, getUserPortfolioPosition} from '@/api/user-portfolio';
import {getSquarePositionCapability, getSquarePositionTrades, getSquareSmartMoneyPosition, type SquareHolding, type SquarePositionTrade} from '@/api/square-position';
import {formatBaseUnitsExact} from '@/lib/exact-decimal';
import {squareCurrentCycle, squarePositionKey, type SquarePositionTarget} from '@/lib/square-position';

/** Mounted only while the dialog is open. Request ownership, session keys and
 * component keys prevent a closed/replaced holder from publishing late data. */
export function useSquarePositionData(target: SquarePositionTarget, bearer?: string) {
  const requests = useRef(new Set<AbortController>());
  const mounted = useRef(false);
  const snapshotRetry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function cancelSnapshotRetry() {
    if (snapshotRetry.current !== undefined) clearTimeout(snapshotRetry.current);
    snapshotRetry.current = undefined;
  }
  useEffect(() => {
    mounted.current = true;
    const active = requests.current;
    return () => {mounted.current = false; cancelSnapshotRetry(); active.forEach((request) => request.abort()); active.clear();};
  }, []);
  async function read<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    requests.current.add(controller);
    try {return await task(AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));}
    finally {requests.current.delete(controller);}
  }
  const key = [squarePositionKey(target), bearer ?? ''];
  const config = {shouldRetryOnError: false, revalidateOnFocus: false};
  const user = target.kind === 'user';
  const current = useSWR(user && !target.cycleKey && target.closedHint !== true ? ['square-holder-current', ...key] : null,
    () => read((signal) => getUserPortfolio(target.identifier, bearer, false, signal)), config);
  const cycleKey = target.cycleKey || squareCurrentCycle(target, current.data?.positions);
  const detail = useSWR(user && cycleKey ? ['square-holder-cycle', ...key, cycleKey] : null,
    () => read((signal) => getUserPortfolioPosition(target.identifier, {chain: target.chain, asset: target.address, cycle_key: cycleKey}, bearer, signal)), config);
  const capability = useSWR(!user ? ['square-holder-capability', ...key] : null,
    () => read(getSquarePositionCapability), {...config, dedupingInterval: 30_000});
  const positionsEnabled = !user && capability.data?.ready !== false;
  const snapshot = useSWR(positionsEnabled ? ['square-holder-snapshot', ...key] : null,
    () => read((signal) => getSquareSmartMoneyPosition(target, signal)), {
      ...config,
      refreshInterval: (value) => value?.holding?.state === 'pending' || value?.holding?.observation?.status === 'pending_source_refresh' || value?.closedRecords?.some((record) => record.holding.observation?.status === 'pending_source_refresh') ? 10_000 : 0,
      // SWR 在缓存存在错误时暂停 refreshInterval；只为快照暂时性失败恢复，
      // 最多连续重试三次。业务拒绝、鉴权/参数错误仍由用户处理。
      shouldRetryOnError: (error) => error instanceof ApiError && (error.kind === 'network' || error.kind === 'transport' && (error.code >= 500 || error.code === 408 || error.code === 429)),
      errorRetryCount: 3,
      errorRetryInterval: 10_000,
      onSuccess: cancelSnapshotRetry,
      onErrorRetry: (_error, _key, retryConfig, revalidate, options) => {
        cancelSnapshotRetry();
        if (!mounted.current || options.retryCount > (retryConfig.errorRetryCount ?? 3)) return;
        snapshotRetry.current = setTimeout(() => {
          snapshotRetry.current = undefined;
          if (mounted.current) void revalidate(options);
        }, retryConfig.errorRetryInterval ?? 10_000);
      },
    });
  const history = useSWR(!user ? ['square-holder-trades', ...key] : null,
    () => read((signal) => getSquarePositionTrades(target, signal)), config);
  const position = detail.data?.position;
  const holding: SquareHolding | undefined = position && detail.data ? {
    state: detail.data.status, quantity: detail.data.status === 'open' ? formatBaseUnitsExact(position.shares_raw, position.decimals) : undefined,
    valueUSD: position.market_value_usd, currentPrice: position.price_usd,
    pnlUSD: detail.data.status === 'closed' ? position.realized_pnl_usd : position.total_pnl_usd,
    ratio: position.pnl_ratio, investedUSD: position.buy_value_usd, buyAmountScope: 'record',
    avgBuyPrice: position.avg_buy_price_usd, avgSellPrice: position.avg_sell_price_usd,
  } : snapshot.data?.holding;
  const trades: SquarePositionTrade[] | undefined = detail.data ? detail.data.trades.map((trade) => ({
    event: trade.side, at: trade.created_at, txHash: trade.tx_hash, chain: trade.tx_chain || trade.chain,
    amountUSD: trade.trade_value_usd, priceUSD: trade.execution_price_usd, quantity: trade.token_amount,
  })) : history.data?.list;
  const pending = user ? current.isLoading || detail.isLoading : snapshot.isLoading;
  const positionError = user ? current.error || detail.error : snapshot.error;
  const historyError = user ? current.error || detail.error : history.error;
  const unavailable = !user && capability.data?.ready === false ? '持仓数据暂不可用。'

    : user && !pending && !positionError && !cycleKey ? target.closedHint === true ? '这条历史持仓未提供周期标识，暂时无法读取该轮详情。' : '作者当前没有可用的该代币持仓周期。'
    : !user && snapshot.data && !holding && !snapshot.data.closedRecords?.length ? '当前已采集快照中没有该代币持仓。' : undefined;
  const refresh = () => {
    cancelSnapshotRetry();
    const queries = user ? [current, detail] : [capability, snapshot, history];
    // Disabled queries must not invoke their fetchers (e.g. platform cycle vs wallet).
    const active = user ? queries.filter((_, index) => index === 0 ? !target.cycleKey && target.closedHint !== true : Boolean(cycleKey))
      : queries.filter((_, index) => index === 1 ? positionsEnabled : true);
    active.forEach((query) => {void query.mutate().catch(() => {});});
  };
  const coverages = [history.data?.coverage, snapshot.data?.coverage].filter((value): value is string => Boolean(value));
  const incomplete = [...new Set(coverages.filter((value) => value !== 'complete'))];
  return {holding, closedRecords: snapshot.data?.closedRecords, trades, pending, historyPending: user ? pending : history.isLoading, positionError, historyError, unavailable,
    coverage: user ? detail.data?.completeness : incomplete.length ? incomplete.join(' / ') : coverages[0],
    stale: snapshot.data?.stale, refresh};
}
