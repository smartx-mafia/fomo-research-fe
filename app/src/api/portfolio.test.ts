import {beforeEach, describe, expect, it, vi} from 'vitest';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));

import {getGlobalPortfolioTrades, getPortfolio, normalizePortfolio, normalizePortfolioTradePage, positionTargetID} from './portfolio';

describe('portfolio contract', () => {
  beforeEach(() => callMock.mockReset());

  const position = {
    asset: {chain: 'solana', chain_id: 792703809, kind: 'spl', token_address: 'example-mint'},
    symbol: 'EXAMPLE', decimals: 6, shares_raw: '125094440507',
    opened_entry_id: '4', cycle_status: 'ready',
    cost_basis_usd: '2.00000000', market_value_usd: '0.00001209',
    realized_pnl_usd: '0.00000000', unrealized_pnl_usd: '-1.99998791',
    total_pnl_usd: '-1.99998791', pnl_ratio: '-0.999993955',
    avg_buy_price_usd: '0.00001598792074127455',
  };

  it('accepts the deployed flat ledger response and separates positions, cash and total assets', () => {
    const result = normalizePortfolio({
      total_value_usd: '0.00001209', cash_balance_usd: '20.00000000', total_assets_usd: '20.00001209',
      cash_observed_at: {seconds: 1788939800}, observed_at: {seconds: 1788939802},
      positions: [position], partial_errors: [],
    });
    expect(result).toMatchObject({total_value_usd: '0.00001209', cash_balance_usd: '20.00000000', total_assets_usd: '20.00001209'});
    expect(result.positions[0]).toMatchObject({shares_raw: '125094440507', opened_entry_id: '4', cost_basis_usd: '2.00000000', total_pnl_usd: '-1.99998791'});
    expect(result.positions[0]).not.toHaveProperty('amount_raw');
    expect(result.positions[0]).not.toHaveProperty('trade_basis');
    expect(result.positions[0]).not.toHaveProperty('sweep');
  });

  it('uses a cancellable current-portfolio read with exact identity decoding', async () => {
    callMock.mockResolvedValue({data: {positions: [position]}});
    const controller = new AbortController();
    await expect(getPortfolio('jwt', controller.signal)).resolves.toMatchObject({positions: [{opened_entry_id: '4'}]});
    const [url, options] = callMock.mock.calls[0];
    expect(url).toBe('/v1/portfolio');
    expect(options.bearer).toBe('jwt');
    expect(options.preserveInt64Fields).toEqual(['opened_entry_id', 'chain_id']);
    controller.abort();
    expect(options.signal.aborted).toBe(true);
  });

  it('preserves the response trace when schema validation fails', async () => {
    callMock.mockResolvedValue({traceID: 'schema-trace', data: {positions: [{...position, shares_raw: undefined, amount_raw: '1'}]}});
    await expect(getPortfolio('jwt')).rejects.toMatchObject({name: 'PortfolioDataError', traceID: 'schema-trace', message: 'Portfolio returned an invalid shares_raw.'});
  });

  it.each(['0', '-1', '1.5', '', 100, null])('rejects malformed ledger quantities %s', (shares_raw) => {
    expect(() => normalizePortfolio({positions: [{...position, shares_raw}]})).toThrow(/shares_raw/);
  });

  it('does not reinterpret old on-chain quantities as ledger shares', () => {
    const {shares_raw: _ignored, ...old} = position;
    expect(() => normalizePortfolio({positions: [{...old, amount_raw: '1000000'}]})).toThrow(/shares_raw/);
  });

  it('keeps missing cash/valuation unknown and accepts real zero cash and zero decimals', () => {
    const data = normalizePortfolio({cash_balance_usd: '0.00000000', total_value_usd: '', total_assets_usd: '', positions: [{...position, decimals: 0}], partial_errors: [{chain: 'solana', reason: 'metadata_or_price_unavailable'}]});
    expect(data.cash_balance_usd).toBe('0.00000000');
    expect(data.total_value_usd).toBeUndefined();
    expect(data.total_assets_usd).toBeUndefined();
    expect(data.positions[0].decimals).toBe(0);
    expect(normalizePortfolio({positions: [], partial_errors: []}).cash_balance_usd).toBeUndefined();
  });

  it.each(['pending', 'unavailable', 'future-status'])('hides unready cycle aggregates for %s while preserving shares and remaining cost', (cycle_status) => {
    const row = normalizePortfolio({positions: [{...position, cycle_status}]}).positions[0];
    expect(row.shares_raw).toBe(position.shares_raw);
    expect(row.cost_basis_usd).toBe(position.cost_basis_usd);
    expect(row.total_pnl_usd).toBeUndefined();
    expect(row.avg_buy_price_usd).toBeUndefined();
    expect(positionTargetID(row)).toBeUndefined();
  });

  it('requires a trustworthy cycle identity even if the source labels it ready', () => {
    const row = normalizePortfolio({positions: [{...position, opened_entry_id: 0}]}).positions[0];
    expect(row.cycle_status).toBe('unavailable');
    expect(row.realized_pnl_usd).toBeUndefined();
    expect(positionTargetID(row)).toBeUndefined();
  });

  it('keeps exact large cycle IDs and uses them for Opinion targets', () => {
    const row = normalizePortfolio({positions: [{...position, opened_entry_id: '9007199254740993'}]}).positions[0];
    expect(positionTargetID(row)).toBe('792703809:spl:example-mint:9007199254740993');
    expect(positionTargetID({...row, asset: {...row.asset, kind: 'spl:bad'}})).toBeUndefined();
    expect(() => normalizePortfolio({positions: [{...position, opened_entry_id: Number.MAX_SAFE_INTEGER + 1}]})).toThrow(/opened_entry_id/);
  });

  it.each(['NaN', '1e-12', 123, Infinity])('rejects malformed money %s instead of silently clearing it', (value) => {
    expect(() => normalizePortfolio({positions: [], total_assets_usd: value})).toThrow(/total_assets_usd/);
  });

  it('handles zero timestamp and zero-expanded pnl without fabricating data', () => {
    expect(normalizePortfolio({positions: [], observed_at: {seconds: 0}, cash_observed_at: {seconds: 0}, pnl: {d1: {amount_usd: '', curve: []}, all_usd: ''}})).toMatchObject({
      positions: [], partial_errors: [], observed_at: undefined, cash_observed_at: undefined, pnl: undefined,
    });
    expect(() => normalizePortfolio({positions: {}})).toThrow(/array/);
    expect(() => normalizePortfolio({positions: [], partial_errors: [{}]})).toThrow(/partial error/);
  });

  it('loads global real trades with all cycle scope parameters omitted and an exact cursor', async () => {
    callMock.mockResolvedValue({data: {trades: [], next_cursor: '0'}});
    await expect(getGlobalPortfolioTrades('jwt', '9007199254740997', 50)).resolves.toEqual({trades: [], next_cursor: undefined});
    expect(callMock).toHaveBeenCalledWith('/v1/portfolio/position/trades?limit=50&before_id=9007199254740997', {
      bearer: 'jwt', signal: undefined, preserveInt64Fields: ['next_cursor', 'cycle_opened_entry_id'],
    });
  });

  it('normalizes exact global trade fields without inventing USD values or missing amounts', () => {
    expect(normalizePortfolioTradePage({
      trades: [{
        trade_id: 'trade-1', side: 'buy', chain: 'solana', token: 'mint', quote_token: 'usdc',
        amount_in_actual: '900719925474099312345', amount_out: '', status: 'SUCCESS', lifecycle: 'confirmed',
        tx_hash: 'sig', tx_chain: 'solana', created_at: '2026-09-08T01:02:03Z', confirmed_at: '',
        fee_app: '1234', fee_currency: 'usdc', cycle_opened_entry_id: '9007199254740995',
        cycle_key: 'cycle-v2', logo: 'https://images.test/mint.png', symbol: 'MINT', name: 'Mint Token',
        token_amount: '123.456', trade_value_usd: '10.50000000', execution_price_usd: '0.08505060728744939271', asset_decimals: 6,
      }],
      next_cursor: '9007199254740993',
    })).toEqual({
      trades: [{
        trade_id: 'trade-1', side: 'buy', chain: 'solana', token: 'mint', quote_token: 'usdc',
        amount_in_actual: '900719925474099312345', amount_out: undefined, status: 'SUCCESS', lifecycle: 'confirmed',
        tx_hash: 'sig', tx_chain: 'solana', created_at: '2026-09-08T01:02:03Z', confirmed_at: undefined,
        fee_app: '1234', fee_currency: 'usdc', cycle_opened_entry_id: '9007199254740995',
        cycle_key: 'cycle-v2', logo: 'https://images.test/mint.png', symbol: 'MINT', name: 'Mint Token',
        token_amount: '123.456', trade_value_usd: '10.50000000', execution_price_usd: '0.08505060728744939271', asset_decimals: 6,
      }],
      next_cursor: '9007199254740993',
    });
  });

  it('rejects malformed global trade identities, amounts, and incomplete fee pairs', () => {
    const base = {trade_id: 't', side: 'sell', chain: 'base', token: '0xt', quote_token: '0xq', status: 'SUCCESS', lifecycle: 'included', created_at: '2026-09-08T01:02:03Z', cycle_opened_entry_id: 0};
    expect(() => normalizePortfolioTradePage({trades: [{...base, amount_out: '1.5'}]})).toThrow(/amount_out/);
    expect(() => normalizePortfolioTradePage({trades: [{...base, fee_app: '1'}]})).toThrow(/incomplete trade fee/);
    expect(() => normalizePortfolioTradePage({trades: [{...base, cycle_opened_entry_id: Number.MAX_SAFE_INTEGER + 1}]})).toThrow(/cycle_opened_entry_id/);
    expect(() => normalizePortfolioTradePage({trades: [{...base, token_amount: '1e3'}]})).toThrow(/token_amount/);
    expect(() => normalizePortfolioTradePage({trades: [{...base, execution_price_usd: 'NaN'}]})).toThrow(/execution_price_usd/);
    expect(() => normalizePortfolioTradePage({trades: [{...base, asset_decimals: 256}]})).toThrow(/asset_decimals/);
  });
});
