// @vitest-environment jsdom
import React from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import type {SquareTradeItem} from '@/api/social-content';
import {SquareTradeCard} from './SquareTradeCard';
vi.mock('next/image', () => ({default: ({unoptimized: _u, ...props}: React.ImgHTMLAttributes<HTMLImageElement> & {unoptimized?: boolean}) => <img {...props} />}));
vi.mock('@/components/TokenAvatar', () => ({TokenAvatar: () => <span data-testid="token-avatar" />}));
const item = (side: 'buy' | 'sell'): SquareTradeItem => ({type: 2, sourceID: '1412', actorIdentifier: '0x8525bd2296e848751254de46bf4f8ac2346ae8d2', actorType: 'smart_money', actor: {identifier: ''}, smartMoney: {address: '0x8525bd2296e848751254de46bf4f8ac2346ae8d2', chains: ['robinhood']}, sortTime: {seconds: 100, nanos: 0}, content: {kind: 'trade', trade: {side, chain: 'robinhood', tokenAddress: '0xc32b91fe216af1b834db02f33326e983ad8cf201', token: {chain: 'robinhood', address: '0xc32b91fe216af1b834db02f33326e983ad8cf201', symbol: 'CAMELTOE', name: 'Cameltoe', decimals: 18, is_verify: false}, tokenAmount: '1709768.2763474016', usd: '1529.38469969', executionPriceUSD: '0.00089449', marketCapUSDAtTrade: '8100000', occurredAt: {seconds: 100, nanos: 0}, txHash: '0xabc', txChain: 'robinhood'}}});
afterEach(cleanup);
describe('Square Trade card', () => {
  it('renders smart-money sell with token amount, USD value and explorer link', () => {
    render(<SquareTradeCard item={item('sell')} now={100000} />);
    expect(screen.getByRole('article', {name: /sell activity/i})).toBeTruthy();
    expect(screen.getByText('Sell')).toBeTruthy();
    expect(screen.getByText('CAMELTOE')).toBeTruthy();
    expect(screen.getByText('$1,529.38')).toBeTruthy();
    expect(screen.getByText('at $8.10M MC')).toBeTruthy();
    expect(screen.getByText(/1,709,768.2763 CAMELTOE/)).toBeTruthy();
    expect(screen.getByRole('link', {name: /Tx/}).getAttribute('href')).toContain('robinhoodchain.blockscout.com');
    expect(screen.queryByRole('button', {name: /Follow/})).toBeNull();
  });
  it('renders an external wallet profile and source without platform follow controls', () => {
    const trade = item('sell');
    Object.assign(trade.smartMoney!, {displayName: '阿峰_Afeng', avatarURL: 'https://gmgn.ai/avatar.jpg',
      xHandle: '@aa_AFeng', source: 'gmgn', sourceURL: 'https://gmgn.ai/robinhood/address/0xwallet'});
    trade.content.trade.chain = 'eth';
    trade.content.trade.txChain = 'eth';
    render(<SquareTradeCard item={trade} now={100000} />);
    expect(screen.getByText('阿峰_Afeng')).toBeTruthy();
    expect(screen.getByRole('link', {name: 'gmgn'}).getAttribute('href')).toBe('https://gmgn.ai/robinhood/address/0xwallet');
    expect(screen.getByRole('link', {name: '@aa_AFeng'}).getAttribute('href')).toBe('https://x.com/aa_AFeng');
    expect(screen.getByRole('article').querySelector('img')?.getAttribute('src')).toBe('https://gmgn.ai/avatar.jpg');
    expect(screen.getByRole('link', {name: /Tx/}).getAttribute('href')).toBe('https://etherscan.io/tx/0xabc');
    expect(screen.queryByRole('button', {name: /Follow/})).toBeNull();
  });
  it('keeps source text but does not render unsafe profile links or avatars', () => {
    const trade = item('buy');
    Object.assign(trade.smartMoney!, {source: 'fomo', sourceURL: 'javascript:alert(1)', avatarURL: 'javascript:alert(1)'});
    render(<SquareTradeCard item={trade} now={100000} />);
    expect(screen.getByText(/fomo/)).toBeTruthy();
    expect(screen.queryByRole('link', {name: 'fomo'})).toBeNull();
    expect(screen.getByRole('article').querySelector('img')).toBeNull();
  });
  it('renders buy with green side marker and missing values as unavailable', () => {
    const buy = item('buy'); buy.content.trade.usd = undefined; buy.content.trade.tokenAmount = undefined; buy.content.trade.marketCapUSDAtTrade = undefined;
    render(<SquareTradeCard item={buy} now={100000} />);
    expect(screen.getByText('Buy')).toBeTruthy();
    expect(screen.getByTitle('Trade value unavailable').textContent).toBe('—');
    expect(screen.getByText('Token amount unavailable')).toBeTruthy();
    expect(screen.getByText('at — MC')).toBeTruthy();
  });
});
