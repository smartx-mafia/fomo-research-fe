// @vitest-environment jsdom
import React from 'react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {SWRConfig} from 'swr';
const api = vi.hoisted(() => ({platform: vi.fn(), portfolio: vi.fn(), wallet: vi.fn(), userTrades: vi.fn(), positionTrades: vi.fn()}));
vi.mock('@/api/platform-holdings', () => ({getPlatformHoldings: api.platform}));
vi.mock('@/api/platform-trades', async (original) => ({...await original<object>(), getPlatformUserTrades: api.userTrades, getPlatformUserPositionTrades: api.positionTrades}));
vi.mock('@/api/user-portfolio', () => ({getUserPortfolio: api.portfolio}));
vi.mock('./SmartMoneyProfile', async (original) => ({...await original<object>(), SmartMoneyProfile: (props: {chain: string; address: string; backHref: string}) => {api.wallet(props); return <p>Wallet {props.chain}</p>;}}));
vi.mock('./SmartMoneyTokenFdv', () => ({SmartMoneyTokenFdv: () => <span>FDV</span>}));
import {LeaderboardDetailView} from './LeaderboardDetailView';
import {ApiError} from '@/api/envelope';
import type {LeaderboardDetailTarget} from '@/lib/leaderboard-detail';

function mount(target: LeaderboardDetailTarget) {return render(<SWRConfig value={{provider: () => new Map(), dedupingInterval: 0}}><LeaderboardDetailView target={target} /></SWRConfig>);}
beforeEach(() => {
  vi.clearAllMocks();
  api.userTrades.mockResolvedValue({list: [], next_cursor: '', wallets: []});
  api.positionTrades.mockResolvedValue({list: [], coverage: 'complete'});
});
afterEach(cleanup);

it.each(['fomo', 'pump'] as const)('loads %s user holdings and filters rows without changing full-user PnL', async (platform) => {
  const token = {token_address: 'mint', symbol: 'COIN', name: '', logo: '', balance: '0', usd_value: '0', cost: '', realized_profit: '-2', unrealized_profit: '3', snapshot_at: 1789542645};
  api.platform.mockResolvedValue({open: [{...token, chain: 'sol'}, {...token, chain: 'base', symbol: 'OTHER'}], closed: [], wallets: [], coverage: 'partial', stale: true, pnl_windows: [{window: 'all', total_profit: '123', username: 'Alice'}]});
  mount({type: 'external_user', platform, id: 'subject:3'});
  await screen.findByText('Alice');
  expect(api.platform).toHaveBeenCalledWith(platform, 'subject:3');
  expect(api.portfolio).not.toHaveBeenCalled();
  expect(api.wallet).not.toHaveBeenCalled();
  expect(screen.getByText(/持仓数据不完整/)).toBeTruthy();
  expect(screen.getByText(/部分持仓数据更新延迟/)).toBeTruthy();
  expect(screen.getByText('OTHER')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name: 'Solana'}));
  expect(screen.queryByText('OTHER')).toBeNull();
  expect(screen.getByText('$123')).toBeTruthy();
  expect(screen.getByText('COIN')).toBeTruthy();
  expect(screen.getByRole('link', {name: '← 返回统一榜单'}).getAttribute('href')).toBe('/leaderboard#unified');
});

it('switches GMGN chains without sending all to the existing wallet profile', async () => {
  mount({type: 'wallet', address: '0xAbC', namespace: 'evm', chains: ['base', 'bsc']});
  expect(api.wallet).toHaveBeenLastCalledWith({chain: 'base', address: '0xAbC', backHref: '/leaderboard#unified'});
  fireEvent.click(screen.getByRole('button', {name: 'BNB'}));
  await waitFor(() => expect(api.wallet).toHaveBeenLastCalledWith({chain: 'bsc', address: '0xAbC', backHref: '/leaderboard#unified'}));
  expect(api.platform).not.toHaveBeenCalled();
});

it('loads the selected SmartX user rather than the logged-in account', async () => {
  api.portfolio.mockResolvedValue({positions: [], partial_errors: [], total_value_usd: '0'});
  mount({type: 'smartx_user', id: 'other-user'});
  await screen.findByText('暂无持仓记录。');
  expect(api.portfolio).toHaveBeenCalledWith('other-user');
  expect(api.platform).not.toHaveBeenCalled();
});

it('does not label an unavailable external portfolio as empty', async () => {
  api.platform.mockRejectedValue(new Error('unavailable'));
  mount({type: 'external_user', platform: 'fomo', id: 'subject:3'});
  await screen.findByRole('alert');
  expect(screen.queryByText('暂无持仓记录。')).toBeNull();
});

it('uses backend position classes, lifetime ROI and expanded buy/sell fields', async () => {
  const token = {token_address: 'same-address', symbol: 'OPEN', name: 'Open token', logo: '', balance: '0', usd_value: '42', total_profit: '30', history_bought_cost: '100', roi: '9', realized_profit: '10', unrealized_profit: '20', realized_profit_pnl: '0.1', unrealized_profit_pnl: '0.2', avg_bought_price: '2', launchpad: 'pump', avg_cost_market_cap_usd: '1000', valuation_consistent: false};
  api.platform.mockResolvedValue({open: [{...token, chain: 'sol'}, {...token, chain: 'base', symbol: 'SECOND'}], closed: [{...token, chain: 'sol', symbol: 'CLOSED', history_sold_income: '120', history_sold_amount: '40', last_active_at: 1789558500}], wallets: [], coverage: 'complete', stale: false, pnl_windows: []});
  api.positionTrades.mockResolvedValue({list: [{tx_hash: '0xleg', event_type: 'sell', occurred_at: 1789550000, token_amount: '12', cost_usd: '34', price_usd: '2.8', legs: 2, round: 3, round_close: true, wallet_address: '0xWalletA'}], coverage: 'partial'});
  mount({type: 'external_user', platform: 'fomo', id: 'subject:3'});
  await screen.findByText('OPEN');
  expect(screen.getAllByText('30.00%')).toHaveLength(2);
  expect(screen.queryByText('900.00%')).toBeNull();
  expect(screen.getAllByText('10%')).toHaveLength(2);
  fireEvent.click(screen.getByText('OPEN'));
  expect(screen.getAllByText('累积买入')).toHaveLength(1);
  expect(screen.getByText(/估值数据存在差异/)).toBeTruthy();
  fireEvent.click(screen.getByText('SECOND'));
  expect(screen.getAllByText('累积买入')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', {name: '已清仓 1'}));
  expect(screen.queryByText('OPEN')).toBeNull();
  fireEvent.click(screen.getByText('CLOSED'));
  expect(screen.getByText('$120')).toBeTruthy();
  expect(screen.getByText('$3')).toBeTruthy();
  expect(screen.getByText('卖出均价')).toBeTruthy();
  await screen.findByText('$34');
  expect(api.positionTrades).toHaveBeenCalledWith('subject:3', 'base:same-address');
  expect(api.positionTrades).toHaveBeenCalledWith('subject:3', 'sol:same-address');
  expect(screen.getByText('清仓')).toBeTruthy();
  expect(screen.getByText(/交易覆盖不完整/)).toBeTruthy();
});

it('loads user-level trades in the trades tab and appends the next cursor page', async () => {
  const token = {token_address: 'mint', symbol: 'COIN', name: '', logo: '', balance: '1', usd_value: '5', realized_profit: '0', unrealized_profit: '0', snapshot_at: 1789542645};
  api.platform.mockResolvedValue({open: [{...token, chain: 'sol'}], closed: [], wallets: [], coverage: 'complete', stale: false, pnl_windows: []});
  const firstPage = {list: [{tx_hash: '0xfirst', event_type: 'buy', occurred_at: 1789550000, token_address: 'mint', token_symbol: 'COIN', cost_usd: '11', chain: 'sol', wallet_address: '0xWalletA'}], next_cursor: 'CURSOR1', wallets: [{chain: 'sol', address: '0xWalletA', coverage: 'complete', truncated: false}]};
  const secondPage = {list: [{tx_hash: '0xsecond', event_type: 'sell', occurred_at: 1789540000, token_address: 'mint', token_symbol: 'COIN', cost_usd: '22', chain: 'base', wallet_address: '0xWalletB'}], next_cursor: '', wallets: [{chain: 'base', address: '0xWalletB', coverage: 'partial', truncated: false}]};
  api.userTrades.mockImplementation(async (_id: string, cursor: string) => cursor ? secondPage : firstPage);
  mount({type: 'external_user', platform: 'pump', id: 'subject:9'});
  await screen.findByText('COIN');
  fireEvent.click(await screen.findByRole('button', {name: '交易 1'}));
  await screen.findByText('$11');
  expect(api.userTrades).toHaveBeenCalledWith('subject:9', '');
  expect(screen.getByText('0xWalletA')).toBeTruthy();
  expect(screen.queryByRole('button', {name: 'Solana'})).toBeNull();
  fireEvent.click(screen.getByRole('button', {name: '加载更多'}));
  await screen.findByText('$22');
  expect(api.userTrades).toHaveBeenCalledWith('subject:9', 'CURSOR1');
  expect(screen.getByText('0xWalletB')).toBeTruthy();
  expect(screen.getByText(/部分钱包的交易覆盖不完整/)).toBeTruthy();
  expect(screen.queryByRole('button', {name: '加载更多'})).toBeNull();
});

it('passes the backend position ID back verbatim instead of rebuilding chain:token', async () => {
  const token = {token_address: 'mint', symbol: 'PID', name: '', logo: '', balance: '1', usd_value: '5', realized_profit: '0', unrealized_profit: '0', chain: 'sol', position_id: 'sol@v2:mint'};
  api.platform.mockResolvedValue({open: [token], closed: [], wallets: [], coverage: 'complete', stale: false, pnl_windows: []});
  api.positionTrades.mockResolvedValue({list: [], coverage: 'complete'});
  mount({type: 'external_user', platform: 'fomo', id: 'subject:3'});
  await screen.findByText('PID');
  fireEvent.click(screen.getByText('PID'));
  await waitFor(() => expect(api.positionTrades).toHaveBeenCalledWith('subject:3', 'sol@v2:mint'));
  expect(api.positionTrades).not.toHaveBeenCalledWith('subject:3', 'sol:mint');
});

it('restarts from the first trade page when the backend rejects an expired cursor', async () => {
  const token = {token_address: 'mint', symbol: 'COIN', name: '', logo: '', balance: '1', usd_value: '5', realized_profit: '0', unrealized_profit: '0', chain: 'sol'};
  api.platform.mockResolvedValue({open: [token], closed: [], wallets: [], coverage: 'complete', stale: false, pnl_windows: []});
  const page = {list: [{tx_hash: '0xfirst', event_type: 'buy', occurred_at: 1789550000, token_address: 'mint', token_symbol: 'COIN', cost_usd: '11', chain: 'sol', wallet_address: '0xWalletA'}], next_cursor: 'EXPIRED', wallets: []};
  api.userTrades.mockImplementation(async (_id: string, cursor: string) => {
    if (cursor) throw new ApiError('business', 100110, 'smdetail invalid param', 'BIZ_SMDETAIL_INVALID_PARAM');
    return page;
  });
  mount({type: 'external_user', platform: 'fomo', id: 'subject:7'});
  await screen.findByText('COIN');
  fireEvent.click(await screen.findByRole('button', {name: '交易 1'}));
  await screen.findByText('$11');
  fireEvent.click(screen.getByRole('button', {name: '加载更多'}));
  await waitFor(() => expect(api.userTrades.mock.calls.filter(([, cursor]) => cursor === '').length).toBeGreaterThanOrEqual(2));
  expect(api.userTrades).toHaveBeenCalledWith('subject:7', 'EXPIRED');
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByText('$11')).toBeTruthy();
});

it('does not restart endlessly when the first trade page itself is rejected as invalid', async () => {
  const token = {token_address: 'mint', symbol: 'COIN', name: '', logo: '', balance: '1', usd_value: '5', realized_profit: '0', unrealized_profit: '0', chain: 'sol'};
  api.platform.mockResolvedValue({open: [token], closed: [], wallets: [], coverage: 'complete', stale: false, pnl_windows: []});
  api.userTrades.mockRejectedValue(new ApiError('business', 100110, 'smdetail invalid param', 'BIZ_SMDETAIL_INVALID_PARAM'));
  mount({type: 'external_user', platform: 'fomo', id: 'subject:8'});
  await screen.findByText('COIN');
  fireEvent.click(await screen.findByRole('button', {name: '交易 0'}));
  await screen.findByText(/交易加载失败/);
  expect(api.userTrades).toHaveBeenCalledTimes(1);
});
