export type TradeStopwatch = {
  mark: (stage: string, detail?: string) => void;
};

const enabled = () => process.env.NODE_ENV !== 'production';
const now = () => typeof performance === 'undefined' ? Date.now() : performance.now();

export function createTradeStopwatch(scope: string): TradeStopwatch {
  if (!enabled()) return {mark: () => undefined};
  const startedAt = now();
  let previous = startedAt;
  return {
    mark(stage, detail) {
      const current = now();
      console.info(
        `[trade-timing] ${scope} ${stage} +${Math.round(current - previous)}ms ` +
        `(total ${Math.round(current - startedAt)}ms)${detail ? ` ${detail}` : ''}`,
      );
      previous = current;
    },
  };
}

export function logTradeTiming(scope: string, elapsedMs: number, detail?: string) {
  if (!enabled()) return;
  console.info(`[trade-timing] ${scope} ${Math.round(elapsedMs)}ms${detail ? ` ${detail}` : ''}`);
}
