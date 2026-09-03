"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LogicalRange,
  type UTCTimestamp,
} from "lightweight-charts";
import { fetchOhlcv, fetchTrades, MarketApiError } from "@/lib/market";
import type { OhlcvBar, OhlcvPeriod, TradeItem } from "@/lib/types";
import { useLivePrice } from "@/components/TokenLive";
import { toMs } from "@/lib/format";
import { Skeleton, ErrorState, EmptyState } from "@/components/ui";

const PERIODS: OhlcvPeriod[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

/** 周期秒数（文档 §5.3）。from/to 入参是 unix 秒、回包 t 是毫秒。 */
const PERIOD_SEC: Record<OhlcvPeriod, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

/** 服务端短缓存 TTL = min(周期时长, 15 分钟)（§5.1）。刷新间隔不得快于 TTL。 */
const PERIOD_TTL_MS: Record<OhlcvPeriod, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 900_000,
  "4h": 900_000,
  "1d": 900_000,
};

/** 每段回查 300 根（单段远小于 2000 根上限,不需要分段循环,§3.3） */
const BACKFILL_BARS = 300;
/** 可视范围左缘距已加载起点不足 60 根时提前回查 */
const BACKFILL_THRESHOLD_BARS = 60;

const UP = "#22c55e";
const DOWN = "#f43f5e";
// dark theme tokens from globals.css
const BG = "#111318"; // --surface
const BORDER = "#23262f"; // --border
const MUTED = "#8b90a0"; // --muted

interface PriceChartProps {
  chain: string;
  address: string;
  createdAt?: string;
}

/** 合并两段 bar:按 t 去重(同桶后者胜),升序;v 非有限数归零(图表断言 NaN 会整页崩) */
function mergeBars(a: OhlcvBar[], b: OhlcvBar[]): OhlcvBar[] {
  const map = new Map<number, OhlcvBar>();
  for (const bar of [...a, ...b]) map.set(bar.t, { ...bar, v: Number.isFinite(bar.v) ? bar.v : 0 });
  return [...map.values()].sort((x, y) => x.t - y.t);
}

/** 一笔成交折进对应周期桶:已有桶更新 c/h/l 并累加 v;没有则新开一根 */
function foldTrade(bars: OhlcvBar[], tr: TradeItem, periodSec: number, loadedFromSec: number | null): OhlcvBar[] {
  const price = tr.price_usd;
  if (tr.date === undefined || price === undefined) return bars;
  const bucket = Math.floor(tr.date / (periodSec * 1000)) * periodSec * 1000;
  // 早于已加载历史的成交不造蜡烛:没有 o/h/l 上下文,造出来是假蜡烛
  if (loadedFromSec !== null && bucket < loadedFromSec * 1000) return bars;
  const vol = Number(tr.base_token_amount);
  const i = bars.findIndex((b) => b.t === bucket);
  if (i < 0) {
    return [...bars, { t: bucket, o: price, h: price, l: price, c: price, v: vol || 0 }];
  }
  const b = bars[i];
  bars[i] = {
    ...b,
    c: price,
    h: Math.max(b.h, price),
    l: Math.min(b.l, price),
    v: (Number.isFinite(b.v) ? b.v : 0) + (Number.isFinite(vol) ? vol : 0),
  };
  return bars;
}

export default function PriceChart({ chain, address, createdAt }: PriceChartProps) {
  const [period, setPeriod] = useState<OhlcvPeriod>("5m");
  const [bars, setBars] = useState<OhlcvBar[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyEnd, setHistoryEnd] = useState(false);
  const livePrice = useLivePrice();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const barsRef = useRef<OhlcvBar[] | null>(null);
  /** 已加载历史的最早桶(unix 秒,周期对齐)。之前的不重取(§5.2③) */
  const loadedFromRef = useRef<number | null>(null);
  /** 深度闸已触发:该周期回翻到底了,不再往回查(§3.2) */
  const historyEndRef = useRef(false);
  const backfillingRef = useRef(false);
  const periodRef = useRef(period);
  const seenTradesRef = useRef(new Set<string>());
  const didFitRef = useRef(false);

  periodRef.current = period;

  const applyBars = (next: OhlcvBar[]) => {
    barsRef.current = next;
    setBars(next);
  };

  // ---- 数据拉取 ----

  /** 追新:缺省形态(不带 from/to,最近 300 根,全站共享缓存,§5.2①) */
  const loadLatest = () => {
    setLoading(true);
    setError(null);
    fetchOhlcv(chain, address, { period: periodRef.current })
      .then((data) => {
        const prev = barsRef.current;
        // 已回查过的更老段落保留,只把追新段与其合并
        const from = loadedFromRef.current;
        const older = prev && from ? prev.filter((b) => b.t < from * 1000) : [];
        applyBars(mergeBars(older, data));
      })
      .catch((err: unknown) => {
        if (err instanceof MarketApiError && err.code === 200300) {
          // 代币不存在/近期无成交,60s 负缓存:按"暂无数据"处理,不重试(§3.4)
          applyBars([]);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load chart data");
        }
      })
      .finally(() => setLoading(false));
  };

  /** 回查历史:固定、周期对齐的 [from, loadedFrom - 1](§5.2②),每次 300 根 */
  const backfill = () => {
    if (backfillingRef.current || historyEndRef.current) return;
    const cur = barsRef.current;
    if (!cur || cur.length === 0) return;
    const periodSec = PERIOD_SEC[periodRef.current];
    if (loadedFromRef.current === null) {
      loadedFromRef.current = Math.floor(cur[0].t / 1000 / periodSec) * periodSec;
    }
    const to = loadedFromRef.current - periodSec; // 与已加载段贴边不重叠
    if (to <= 0) return;
    const from = to - (BACKFILL_BARS - 1) * periodSec;

    backfillingRef.current = true;
    fetchOhlcv(chain, address, { period: periodRef.current, from, to })
      .then((data) => {
        applyBars(mergeBars(barsRef.current ?? [], data));
        loadedFromRef.current = from;
        // 空段或贴到时间原点:更早没有数据了
        if (data.length === 0 || from <= periodSec) {
          historyEndRef.current = true;
          setHistoryEnd(true);
        }
      })
      .catch((err: unknown) => {
        // 100307 深度闸:永久拒绝,不重试,标记到底(§3.2)
        if (err instanceof MarketApiError && err.code === 100307) {
          historyEndRef.current = true;
          setHistoryEnd(true);
        }
      })
      .finally(() => {
        backfillingRef.current = false;
      });
  };

  // 切币/切周期:全部重置(不同周期是不同的数据视图)
  useEffect(() => {
    barsRef.current = null;
    loadedFromRef.current = null;
    historyEndRef.current = false;
    backfillingRef.current = false;
    seenTradesRef.current = new Set();
    didFitRef.current = false;
    setBars(null);
    setHistoryEnd(false);
    loadLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, address, period]);

  // 按 TTL 低频重取追新(§5.1)
  useEffect(() => {
    const t = setInterval(loadLatest, PERIOD_TTL_MS[period]);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, address, period]);

  // ---- 交易流 → 末段蜡烛(§5.2⑤ 的交易流版) ----
  // trades 没有 WS topic,轮询是正解;服务端缓存 30s(2026-09 起),轮询更快只会拿到同一份缓存。
  // 每笔成交按时间折进所属周期桶:已有桶更新 c/h/l/累加 v,跨入新周期则新开一根。
  useEffect(() => {
    const periodSec = PERIOD_SEC[period];
    const poll = () => {
      fetchTrades(chain, address, { limit: 50 })
        .then((trades) => {
          const seen = seenTradesRef.current;
          let next = barsRef.current ?? [];
          let changed = false;
          for (const tr of trades) {
            const key = tr.tx_hash && tr.date ? `${tr.tx_hash}:${tr.date}` : "";
            if (key && seen.has(key)) continue;
            if (key) seen.add(key);
            const before = next.length;
            next = foldTrade(next, tr, periodSec, loadedFromRef.current);
            changed = changed || next.length !== before || next !== barsRef.current;
          }
          if (changed && next.length > 0) applyBars([...next].sort((a, b) => a.t - b.t));
        })
        .catch(() => {
          // 轮询失败静默:K 线主体还有 TTL 刷新兜底
        });
    };
    poll();
    const t = setInterval(poll, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, address, period]);

  // ---- 图表骨架 ----

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: BG },
        textColor: MUTED,
      },
      grid: {
        vertLines: { color: BORDER },
        horzLines: { color: BORDER },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: BORDER,
      },
      timeScale: {
        borderColor: BORDER,
        timeVisible: true,
        secondsVisible: false,
      },
      autoSize: false,
      width: container.clientWidth,
      height: container.clientHeight,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: MUTED,
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    candleSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.05, bottom: 0.25 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // 用户向左拖动接近已加载左缘时提前回查历史。
    // logical range 以首根数据为 0:左缘距首根不足阈值根数即触发(有防重入/到底护栏)
    const onVisibleRange = (range: LogicalRange | null) => {
      if (!range || historyEndRef.current || backfillingRef.current) return;
      if (range.from < BACKFILL_THRESHOLD_BARS) backfill();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRange);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        chart.resize(width, height);
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRange);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 数据 → 系列 ----

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries || !bars) return;

    const candleData: CandlestickData[] = bars.map((bar) => ({
      time: Math.floor(bar.t / 1000) as UTCTimestamp,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
    }));

    const volumeData: HistogramData[] = bars.map((bar) => ({
      time: Math.floor(bar.t / 1000) as UTCTimestamp,
      value: Number.isFinite(bar.v) ? bar.v : 0,
      color: bar.c >= bar.o ? `${UP}80` : `${DOWN}80`,
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);
    // 只在首次拿到数据时 fit;之后(交易流折叠/回查追加)保住用户当前视窗,
    // 否则每次 setData 都会把视图拽回最右端
    if (!didFitRef.current && candleData.length > 0) {
      didFitRef.current = true;
      chartRef.current?.timeScale().fitContent();
    }
  }, [bars]);

  // WS 实时价兜底:交易流没覆盖的空窗,末根 c/h/l 仍能跳(§5.2⑤)
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const last = barsRef.current?.[barsRef.current.length - 1];
    if (!candleSeries || !volumeSeries || !last || livePrice === undefined) return;

    last.c = livePrice;
    last.h = Math.max(last.h, livePrice);
    last.l = Math.min(last.l, livePrice);
    const time = Math.floor(last.t / 1000) as UTCTimestamp;
    candleSeries.update({
      time,
      open: last.o,
      high: last.h,
      low: last.l,
      close: last.c,
    });
    volumeSeries.update({
      time,
      value: Number.isFinite(last.v) ? last.v : 0,
      color: last.c >= last.o ? `${UP}80` : `${DOWN}80`,
    });
  }, [livePrice]);

  const showEmpty = !loading && !error && bars && bars.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              p === period
                ? "border-accent bg-surface-2 text-foreground"
                : "border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            {p}
          </button>
        ))}
        {historyEnd && <span className="ml-2 text-[11px] text-muted">已到该周期最早历史</span>}
      </div>

      <div className="relative h-80 w-full overflow-hidden rounded-lg border border-border bg-surface">
        {loading && (
          <div className="absolute inset-0 p-3">
            <Skeleton className="h-full w-full" />
          </div>
        )}
        {!loading && error && (
          <div className="absolute inset-0">
            <ErrorState message={error} />
          </div>
        )}
        {showEmpty && (
          <div className="absolute inset-0">
            <EmptyState>No chart data</EmptyState>
          </div>
        )}
        {/* Chart container must always be mounted (with real size) for lightweight-charts to attach to. */}
        <div ref={containerRef} className="h-full w-full" />
      </div>

      {/* created_at 上游格式不定(秒/毫秒/ISO),toMs 带解析失败兜底,失败就不展示。
          toLocaleString 受运行环境 locale 影响必然水合不匹配，交给客户端渲染 */}
      {toMs(createdAt) !== undefined && (
        <p className="text-xs text-muted" suppressHydrationWarning>
          Token created {new Date(toMs(createdAt)!).toLocaleString()}
        </p>
      )}
    </div>
  );
}
