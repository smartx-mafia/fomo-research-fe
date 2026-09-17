import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {beginSignAttempt, finishSignAttempt, flushTimingEvidence, markSwapTiming, recordHttpAttemptEvent, setTimingActor, startTimingRun, timingEvidence, timingRunOptions} from './timing';

describe('timing evidence isolation and clocks', () => {
  beforeEach(() => {
    setTimingActor(undefined);
    const records = new Map<string,string>();
    vi.stubGlobal('sessionStorage',{getItem:(key:string)=>records.get(key) ?? null,setItem:(key:string,value:string)=>records.set(key,value)});
    vi.stubGlobal('performance',{timeOrigin:1000,now:()=>500});
  });
  afterEach(() => {setTimingActor(undefined); vi.unstubAllGlobals();});
  it('does not export another account or anonymous session history', () => {
    startTimingRun('intent-a','actor-a'); markSwapTiming('confirm_click');
    expect(JSON.parse(timingEvidence('actor-a')).runs).toHaveLength(1);
    expect(JSON.parse(timingEvidence('actor-b')).runs).toHaveLength(0);
    setTimingActor('actor-b'); expect(JSON.parse(timingEvidence('actor-b')).runs).toHaveLength(0);
    setTimingActor('actor-a'); expect(JSON.parse(timingEvidence('actor-a')).runs).toHaveLength(1);
    expect(JSON.parse(timingEvidence()).runs).toHaveLength(0);
  });
  it('never subtracts relative performance clocks across reloads', () => {
    startTimingRun('intent-a','actor-a');
    setTimingActor(undefined);
    vi.stubGlobal('performance',{timeOrigin:2000,now:()=>10});
    setTimingActor('actor-a'); markSwapTiming('recovered',{},'intent-a');
    const point = JSON.parse(timingEvidence('actor-a')).runs[0].points.at(-1);
    expect(point.elapsed_ms).toBeNull(); expect(point.time_origin_ms).toBe(2000);
  });
  it('keeps critical-path marks in memory until an explicit flush', () => {
    let writes = 0;
    const records = new Map<string,string>();
    vi.stubGlobal('sessionStorage',{getItem:(key:string)=>records.get(key) ?? null,setItem:(key:string,value:string)=>{writes += 1; records.set(key,value);}});
    startTimingRun('intent-a','actor-a'); markSwapTiming('privy_sign_start'); markSwapTiming('privy_sign_done');
    expect(writes).toBe(0);
    flushTimingEvidence();
    expect(writes).toBe(1);
    expect(JSON.parse(timingEvidence('actor-a')).format).toBe('fastswap-timing.v3');
  });
  it('isolates HTTP retries under their own request ids and preserves legacy v2 as partial', () => {
    const records = new Map<string,string>();
    records.set('smartx-fast-swap.timing.v2:actor-a', JSON.stringify([{client_intent_id:'legacy'}]));
    vi.stubGlobal('sessionStorage',{getItem:(key:string)=>records.get(key) ?? null,setItem:(key:string,value:string)=>records.set(key,value)});
    startTimingRun('intent-a','actor-a'); const signAttempt = beginSignAttempt('intent-a','1');
    recordHttpAttemptEvent('intent-a','request-1',{stage:'request_start',monotonic_ms:510,at:new Date().toISOString(),details:{}},signAttempt);
    recordHttpAttemptEvent('intent-a','request-2',{stage:'request_start',monotonic_ms:520,at:new Date().toISOString(),details:{}},signAttempt);
    const evidence = JSON.parse(timingEvidence('actor-a'));
    expect(evidence.runs[0].http_attempts.map((attempt:{attempt_id:string})=>attempt.attempt_id)).toEqual(['request-1','request-2']);
    expect(evidence.legacy_v2_runs[0]).toMatchObject({client_intent_id:'legacy',v3_breakdown_available:false});
  });
  it('does not flush a successful signature before execution and discards malformed stored v3 rows', () => {
    let writes = 0;
    const nestedMalformed = {client_intent_id:'bad',swap_id:7,actor_scope_fingerprint:'scope',experiment_group:'A',group_sample_index:1,page_instance_id:'page',started_at:'now',started_monotonic_ms:1,time_origin_ms:1,points:[],sign_attempts:[null],http_attempts:[]};
    const records = new Map<string,string>([['smartx-fast-swap.timing.v3:actor-a',JSON.stringify({runs:[null,nestedMalformed],pages:[null]})]]);
    vi.stubGlobal('sessionStorage',{getItem:(key:string)=>records.get(key) ?? null,setItem:(key:string,value:string)=>{writes+=1;records.set(key,value);}});
    startTimingRun('intent-a','actor-a'); beginSignAttempt('intent-a','1'); finishSignAttempt('intent-a','signed',null);
    expect(writes).toBe(0);
    expect(()=>timingRunOptions()).not.toThrow();
    expect(timingRunOptions()).toHaveLength(1);
  });
});
