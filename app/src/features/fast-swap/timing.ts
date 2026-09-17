import type {SwapSnapshot} from './contract';

export type TimingDetails = Record<string, string | number | boolean | null>;
export type TimingPoint = {
  stage: string; at: string; monotonic_ms: number; time_origin_ms: number; elapsed_ms: number | null; details: TimingDetails;
};
export type HttpTimingEvent = {
  stage: 'request_start' | 'response_headers' | 'response_body_done' | 'parse_done' | 'request_error';
  monotonic_ms: number; at: string; details: TimingDetails;
};
type HttpAttempt = {attempt_id: string; sign_attempt_id: string | null; events: HttpTimingEvent[]};
type SignAttempt = {sign_attempt_id: string; revision: string; page_instance_id: string; started_at: string; outcome: 'pending' | 'signed' | 'failed'; failure_stage: string | null};
type Run = {
  client_intent_id: string; swap_id: string | null; actor_scope_fingerprint: string;
  experiment_group: 'A' | 'B' | 'unassigned'; group_sample_index: number; page_instance_id: string;
  started_at: string; started_monotonic_ms: number; time_origin_ms: number;
  points: TimingPoint[]; sign_attempts: SignAttempt[]; http_attempts: HttpAttempt[];
};
type PageEvent = {stage: string; at: string; monotonic_ms: number; time_origin_ms: number; details: TimingDetails};
type ResourceTiming = {
  domain_category: string; path_category: string; initiator_type: string; start_ms: number; end_ms: number; duration_ms: number;
  connect_ms: number | null; wait_ms: number | null; connection_reused: boolean | null;
};
type LongTask = {start_ms: number; duration_ms: number; end_ms: number};
type PageCapture = {
  page_instance_id: string; navigation_started_at: string; time_origin_ms: number; events: PageEvent[];
  resources: ResourceTiming[]; long_tasks: LongTask[];
  capture: {main_frame_resource_timing: boolean; privy_iframe_cdp: boolean; long_task_supported: boolean; completeness: 'partial' | 'complete'; limitations: string[]};
};
type StoredV3 = {runs?: Run[]; pages?: PageCapture[]};

const v3Prefix = 'smartx-fast-swap.timing.v3:';
const v2Prefix = 'smartx-fast-swap.timing.v2:';
const groupKey = 'smartx-fast-swap.experiment-group.v1';
let actorScope = '';
let actorFingerprint = '';
let runs: Run[] = [];
let pages: PageCapture[] = [];
let legacyRuns: unknown[] = [];
let activeID = '';
let loaded = false;
let observerStarted = false;
let flushScheduled = false;
const activeSignAttempts = new Map<string, string>();

function now(): number { return globalThis.performance?.now?.() ?? Date.now(); }
function timeOrigin(): number { return globalThis.performance?.timeOrigin ?? Date.now() - now(); }
function uuid(): string { return globalThis.crypto?.randomUUID?.() ?? `diag-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
const pageInstanceID = uuid();

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return `scope-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
function currentGroup(): 'A' | 'B' | 'unassigned' {
  if (typeof sessionStorage === 'undefined') return 'unassigned';
  try { const value = sessionStorage.getItem(groupKey); return value === 'A' || value === 'B' ? value : 'unassigned'; } catch { return 'unassigned'; }
}
export function setTimingExperimentGroup(group: 'A' | 'B'): void {
  try { sessionStorage.setItem(groupKey, group); } catch { /* Diagnostics never block the transaction. */ }
}
export function getTimingExperimentGroup(): 'A' | 'B' | 'unassigned' { return currentGroup(); }

function currentPage(): PageCapture {
  let page = pages.find((item) => item.page_instance_id === pageInstanceID);
  if (page) return page;
  const origin = timeOrigin();
  page = {
    page_instance_id: pageInstanceID, navigation_started_at: new Date(origin).toISOString(), time_origin_ms: origin,
    events: [], resources: [], long_tasks: [],
    capture: {
      main_frame_resource_timing: typeof PerformanceObserver !== 'undefined', privy_iframe_cdp: false,
      long_task_supported: typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes?.includes('longtask') ?? false),
      completeness: 'partial',
      limitations: ['In-page Resource Timing does not prove complete visibility into Privy cross-origin iframe requests. A separate CDP capture is required.'],
    },
  };
  pages = [...pages.slice(-7), page];
  return page;
}
function validRun(value: unknown): value is Run {
  if (!value || typeof value !== 'object') return false;
  const run = value as Partial<Run>;
  return typeof run.client_intent_id === 'string' && (run.swap_id === null || typeof run.swap_id === 'string') &&
    typeof run.actor_scope_fingerprint === 'string' && ['A','B','unassigned'].includes(String(run.experiment_group)) &&
    typeof run.group_sample_index === 'number' && typeof run.page_instance_id === 'string' && typeof run.started_at === 'string' &&
    typeof run.started_monotonic_ms === 'number' && typeof run.time_origin_ms === 'number' &&
    Array.isArray(run.points) && run.points.every((point) => Boolean(point) && typeof point === 'object' && typeof point.stage === 'string' && Boolean(point.details) && typeof point.details === 'object') &&
    Array.isArray(run.sign_attempts) && run.sign_attempts.every((attempt) => Boolean(attempt) && typeof attempt === 'object' && typeof attempt.sign_attempt_id === 'string' && typeof attempt.revision === 'string') &&
    Array.isArray(run.http_attempts) && run.http_attempts.every((attempt) => Boolean(attempt) && typeof attempt === 'object' && typeof attempt.attempt_id === 'string' && Array.isArray(attempt.events));
}
function validPage(value: unknown): value is PageCapture {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<PageCapture>;
  return typeof page.page_instance_id === 'string' && typeof page.time_origin_ms === 'number' &&
    Array.isArray(page.events) && page.events.every((event) => Boolean(event) && typeof event === 'object' && typeof event.stage === 'string') &&
    Array.isArray(page.resources) && page.resources.every((resource) => Boolean(resource) && typeof resource === 'object' && typeof resource.domain_category === 'string') &&
    Array.isArray(page.long_tasks) && page.long_tasks.every((task) => Boolean(task) && typeof task === 'object' && typeof task.duration_ms === 'number') &&
    Boolean(page.capture) && typeof page.capture === 'object';
}
function init(): void {
  if (!actorScope || loaded || typeof sessionStorage === 'undefined') return;
  loaded = true;
  try {
    const stored = JSON.parse(sessionStorage.getItem(v3Prefix + encodeURIComponent(actorScope)) ?? '{}') as StoredV3;
    runs = Array.isArray(stored.runs) ? stored.runs.filter(validRun) : [];
    pages = Array.isArray(stored.pages) ? stored.pages.filter(validPage) : [];
  } catch { runs = []; pages = []; }
  try {
    const value = JSON.parse(sessionStorage.getItem(v2Prefix + encodeURIComponent(actorScope)) ?? '[]');
    legacyRuns = Array.isArray(value) ? value : [];
  } catch { legacyRuns = []; }
  currentPage();
}
function persist(): void {
  flushScheduled = false;
  if (!actorScope || typeof sessionStorage === 'undefined') return;
  try { sessionStorage.setItem(v3Prefix + encodeURIComponent(actorScope), JSON.stringify({runs, pages} satisfies StoredV3)); } catch { /* Diagnostics never block the transaction. */ }
}
export function scheduleTimingFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  const callback = () => persist();
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window.requestIdleCallback as (cb: IdleRequestCallback, options?: IdleRequestOptions) => number)(callback, {timeout: 1500});
  } else setTimeout(callback, 0);
}
export function flushTimingEvidence(): void { persist(); }

function pathCategory(url: URL): string {
  const path = url.pathname.toLowerCase();
  if (path.includes('sign')) return 'signing';
  if (path.includes('auth') || path.includes('token') || path.includes('session')) return 'authentication';
  if (path.includes('wallet')) return 'wallet';
  if (path.includes('rpc')) return 'rpc';
  if (path.includes('iframe') || path.includes('embed')) return 'iframe';
  if (path.includes('/v2/swaps')) return 'fastswap';
  return 'other';
}
function domainCategory(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host.includes('privy')) return 'privy';
  if (host.includes('alchemy') || host.includes('solana')) return 'solana_rpc';
  if (typeof location !== 'undefined' && host === location.hostname.toLowerCase()) return 'same_origin';
  return 'third_party';
}
function addResource(entry: PerformanceResourceTiming): void {
  try {
    const url = new URL(entry.name);
    const connect = entry.connectEnd > 0 && entry.connectStart > 0 ? entry.connectEnd - entry.connectStart : null;
    const wait = entry.responseStart > 0 && entry.requestStart > 0 ? entry.responseStart - entry.requestStart : null;
    currentPage().resources.push({
      domain_category: domainCategory(url.hostname), path_category: pathCategory(url), initiator_type: entry.initiatorType || 'unknown',
      start_ms: entry.startTime, end_ms: entry.responseEnd || entry.startTime + entry.duration, duration_ms: entry.duration,
      connect_ms: connect, wait_ms: wait, connection_reused: connect === null ? null : connect === 0,
    });
    currentPage().resources = currentPage().resources.slice(-500);
  } catch { /* Ignore malformed or unavailable resource names. */ }
}
export function observeBrowserDiagnostics(): void {
  init();
  if (observerStarted || typeof PerformanceObserver === 'undefined') return;
  observerStarted = true;
  try { performance.getEntriesByType('resource').forEach((entry) => addResource(entry as PerformanceResourceTiming)); } catch { /* optional diagnostic */ }
  try {
    const resources = new PerformanceObserver((list) => list.getEntries().forEach((entry) => addResource(entry as PerformanceResourceTiming)));
    resources.observe({type: 'resource', buffered: true});
  } catch { currentPage().capture.main_frame_resource_timing = false; }
  try {
    const tasks = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) currentPage().long_tasks.push({start_ms: entry.startTime, duration_ms: entry.duration, end_ms: entry.startTime + entry.duration});
      currentPage().long_tasks = currentPage().long_tasks.slice(-300);
    });
    tasks.observe({type: 'longtask', buffered: true});
  } catch { currentPage().capture.long_task_supported = false; }
  recordPageTiming('diagnostics_started', {resource_timing: currentPage().capture.main_frame_resource_timing, long_tasks: currentPage().capture.long_task_supported});
}

export function setTimingActor(actor?: string): void {
  if ((actor ?? '') === actorScope) return;
  if (actorScope) persist();
  actorScope = actor ?? ''; actorFingerprint = actorScope ? fingerprint(actorScope) : '';
  runs = []; pages = []; legacyRuns = []; activeID = ''; loaded = false; activeSignAttempts.clear();
  init();
}
export function recordPageTiming(stage: string, details: TimingDetails = {}): void {
  try {
    init(); if (!actorScope) return;
    const mono = now();
    currentPage().events.push({stage, at: new Date().toISOString(), monotonic_ms: mono, time_origin_ms: timeOrigin(), details});
    try { performance.mark(`fastswap:${stage}`); } catch { /* optional browser mark */ }
  } catch { /* Diagnostics never block the transaction. */ }
}
export function startTimingRun(id: string, actor: string): void {
  setTimingActor(actor); init(); activeID = id;
  if (!runs.some((run) => run.client_intent_id === id)) {
    const group = currentGroup();
    const sample = runs.filter((run) => run.experiment_group === group).length + 1;
    runs = [...runs.slice(-19), {
      client_intent_id: id, swap_id: null, actor_scope_fingerprint: actorFingerprint,
      experiment_group: group, group_sample_index: sample, page_instance_id: pageInstanceID,
      started_at: new Date().toISOString(), started_monotonic_ms: now(), time_origin_ms: timeOrigin(),
      points: [], sign_attempts: [], http_attempts: [],
    }];
  }
  markSwapTiming('create_start', {experiment_group: currentGroup()});
}
export function beginSignAttempt(id: string, revision: string): string {
  init();
  const run = runs.find((item) => item.client_intent_id === id);
  const attemptID = uuid();
  if (run) {
    run.sign_attempts.push({sign_attempt_id: attemptID, revision, page_instance_id: pageInstanceID, started_at: new Date().toISOString(), outcome: 'pending', failure_stage: null});
    activeSignAttempts.set(id, attemptID);
  }
  return attemptID;
}
export function finishSignAttempt(id: string, outcome: 'signed' | 'failed', failureStage: string | null): void {
  try {
    const run = runs.find((item) => item.client_intent_id === id); const attemptID = activeSignAttempts.get(id);
    const attempt = run?.sign_attempts.find((item) => item.sign_attempt_id === attemptID);
    if (attempt) { attempt.outcome = outcome; attempt.failure_stage = failureStage; }
    activeSignAttempts.delete(id);
    if (outcome === 'failed') scheduleTimingFlush();
  } catch { activeSignAttempts.delete(id); }
}
export function markSwapTiming(stage: string, details: TimingDetails = {}, id = activeID, signAttemptID?: string): number {
  const overheadStarted = now();
  try {
    init(); const run = runs.find((item) => item.client_intent_id === id); if (!run) return now() - overheadStarted;
    const mono = now(); const origin = timeOrigin(); const attempt = signAttemptID ?? activeSignAttempts.get(id);
    run.points.push({
      stage, at: new Date().toISOString(), monotonic_ms: mono, time_origin_ms: origin,
      elapsed_ms: run.time_origin_ms === origin ? mono - run.started_monotonic_ms : null,
      details: attempt ? {...details, sign_attempt_id: attempt} : details,
    });
    try { performance.mark(`fastswap:${stage}`); } catch { /* optional browser mark */ }
  } catch { /* Diagnostics never block the transaction. */ }
  return now() - overheadStarted;
}
export function recordDiagnosticOverhead(source: string, durationMS: number, id = activeID, signAttemptID?: string): void {
  markSwapTiming('diagnostic_callback_overhead', {source, duration_ms: durationMS}, id, signAttemptID);
}
export function recordHttpAttemptEvent(id: string, attemptID: string, event: HttpTimingEvent, signAttemptID?: string): void {
  try {
    init(); const run = runs.find((item) => item.client_intent_id === id); if (!run) return;
    let attempt = run.http_attempts.find((item) => item.attempt_id === attemptID);
    if (!attempt) { attempt = {attempt_id: attemptID, sign_attempt_id: signAttemptID ?? activeSignAttempts.get(id) ?? null, events: []}; run.http_attempts.push(attempt); }
    attempt.events.push(event);
    markSwapTiming(`execution_http_${event.stage}`, {...event.details, attempt_id: attemptID}, id, attempt.sign_attempt_id ?? undefined);
    if (event.stage === 'parse_done' || event.stage === 'request_error') scheduleTimingFlush();
  } catch { /* Diagnostics never block the transaction. */ }
}
export function recordSnapshotTiming(snapshot: SwapSnapshot): void {
  try {
    init(); const run = runs.find((item) => item.client_intent_id === snapshot.intent.client_intent_id); if (!run) return;
    run.swap_id = snapshot.swap_id;
    const once = (stage: string, condition: boolean) => {
      if (!condition || run.points.some((point) => point.stage === stage)) return;
      markSwapTiming(stage, {event_version:snapshot.event_version, execution:snapshot.execution.status, source:snapshot.settlement.source, destination:snapshot.settlement.destination, accounting:snapshot.settlement.accounting, outcome:snapshot.settlement.outcome, amount_in_raw:snapshot.intent.amount_in_raw, amount_in_actual_raw:snapshot.settlement.amount_in_actual_raw, amount_out_actual_raw:snapshot.settlement.amount_out_actual_raw, origin_tx_hash:snapshot.execution.origin_tx_hash, destination_tx_hash:snapshot.settlement.destination_tx_hash}, run.client_intent_id);
    };
    once('ready_received', snapshot.preparation.status === 2);
    once('execution_accepted', snapshot.execution.status === 3);
    once('source_observed', snapshot.settlement.source === 2 || snapshot.settlement.source === 3);
    once('source_confirmed', snapshot.settlement.source === 3);
    once('destination_observed', snapshot.settlement.destination === 2 || snapshot.settlement.destination === 3);
    once('destination_confirmed', snapshot.settlement.destination === 3);
    once('accounting_posted', snapshot.settlement.accounting === 2);
    once('completed', snapshot.settlement.outcome === 2);
    once('terminal_other', [4,5,6,8].includes(snapshot.settlement.outcome));
    once('attention_required', snapshot.settlement.outcome === 9);
    if ([2,4,5,6,8,9].includes(snapshot.settlement.outcome)) scheduleTimingFlush();
  } catch { /* Diagnostics never block the transaction. */ }
}
export function timingRunOptions(): {id: string; label: string}[] {
  try {
    init();
    return runs.filter(validRun).map((run) => ({id: run.client_intent_id, label: `${run.experiment_group}-${run.group_sample_index} · ${run.swap_id?.slice(0, 8) ?? run.client_intent_id.slice(0, 8)}`}));
  } catch { return []; }
}
export function timingEvidence(actor?: string, runID?: string): string {
  init();
  const allowed = Boolean(actor && actor === actorScope);
  const selectedRuns = allowed ? runID ? runs.filter((run) => run.client_intent_id === runID) : runs : [];
  const selectedPageIDs = new Set(selectedRuns.map((run) => run.page_instance_id));
  return JSON.stringify({
    format: 'fastswap-timing.v3',
    measured: 'Browser monotonic times are comparable only within identical page_instance_id and time_origin_ms. Server and chain clocks are reported separately.',
    capture_completeness: {privy_iframe_network: 'requires_separate_cdp_capture', missing_values: 'unknown_not_zero', legacy_v2: legacyRuns.length > 0 ? 'included_without_v3_breakdown' : 'none'},
    runs: selectedRuns,
    pages: allowed ? pages.filter((page) => runID ? selectedPageIDs.has(page.page_instance_id) : true) : [],
    legacy_v2_runs: allowed ? legacyRuns.map((run) => ({...run as object, v3_breakdown_available: false})) : [],
  }, null, 2);
}
