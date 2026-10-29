import {ApiError} from '@/api/envelope';
import type {UnifiedLeaderboardReply} from '@/api/leaderboard-new';
import {withRequestDeadline} from './request-deadline';

type Entry = {owners: number; controller?: AbortController; promise?: Promise<UnifiedLeaderboardReply>; cleanup?: ReturnType<typeof setTimeout>};

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {clearTimeout(timer); reject(signal.reason);};
    const timer = setTimeout(() => {signal.removeEventListener('abort', abort); resolve();}, ms);
    signal.addEventListener('abort', abort, {once: true});
  });
}

/** Shares only active transmissions. SWR owns response caching. */
export function createLeaderboardRequests() {
  const entries = new Map<string, Entry>();
  const entryFor = (key: string) => {
    let entry = entries.get(key);
    if (!entry) {entry = {owners: 0}; entries.set(key, entry);}
    return entry;
  };
  return {
    retain(key: string) {
      const entry = entryFor(key);
      clearTimeout(entry.cleanup);
      entry.owners++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--entry.owners > 0) return;
        // Preserve shared work through React Strict Mode's same-turn remount.
        entry.cleanup = setTimeout(() => {
          if (entry.owners || entries.get(key) !== entry) return;
          entry.controller?.abort();
          entries.delete(key);
        }, 0);
      };
    },
    run(key: string, fetcher: (signal: AbortSignal) => Promise<UnifiedLeaderboardReply>) {
      const entry = entryFor(key);
      if (entry.promise) return entry.promise;
      const controller = new AbortController();
      entry.controller = controller;
      const work = async (signal: AbortSignal) => {
        for (let attempt = 0; ; attempt++) {
          signal.throwIfAborted();
          try {
            const data = await fetcher(signal);
            signal.throwIfAborted();
            return data;
          } catch (error) {
            signal.throwIfAborted();
            // The sole retry owner: at most two retries, only for rate limiting.
            if (!(error instanceof ApiError) || error.code !== 420000 || attempt >= 2) throw error;
            await delay(500 * 2 ** attempt, signal);
          }
        }
      };
      const promise = withRequestDeadline(work, controller.signal).finally(() => {
        if (entry.promise === promise) {entry.promise = undefined; entry.controller = undefined;}
      });
      entry.promise = promise;
      return promise;
    },
  };
}
