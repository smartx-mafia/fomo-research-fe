// @vitest-environment jsdom
import React, {StrictMode} from 'react';
import {act, cleanup, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {draftKey, signingDeadline, unsignedQuote, validDraft} from './auto-quote';
import {quoteFixture} from './auto-quote.fixture';
import {useAutoQuote} from './useAutoQuote';

const tick = (ms:number) => act(async()=>{await vi.advanceTimersByTimeAsync(ms);});
const options = () => ({scope:'actor:jwt',enabled:true,inputKey:draftKey(quoteFixture().intent),inputVersion:1,
  snapshot:undefined as ReturnType<typeof quoteFixture>|undefined,busy:false,expired:false,blockedUntil:0,
  prepare:vi.fn(async(_signal:AbortSignal)=>{}),cancel:vi.fn(async(_signal:AbortSignal)=>{}),refresh:vi.fn(async(_signal:AbortSignal)=>{}),canRefresh:vi.fn(async()=>true)});

describe('automatic quote orchestration',()=>{
  beforeEach(()=>{vi.useFakeTimers(); Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});});
  afterEach(()=>{cleanup(); vi.useRealTimers();vi.restoreAllMocks();});

  it('debounces rapid edits and performs one Create, including StrictMode',async()=>{
    const p=options(); const h=renderHook(props=>useAutoQuote(props),{initialProps:p,wrapper:({children})=><StrictMode>{children}</StrictMode>});
    await tick(200);
    h.rerender({...p,inputKey:draftKey(quoteFixture('3000000').intent),inputVersion:2});
    await tick(299);expect(p.prepare).not.toHaveBeenCalled();
    await tick(1);expect(p.prepare).toHaveBeenCalledTimes(1);
    await tick(5000);expect(p.prepare).toHaveBeenCalledTimes(1);
  });

  it('does not request a quote for empty or invalid input',async()=>{
    const p=options();renderHook(()=>useAutoQuote({...p,inputKey:null})); await tick(5000); expect(p.prepare).not.toHaveBeenCalled();
    expect(validDraft({...quoteFixture().intent,amount_in_raw:'1.2'})).toBe(false);
    expect(validDraft({...quoteFixture().intent,destination_asset:'incomplete'})).toBe(false);
  });

  it('retires a late old quote before preparing the latest amount',async()=>{
    const p=options(); let finish!:()=>void;
    p.prepare.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const h=renderHook(props=>useAutoQuote(props),{initialProps:p}); await tick(300);
    const changed={...p,inputKey:draftKey(quoteFixture('3000000').intent),inputVersion:2};
    h.rerender(changed);await tick(300);expect(p.prepare).toHaveBeenCalledTimes(1);
    await act(async()=>{h.rerender({...changed,snapshot:quoteFixture()}); finish();});
    await tick(0);expect(h.result.current.quoteMatches).toBe(false);expect(p.cancel).toHaveBeenCalledTimes(1);
    const cancelling=quoteFixture();cancelling.settlement.outcome=3;
    h.rerender({...changed,snapshot:cancelling});await tick(5000);
    expect(p.prepare).toHaveBeenCalledTimes(1);
    const cancelled=quoteFixture();cancelled.settlement.outcome=4;
    h.rerender({...changed,snapshot:cancelled});await tick(0);expect(p.prepare).toHaveBeenCalledTimes(2);
  });

  it('waits for chain expiry before refreshing and never creates a second intent',async()=>{
    const p=options();p.snapshot=quoteFixture();p.expired=true;p.canRefresh.mockResolvedValue(false);
    renderHook(()=>useAutoQuote(p));await tick(300);expect(p.refresh).not.toHaveBeenCalled();
    await tick(2000);expect(p.refresh).not.toHaveBeenCalled();
    p.canRefresh.mockResolvedValue(true);await tick(2000);
    expect(p.refresh).toHaveBeenCalledTimes(1);expect(p.prepare).not.toHaveBeenCalled();
  });

  it('does not refresh permanent BLOCKED but respects a temporary retry delay',async()=>{
    const p=options();p.snapshot=quoteFixture();p.snapshot.preparation={status:5,current_revision:null,retry_after_ms:null,reason_code:'unsupported'};
    const h=renderHook(props=>useAutoQuote(props),{initialProps:p});await tick(3000);expect(p.refresh).not.toHaveBeenCalled();
    const blocked=quoteFixture();blocked.preparation={status:5,current_revision:null,retry_after_ms:2000,reason_code:'sponsor'};
    h.rerender({...p,snapshot:blocked,blockedUntil:performance.now()+2000});
    await tick(1999);expect(p.refresh).not.toHaveBeenCalled();await tick(1);expect(p.refresh).toHaveBeenCalledTimes(1);
  });

  it('never auto-cancels or refreshes a potentially executing swap',async()=>{
    const p=options();p.snapshot=quoteFixture();p.snapshot.execution.status=4;
    p.inputKey=draftKey(quoteFixture('3000000').intent);
    renderHook(()=>useAutoQuote(p));await tick(5000);
    expect(p.cancel).not.toHaveBeenCalled();expect(p.refresh).not.toHaveBeenCalled();expect(p.prepare).not.toHaveBeenCalled();
    expect(unsignedQuote(p.snapshot)).toBe(false);
  });

  it('pauses in hidden tabs and aborts an old session on account switch',async()=>{
    const p=options();let finish!:()=>void;
    p.prepare.mockImplementationOnce(()=>new Promise<void>(r=>{finish=r;}));
    const h=renderHook(props=>useAutoQuote(props),{initialProps:p});
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
    act(()=>document.dispatchEvent(new Event('visibilitychange')));await tick(2000);expect(p.prepare).not.toHaveBeenCalled();
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
    act(()=>document.dispatchEvent(new Event('visibilitychange')));await tick(300);
    const oldSignal=p.prepare.mock.calls[0]![0];
    h.rerender({...p,scope:'other:jwt'});expect(oldSignal.aborted).toBe(true);await tick(300);
    expect(p.prepare).toHaveBeenCalledTimes(2);await act(async()=>finish());
  });

  it('does not extend a READY deadline when an old event is replayed',()=>{
    const deadlines=new Map<string,number>();
    const s=quoteFixture();const first=signingDeadline(deadlines,s,100);
    expect(first.until).toBe(8100);
    expect(signingDeadline(deadlines,s,5000).until).toBe(8100);
    s.preparation.current_revision='2';expect(signingDeadline(deadlines,s,9000).until).toBe(17000);
    s.preparation.current_revision='1';expect(signingDeadline(deadlines,s,10000).until).toBe(8100);
  });
});
