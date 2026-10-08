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
