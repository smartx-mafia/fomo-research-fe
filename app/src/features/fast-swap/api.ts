import {newTraceID} from '@/lib/trace';

import {FAST_SWAP_API_BASE} from './config';
import {
  parseActiveSwaps, parseAvailabilityReply, parseCapabilities, parseEvents, parseStreamTicket,
  parseSwapReply, type CreateIntent,
} from './contract';

export type RecoveryAction = 'change_input' | 'get_snapshot' | 'refresh_quote' | 'retry_same_request' | 'new_idempotency_key' | 'contact_support';
const RECOVERY_ACTIONS = new Set<RecoveryAction>(['change_input', 'get_snapshot', 'refresh_quote', 'retry_same_request', 'new_idempotency_key', 'contact_support']);
export class FastSwapApiError extends Error {
  constructor(
    readonly kind: 'business' | 'transport' | 'network' | 'contract',
    readonly code: number,
    message: string,
    readonly reason?: string,
    readonly traceID?: string,
    readonly metadata: Record<string, string> = {},
  ) { super(message); this.name = 'FastSwapApiError'; }
  get recoveryAction(): RecoveryAction {
    const value = this.metadata.recovery_action;
    return RECOVERY_ACTIONS.has(value as RecoveryAction) ? value as RecoveryAction : 'get_snapshot';
  }
  get retryable(): boolean { return this.metadata.retryable === 'true'; }
  get retryAfterMS(): number | undefined {
    const value = this.metadata.retry_after_ms;
    if (!value || !/^\d+$/.test(value)) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  get relatedSwapID(): string | undefined { return this.metadata.related_swap_id; }
}

export type RequestTimingEvent = {
  attemptID: string;
  stage: 'request_start' | 'response_headers' | 'response_body_done' | 'parse_done' | 'request_error';
  monotonicMS: number;
  at: string;
  details: Record<string, string | number | boolean | null>;
};
export type RequestTimingReporter = (event: RequestTimingEvent) => void;
type Options = {method?: 'GET' | 'POST'; body?: unknown; bearer: string; idempotencyKey?: string; signal?: AbortSignal; timing?: RequestTimingReporter};
type Envelope = {code?: unknown; msg?: unknown; error?: unknown; metadata?: unknown; trace_id?: unknown; data?: unknown};
let latestTraceID = '';
const traceListeners = new Set<(traceID: string) => void>();
function recordTrace(traceID: string | undefined) {
  if (!traceID) return;
  latestTraceID = traceID;
  for (const listener of traceListeners) {
    try { listener(traceID); } catch { /* Diagnostic listeners never alter request behavior. */ }
  }
}
export function getLatestFastSwapTrace(): string { return latestTraceID; }
export function subscribeFastSwapTrace(listener: (traceID: string) => void): () => void {
  traceListeners.add(listener);
  return () => traceListeners.delete(listener);
}

function assertNoMixedContent(url: URL) {
  if (typeof location !== 'undefined' && location.protocol === 'https:' && url.protocol === 'http:') {
    throw new FastSwapApiError('network', 0, `HTTPS cannot call ${url.origin}. Configure NEXT_PUBLIC_FAST_SWAP_API_BASE.`);
  }
}
function metadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) if (typeof item === 'string') output[key] = item;
  return output;
}
async function request(path: string, options: Options): Promise<unknown> {
  const url = new URL(path, `${FAST_SWAP_API_BASE}/`); assertNoMixedContent(url);
  const sentRequestID = newTraceID();
  const report = (stage: RequestTimingEvent['stage'], details: RequestTimingEvent['details'] = {}) => {
    try { options.timing?.({attemptID: sentRequestID, stage, monotonicMS: performance.now(), at: new Date().toISOString(), details}); } catch { /* Diagnostics never alter the API request. */ }
  };
  const headers: Record<string, string> = {authorization: `Bearer ${options.bearer}`, 'x-request-id': sentRequestID};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  let response: Response;
  report('request_start', {method: options.method ?? 'GET', path_category: path.endsWith('/executions') ? 'execution' : 'fastswap'});
  try {
    response = await fetch(url, {method: options.method ?? 'GET', headers, body, signal: options.signal});
  } catch (error) {
    recordTrace(sentRequestID);
    report('request_error', {phase: 'fetch', trace_id: sentRequestID, error_kind: error instanceof DOMException && error.name === 'AbortError' ? 'aborted' : 'network'});
    throw new FastSwapApiError('network', 0, error instanceof Error ? error.message : String(error), undefined, sentRequestID);
  }
  const headerTrace = response.headers.get('x-trace-id') || response.headers.get('x-request-id') || sentRequestID;
  report('response_headers', {status: response.status, trace_id: headerTrace});
  let text: string;
  try { text = await response.text(); }
  catch (error) {
    recordTrace(headerTrace);
    report('request_error', {phase: 'response_body', status: response.status, trace_id: headerTrace, error_kind: 'body_read'});
    throw new FastSwapApiError('transport', response.status, error instanceof Error ? error.message : String(error), undefined, headerTrace);
  }
  report('response_body_done', {status: response.status, response_bytes: options.timing ? new TextEncoder().encode(text).length : 0, trace_id: headerTrace});
  recordTrace(headerTrace);
  if (response.status !== 200) {
    report('request_error', {phase: 'http_status', status: response.status, trace_id: headerTrace, error_kind: 'transport'});
    throw new FastSwapApiError('transport', response.status, `Fast Swap HTTP ${response.status}: ${text.slice(0, 180)}`, undefined, headerTrace);
  }
  let envelope: Envelope;
  try { envelope = JSON.parse(text) as Envelope; } catch {
    report('request_error', {phase: 'parse', status: 200, trace_id: headerTrace, error_kind: 'invalid_json'});
    throw new FastSwapApiError('transport', 200, 'Fast Swap response is not JSON.', undefined, headerTrace);
  }
  if (typeof envelope.code !== 'number') {
    report('request_error', {phase: 'contract', status: 200, trace_id: headerTrace, error_kind: 'missing_code'});
    throw new FastSwapApiError('contract', 0, 'Fast Swap envelope has no numeric code.', undefined, headerTrace);
  }
  const traceID = typeof envelope.trace_id === 'string' ? envelope.trace_id : undefined;
  recordTrace(traceID ?? headerTrace);
  if (envelope.code !== 200) {
    report('request_error', {phase: 'business', status: 200, code: envelope.code, trace_id: traceID ?? headerTrace, error_kind: 'business'});
    throw new FastSwapApiError('business', envelope.code, typeof envelope.msg === 'string' ? envelope.msg : 'Fast Swap rejected the request.', typeof envelope.error === 'string' ? envelope.error : undefined, traceID, metadata(envelope.metadata));
  }
  if (envelope.data === undefined) {
    report('request_error', {phase: 'contract', status: 200, trace_id: traceID ?? headerTrace, error_kind: 'missing_data'});
    throw new FastSwapApiError('contract', 200, 'Successful Fast Swap response has no data.', undefined, traceID);
  }
  report('parse_done', {status: 200, code: envelope.code, trace_id: traceID ?? headerTrace});
  return envelope.data;
}

async function executionRequest(
  run: (timing?: RequestTimingReporter) => Promise<unknown>,
  timing?: RequestTimingReporter,
) {
  if (!timing) return parseSwapReply(await run());
  let envelopeParsed: RequestTimingEvent | undefined;
  let requestFailed = false;
  const safelyReport = (event: RequestTimingEvent) => { try { timing(event); } catch { /* Diagnostics never alter execution. */ } };
  const proxy: RequestTimingReporter = (event) => {
    if (event.stage === 'parse_done') { envelopeParsed = event; return; }
    if (event.stage === 'request_error') requestFailed = true;
    safelyReport(event);
  };
  const data = await run(proxy);
  try {
    const parsed = parseSwapReply(data);
    if (envelopeParsed) safelyReport({...envelopeParsed, monotonicMS: performance.now(), at: new Date().toISOString(), details: {...envelopeParsed.details, contract_parsed: true}});
    return parsed;
  } catch (error) {
    if (!requestFailed && envelopeParsed) safelyReport({
      ...envelopeParsed, stage: 'request_error', monotonicMS: performance.now(), at: new Date().toISOString(),
      details: {...envelopeParsed.details, phase: 'contract_parse', error_kind: 'contract'},
    });
    throw error;
  }
}

export const getCapabilities = async (bearer: string, signal?: AbortSignal) => parseCapabilities(await request('/v2/swaps/capabilities', {bearer, signal}));
export const createSwap = async (bearer: string, intent: CreateIntent, key: string, signal?: AbortSignal) => parseSwapReply(await request('/v2/swaps', {method: 'POST', bearer, body: intent, idempotencyKey: key, signal}));
export const getSwap = async (bearer: string, swapID: string, signal?: AbortSignal) => parseSwapReply(await request(`/v2/swaps/${encodeURIComponent(swapID)}`, {bearer, signal}));
export const refreshSwap = async (bearer: string, swapID: string, expectedRevision: string | null, key: string, signal?: AbortSignal) => parseSwapReply(await request(`/v2/swaps/${encodeURIComponent(swapID)}/refresh`, {method: 'POST', bearer, body: {expected_revision: expectedRevision}, idempotencyKey: key, signal}));
export const cancelSwap = async (bearer: string, swapID: string, expectedRevision: string | null, key: string, signal?: AbortSignal) => parseSwapReply(await request(`/v2/swaps/${encodeURIComponent(swapID)}/cancel`, {method: 'POST', bearer, body: {expected_revision: expectedRevision}, idempotencyKey: key, signal}));
export const reportSolanaExecution = async (bearer: string, swapID: string, revision: string, intentHash: string, signedTransaction: string, key: string, signal?: AbortSignal, timing?: RequestTimingReporter) => executionRequest(
  (reporter) => request(`/v2/swaps/${encodeURIComponent(swapID)}/executions`, {method: 'POST', bearer, idempotencyKey: key, signal, timing: reporter, body: {swap_id: swapID, revision, intent_hash: intentHash, solana_transaction: {signed_transaction_base64: signedTransaction}}}), timing,
);
export const reportEvmExecution = async (bearer: string, swapID: string, revision: string, intentHash: string, signatures: {request_id: string; signature: string}[], key: string, signal?: AbortSignal, timing?: RequestTimingReporter) => executionRequest(
  (reporter) => request(`/v2/swaps/${encodeURIComponent(swapID)}/executions`, {method: 'POST', bearer, idempotencyKey: key, signal, timing: reporter, body: {swap_id: swapID, revision, intent_hash: intentHash, evm_signatures: {signatures}}}), timing,
);
export const listActiveSwaps = async (bearer: string, cursor = '', limit = 20, signal?: AbortSignal) => parseActiveSwaps(await request(`/v2/swaps/active?cursor=${encodeURIComponent(cursor)}&limit=${limit}`, {bearer, signal}));
export const listSwapEvents = async (bearer: string, swapID: string, afterVersion: string, signal?: AbortSignal) => parseEvents(await request(`/v2/swaps/${encodeURIComponent(swapID)}/events?after_version=${encodeURIComponent(afterVersion)}`, {bearer, signal}));
export const getSwapAvailability = async (bearer: string, swapID: string, signal?: AbortSignal) => parseAvailabilityReply(await request(`/v2/swaps/${encodeURIComponent(swapID)}/availability`, {bearer, signal}));
export const createStreamTicket = async (bearer: string, signal?: AbortSignal) => parseStreamTicket(await request('/v2/swaps/stream-tickets', {method: 'POST', bearer, body: {}, signal}));
export async function reportTelemetry(bearer: string, events: unknown[], key: string, signal?: AbortSignal): Promise<void> {
  try { await request('/v2/swaps/telemetry', {method: 'POST', bearer, body: {events}, idempotencyKey: key, signal}); } catch { /* Telemetry never changes the trade result. */ }
}
