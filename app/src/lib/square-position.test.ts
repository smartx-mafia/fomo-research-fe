import {describe, expect, it} from 'vitest';
import type {SquareFeedItem, SquareTradeItem} from '@/api/social-content';
import type {PortfolioPosition} from '@/api/portfolio';
import {squareCurrentCycle, squarePositionTarget} from './square-position';
const wallet = `0x${'ab'.repeat(20)}`, token = `0x${'cd'.repeat(20)}`;
const item: SquareTradeItem = {type: 2, sourceID: '1', actorIdentifier: wallet, actorType: 'smart_money', actor: {identifier: ''}, smartMoney: {address: wallet, chains: ['bsc']}, sortTime: {seconds: 100, nanos: 0}, content: {kind: 'trade', trade: {side: 'buy', chain: 'bsc', tokenAddress: token, cycleKey: 'unused', tokenAmount: '999', usd: '99', occurredAt: {seconds: 100, nanos: 0}}}};
describe('Square position identity and cycle selection', () => {
  it('separates token, wallet and platform identities and consumes an explicit subject first', () => {
    expect(squarePositionTarget(item)).toMatchObject({kind: 'wallet', identifier: wallet, address: token, cycleKey: undefined});
    expect(squarePositionTarget({...item, smartMoney: {...item.smartMoney!, subjectId: 'subject:3'}})).toMatchObject({kind: 'external_user', identifier: 'subject:3'});
    expect(squarePositionTarget({...item, actorType: 'user', actorIdentifier: 'alice', actor: {identifier: 'alice'}})).toMatchObject({kind: 'user', identifier: 'alice', cycleKey: 'unused'});
  });
  it('resolves a missing cycle only from the selected author and never from a closed card', () => {
    const target = squarePositionTarget({...item, actorType: 'user', actor: {identifier: 'alice'}, content: {...item.content, trade: {...item.content.trade, cycleKey: undefined}}})!;
    const positions = [{asset: {chain: 'bsc', token_address: token.toUpperCase()}, cycle_key: 'author-cycle'}] as PortfolioPosition[];
    expect(squareCurrentCycle(target, positions)).toBe('author-cycle');
    expect(squareCurrentCycle({...target, closedHint: true}, positions)).toBeUndefined();
    expect(squareCurrentCycle({...target, kind: 'wallet'}, positions)).toBeUndefined();
  });
  it('refuses an opinion token that is not ready and preserves its original closed cycle', () => {
    const position = {asset: {chain: 'bsc', token_address: token}, cycle_key: 'old-cycle', shares_raw: '0'};
    const opinion = {...item, type: 1, actorType: 'user', actor: {identifier: 'alice'}, content: {kind: 'opinion', position, opinion: {latestVersion: {body: 'Original opinion'}}}} as unknown as SquareFeedItem;
    expect(squarePositionTarget(opinion)).toBeUndefined();
    if (opinion.type !== 1) throw new Error('opinion');
    expect(squarePositionTarget({...opinion, content: {...opinion.content, token: {chain: 'bsc', address: token, decimals: 0, symbol: 'COIN', name: 'Coin', is_verify: false}}})).toMatchObject({kind: 'user', cycleKey: 'old-cycle', closedHint: true, opinionBody: 'Original opinion'});
  });
});
