import {afterEach, describe, expect, it, vi} from 'vitest';

import {FastSwapApiError, getCapabilities, getLatestFastSwapTrace, reportSolanaExecution, subscribeFastSwapTrace} from './api';
import {quoteFixture} from './auto-quote.fixture';

describe('Fast Swap trace propagation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the successful envelope trace for diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({code: 200, msg: 'success', trace_id: 'trace-envelope', data: {contract_version: 'fast-swap.v1', routes: [], server_time: '2026-09-16T00:00:00Z'}}), {status: 200, headers: {'x-trace-id': 'trace-header'}})));
    await expect(getCapabilities('jwt')).resolves.toMatchObject({routes: []});
    expect(getLatestFastSwapTrace()).toBe('trace-envelope');
  });

  it('uses the response trace header when transport rejects before the envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway failure', {status: 502, headers: {'x-trace-id': 'trace-transport'}})));
    await expect(getCapabilities('jwt')).rejects.toMatchObject({kind: 'transport', traceID: 'trace-transport'} satisfies Partial<FastSwapApiError>);
    expect(getLatestFastSwapTrace()).toBe('trace-transport');
  });

  it('reports execution HTTP boundaries with a request-scoped trace and isolates diagnostic failures', async () => {
    const snapshot = quoteFixture();
    const events: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({code:200,msg:'success',trace_id:'trace-execution',data:{contract_version:'fast-swap.v1',swap:snapshot}}), {status:200,headers:{'x-trace-id':'trace-header'}})));
    await expect(reportSolanaExecution('jwt','swap','1','hash','signed','key',undefined,(event)=>events.push(`${event.attemptID}:${event.stage}:${String(event.details.trace_id ?? '')}`))).resolves.toMatchObject({swap_id:'swap'});
    expect(events.map((event)=>event.split(':')[1])).toEqual(['request_start','response_headers','response_body_done','parse_done']);
    expect(new Set(events.map((event)=>event.split(':')[0])).size).toBe(1);
    expect(events.at(-1)).toContain('trace-execution');
    await expect(reportSolanaExecution('jwt','swap','1','hash','signed','key',undefined,()=>{throw new Error('diagnostics failed');})).resolves.toMatchObject({swap_id:'swap'});
  });

  it('isolates trace subscribers and reports execution contract parse failures as request failures', async () => {
    const unsubscribe = subscribeFastSwapTrace(() => { throw new Error('trace UI failed'); });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({code:200,msg:'success',trace_id:'trace-listener',data:{contract_version:'fast-swap.v1',routes:[],server_time:'2026-09-16T00:00:00Z'}}), {status:200})));
    await expect(getCapabilities('jwt')).resolves.toMatchObject({routes:[]});
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({code:200,msg:'success',trace_id:'trace-bad-contract',data:{contract_version:'fast-swap.v1',swap:{swap_id:'incomplete'}}}), {status:200})));
    const events: {stage:string;phase?:unknown}[] = [];
    await expect(reportSolanaExecution('jwt','swap','1','hash','signed','key',undefined,(event)=>events.push({stage:event.stage,phase:event.details.phase}))).rejects.toThrow();
    unsubscribe();
    expect(events.some((event)=>event.stage==='parse_done')).toBe(false);
    expect(events.at(-1)).toEqual({stage:'request_error',phase:'contract_parse'});
  });
});
