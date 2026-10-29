'use client';
import {useEffect, useRef, useState} from 'react';
import {ApiError} from '@/api/envelope';
import {getPortfolioPart, timestampMs, type PartName, type PortfolioPart, type PortfolioWindow, type PositionFilters} from '@/api/portfolio-parts';

export type PartState = {data?: PortfolioPart; loading: boolean; error?: Error; stale?: boolean};
type State = Record<PartName, PartState>;
const names: PartName[] = ['history-curves', 'cash', 'positions', 'current'];
const empty = (): State => Object.fromEntries(names.map(k => [k, {loading: true}])) as State;
type Round = {id: string; snapshot?: string; context?: string; expires: number; force: boolean; controller: AbortController; window: PortfolioWindow; version: number; filters: PositionFilters; page?: PortfolioPart; applied: Set<string>; more: boolean; recovery: number};

export function useProgressivePortfolio(identifier: string, bearer?: string) {
  const owner = `${identifier}:${bearer ?? 'anonymous'}`;
  const [view, setView] = useState<{owner: string; state: State}>({owner, state: empty()});
  const [window, setWindow] = useState<PortfolioWindow>('1d');
  const [filters, setFilters] = useState<PositionFilters>({sort: 'value_desc'});
  const [moreLoading, setMoreLoading] = useState(false);
  const round = useRef<Round | undefined>(undefined);
  const update = (r: Round, part: PartName, fn: (s: PartState) => PartState) => {
    if (round.current !== r || r.controller.signal.aborted) return;
    setView(v => ({owner, state: {...(v.owner === owner ? v.state : empty()), [part]: fn(v.owner === owner ? v.state[part] : {loading: true})}}));
  };
  function stop(r: Round, error: Error) {
    if (round.current !== r) return;
    r.controller.abort(); setMoreLoading(false);
    setView({owner, state: Object.fromEntries(names.map(k => [k, {loading: false, error}])) as State});
  }
  async function request(r: Round, part: PartName, cursor?: string) {
    const version = r.version, requestedWindow = r.window;
    const contextual = part === 'current' || part === 'history-curves';
    const active = () => round.current === r && !r.controller.signal.aborted && (!contextual || r.version === version);
    try {
      const data = await getPortfolioPart(identifier, part, {
        read_id: r.id, snapshot_id: r.snapshot, force_refresh: r.force,
        ...(contextual ? {window: requestedWindow, window_context: r.context} : {}),
        ...(part === 'positions' ? {...r.filters, cursor} : {}),
      }, bearer, r.controller.signal);
      if (!active()) return;
      if (data.meta.read_id !== r.id || (r.snapshot && r.snapshot !== data.meta.snapshot_id) || (contextual && data.window !== requestedWindow)) throw new ApiError('business', 430122, 'Portfolio snapshot changed. Reload required.');
      r.snapshot = data.meta.snapshot_id;
      if (part === 'history-curves') r.context = data.window_context;
      r.expires = Math.min(r.expires, timestampMs(data.meta.expires_at));
      if (part === 'positions') {
        if (cursor && r.applied.has(cursor)) return;
        if (cursor && (data.total_count !== r.page?.total_count || timestampMs(data.page_expires_at) !== timestampMs(r.page?.page_expires_at))) throw new ApiError('business', 430122, 'Portfolio pagination changed.');
        if (data.next_cursor && (data.next_cursor === cursor || r.applied.has(data.next_cursor))) throw new ApiError('business', 430122, 'Portfolio cursor did not advance.');
        if (cursor) r.applied.add(cursor);
        const rows = cursor ? [...(r.page?.positions ?? []), ...data.positions] : data.positions;
        const keys = rows.map(p => `${p.asset.chain_id}:${p.asset.kind}:${p.asset.token_address}:${p.cycle_key ?? p.opened_entry_id}`);
        if (new Set(keys).size !== keys.length) throw new ApiError('business', 430122, 'Duplicate portfolio positions.');
        r.page = {...data, positions: rows};
        update(r, part, () => ({data: r.page, loading: false}));
      } else update(r, part, () => ({data, loading: false}));
    } catch (cause) {
      if (!active()) return;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      if (error instanceof ApiError && [400000, 200102].includes(error.code)) {
        stop(r, error);
      } else if (error instanceof ApiError && error.code === 430122) {
        if (r.recovery < 1) start(r.force, r.window, r.filters, r.recovery + 1);
        else stop(r, error);
      } else update(r, part, s => ({...s, loading: false, error}));
    }
  }
  function start(force = false, selectedWindow = window, selectedFilters = filters, recovery = 0) {
    round.current?.controller.abort();
    const r: Round = {id: crypto.randomUUID(), expires: Infinity, force, controller: new AbortController(), window: selectedWindow, version: 0, filters: selectedFilters, applied: new Set(), more: false, recovery};
    round.current = r; setMoreLoading(false);
    // Retain explicitly stale blocks, but never carry pagination into a new round.
    setView(v => ({owner, state: Object.fromEntries(names.map(part => [part, {
      loading: true, data: part !== 'positions' && v.owner === owner && (part === 'cash' || v.state[part].data?.window === selectedWindow) ? v.state[part].data : undefined, stale: true,
    }])) as State}));
    for (const part of names) void request(r, part);
  }
  useEffect(() => {
    start();
    const refresh = () => {const r = round.current; if (r && !r.controller.signal.aborted) start(false, r.window, r.filters);};
    const focus = () => {if (round.current && Date.now() >= round.current.expires) refresh();};
    globalThis.addEventListener('focus', focus);
    globalThis.addEventListener('smartx:portfolio-refresh', refresh);
    return () => {round.current?.controller.abort(); globalThis.removeEventListener('focus', focus); globalThis.removeEventListener('smartx:portfolio-refresh', refresh);};
    // Each session owns its requests; actions below use the current render's selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identifier, bearer]);
  function selectWindow(next: PortfolioWindow) {
    setWindow(next);
    const r = round.current;
    if (!r || r.controller.signal.aborted || Date.now() >= r.expires) {start(false, next); return;}
    r.window = next; r.version++; r.context = undefined;
    for (const part of ['history-curves', 'current'] as const) {update(r, part, () => ({loading: true})); void request(r, part);}
  }
  function selectFilters(next: PositionFilters) {setFilters(next); start(false, window, next);}
  async function more() {
    const r = round.current, cursor = r?.page?.next_cursor;
    if (!r || !cursor || r.more || r.controller.signal.aborted) return;
    if (Date.now() >= timestampMs(r.page?.page_expires_at)) {start(false); return;}
    r.more = true; setMoreLoading(true);
    update(r, 'positions', s => ({...s, error: undefined}));
    await request(r, 'positions', cursor);
    if (round.current === r) {r.more = false; setMoreLoading(false);}
  }
  function retry(part: PartName) {
    const r = round.current;
    if (!r || r.controller.signal.aborted || Date.now() >= r.expires) {start(); return;}
    if (part === 'positions' && r.page?.next_cursor) {void more(); return;}
    update(r, part, s => ({...s, error: undefined, loading: true})); void request(r, part);
  }
  return {parts: view.owner === owner ? view.state : empty(), window, selectWindow, filters, selectFilters, more, moreLoading, retry, refresh: () => start(true)};
}
