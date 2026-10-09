// @vitest-environment jsdom
import React from 'react';
import {afterEach, expect, it} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import {SmartMoneyAccountingNote} from './SmartMoneyAccountingNote';
import {unrealizedLabel} from '@/api/smartmoney-accounting';
afterEach(cleanup);
it('keeps unavailable and source observation times visible without implying replay', () => {
 render(<SmartMoneyAccountingNote accounting={{source:'gmgn',method:'source_snapshot',as_of:'2026-10-08T00:00:00Z',balance_as_of:'2026-10-07T23:59:00Z',total_status:'unavailable',continuation_status:'pending',stale:true}} />);
 expect(screen.getByText(/金额未知/)).toBeTruthy();
 expect(screen.getByText(/起点快照/)).toBeTruthy();
 expect(screen.getByText(/2026-10-07T23:59:00Z/)).toBeTruthy();
 expect(screen.getByText(/不会用旧金额补齐/)).toBeTruthy();
});
it('labels canonical period U as change, and leaves ALL as current U',()=>{
 expect(unrealizedLabel('7d',{source:'gmgn'})).toBe('未实现变化');
 expect(unrealizedLabel('all',{source:'gmgn'})).toBe('当前未实现');
 expect(unrealizedLabel('7d')).toBe('未实现');
});

it('labels a partial window subtotal by its actual coverage and explains capture gaps', () => {
 render(<SmartMoneyAccountingNote accounting={{source:'gmgn',method:'future_method',window_status:'warming_up',effective_from:'2026-10-09T01:00:00Z',since_baseline_total:'0',reasons:['history_limit_suspected:bsc','current_inventory_limit_suspected:bsc','changed_during_capture:bsc']}} />);
 expect(screen.getByText(/计算方式待确认/)).toBeTruthy();
 expect(screen.getByText(/实际覆盖开始：2026-10-09T01:00:00Z；当前片段小计 \$0/)).toBeTruthy();
 expect(screen.queryByText(/接入以来/)).toBeNull();
 expect(screen.getByText('bsc：当前资产可能尚未收全。')).toBeTruthy();
 expect(screen.getByText('bsc：采集期间持仓发生变化，仍需核对。')).toBeTruthy();
});

it('keeps source window realized, current U and source ALL separate and filters the chain scope', () => {
 render(<SmartMoneyAccountingNote scopeChain="ethereum" showReferences accounting={{source:'gmgn',source_references:[
  {chain:'eth',window:'7d',realized_profit_usd:'100',current_unrealized_profit_usd:'20',authoritative_total_profit_usd:'999',observed_at:'2026-10-09T00:00:00Z'},
  {chain:'bsc',window:'7d',realized_profit_usd:'300',current_unrealized_profit_usd:'40',authoritative_total_profit_usd:'888'},
 ]}} />);
 expect(screen.getByText(/窗口内已实现 \$100 · 当前浮盈 \$20 · 该链全部收益 \$999/)).toBeTruthy();
 expect(screen.queryByText(/\$120/)).toBeNull();
 expect(screen.queryByText(/\$888/)).toBeNull();
});
