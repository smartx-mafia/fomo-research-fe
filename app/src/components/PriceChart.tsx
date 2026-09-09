'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, Maximize2, Minimize2, RotateCcw, RefreshCw} from 'lucide-react';
import {CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineStyle, PriceScaleMode, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type LogicalRange, type Time, type UTCTimestamp} from 'lightweight-charts';
import {useLiveQuote} from '@/components/TokenLive';
import {useChartData} from '@/hooks/useChartData';
import {CHART_PERIODS, PERIOD_SECONDS, RETENTION_DAYS, chartMinMove, formatChartPrice, shiftedChartRange, usableChartQuote} from '@/lib/chart-data';
import {fmtCompact} from '@/lib/format';
import type {OhlcvBar, OhlcvPeriod} from '@/lib/types';

const UP = '#26c6a0', DOWN = '#f1667b';
const button = 'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40';
const utcTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

export default function PriceChart({chain, address}: {chain: string; address: string; createdAt?: string}) {
  const [period, setPeriod] = useState<OhlcvPeriod>('5m');
  const [expanded, setExpanded] = useState(false);
  const [logScale, setLogScale] = useState(false);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [following, setFollowing] = useState(true);
  const {view, now, history, refresh} = useChartData(chain, address, period);
  const quote = useLiveQuote();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const quoteLineRef = useRef<IPriceLine | null>(null);
  const acceptedQuoteRef = useRef(0);
  const renderedRef = useRef<{key: string; bars: OhlcvBar[]}>({key: '', bars: []});
  const changingDataRef = useRef(false);
  const historyIntentRef = useRef(false);
  const currentRef = useRef({history, loading: view.loading || view.loadingHistory, end: view.historyEnd, historyError: view.historyError});
  currentRef.current = {history, loading: view.loading || view.loadingHistory, end: view.historyEnd, historyError: view.historyError};
  const rowsByTime = useMemo(() => new Map(view.bars.map((bar) => [bar.t, bar])), [view.bars]);
  const unconfirmed = useMemo(() => new Set(view.unconfirmed), [view.unconfirmed]);
  const selected = (hoveredTime === null ? undefined : rowsByTime.get(hoveredTime)) ?? view.bars.at(-1);
  const liveQuote = usableChartQuote(quote, chain, chain === 'solana' ? address : address.toLowerCase(), now);
  const canRefresh = !view.loading && !view.loadingHistory && now >= view.nextRefreshAt;

  function resetView() {
    const chart = chartRef.current;
    if (!chart || !view.bars.length) return;
    changingDataRef.current = true;
    const count = Math.max(35, Math.min(120, Math.floor((containerRef.current?.clientWidth ?? 900) / 9)));
    chart.timeScale().setVisibleLogicalRange({from: view.bars.length - count, to: view.bars.length + 4});
    candleRef.current?.priceScale().applyOptions({autoScale: true});
    changingDataRef.current = false;
    historyIntentRef.current = false;
    setFollowing(true);
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth, height: container.clientHeight,
      layout: {background: {type: ColorType.Solid, color: '#111318'}, textColor: '#9198a7', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11,
        panes: {separatorColor: '#23262f', separatorHoverColor: '#3a4050'}},
      grid: {vertLines: {visible: false}, horzLines: {color: '#1d222b', style: LineStyle.Dotted}},
      crosshair: {mode: CrosshairMode.Normal, vertLine: {color: '#687185', labelBackgroundColor: '#303747'}, horzLine: {color: '#687185', labelBackgroundColor: '#303747'}},
      rightPriceScale: {borderVisible: false, minimumWidth: 94, autoScale: true},
      timeScale: {borderColor: '#23262f', timeVisible: true, secondsVisible: false, rightOffset: 5, barSpacing: 9, minBarSpacing: 3, rightBarStaysOnScroll: true},
      localization: {locale: 'en-US', timeFormatter: (time: Time) => typeof time === 'number' ? utcTime(time * 1000) + ' UTC' : String(time)},
      handleScroll: {vertTouchDrag: false, horzTouchDrag: true, mouseWheel: true, pressedMouseMove: true},
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN,
      priceFormat: {type: 'custom', formatter: formatChartPrice, minMove: 0.00000001}, priceLineStyle: LineStyle.Dotted,
    });
    candles.priceScale().applyOptions({scaleMargins: {top: 0.12, bottom: 0.08}});
    const volume = chart.addSeries(HistogramSeries, {priceFormat: {type: 'volume'}, priceLineVisible: false, lastValueVisible: false}, 1);
    volume.priceScale().applyOptions({scaleMargins: {top: 0.15, bottom: 0}});
    chart.panes()[0].setStretchFactor(4);
    chart.panes()[1].setStretchFactor(1);
    chartRef.current = chart; candleRef.current = candles; volumeRef.current = volume;
    const onRange = (range: LogicalRange | null) => {
      if (!range || changingDataRef.current) return;
      setFollowing(range.to >= renderedRef.current.bars.length - 2);
      // Programmatic setData/resize must never trigger an automatic history scan.
      if (historyIntentRef.current && range.from < 15 && !currentRef.current.loading && !currentRef.current.end && !currentRef.current.historyError) {
        historyIntentRef.current = false;
        void currentRef.current.history();
      }
    };
    const onCrosshair = (event: {time?: unknown; point?: {x: number; y: number}}) => setHoveredTime(typeof event.time === 'number' && event.point ? event.time * 1000 : null);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    chart.subscribeCrosshairMove(onCrosshair);
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        changingDataRef.current = true;
        chart.resize(entry.contentRect.width, entry.contentRect.height);
        changingDataRef.current = false;
      }
    });
    observer.observe(container);
    return () => {
      observer.disconnect(); chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange); chart.unsubscribeCrosshairMove(onCrosshair); chart.remove();
      chartRef.current = null; candleRef.current = null; volumeRef.current = null; quoteLineRef.current = null;
      renderedRef.current = {key: '', bars: []};
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current, candles = candleRef.current, volume = volumeRef.current;
    if (!chart || !candles || !volume) return;
    const before = renderedRef.current;
    const seriesKey = view.key + ':' + view.revision;
    const reset = before.key !== seriesKey || !before.bars.length;
    const range = chart.timeScale().getVisibleLogicalRange();
    const wasFollowing = !range || range.to >= before.bars.length - 2;
    changingDataRef.current = true;
    historyIntentRef.current = false;
    candles.setData(view.bars.map((bar) => ({time: bar.t / 1000 as UTCTimestamp, open: bar.o, high: bar.h, low: bar.l, close: bar.c, ...(unconfirmed.has(bar.t) ? {color: '#a695df', wickColor: '#a695df'} : {})})));
    volume.setData(view.bars.map((bar) => bar.v === null || unconfirmed.has(bar.t) ? {time: bar.t / 1000 as UTCTimestamp} : {time: bar.t / 1000 as UTCTimestamp, value: bar.v, color: bar.c >= bar.o ? '#26c6a055' : '#f1667b55'}));
    const last = view.bars.at(-1);
    if (last) candles.applyOptions({priceFormat: {type: 'custom', formatter: formatChartPrice, minMove: chartMinMove(last.c)}});
    renderedRef.current = {key: seriesKey, bars: view.bars};
    if (reset) {
      acceptedQuoteRef.current = 0;
      historyIntentRef.current = false;
      setHoveredTime(null);
      const count = Math.max(35, Math.min(120, Math.floor((containerRef.current?.clientWidth ?? 900) / 9)));
      if (last) chart.timeScale().setVisibleLogicalRange({from: view.bars.length - count, to: view.bars.length + 4});
      candles.priceScale().applyOptions({autoScale: true});
      setFollowing(true);
    } else if (range) {
      const shifted = shiftedChartRange(before.bars, view.bars, range);
      const newTail = last && last.t > before.bars[before.bars.length - 1].t;
      if (wasFollowing && newTail) {
        const to = view.bars.length + 4;
        chart.timeScale().setVisibleLogicalRange({from: to - (range.to - range.from), to});
      } else chart.timeScale().setVisibleLogicalRange(shifted);
    }
    changingDataRef.current = false;
  }, [view.bars, view.key, view.revision, unconfirmed]);

  useEffect(() => {candleRef.current?.priceScale().applyOptions({mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal, autoScale: true});}, [logScale]);
  useEffect(() => {
    const candles = candleRef.current;
    if (!candles) return;
    if (!liveQuote) {
      if (quoteLineRef.current) candles.removePriceLine(quoteLineRef.current);
      quoteLineRef.current = null; return;
    }
    if (liveQuote.observedAt < acceptedQuoteRef.current) return;
    acceptedQuoteRef.current = liveQuote.observedAt;
    const options = {price: liveQuote.price, color: '#8f80ff', lineWidth: 1 as const, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Quote'};
    if (quoteLineRef.current) quoteLineRef.current.applyOptions(options);
    else quoteLineRef.current = candles.createPriceLine(options);
    // Token quotes have neither trade IDs nor primary-pool identity: never mutate OHLC/volume.
  }, [liveQuote, view.key]);

  const countdown = now ? PERIOD_SECONDS[period] - Math.floor(now / 1000) % PERIOD_SECONDS[period] : 0;
  const openCandle = selected && now && selected.t === Math.floor(now / (PERIOD_SECONDS[period] * 1000)) * PERIOD_SECONDS[period] * 1000;
  const pendingCandle = selected && view.unconfirmed.includes(selected.t);
  const remaining = (Math.floor(countdown / 3600) ? Math.floor(countdown / 3600) + ':' : '') + String(Math.floor(countdown / 60) % 60).padStart(2, '0') + ':' + String(countdown % 60).padStart(2, '0');

  return (
    <section aria-label="Token price chart" className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-3 sm:px-4">
        <div className="flex items-center gap-3"><h2 className="text-sm font-semibold text-foreground">Price chart</h2><span className="text-[10px] text-muted">USD · UTC</span></div>
        <div className="flex items-center gap-2 text-[11px]"><span className={'h-1.5 w-1.5 rounded-full ' + (liveQuote ? 'bg-up' : 'bg-muted')} /><span className="text-muted">{liveQuote ? 'Live quote' : 'Quote delayed'}</span>{liveQuote ? <span className="tabular text-foreground">{formatChartPrice(liveQuote.price)}</span> : null}</div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-2 py-2 sm:px-3">
        <div role="group" aria-label="Candle interval" className="flex items-center gap-0.5">{CHART_PERIODS.map((p) => <button type="button" key={p} aria-pressed={p === period} onClick={() => setPeriod(p)} title={RETENTION_DAYS[p] === null ? 'Daily history' : 'Up to ' + RETENTION_DAYS[p] + ' days of history'} className={button + (p === period ? ' bg-accent/15 text-accent' : ' text-muted hover:bg-surface-2 hover:text-foreground')}>{p}</button>)}</div>
        <div className="flex items-center gap-1"><button type="button" className={button + (logScale ? ' bg-accent/15 text-accent' : ' text-muted')} aria-pressed={logScale} onClick={() => setLogScale(!logScale)} title="Toggle logarithmic price scale">Log</button><button type="button" className={button + ' text-muted'} onClick={resetView} aria-label="Reset chart view"><RotateCcw size={14} /></button><button type="button" className={button + ' text-muted'} onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Collapse chart' : 'Expand chart'}>{expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button></div>
      </div>
      <div className="min-h-[76px] px-3 py-3 sm:px-4" aria-label="Candle details">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted"><span>{selected ? utcTime(selected.t) + ' UTC' : 'Select a candle to inspect its prices'}</span>{openCandle ? <span className="tabular text-accent">Open candle · {remaining}</span> : pendingCandle ? <span className="text-amber-400">Awaiting confirmation</span> : selected ? <span>Closed candle</span> : null}{view.loading && view.bars.length ? <span>Updating…</span> : null}</div>
        <dl className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">{(['o', 'h', 'l', 'c'] as const).map((field) => <div key={field} className="flex items-baseline gap-1.5"><dt className="uppercase text-muted">{field}</dt><dd className={'tabular ' + (selected && selected.c >= selected.o ? 'text-up' : 'text-down')}>{selected ? formatChartPrice(selected[field]) : '—'}</dd></div>)}<div className="flex items-baseline gap-1.5"><dt className="text-muted">Vol</dt><dd className="tabular text-foreground">{pendingCandle ? 'Pending' : selected?.v != null ? (selected.v === 0 ? '0' : fmtCompact(selected.v)) : '—'}</dd></div></dl>
      </div>
      {view.error && view.bars.length ? <p role="status" className="px-4 pb-2 text-xs text-amber-400">Chart refresh failed. Displaying the last received candles.</p> : null}
      <div className={'relative w-full ' + (expanded ? 'h-[70vh] min-h-[440px]' : 'h-[370px] sm:h-[450px]')} onPointerDown={() => {historyIntentRef.current = true;}} onWheel={() => {historyIntentRef.current = true;}}>
        <div ref={containerRef} className="h-full w-full" />
        {!view.bars.length ? <div role="status" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface/95 px-6 text-center text-sm text-muted">{view.loading || !now ? <><RefreshCw className="animate-spin" size={20} />Loading candles…</> : view.error ? <><span className="max-w-lg break-words">{view.error}</span><button type="button" className={button + ' border border-border text-foreground'} disabled={!canRefresh} onClick={() => void refresh()}>Retry chart</button></> : 'No candles in the available interval.'}</div> : null}
        {!following && view.bars.length ? <button type="button" onClick={resetView} className="absolute bottom-[28%] right-28 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-foreground shadow-lg">Back to latest →</button> : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 sm:px-4">
        <button type="button" className={button + ' inline-flex items-center gap-1 text-muted hover:text-foreground'} disabled={!view.updatedAt || view.loading || view.loadingHistory || view.historyEnd} onClick={() => void history()}><ArrowLeft size={12} />{view.loadingHistory ? 'Loading history…' : view.historyEnd ? 'History limit reached' : 'Load earlier'}</button>
        <span className="tabular text-[10px] text-muted">{view.bars.length.toLocaleString('en-US')} candles · {view.updatedAt ? 'Synced ' + utcTime(view.updatedAt).slice(11) + ' UTC' : 'Waiting for chart feed'}</span>
        <button type="button" className={button + ' text-muted'} aria-label="Refresh chart data" disabled={!canRefresh} onClick={() => void refresh()} title="Refresh is limited to the candle cache interval"><RefreshCw size={12} className={view.loading ? 'animate-spin' : ''} /></button>
      </div>
      {view.historyError || view.historyMessage ? <p role="status" className="px-4 pb-3 text-xs text-muted">{view.historyError ?? view.historyMessage}</p> : null}
      <p className="border-t border-border px-4 py-2 text-[10px] leading-relaxed text-muted">The open candle is provisional. The live quote is indicative and does not change closed candles.</p>
    </section>
  );
}
