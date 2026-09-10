import {beforeEach, describe, expect, it, vi} from 'vitest';
const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));
import {getSmartMoneyHoldings, getSmartMoneyTokenTrades, getSmartMoneyTrades} from './smartmoney';

describe('smart-money detail API', () => {
  beforeEach(() => callMock.mockReset());
  it('loads holdings and recent trades for the exact address', async () => {
    callMock.mockResolvedValue({data: {}});
    await getSmartMoneyHoldings('sol', 'wallet');
    await getSmartMoneyTrades('sol', 'wallet');
    expect(callMock.mock.calls.map((call) => call[0])).toEqual([
      '/v1/smartmoney/holdings?chain=sol&address=wallet',
      '/v1/smartmoney/trades?chain=sol&address=wallet',
    ]);
  });
  it('uses the opaque token-history cursor without changing it', async () => {
    callMock.mockResolvedValue({data: {list: [], next_cursor: ''}});
    await getSmartMoneyTokenTrades('bsc', '0xwallet', '0xtoken', 'opaque+/=');
    expect(callMock).toHaveBeenCalledWith('/v1/smartmoney/token-trades?chain=bsc&address=0xwallet&token_address=0xtoken&limit=50&cursor=opaque%2B%2F%3D', {signal: undefined});
  });
});
