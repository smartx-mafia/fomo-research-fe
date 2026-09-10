import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {TradeRow} from './PortfolioActivity';
import type {PortfolioTrade} from '@/api/portfolio';

const trade: PortfolioTrade = {
  trade_id: 'trade-1', side: 'buy', chain: 'solana', token: 'MintA', quote_token: 'USDC',
  amount_in_actual: '10500000', amount_out: '123456000', status: 'SUCCESS', lifecycle: 'confirmed',
  created_at: '2026-09-10T01:02:03Z', confirmed_at: '2026-09-10T01:03:04Z', tx_hash: 'signature', tx_chain: 'solana',
  cycle_opened_entry_id: '7', logo: 'https://images.test/mint.png', symbol: 'MINT', name: 'Mint Token',
  token_amount: '123.456', trade_value_usd: '10.50000000', execution_price_usd: '0.08505060728744939271', asset_decimals: 6,
};

describe('Portfolio executed trade row', () => {
  it('shows server-provided token identity, logo, execution price, quantity, value and times', () => {
    const html = renderToStaticMarkup(<table><tbody><TradeRow trade={trade} /></tbody></table>);
    expect(html).toContain('Mint Token');
    expect(html).toContain('$MINT');
    expect(html).toContain('src="https://images.test/mint.png"');
    expect(html).toContain('$0.08505060728744939271');
    expect(html).toContain('123.456 MINT');
    expect(html).toContain('$10.50000000');
    expect(html).toContain('2026');
    expect(html).toContain('Confirmed');
  });

  it('shows unavailable markers for legacy trade enrichment gaps without dropping the trade', () => {
    const html = renderToStaticMarkup(<table><tbody><TradeRow trade={{...trade, logo: undefined, symbol: undefined, name: undefined, token_amount: undefined, trade_value_usd: undefined, execution_price_usd: undefined, asset_decimals: undefined}} /></tbody></table>);
    expect(html).toContain('MintA');
    expect(html).toContain('>— token<');
    expect(html.match(/>—</g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('trade-1');
  });
});
