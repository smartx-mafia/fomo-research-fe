'use client';

import {useEffect, useMemo, useState} from 'react';
import {fetchOhlcv} from '@/lib/market';
import {chartKey, createChartSession, emptyChart} from '@/lib/chart-session';
import type {OhlcvPeriod} from '@/lib/types';

export function useChartData(chain: string, address: string, period: OhlcvPeriod) {
  const key = chartKey(chain, address, period);
  const [snapshot, setSnapshot] = useState(() => emptyChart(key));
  const [now, setNow] = useState(0);
  const session = useMemo(() => createChartSession(fetchOhlcv, setSnapshot), []);
  useEffect(() => {
    session.activate(chain, address, period);
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      setNow(Date.now());
      if (navigator.onLine) void session.refresh();
    };
    const visibility = () => {session.setVisible(document.visibilityState === 'visible'); tick();};
    visibility();
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', tick);
      session.pause();
    };
  }, [chain, address, period, session]);
  // WS frames can arrive between clock ticks. Compare their timestamps against
  // this render's time, not against a local tick that is almost one second older.
  return {view: snapshot.key === key ? snapshot : emptyChart(key), now: now ? Math.max(now, Date.now()) : 0, history: session.history, refresh: session.refresh};
}
