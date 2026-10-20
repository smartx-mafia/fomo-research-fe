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

it('labels record-scope pure buys without presenting transfer-inclusive cost as cumulative buys', () => {
  data.mockReturnValue({pending: false, refresh: vi.fn(), holding: {state: 'closed', investedUSD: '20', buyAmountScope: 'record', transferIn: '8'}, trades: []});
  render(<SquarePositionDialog target={target} onClose={() => {}} />);
  expect(screen.getByText('记录买入金额')).toBeTruthy();
  expect(screen.queryByText('累计买入金额')).toBeNull();
  expect(screen.getByLabelText('持仓指标').textContent).toContain('$20');
});

const tcgObservation = {status: 'pending_source_refresh', buyCount: 3, sellCount: 2, firstObservedAt: '1792476282', lastObservedAt: '1792491982', metrics: {
  avg_sold_price: {value: '0.003957780340556271', status: 'available'},
  avg_bought_price: {value: '0.004290928769405355', status: 'available'},
  sold_usd: {value: '9999.989938', status: 'available'}, bought_usd: {value: '20000.01851945', status: 'available'},
  cash_flow_difference: {value: '-10000.02858145', status: 'available'},
}};
it('shows TCG observed average sell with its scope when the formal source has none', () => {
  data.mockReturnValue({pending: false, refresh: vi.fn(), holding: {state: 'open', pnlUSD: '-1370.90774356', observation: tcgObservation}, trades: []});
  render(<SquarePositionDialog target={{...target, kind: 'external_user', identifier: 'subject:180'}} onClose={() => {}} />);
  expect(screen.getByLabelText('持仓指标').textContent).toContain('平均卖出价（已记录交易）');
  expect(screen.getByLabelText('持仓指标').textContent).toContain('0.00395778');
  expect(screen.getByLabelText('已观测交易小计').textContent).toContain('已记录平均卖出价');
  expect(screen.getByLabelText('已观测交易小计').textContent).toContain('卖出 2 笔');
  expect(screen.getByLabelText('持仓指标').textContent).not.toContain('10,000.028');
});
it('prefers the formal source average and never fills a closed record from all-token observations', () => {
  data.mockReturnValue({pending: false, refresh: vi.fn(), holding: {state: 'open', avgSellPrice: '0', observation: tcgObservation}, trades: []});
  const props = {target: {...target, kind: 'external_user' as const, identifier: 'subject:180'}, onClose: () => {}};
  const view = render(<SquarePositionDialog {...props} />);
  expect(screen.getByLabelText('持仓指标').textContent).not.toContain('平均卖出价（已记录交易）');
  expect(screen.getByLabelText('持仓指标').textContent).not.toContain('0.00395778');
  data.mockReturnValue({pending: false, refresh: vi.fn(), holding: {state: 'closed', observation: tcgObservation}, trades: []});
  view.rerender(<SquarePositionDialog {...props} />);
  expect(screen.getByLabelText('持仓指标').textContent).not.toContain('0.00395778');
});
it('preserves unknown metric status instead of using old totals or showing zero', () => {
  data.mockReturnValue({pending: false, refresh: vi.fn(), holding: {state: 'pending', observation: {
    ...tcgObservation, boughtUSD: '987654321', metrics: {bought_usd: {status: 'unavailable'}, avg_sold_price: {status: 'truncated'}},
  }}, trades: []});
  render(<SquarePositionDialog target={{...target, kind: 'external_user', identifier: 'subject:180'}} onClose={() => {}} />);
  expect(screen.getByLabelText('已观测交易小计').textContent).not.toContain('987,654,321');
  expect(screen.getByLabelText('持仓指标').textContent).not.toContain('$0');
});
