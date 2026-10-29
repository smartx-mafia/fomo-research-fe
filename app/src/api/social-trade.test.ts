import {beforeEach, describe, expect, it, vi} from 'vitest';
const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));
import {listSquareFeedPage, SQUARE_LANES, type SquareFilter} from './social-content';

const address = '0xc32b91fe216af1b834db02f33326e983ad8cf201';
function smartMoneySell() {
  return {type: 2, source_id: '1412', actor_identifier: '0x8525bd2296e848751254de46bf4f8ac2346ae8d2', sort_time: {seconds: 1789027495, nanos: 937892000}, opinion: null,
    trade: {side: 'sell', chain: 'robinhood', token_address: address, token: {chain: 'robinhood', address, symbol: 'CAMELTOE', name: 'Cameltoe', decimals: 18, logo: '', creator: '', twitter: '', website: '', launchpad: '', launchpad_name: '', launchpad_logo: ''}, token_amount: '1709768.2763474016', usd: '1529.38469969', occurred_at: {seconds: 1788382219, nanos: 0}, tx_hash: '0xdbc052298f57c1f69f5f7b58c1dbaf593cfb7779abf0377b9c5544eab20bb9b3', position_target_id: '', tx_chain: 'robinhood'},
    actor: {identifier: '', username: '', nickname: '', avatar_url: ''}, smart_money: {address: '0x8525bd2296e848751254de46bf4f8ac2346ae8d2', chains: ['robinhood']}, actor_type: 'smart_money'};
}
describe('Square TradeCard wire contract', () => {
  beforeEach(() => callMock.mockReset());
  it('parses type=2 smart-money sell with exact token amount/usd and separate times', async () => {
    callMock.mockResolvedValue({data: {items: [smartMoneySell()]}});
    const item = (await listSquareFeedPage(SQUARE_LANES.NEWEST)).items[0];
    if (!item || item.type !== 2) throw new Error('expected trade item');
    expect(item.actorType).toBe('smart_money');
    expect(item.actor.identifier).toBe('');
    expect(item.smartMoney).toEqual({address: '0x8525bd2296e848751254de46bf4f8ac2346ae8d2', chains: ['robinhood']});
    expect(item.content.trade).toMatchObject({side: 'sell', chain: 'robinhood', tokenAddress: address, tokenAmount: '1709768.2763474016', usd: '1529.38469969', executionPriceUSD: undefined, marketCapUSDAtTrade: undefined, txChain: 'robinhood', positionTargetID: undefined});
    expect(item.content.trade.occurredAt.seconds).toBe(1788382219);
    expect(item.sortTime.seconds).toBe(1789027495);
  });
  it('allows user trade actor, keeps missing token metadata unavailable, and sends repeated filter params', async () => {
    const row = smartMoneySell();
    row.actor_type = 'user'; row.actor_identifier = 'alice'; row.actor = {identifier: 'alice', username: 'alice', nickname: 'Alice', avatar_url: ''}; row.smart_money = {address: '', chains: []}; row.trade.token = {chain: '', address: '', symbol: '', name: '', decimals: 0, logo: '', creator: '', twitter: '', website: '', launchpad: '', launchpad_name: '', launchpad_logo: ''};
    callMock.mockResolvedValue({data: {items: [row]}});
    const filters: SquareFilter[] = ['SQUARE_FILTER_BUY', 'SQUARE_FILTER_SELL'];
    const item = (await listSquareFeedPage(SQUARE_LANES.NEWEST, {filters})).items[0];
    if (!item || item.type !== 2) throw new Error('expected trade item');
    expect(item.actorType).toBe('user');
    expect(item.content.trade.token).toBeUndefined();
    expect(callMock.mock.calls[0][0]).toBe('/v1/social/square/feed?lane=SQUARE_LANE_NEWEST&filters=SQUARE_FILTER_BUY&filters=SQUARE_FILTER_SELL');
  });
  it('rejects side, token identity and smart-money identity mismatches', async () => {
    for (const mutate of [
      (row: ReturnType<typeof smartMoneySell>) => {row.trade.side = 'hold';},
      (row: ReturnType<typeof smartMoneySell>) => {row.trade.token.address = '0xother';},
      (row: ReturnType<typeof smartMoneySell>) => {row.smart_money.address = '0xother';},
    ]) {
      const row = smartMoneySell(); mutate(row); callMock.mockResolvedValue({data: {items: [row]}});
      await expect(listSquareFeedPage(SQUARE_LANES.NEWEST)).rejects.toThrow(); callMock.mockReset();
    }
  });
});
