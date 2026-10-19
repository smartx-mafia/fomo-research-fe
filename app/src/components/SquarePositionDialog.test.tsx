// @vitest-environment jsdom
import React from 'react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
const {data} = vi.hoisted(() => ({data: vi.fn()}));
vi.mock('@/hooks/useSquarePositionData', () => ({useSquarePositionData: data}));
vi.mock('@/session/storage', () => ({useSession: () => null}));
vi.mock('@/components/TokenAvatar', () => ({TokenAvatar: () => <span />}));
vi.mock('next/dynamic', () => ({default: () => function Chart() {return <div>Price chart</div>;}}));
import {SquarePositionDialog} from './SquarePositionDialog';
import {ApiError} from '@/api/envelope';
const target = {kind: 'user', identifier: 'alice', name: 'Alice', chain: 'bsc', address: '0xabc', symbol: 'COIN', cycleKey: 'old-cycle'} as const;
beforeEach(() => {data.mockReturnValue({pending: false, historyPending: false, refresh: vi.fn(), trades: []});});
afterEach(() => {cleanup(); vi.resetAllMocks();});
it('opens immediately with placeholders, traps modal focus and closes through the close control', () => {
  data.mockReturnValue({pending: true, historyPending: true, refresh: vi.fn()});
  const close = vi.fn();
  render(<SquarePositionDialog target={target} onClose={close} />);
  expect(screen.getByRole('dialog', {name: '持仓详情'})).toBeTruthy();
  expect(screen.getByText('正在读取作者持仓…')).toBeTruthy();
  expect(screen.getByLabelText('持仓指标').textContent).not.toContain('$0');
  fireEvent.click(screen.getByRole('button', {name: '关闭持仓详情'}));
  expect(close).toHaveBeenCalledOnce();
});
it('uses the closed layout and never exposes a current valuation or price for a historical cycle', () => {
  data.mockReturnValue({pending: false, refresh: vi.fn(), holding: {state: 'closed', valueUSD: '999', currentPrice: '9', pnlUSD: '-2', ratio: '-0.25', investedUSD: '8'}, trades: [{event: 'transfer_in', amountUSD: undefined, priceUSD: undefined}, {event: 'buy', amountUSD: '0', priceUSD: undefined}]});
  render(<SquarePositionDialog target={target} onClose={() => {}} />);
  expect(screen.getByText('平台用户 · 已平仓')).toBeTruthy();
  expect(screen.getByLabelText('持仓指标').textContent).not.toContain('999');
  expect(screen.getByText('-25%')).toBeTruthy();
  expect(screen.getByText('TRANSFER_IN')).toBeTruthy();
  expect(screen.getByLabelText('持仓交易历史').textContent).toContain('$0');
  expect(screen.getByLabelText('持仓交易历史').textContent).toContain('@ —');
});
it('hides retained amounts and history after authentication expires', () => {
  data.mockReturnValue({pending: false, refresh: vi.fn(), holding: {state: 'open', valueUSD: '123456', pnlUSD: '888'}, trades: [{event: 'buy', amountUSD: '333'}], positionError: new ApiError('business', 400000, 'expired')});
  render(<SquarePositionDialog target={target} onClose={() => {}} />);
  expect(screen.getByRole('alert').textContent).toContain('登录已过期');
  expect(screen.queryByLabelText('持仓指标')).toBeNull();
  expect(screen.queryByLabelText('持仓交易历史')).toBeNull();
});
it('labels a provisional smart-money position as awaiting a rescan and displays observations separately', () => {
  data.mockReturnValue({pending: false, refresh: vi.fn(), holding: {state: 'pending', observation: {status: 'pending_source_refresh', boughtUSD: '45400.20', boughtQuantity: '7', soldUSD: undefined}}, trades: []});
  render(<SquarePositionDialog target={{...target, kind: 'external_user', identifier: 'subject:171379'}} onClose={() => {}} />);
  expect(screen.getByText('聪明钱 · 待回扫确认')).toBeTruthy();
  expect(screen.queryByText('聪明钱 · 持仓中')).toBeNull();
  expect(screen.queryByText('聪明钱 · 已平仓')).toBeNull();
  expect(screen.getByLabelText('已观测交易小计').textContent).toContain('不代表完整历史累计');
  expect(screen.getByLabelText('已观测交易小计').textContent).toContain('$45,400.2');
  expect(screen.getByLabelText('持仓指标').textContent).not.toContain('$');
});

it('requires a closed record selection, keeps metrics separate and invalidates a replaced snapshot', () => {
  const records = [
    {key: 'snapshot1:new', at: '1792422045', holding: {state: 'closed', pnlUSD: '12', avgSellPrice: '3', ratio: '0.5'}},
    {key: 'snapshot1:old', at: '1791995586', holding: {state: 'closed', pnlUSD: '-4', avgSellPrice: undefined, ratio: '-0.25'}},
  ];
  const result = {pending: false, refresh: vi.fn(), closedRecords: records, trades: []};
  data.mockReturnValue(result);
  const props = {target: {...target, kind: 'external_user' as const, identifier: 'subject:137185'}, onClose: () => {}};
  const view = render(<SquarePositionDialog {...props} />);
  const selector = screen.getByLabelText('已平仓记录（2）');
  expect(screen.getByLabelText('持仓指标').textContent).not.toContain('$');
  fireEvent.change(selector, {target: {value: records[0].key}});
  expect(screen.getByLabelText('持仓指标').textContent).toContain('+$12');
  expect(screen.getByLabelText('持仓指标').textContent).toContain('$3');
  fireEvent.change(selector, {target: {value: records[1].key}});
  expect(screen.getByLabelText('持仓指标').textContent).toContain('-$4');
  expect(screen.getByLabelText('持仓指标').textContent).not.toContain('$3');
  data.mockReturnValue({...result, closedRecords: records.map((record) => ({...record, key: record.key.replace('snapshot1', 'snapshot2')}))});
  view.rerender(<SquarePositionDialog {...props} />);
  expect(screen.getByLabelText('持仓指标').textContent).not.toContain('$');
  expect((screen.getByLabelText('已平仓记录（2）') as HTMLSelectElement).value).toBe('');
});
