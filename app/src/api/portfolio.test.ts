import {beforeEach, describe, expect, it, vi} from 'vitest';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));

import {getGlobalPortfolioTrades, getPortfolio, normalizePortfolio, normalizePortfolioTradePage, positionTargetID} from './portfolio';

describe('portfolio contract', () => {
  beforeEach(() => callMock.mockReset());

  it('loads only the authenticated current-portfolio endpoint', async () => {
    callMock.mockResolvedValue({data: {positions: []}});
    await expect(getPortfolio('jwt')).resolves.toMatchObject({positions: [], partial_errors: []});
    expect(callMock).toHaveBeenCalledWith('/v1/portfolio', {bearer: 'jwt', signal: undefined});
  });

  it('preserves exact strings, zero decimals, timestamp objects, and optional current-cycle data', () => {
    const result = normalizePortfolio({
      total_value_usd: '21.75000000',
      positions: [{
        asset: {chain: 'bsc', chain_id: 56, kind: 'erc20', token_address: '0x1111111111111111111111111111111111111111'},
        symbol: 'MEME',
        decimals: 0,
        amount_raw: '37000000000000000000',
        price_usd: '0.250000000000',
        price_as_of: {seconds: 1788595200},
        trade_basis: {status: 1, cost_basis_usd: '10.00000000', realized_pnl_usd: '2.00000000'},
        current_cycle: {opened_entry_id: 9081, realized_pnl_usd: '1.50000000', buy_value_usd: '10.00000000'},
      }],
      observed_at: {seconds: '1788595202'},
    });
    expect(result.total_value_usd).toBe('21.75000000');
    expect(result.positions[0]).toMatchObject({
      decimals: 0,
      amount_raw: '37000000000000000000',
      current_cycle: {opened_entry_id: 9081, realized_pnl_usd: '1.50000000'},
    });
    expect(result.observed_at?.seconds).toBe('1788595202');
  });

  it('treats omitted repeated fields as empty arrays and keeps partial failures explicit', () => {
    expect(normalizePortfolio({partial_errors: [{chain: 'ethereum', reason: 'chain_unavailable', retryable: true}]})).toMatchObject({
      positions: [],
      partial_errors: [{chain: 'ethereum', reason: 'chain_unavailable', retryable: true}],
    });
  });

  it('rejects malformed base-unit balances rather than rendering fabricated values', () => {
    expect(() => normalizePortfolio({positions: [{
      asset: {chain: 'bsc', chain_id: 56, kind: 'erc20', token_address: '0x1'},
      amount_raw: '1.5',
    }]})).toThrow(/invalid position identity or balance/);
  });

  it('rejects malformed financial decimals before they reach render-time arithmetic', () => {
    expect(() => normalizePortfolio({total_value_usd: 'NaN', positions: []})).toThrow(
      /invalid decimal for total_value_usd/,
    );
  });

  it('rejects malformed repeated fields and zero-balance rows instead of presenting an empty or valid portfolio', () => {
    expect(() => normalizePortfolio({positions: {}})).toThrow(/positions must be an array/);
    expect(() => normalizePortfolio({partial_errors: [{}]})).toThrow(/invalid partial error/);
    expect(() => normalizePortfolio({positions: [{
      asset: {chain: 'bsc', chain_id: 56, kind: 'erc20', token_address: '0x1'},
      amount_raw: '0',
    }]})).toThrow(/invalid position identity or balance/);
  });

  it('bounds decimals to the formatter range and requires a positive exact current-cycle identity', () => {
    const base = {
      asset: {chain: 'bsc', chain_id: 56, kind: 'erc20', token_address: '0x1'},
      amount_raw: '1',
    };
    expect(normalizePortfolio({positions: [{...base, decimals: 256}]}).positions[0]?.decimals).toBeUndefined();
    for (const opened_entry_id of [-1, 1.5, '', '-1', '1.5', 'abc']) {
      expect(() => normalizePortfolio({positions: [{...base, current_cycle: {opened_entry_id}}]})).toThrow(
        /invalid current-cycle identity/,
      );
    }
    expect(normalizePortfolio({positions: [{...base, current_cycle: {opened_entry_id: '9007199254740993'}}]}).positions[0]?.current_cycle?.opened_entry_id).toBe('9007199254740993');
  });

  it('folds rule-10 zero expansions back to absent: zero cycle, zero basis/sweep status, zero timestamps, empty pnl', () => {
    const result = normalizePortfolio({
      positions: [{
        asset: {chain: 'bsc', chain_id: 56, kind: 'erc20', token_address: '0x1'},
        amount_raw: '1',
        price_as_of: {seconds: 0, nanos: 0},
        trade_basis: {status: 0, ledger_amount_raw: '', cost_basis_usd: '', realized_pnl_usd: ''},
        sweep: {status: 0, min_amount_raw: ''},
        current_cycle: {opened_entry_id: 0, realized_pnl_usd: '', buy_value_usd: '', round: 0},
      }],
      pnl: {d1: {amount_usd: '', baseline_as_of: '', curve: []}, d7: {}, d30: {}, all: {}},
      observed_at: {seconds: 0, nanos: 0},
    });
    const row = result.positions[0];
    expect(row?.current_cycle).toBeUndefined();
    expect(row?.trade_basis).toBeUndefined();
    expect(row?.sweep).toBeUndefined();
    expect(row?.price_as_of).toBeUndefined();
    expect(result.pnl).toBeUndefined();
    expect(result.observed_at).toBeUndefined();
  });

  it('normalizes the current-cycle round: omitted or zero means not ready, invalid values throw', () => {
    const base = {
      asset: {chain: 'bsc', chain_id: 56, kind: 'erc20', token_address: '0x1'},
      amount_raw: '1',
    };
    expect(normalizePortfolio({positions: [{...base, current_cycle: {opened_entry_id: 1}}]}).positions[0]?.current_cycle?.round).toBeUndefined();
    expect(normalizePortfolio({positions: [{...base, current_cycle: {opened_entry_id: 1, round: 0}}]}).positions[0]?.current_cycle?.round).toBeUndefined();
    expect(normalizePortfolio({positions: [{...base, current_cycle: {opened_entry_id: 1, round: 2}}]}).positions[0]?.current_cycle?.round).toBe(2);
    for (const round of [-1, 1.5]) {
      expect(() => normalizePortfolio({positions: [{...base, current_cycle: {opened_entry_id: 1, round}}]})).toThrow(
        /invalid current-cycle round/,
      );
    }
  });

  it('builds the POSITION target id from the trade round identity (opened_entry_id), not the display round', () => {
    const base = {
      asset: {chain: 'bsc', chain_id: 56, kind: 'erc20', token_address: '0xabc'},
      amount_raw: '1',
      current_cycle: {opened_entry_id: 9081, round: 3},
    };
    expect(positionTargetID(base)).toBe('56:erc20:0xabc:9081');
    expect(positionTargetID({...base, asset: {...base.asset, chain_id: '056'}})).toBe('56:erc20:0xabc:9081');
    expect(positionTargetID({...base, current_cycle: {opened_entry_id: '09081', round: 3}})).toBe('56:erc20:0xabc:9081');
    expect(positionTargetID({...base, current_cycle: undefined})).toBeUndefined();
    expect(positionTargetID({...base, current_cycle: {opened_entry_id: 0, round: 3}})).toBeUndefined();
    expect(positionTargetID({...base, current_cycle: {opened_entry_id: 9081, round: 0}})).toBe('56:erc20:0xabc:9081');
    expect(positionTargetID({...base, asset: {...base.asset, token_address: '0x:abc'}})).toBeUndefined();
    expect(positionTargetID({...base, asset: {...base.asset, kind: 'erc:20'}})).toBeUndefined();
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
      }],
      next_cursor: '9007199254740993',
    })).toEqual({
      trades: [{
        trade_id: 'trade-1', side: 'buy', chain: 'solana', token: 'mint', quote_token: 'usdc',
        amount_in_actual: '900719925474099312345', amount_out: undefined, status: 'SUCCESS', lifecycle: 'confirmed',
        tx_hash: 'sig', tx_chain: 'solana', created_at: '2026-09-08T01:02:03Z', confirmed_at: undefined,
        fee_app: '1234', fee_currency: 'usdc', cycle_opened_entry_id: '9007199254740995',
      }],
      next_cursor: '9007199254740993',
    });
  });

  it('rejects malformed global trade identities, amounts, and incomplete fee pairs', () => {
    const base = {trade_id: 't', side: 'sell', chain: 'base', token: '0xt', quote_token: '0xq', status: 'SUCCESS', lifecycle: 'included', created_at: '2026-09-08T01:02:03Z', cycle_opened_entry_id: 0};
    expect(() => normalizePortfolioTradePage({trades: [{...base, amount_out: '1.5'}]})).toThrow(/amount_out/);
    expect(() => normalizePortfolioTradePage({trades: [{...base, fee_app: '1'}]})).toThrow(/incomplete trade fee/);
    expect(() => normalizePortfolioTradePage({trades: [{...base, cycle_opened_entry_id: Number.MAX_SAFE_INTEGER + 1}]})).toThrow(/cycle_opened_entry_id/);
  });
});
