import {useCallback, useRef, useState} from 'react';

/**
 * 内存事件时间轴。这个页面的**产出物就是它** —— 「哪一步、什么码、
 * 哪个 trace_id、耗时多少」，而不是「登录成功」四个字。
 *
 * 刻意不持久化：日志里会带 token 全文。
 */
export type LogLevel = 'info' | 'ok' | 'warn' | 'error';

export type LogEntry = {
  id: number;
  at: number;
  level: LogLevel;
  step: string;
  detail?: string;
  /** 耗时（ms），只有成对的步骤才有。 */
  ms?: number;
  traceID?: string;
};

let seq = 0;

export function useEventLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const marks = useRef(new Map<string, number>());

  const push = useCallback(
    (level: LogLevel, step: string, detail?: string, extra?: {ms?: number; traceID?: string}) => {
      setEntries((prev) => [
        ...prev,
        {id: ++seq, at: Date.now(), level, step, detail, ...extra},
      ]);
    },
    [],
  );

  /** 标记某一步的开始，配合 end() 算耗时。 */
  const begin = useCallback((step: string) => {
    marks.current.set(step, performance.now());
  }, []);

  const end = useCallback(
    (level: LogLevel, step: string, detail?: string, traceID?: string) => {
      const t0 = marks.current.get(step);
      marks.current.delete(step);
      const ms = t0 === undefined ? undefined : Math.round(performance.now() - t0);
      push(level, step, detail, {ms, traceID});
    },
    [push],
  );

  /** 只清日志，不动任何登录态 —— 反过来（退出时清日志）会把刚才那次
   *  失败的线索一起丢掉，而那正是唯一有价值的东西。 */
  const clear = useCallback(() => setEntries([]), []);

  return {entries, push, begin, end, clear};
}
