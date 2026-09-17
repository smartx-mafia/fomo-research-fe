import {beforeEach, describe, expect, it, vi} from 'vitest';
import {confirmTokenRisk, getTokenRisk} from './token-risk';
import {createTrade} from './trade';
const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', async (original) => ({...await original<typeof import('./envelope')>(), call: callMock}));
const address = '0x1111111111111111111111111111111111111111';
const reply = {chain: 'base', address, risk: {assessment: {mode: 'enforce', grade: 4, buy_action: 'confirm', confirmation_version: 'v1'}}};
describe('risk RPC contract', () => {
  beforeEach(() => {callMock.mockReset(); callMock.mockResolvedValue({data: reply});});
  it('GET is anonymous and validates fresh response identity', async () => {
    expect((await getTokenRisk('base', address)).risk.assessment?.grade).toBe(4);
    expect(callMock.mock.calls[0]).toEqual([`/v1/tokens/base/${address}/risk`, {bearer: undefined, signal: undefined}]);
    for (const bad of [{...reply, chain: 'bsc'}, {...reply, address: 'different'}, {risk: reply.risk}, null]) {
      callMock.mockResolvedValueOnce({data: bad});
      await expect(getTokenRisk('base', address)).rejects.toThrow(/match/);
    }
  });
  it('POST sends only flow and version with bearer, and validates identity too', async () => {
    await confirmTokenRisk('base', address, 'jwt', 'meme:123', 'semanticHash:42');
    expect(callMock.mock.calls[0]).toEqual([`/v1/tokens/base/${address}/risk/confirm`, {method: 'POST', bearer: 'jwt', signal: undefined, body: {flow_id: 'meme:123', confirmation_version: 'semanticHash:42'}}]);
    callMock.mockResolvedValueOnce({data: {...reply, chain: 'solana'}});
    await expect(confirmTokenRisk('base', address, 'jwt', 'meme:123', 'v1')).rejects.toThrow(/match/);
    await expect(confirmTokenRisk('base', address, '', 'meme:123', 'v1')).rejects.toThrow(/Sign in/);
  });
  it('Create can explicitly suppress preparation, with no ack or receipt fields', async () => {
    await createTrade('jwt', {chain: 'base', token: address, side: 'buy', amountIn: '1000000', slippageBps: 300}, undefined, {prepare: false});
    expect(callMock.mock.calls[0][1].body).toEqual({wallet: {chain: 'base'}, funding: {chain: 'solana'}, token: address, side: 'buy', amount_in: '1000000', slippage_bps: 300, prepare: false});
  });
});
