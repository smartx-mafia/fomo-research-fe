import type {TokenOverview} from './token-overview';

type Entry = {
  owners: number;
  controller?: AbortController;
  promise?: Promise<TokenOverview>;
  cleanup?: ReturnType<typeof setTimeout>;
};

/** Only in-flight work is shared here. Response caching belongs to SWR. */
export function createOverviewRequests(fetcher: (chain: string, address: string, signal: AbortSignal) => Promise<TokenOverview>) {
  const entries = new Map<string, Entry>();
  const keyOf = (chain: string, address: string) => JSON.stringify([chain, address]);
  const entryFor = (key: string) => {
    let entry = entries.get(key);
    if (!entry) {
      entry = {owners: 0};
      entries.set(key, entry);
    }
    return entry;
  };
  return {
    retain(chain: string, address: string) {
      const key = keyOf(chain, address);
      const entry = entryFor(key);
      clearTimeout(entry.cleanup);
      entry.owners++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.owners--;
        if (entry.owners > 0) return;
        // A same-turn Strict Mode remount can retain the same request. Other consumers
        // cannot have their shared request aborted when just one component leaves.
        entry.cleanup = setTimeout(() => {
          if (entry.owners > 0 || entries.get(key) !== entry) return;
          entry.controller?.abort();
          entries.delete(key);
        }, 0);
      };
    },
    run(chain: string, address: string): Promise<TokenOverview> {
      const entry = entryFor(keyOf(chain, address));
      if (entry.promise) return entry.promise;
      const controller = new AbortController();
      entry.controller = controller;
      let onAbort!: () => void;
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', onAbort, {once: true});
      });
      const work = Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return fetcher(chain, address, controller.signal);
      }).then((data) => {
        // Some transports can settle despite cancellation; never accept their late data.
        controller.signal.throwIfAborted();
        return data;
      });
      // SWR must stop deduping this cancelled request immediately, even if an
      // underlying transport ignores abort and never settles. Racing also attaches
      // a rejection handler to late work, so it cannot leak an unhandled rejection.
      const promise = Promise.race([work, cancelled]).finally(() => {
        controller.signal.removeEventListener('abort', onAbort);
        if (entry.promise === promise) {
          entry.promise = undefined;
          entry.controller = undefined;
        }
      });
      entry.promise = promise;
      return promise;
    },
  };
}
