// @vitest-environment jsdom
import React from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import type {SquareFeedItem} from '@/api/social-content';
import {SquareOpinionCard} from './SquareOpinionCard';

vi.mock('next/image', () => ({default: ({unoptimized: _u, ...props}: React.ImgHTMLAttributes<HTMLImageElement> & {unoptimized?: boolean}) => <img {...props} />}));
const item = (closed: boolean): SquareFeedItem => ({type: 1, sourceID: '1', actorIdentifier: 'alice', actor: {identifier: 'alice', nickname: 'Alice'}, sortTime: {seconds: 100, nanos: 0}, content: {
  kind: 'opinion', opinion: {opinionID: '1', authorIdentifier: 'alice', targetType: 1, targetID: '56:erc20:0xabc:1', latestVersion: {versionID: '1', versionNo: 1, body: 'My opinion', items: [], likeCount: 0, publishedAt: {seconds: 100, nanos: 0}, viewerLike: false}, createdAt: {seconds: 100, nanos: 0}, updatedAt: {seconds: 100, nanos: 0}},
  position: {asset: {chain: 'bsc', chain_id: '56', kind: 'erc20', token_address: '0xabc'}, shares_raw: closed ? '0' : '60', opened_entry_id: '1', cycle_status: 'ready', market_value_usd: '90', unrealized_pnl_usd: '30', realized_pnl_usd: '40', pnl_ratio: '0.4'},
  token: {chain: 'bsc', address: '0xabc', symbol: 'SYM', name: 'Do not show full name', decimals: 0, logo: 'https://example.com/token.png'},
}});
afterEach(cleanup);
describe('PRD 08-square §7.2', () => {
  it('shows only symbol, open value and unrealized USD PnL; no ROI', () => {
    render(<SquareOpinionCard item={item(false)} likePending={false} onToggleLike={() => {}} now={100000} />);
    expect(screen.getByText('SYM')).toBeTruthy();
    expect(screen.queryByText('Do not show full name')).toBeNull();
    expect(screen.getByTitle('Position market value (USD)').textContent).toBe('$90');
    expect(screen.getByTitle('Unrealized PnL (USD)').textContent).toContain('+$30');
    expect(screen.queryByTitle(/^ROI:/)).toBeNull();
  });
  it('shows closed realized USD PnL and ROI; no market value or unrealized PnL', () => {
    render(<SquareOpinionCard item={item(true)} likePending={false} onToggleLike={() => {}} now={100000} />);
    expect(screen.getByTitle('Realized PnL (USD)').textContent).toContain('+$40');
    expect(screen.getByTitle(/^ROI:/).textContent).toContain('40%');
    expect(screen.queryByTitle('Position market value (USD)')).toBeNull();
    expect(screen.queryByTitle('Unrealized PnL (USD)')).toBeNull();
  });
  it('does not turn unavailable amounts into zero', () => {
    const partial = item(false); partial.content.position.market_value_usd = undefined; partial.content.position.unrealized_pnl_usd = undefined;
    render(<SquareOpinionCard item={partial} likePending={false} onToggleLike={() => {}} now={100000} />);
    expect(screen.getByTitle('Position value unavailable').textContent).toBe('—');
    expect(screen.getByTitle('Unrealized PnL (USD)').textContent).not.toContain('$0');
  });
});
