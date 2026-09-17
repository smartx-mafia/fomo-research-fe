// @vitest-environment jsdom
import React from 'react';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {quoteFixture} from './auto-quote.fixture';
import type {CreateIntent, SwapSnapshot} from './contract';

const mocks = vi.hoisted(()=>({
  session:{jwt:'test-session',user:{identifier:'test-actor'},meta:null},
  user:{id:'test-privy',linkedAccounts:[{type:'wallet',walletClientType:'privy',chainType:'solana',id:'wallet-sol',address:'user',walletIndex:0}]},
  solanaWallets:[{address:'user'}], evmWallets:[], params:new URLSearchParams(),
  create:vi.fn(), get:vi.fn(), events:vi.fn(), refresh:vi.fn(), cancel:vi.fn(), sign:vi.fn(),
  prewarmSign:vi.fn(), accessToken:vi.fn(),
  pendingWrite:vi.fn(), report:vi.fn(),
  expired:vi.fn(), verify:vi.fn(), listeners:[] as ((snapshot:SwapSnapshot)=>void)[],
}));
vi.mock('next/navigation',()=>({useSearchParams:()=>mocks.params}));
vi.mock('@/session/storage',()=>({useSession:()=>mocks.session}));
vi.mock('@privy-io/react-auth',()=>({usePrivy:()=>({ready:true,authenticated:true,user:mocks.user,getAccessToken:mocks.accessToken}),useWallets:()=>({ready:true,wallets:mocks.evmWallets})}));
vi.mock('@privy-io/react-auth/solana',()=>({useWallets:()=>({ready:true,wallets:mocks.solanaWallets}),useSignMessage:()=>({signMessage:mocks.prewarmSign}),useSignTransaction:()=>({signTransaction:mocks.sign})}));
vi.mock('./pending-execution',()=>({readPendingExecution:async()=>null,writePendingExecution:(value:unknown)=>mocks.pendingWrite(value),clearPendingExecutionIfMatch:async()=>true}));
vi.mock('./signing',()=>({verifySolanaChainState:mocks.verify,solanaRevisionExpired:mocks.expired,signSolanaRevision:mocks.sign,signEvmRevision:mocks.sign}));
vi.mock('./stream',()=>({watchSwap:(options:{onSnapshot:(s:SwapSnapshot)=>void})=>{mocks.listeners.push(options.onSnapshot);return ()=>{};}}));
vi.mock('./api',async original=>({
  ...await original<typeof import('./api')>(),
  getCapabilities:async()=>({server_time:new Date().toISOString(),routes:[{route_id:'sol-swap',origin_chain:'solana:mainnet',destination_chain:'solana:mainnet',side:3,enabled:true,signing_kinds:[1],broadcast_modes:[1],sponsorship_available:true,fast_fill_available:false,multi_revision_safe:false,unavailable_reason:null}]}),
  listActiveSwaps:async()=>({items:[],next_cursor:null}),
  createSwap:mocks.create,getSwap:mocks.get,listSwapEvents:mocks.events,refreshSwap:mocks.refresh,cancelSwap:mocks.cancel,
  reportSolanaExecution:mocks.report,reportEvmExecution:mocks.report,
  getSwapAvailability:async()=>quoteFixture().availability,
}));
import FastSwapPage from './FastSwapPage';

const tick=(ms:number)=>act(async()=>{await vi.advanceTimersByTimeAsync(ms);});
let current:SwapSnapshot;
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-16T00:00:00Z')); localStorage.clear();sessionStorage.clear();
  mocks.solanaWallets.splice(0,mocks.solanaWallets.length,{address:'user'});
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
  mocks.create.mockReset(); mocks.cancel.mockReset(); mocks.refresh.mockReset(); mocks.sign.mockReset(); mocks.listeners.length=0;
  mocks.prewarmSign.mockReset(); mocks.prewarmSign.mockResolvedValue({signature:new Uint8Array(64)});
  mocks.accessToken.mockReset(); mocks.accessToken.mockResolvedValue('privy-token');
  mocks.pendingWrite.mockReset(); mocks.pendingWrite.mockResolvedValue(true); mocks.report.mockReset();
  mocks.verify.mockResolvedValue(undefined);mocks.expired.mockResolvedValue(false);
  mocks.create.mockImplementation(async(_token:string,intent:CreateIntent)=>{
    current={...quoteFixture(intent.amount_in_raw),swap_id:intent.client_intent_id,intent};
    current.preparation={status:1,current_revision:null,retry_after_ms:null,reason_code:null};
    return current;
  });
  mocks.get.mockImplementation(async()=>current);
  mocks.events.mockImplementation(async()=>({items:[],reset_required:false,next_version:current?.event_version ?? '0'}));
  mocks.cancel.mockImplementation(async()=>{current={...current,event_version:'3',settlement:{...current.settlement,outcome:3}};return current;});
  mocks.refresh.mockImplementation(async()=>{current={...current,event_version:'4',revision:{...current.revision,revision:'2'},preparation:{status:2,current_revision:'2',retry_after_ms:8000,reason_code:null}};return current;});
});
afterEach(()=>{cleanup();vi.useRealTimers();});

describe('FastSwapPage input-to-quote flow',()=>{
  it('runs one non-authorizing Solana prewarm in group B and never repeats it for amount edits',async()=>{
    sessionStorage.setItem('smartx-fast-swap.experiment-group.v1','B');
    render(<FastSwapPage/>);await tick(0);
    const input=screen.getByRole('textbox',{name:'投入原子金额'});
    fireEvent.change(input,{target:{value:'2000000'}});
    await tick(300);
    expect(mocks.accessToken).toHaveBeenCalledTimes(1);
    expect(mocks.prewarmSign).toHaveBeenCalledTimes(1);
    const call=mocks.prewarmSign.mock.calls[0]![0];
    expect(new TextDecoder().decode(call.message)).toMatch(/SmartX Fast Swap signer warm-up[\s\S]*purpose:non-authorizing/);
    expect(call.options.uiOptions.showWalletUIs).toBe(false);
    fireEvent.change(input,{target:{value:'3000000'}});await tick(300);
    expect(mocks.prewarmSign).toHaveBeenCalledTimes(1);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it('waits for the page to become visible before prewarming',async()=>{
    sessionStorage.setItem('smartx-fast-swap.experiment-group.v1','B');
    let resolveCreate:()=>void=()=>{};
    mocks.create.mockImplementationOnce((_token:string,intent:CreateIntent)=>new Promise<SwapSnapshot>((resolve)=>{
      resolveCreate=()=>{
        current={...quoteFixture(intent.amount_in_raw),swap_id:intent.client_intent_id,intent};
        current.preparation={status:1,current_revision:null,retry_after_ms:null,reason_code:null};
        resolve(current);
      };
    }));
    render(<FastSwapPage/>);await tick(0);
    fireEvent.change(screen.getByRole('textbox',{name:'投入原子金额'}),{target:{value:'2000000'}});
    await tick(300);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
    act(()=>document.dispatchEvent(new Event('visibilitychange')));
    resolveCreate();
    await tick(0);
    expect(mocks.accessToken).not.toHaveBeenCalled();
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
    act(()=>document.dispatchEvent(new Event('visibilitychange')));
    await tick(0);
    expect(mocks.accessToken).toHaveBeenCalledTimes(1);
    expect(mocks.prewarmSign).toHaveBeenCalledTimes(1);
  });

  it('does not sign when the wallet context changes while session refresh is pending',async()=>{
    sessionStorage.setItem('smartx-fast-swap.experiment-group.v1','B');
    let resolveToken:(value:string)=>void=()=>{};
    mocks.accessToken.mockImplementationOnce(()=>new Promise<string>((resolve)=>{resolveToken=resolve;}));
    const view=render(<FastSwapPage/>);await tick(0);
    fireEvent.change(screen.getByRole('textbox',{name:'投入原子金额'}),{target:{value:'2000000'}});
    await tick(300);
    expect(mocks.accessToken).toHaveBeenCalledTimes(1);
    expect(mocks.prewarmSign).not.toHaveBeenCalled();
    mocks.solanaWallets.splice(0,mocks.solanaWallets.length,{address:'different-wallet'});
    view.rerender(<FastSwapPage/>);
    resolveToken('late-token');
    await tick(0);
    expect(mocks.prewarmSign).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it('fails open when session refresh times out and never starts a late warm-up signature',async()=>{
    sessionStorage.setItem('smartx-fast-swap.experiment-group.v1','B');
    let resolveToken:(value:string)=>void=()=>{};
    mocks.accessToken.mockImplementationOnce(()=>new Promise<string>((resolve)=>{resolveToken=resolve;}));
    mocks.create.mockImplementation(async(_token:string,intent:CreateIntent)=>{
      current={...quoteFixture(intent.amount_in_raw),swap_id:intent.client_intent_id,intent};
      return current;
    });
    render(<FastSwapPage/>);await tick(0);
    fireEvent.change(screen.getByRole('textbox',{name:'投入原子金额'}),{target:{value:'2000000'}});
    await tick(300);
    expect((screen.getByRole('button',{name:'Privy 预热中'}) as HTMLButtonElement).disabled).toBe(true);
    await tick(4000);
    expect((screen.getByRole('button',{name:'确认、签名并执行'}) as HTMLButtonElement).disabled).toBe(false);
    resolveToken('late-token');
    await tick(0);
    expect(mocks.prewarmSign).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it('keeps the transaction signature gated while a non-cancellable warm-up signature is in flight',async()=>{
    sessionStorage.setItem('smartx-fast-swap.experiment-group.v1','B');
    let resolveWarmup:(value:{signature:Uint8Array})=>void=()=>{};
    mocks.prewarmSign.mockImplementationOnce(()=>new Promise<{signature:Uint8Array}>((resolve)=>{resolveWarmup=resolve;}));
    mocks.create.mockImplementation(async(_token:string,intent:CreateIntent)=>{
      current={...quoteFixture(intent.amount_in_raw),swap_id:intent.client_intent_id,intent};
      return current;
    });
    render(<FastSwapPage/>);await tick(0);
    fireEvent.change(screen.getByRole('textbox',{name:'投入原子金额'}),{target:{value:'2000000'}});
    await tick(300);
    expect(mocks.prewarmSign).toHaveBeenCalledTimes(1);
    await tick(4000);
    expect((screen.getByRole('button',{name:'Privy 预热中'}) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.sign).not.toHaveBeenCalled();
    resolveWarmup({signature:new Uint8Array(64)});
    await tick(0);
    expect((screen.getByRole('button',{name:'确认、签名并执行'}) as HTMLButtonElement).disabled).toBe(false);
  });

  it('creates after typing, waits for READY, and never signs an old amount',async()=>{
    render(<FastSwapPage/>);await tick(0);
    const input=screen.getByRole('textbox',{name:'投入原子金额'});
    fireEvent.change(input,{target:{value:'2000000'}});
    await tick(299);expect(mocks.create).not.toHaveBeenCalled();
    await tick(1);expect(mocks.create).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button',{name:'正在获取报价'}) as HTMLButtonElement).disabled).toBe(true);
    const firstID=current.swap_id;
    current={...current,event_version:'2',preparation:{status:2,current_revision:'1',retry_after_ms:8000,reason_code:null}};
    mocks.events.mockResolvedValueOnce({items:[{snapshot:current}],reset_required:false,next_version:'2'});
    await tick(1000);
    expect((screen.getByRole('button',{name:'确认、签名并执行'}) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.sign).not.toHaveBeenCalled();
    fireEvent.change(input,{target:{value:'3000000'}});
    expect((screen.getByRole('button',{name:'等待输入完成'}) as HTMLButtonElement).disabled).toBe(true);
    act(()=>mocks.listeners.at(-1)?.(current));
    expect((input as HTMLInputElement).value).toBe('3000000');
    expect(screen.queryByText('预计收到')).toBeNull();
    await tick(300);expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    current={...current,event_version:'4',settlement:{...current.settlement,outcome:4}};
    mocks.events.mockResolvedValueOnce({items:[{snapshot:current}],reset_required:false,next_version:'4'});
    await tick(1000);expect(mocks.create).toHaveBeenCalledTimes(2);
    const newIntent=mocks.create.mock.calls[1]![1] as CreateIntent;
    expect(newIntent.amount_in_raw).toBe('3000000');expect(newIntent.client_intent_id).not.toBe(firstID);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it('rebinds a recovered cancel request to the latest unsigned revision',async()=>{
    mocks.create.mockImplementation(async(_token:string,intent:CreateIntent)=>{
      current={...quoteFixture(intent.amount_in_raw),swap_id:intent.client_intent_id,intent};
      return current;
    });
    render(<FastSwapPage/>);await tick(0);
    fireEvent.change(screen.getByRole('textbox',{name:'投入原子金额'}),{target:{value:'2000000'}});
    await tick(300);
    const storageKey='smartx-fast-swap.v1.test-actor';
    const recovery=JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    recovery.pending_operation={kind:'cancel',swap_id:current.swap_id,expected_revision:'1',idempotency_key:'old-cancel-key',recovery_action:'get_snapshot'};
    localStorage.setItem(storageKey,JSON.stringify(recovery));
    current={...current,event_version:'2',revision:{...current.revision,revision:'2'},preparation:{status:4,current_revision:'2',retry_after_ms:null,reason_code:'quote_expired'}};
    act(()=>mocks.listeners.at(-1)?.(current));
    fireEvent.click(screen.getByRole('button',{name:'停止准备'}));
    await tick(0);
    expect(mocks.get).toHaveBeenCalledWith('test-session',current.swap_id,undefined);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.cancel.mock.calls[0]![2]).toBe('2');
    expect(mocks.cancel.mock.calls[0]![3]).not.toBe('old-cancel-key');
  });

  it('allows an unsigned swap to cancel after a definitive refresh recovery',async()=>{
    mocks.create.mockImplementation(async(_token:string,intent:CreateIntent)=>{
      current={...quoteFixture(intent.amount_in_raw),swap_id:intent.client_intent_id,intent};
      return current;
    });
    render(<FastSwapPage/>);await tick(0);
    fireEvent.change(screen.getByRole('textbox',{name:'投入原子金额'}),{target:{value:'2000000'}});
    await tick(300);
    const storageKey='smartx-fast-swap.v1.test-actor';
    const recovery=JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    recovery.pending_operation={kind:'refresh',swap_id:current.swap_id,expected_revision:'1',idempotency_key:'failed-refresh-key',recovery_action:'get_snapshot'};
    localStorage.setItem(storageKey,JSON.stringify(recovery));
    current={...current,event_version:'2',revision:{...current.revision,revision:'2'},preparation:{status:4,current_revision:'2',retry_after_ms:null,reason_code:'quote_expired'}};
    act(()=>mocks.listeners.at(-1)?.(current));
    fireEvent.click(screen.getByRole('button',{name:'停止准备'}));
    await tick(0);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.cancel.mock.calls[0]![2]).toBe('2');
    expect(mocks.cancel.mock.calls[0]![3]).not.toBe('failed-refresh-key');
  });

  it('greys an expired quote and safely refreshes the same swap after chain expiry',async()=>{
    mocks.create.mockImplementation(async(_token:string,intent:CreateIntent)=>{current={...quoteFixture(intent.amount_in_raw),swap_id:intent.client_intent_id,intent};return current;});
    render(<FastSwapPage/>);await tick(0);
    fireEvent.change(screen.getByRole('textbox',{name:'投入原子金额'}),{target:{value:'2000000'}});await tick(300);
    expect((screen.getByRole('button',{name:'确认、签名并执行'}) as HTMLButtonElement).disabled).toBe(false);
    const id=current.swap_id;
    await tick(8250);
    expect(mocks.refresh).not.toHaveBeenCalled();expect(mocks.sign).not.toHaveBeenCalled();
    mocks.expired.mockResolvedValue(true);await tick(2100);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);expect(mocks.refresh.mock.calls[0]![1]).toBe(id);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button',{name:'确认、签名并执行'}) as HTMLButtonElement).disabled).toBe(false);
  });

  it('ignores a late old revision when measuring the accepted signing window',async()=>{
    mocks.create.mockImplementation(async(_token:string,intent:CreateIntent)=>{current={...quoteFixture(intent.amount_in_raw),swap_id:intent.client_intent_id,intent};return current;});
    render(<FastSwapPage/>);await tick(0);
    fireEvent.change(screen.getByRole('textbox',{name:'投入原子金额'}),{target:{value:'2000000'}});await tick(300);
    const old=current;
    current={...current,event_version:'4',revision:{...current.revision,revision:'2'},preparation:{status:2,current_revision:'2',retry_after_ms:1000,reason_code:null}};
    act(()=>mocks.listeners.at(-1)?.(current));await tick(0);
    expect((screen.getByRole('button',{name:'确认、签名并执行'}) as HTMLButtonElement).disabled).toBe(false);
    await tick(500);
    act(()=>mocks.listeners.at(-1)?.(old));
    await tick(750);
    expect(screen.queryByRole('button',{name:'确认、签名并执行'})).toBeNull();
    expect(mocks.sign).not.toHaveBeenCalled();expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('records a signed artifact storage failure and never sends execution',async()=>{
    mocks.create.mockImplementation(async(_token:string,intent:CreateIntent)=>{current={...quoteFixture(intent.amount_in_raw),swap_id:intent.client_intent_id,intent};return current;});
    mocks.sign.mockResolvedValue('signed-base64');
    mocks.pendingWrite.mockResolvedValueOnce(false);
    render(<FastSwapPage/>);await tick(0);
    fireEvent.change(screen.getByRole('textbox',{name:'投入原子金额'}),{target:{value:'2000000'}});await tick(300);
    fireEvent.click(screen.getByRole('button',{name:'确认、签名并执行'}));await tick(0);
    expect(mocks.pendingWrite).toHaveBeenCalledTimes(1);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/签名已经完成.*无法保存完整恢复材料/);
    fireEvent.click(screen.getByRole('button',{name:'显示所选时间证据'}));
    const evidence=JSON.parse(screen.getByTestId('fastswap-timing-evidence').textContent ?? '{}');
    const points=evidence.runs[0].points;
    expect(points).toEqual(expect.arrayContaining([
      expect.objectContaining({stage:'artifact_persist_done',details:expect.objectContaining({saved:false})}),
      expect.objectContaining({stage:'sign_flow_error',details:expect.objectContaining({signature_produced:true})}),
    ]));
  });
});
