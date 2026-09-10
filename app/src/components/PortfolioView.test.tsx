import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {normalizePortfolio, PortfolioDataError, type PortfolioReply} from '@/api/portfolio';

const {state} = vi.hoisted(() => ({state: {data: undefined as PortfolioReply | undefined, error: undefined as Error | undefined}}));
vi.mock('swr', () => ({default: () => ({...state, isLoading: false, isValidating: false, mutate: vi.fn()})}));
vi.mock('@/session/storage', () => ({useSession: () => ({jwt: 'test-session'}), clearSite: vi.fn(), readSite: () => null}));
vi.mock('@/components/PortfolioActivity', () => ({PortfolioActivity: () => null}));
vi.mock('@/components/PortfolioCycles', () => ({ClosedPortfolioPositions: () => null, PortfolioCycleTrades: () => null}));
vi.mock('@/components/OpinionComposer', () => ({OpinionComposer: () => null}));
import {PortfolioView} from './PortfolioView';

describe('Portfolio deployed response presentation', () => {
  it('renders the account PnL curve from the same normalized Portfolio snapshot', () => {
    state.data = normalizePortfolio({positions: [], pnl: {d1: {amount_usd: '4', baseline_as_of: '2026-09-08T00:00:00Z', curve: [{at: '2026-09-09T00:00:00Z', pnl_usd: '0'}, {at: '2026-09-09T01:00:00Z', pnl_usd: '4'}]}}});
    const html = renderToStaticMarkup(<PortfolioView />);
    expect(html).toContain('PnL performance');
    expect(html).toContain('data-testid="pnl-segment"');
    expect(html).toContain('2026-09-08 08:00:00 UTC');
  });
  beforeEach(() => {state.data = undefined; state.error = undefined;});
  const row = {asset: {chain: 'solana', chain_id: 792703809, kind: 'spl', token_address: 'test-mint'}, shares_raw: '1250000', decimals: 6, symbol: 'EXAMPLE', logo: 'https://images.test/example.png', opened_entry_id: '4', cycle_status: 'ready', price_usd: '0.00000967', buy_value_usd: '2', avg_buy_price_usd: '0.0000016', pnl_ratio: '-0.25', market_value_usd: '0.00001209', cost_basis_usd: '2', realized_pnl_usd: '0', total_pnl_usd: '-1.99998791', unrealized_pnl_usd: '-1.99998791'};
  it('renders real positions and separate cash instead of the generic load failure', () => {
    state.data = normalizePortfolio({positions: [row], partial_errors: [], total_value_usd: '0.00001209', cash_balance_usd: '20', total_assets_usd: '20.00001209'});
    const html = renderToStaticMarkup(<PortfolioView />);
    expect(html).toContain('EXAMPLE');
    expect(html).toContain('src="https://images.test/example.png"');
    expect(html).toContain('Market price');
    expect(html).toContain('Shares');
    expect(html).toContain('Position value');
    expect(html).toContain('1.25');
    expect(html).toContain('$0.00001209');
    expect(html).toContain('ROI');
    expect(html).toContain('Total bought');
    expect(html).toContain('Avg buy / share');
    expect(html).toContain('-25%');
    expect(html).not.toContain('Cost basis</th>');
    expect(html).not.toContain('Unrealized</th>');
    expect(html).toContain('USDC cash');
    expect(html).toContain('Total assets');
    expect(html).toContain('Positions value');
    expect(html).not.toContain('Could not load portfolio');
    expect(html).not.toContain('Lifetime realized');
    expect(html).not.toContain('read directly from chain');
  });
  it('renders missing cash as unknown and keeps a valid position visible', () => {
    state.data = normalizePortfolio({positions: [row], partial_errors: [{chain: 'solana', reason: 'cash_unavailable'}], total_value_usd: '0.00001209', cash_balance_usd: '', total_assets_usd: ''});
    const html = renderToStaticMarkup(<PortfolioView />);
    expect(html).toContain('Partial portfolio');
    expect(html).toContain('EXAMPLE');
    expect(html).toContain('>—<');
  });
  it('shows actionable parser errors and their trace instead of hiding the cause', () => {
    state.error = new PortfolioDataError('Portfolio returned an invalid shares_raw.', 'trace-for-support');
    const html = renderToStaticMarkup(<PortfolioView />);
    expect(html).toContain('invalid shares_raw');
    expect(html).toContain('trace-for-support');
  });
  it('retains error details alongside an older successfully cached snapshot', () => {
    state.data = normalizePortfolio({positions: [row], partial_errors: []});
    state.error = new PortfolioDataError('Portfolio returned an invalid shares_raw.', 'refresh-trace');
    const html = renderToStaticMarkup(<PortfolioView />);
    expect(html).toContain('EXAMPLE');
    expect(html).toContain('invalid shares_raw');
    expect(html).toContain('refresh-trace');
  });
  it('does not present unready cycle gains as zero or allow an Opinion target', () => {
    state.data = normalizePortfolio({positions: [{...row, cycle_status: 'pending'}], partial_errors: []});
    const html = renderToStaticMarkup(<PortfolioView />);
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('>$0<');
  });
});
