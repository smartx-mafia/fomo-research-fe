'use client';

import {useEffect, useRef, useState} from 'react';
import {isTerminal, Outcome, PreparationStatus, type SwapSnapshot} from './contract';
import {draftKey, unsignedQuote} from './auto-quote';

type Options = {
  scope: string;
  enabled: boolean;
  inputKey: string | null;
  inputVersion: number;
  snapshot?: SwapSnapshot;
  busy: boolean;
  expired: boolean;
  blockedUntil: number;
  prepare: (signal: AbortSignal) => Promise<unknown>;
  refresh: (signal: AbortSignal) => Promise<unknown>;
  cancel: (signal: AbortSignal) => Promise<unknown>;
  canRefresh: (snapshot: SwapSnapshot) => Promise<boolean>;
};

/** Serializes quote-only work. This hook has no signing or execution dependency. */
export function useAutoQuote(options: Options) {
  const latest = useRef(options); latest.current = options;
  const running = useRef(false);
  const operationVersion = useRef(0);
  const attempted = useRef(new Set<string>());
  const controller = useRef<AbortController | null>(null);
  const [visible, setVisible] = useState(true);
  const [settled, setSettled] = useState<{key:string;version:number;scope:string} | null>(null);
  const [phase, setPhase] = useState('');
  const [pulse, setPulse] = useState(0);
  const [waitingExpiry, setWaitingExpiry] = useState(false);

  useEffect(() => {
    const current = new AbortController(); controller.current = current;
    operationVersion.current += 1; running.current = false;
    attempted.current.clear(); setSettled(null); setPhase('');
    return () => {current.abort(); operationVersion.current += 1;};
  }, [options.scope]);

  useEffect(() => {
    const changed = () => setVisible(document.visibilityState !== 'hidden');
    changed(); document.addEventListener('visibilitychange',changed);
    return () => document.removeEventListener('visibilitychange',changed);
  }, []);

  useEffect(() => {
    if (!options.enabled || !visible || !options.inputKey) {setSettled(null); return;}
    const key = options.inputKey, version = options.inputVersion, scope = options.scope;
    const timer = setTimeout(() => setSettled({key,version,scope}),300);
    return () => clearTimeout(timer);
  }, [options.enabled,options.inputKey,options.inputVersion,options.scope,visible]);

  const debouncing = options.enabled && Boolean(options.inputKey) &&
    (!settled || settled.key !== options.inputKey || settled.version !== options.inputVersion || settled.scope !== options.scope);
  const quoteMatches = Boolean(options.snapshot && options.inputKey && draftKey(options.snapshot.intent) === options.inputKey);

  useEffect(() => {
    if (!options.enabled || !visible || debouncing || !settled || options.busy || running.current) return;
    const signal = controller.current?.signal;
    if (!signal || signal.aborted) return;
    const snap = options.snapshot;
    let action: 'prepare' | 'refresh' | 'cancel' | undefined;
    let key = '';
    if (!snap || isTerminal(snap)) {
      action = 'prepare'; key = `prepare:${settled.version}:${settled.key}`;
    } else if (!unsignedQuote(snap)) {
      setPhase('已有交易待确认'); return;
    } else if (snap.settlement.outcome === Outcome.CANCEL_PENDING) {
      setPhase('等待旧报价释放'); return;
    } else if (!quoteMatches) {
      action = 'cancel'; key = `cancel:${snap.swap_id}`;
    } else if (snap.preparation.status === PreparationStatus.BLOCKED) {
      if (snap.preparation.retry_after_ms === null) {setPhase('报价不可用，请修改输入'); return;}
      const wait = options.blockedUntil - performance.now();
      if (wait > 0) {
        setPhase('等待重新获取报价');
        const timer = setTimeout(()=>setPulse(n=>n+1),wait);
        return () => clearTimeout(timer);
      }
      action = 'refresh'; key = `refresh:${snap.swap_id}:${snap.preparation.current_revision}:${snap.event_version}`;
    } else if (options.expired || snap.preparation.status === PreparationStatus.EXPIRED) {
      action = 'refresh'; key = `refresh:${snap.swap_id}:${snap.preparation.current_revision}`;
    } else {
      setPhase(snap.preparation.status === PreparationStatus.READY ? '' : '正在获取报价'); return;
    }
    if (attempted.current.has(key)) {setPhase('报价未就绪，可重试获取'); return;}
    const kind = action;
    const version = ++operationVersion.current;
    running.current = true;
    setPhase(kind === 'cancel' ? '正在停止旧报价' : kind === 'refresh' ? '正在更新报价' : '正在获取报价');
    let wake: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        if (kind === 'refresh' && snap?.preparation.current_revision) {
          const dead = await latest.current.canRefresh(snap);
          if (signal.aborted) return;
          if (!dead) {setWaitingExpiry(true); setPhase('等待旧报价失效'); wake = setTimeout(()=>{if (!signal.aborted) setPulse(n=>n+1);},2000); return;}
        }
        const current = latest.current;
        if (signal.aborted || !current.enabled || current.inputKey !== settled.key || current.inputVersion !== settled.version || document.visibilityState === 'hidden') return;
        attempted.current.add(key); setWaitingExpiry(false);
        await current[kind](signal);
      } catch {
        if (!signal.aborted) {attempted.current.add(key); setPhase('报价暂不可用，可重试获取');}
      } finally {
        if (version === operationVersion.current) {
          running.current = false;
          if (!signal.aborted && !wake) setPulse(n=>n+1);
        }
      }
    })();
    // A mutation stays in flight across edits so its returned swap can be retired
    // safely. Only unmount/auth changes abort it; its durable marker survives.
  }, [options.enabled,options.busy,options.scope,options.inputKey,options.inputVersion,options.snapshot?.swap_id,
    options.snapshot?.preparation.status,options.snapshot?.preparation.current_revision,options.snapshot?.event_version,
    options.snapshot?.settlement.outcome,options.snapshot?.execution.status,options.expired,options.blockedUntil,
    quoteMatches,debouncing,settled,visible,pulse]);

  return {
    debouncing,
    quoteMatches,
    inFlight:running.current,
    phase:debouncing ? '等待输入完成' : !visible && options.enabled ? '页面恢复后更新报价' : phase,
    waitingExpiry,
    retry:() => {attempted.current.clear(); setWaitingExpiry(false); setPulse(n=>n+1);},
  };
}
