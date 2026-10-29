import {afterEach, expect, it, vi} from 'vitest';
const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));
import {listSquareFeedPage, SQUARE_LANES} from './social-content';
import {squarePositionTarget} from '@/lib/square-position';
const address = `0x${'ab'.repeat(20)}`, token = `0x${'cd'.repeat(20)}`;
const trade = (view: unknown) => ({type: 2, source_id: '1', actor_identifier: address, actor_type: 'smart_money', actor: {}, smart_money: {address, chains: ['bsc'], display_name: 'FOMO author'}, actor_view: view, sort_time: {seconds: 100}, trade: {side: 'buy', chain: 'bsc', token_address: token, cycle_key: '', occurred_at: {seconds: 100}}});
afterEach(() => vi.resetAllMocks());
it('uses the explicit actor_view subject without rewriting the original trade wallet', async () => {
  callMock.mockResolvedValue({data: {items: [trade({identity: {type: 'external_user', id: 'subject:42'}})]}});
  const item = (await listSquareFeedPage(SQUARE_LANES.NEWEST)).items[0];
  expect(item.actorIdentifier).toBe(address);
  expect(item.smartMoney?.subjectId).toBe('subject:42');
  expect(squarePositionTarget(item)).toMatchObject({kind: 'external_user', identifier: 'subject:42'});
});
it.each([
  {identity: {type: 'external_user', id: 'subject:42'}, has_shared_wallets: true},
  {identity: {type: 'external_user', id: 'subject:0'}},
  {identity: {type: 'smartx_user', id: 'platform-user'}, profile_subject: {id: 'subject:42'}},
])('does not invent a subject from a shared wallet or invalid identity', async (view) => {
  callMock.mockResolvedValue({data: {items: [trade(view)]}});
  const item = (await listSquareFeedPage(SQUARE_LANES.NEWEST)).items[0];
  expect(item.smartMoney?.subjectId).toBeUndefined();
  expect(squarePositionTarget(item)).toMatchObject({kind: 'wallet', identifier: address});
});
it('accepts a validated explicit profile_subject when identity has no subject id', async () => {
  callMock.mockResolvedValue({data: {items: [trade({identity: {type: 'wallet', address}, profile_subject: {id: 'subject:42'}})]}});
  expect((await listSquareFeedPage(SQUARE_LANES.NEWEST)).items[0].smartMoney?.subjectId).toBe('subject:42');
});
it('keeps platform trade cycle_key separate from the trade/position IDs', async () => {
  callMock.mockResolvedValue({data: {items: [{...trade(undefined), actor_type: 'user', actor_identifier: 'alice', actor: {identifier: 'alice'}, smart_money: null, trade: {...trade(undefined).trade, cycle_key: 'original+/='}}]}});
  const item = (await listSquareFeedPage(SQUARE_LANES.NEWEST)).items[0];
  expect(squarePositionTarget(item)).toMatchObject({kind: 'user', identifier: 'alice', cycleKey: 'original+/='});
});
