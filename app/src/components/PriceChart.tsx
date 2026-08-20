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
  type UTCTimestamp,
} from "lightweight-charts";
import { mobulaUrl } from "@/lib/client";
import type { OhlcvBar, OhlcvPeriod } from "@/lib/types";
import { Skeleton, ErrorState, EmptyState } from "@/components/ui";

const PERIODS: OhlcvPeriod[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

const UP = "#22c55e";
const DOWN = "#f43f5e";
// dark theme tokens from globals.css
const BG = "#111318"; // --surface
const BORDER = "#23262f"; // --border
const FOREGROUND = "#e6e8eb"; // --foreground
const MUTED = "#8b90a0"; // --muted

interface PriceChartProps {
  chainId: string;
  address: string;
  createdAt?: string;
}

export default function PriceChart({ chainId, address, createdAt }: PriceChartProps) {
  const [period, setPeriod] = useState<OhlcvPeriod>("5m");
  const [bars, setBars] = useState<OhlcvBar[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  // Fetch OHLCV data whenever chainId/address/period change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBars(null);

    fetch(mobulaUrl("token/ohlcv-history", { chainId, address, period, usd: "true" }))
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((json: { data?: OhlcvBar[] }) => {
        if (cancelled) return;
        setBars(Array.isArray(json.data) ? json.data : []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load chart data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chainId, address, period]);

  // Create the chart once the container is mounted. Runs only client-side (useEffect never runs on server).
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
    // Overlay the volume histogram in the lower ~20% of the pane, above the candlesticks.
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    candleSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.05, bottom: 0.25 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

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
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // Push new data into the series whenever bars change.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries || !bars) return;

    const sorted = [...bars].sort((a, b) => a.t - b.t);

    const candleData: CandlestickData[] = sorted.map((bar) => ({
      time: Math.floor(bar.t / 1000) as UTCTimestamp,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
    }));

    const volumeData: HistogramData[] = sorted.map((bar) => ({
      time: Math.floor(bar.t / 1000) as UTCTimestamp,
      value: bar.v,
      color: bar.c >= bar.o ? `${UP}80` : `${DOWN}80`,
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);
    chartRef.current?.timeScale().fitContent();
  }, [bars]);

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

      {createdAt && (
        <p className="text-xs text-muted">
          Token created {new Date(createdAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
