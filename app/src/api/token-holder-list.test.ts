import {beforeEach, describe, expect, it, vi} from 'vitest';
const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));
import {fetchFollowedHolderList, fetchHolderList, normalizeHolderPage, normalizeHolder} from './token-holder-list';

export const view = (type = 'wallet', id = '0xabc') => ({identity: {type, namespace: 'evm', address: type === 'wallet' ? id : '', id: type === 'wallet' ? '' : id}, profile: {display_name: id, sources: ['FOMO']}, position: {basis: 'external_snapshot', balance: '9007199254740993.000000000000000001', cost_usd: '', value_usd: '0', pnl_percent: '-0.5'}, viewer: {state: 'available', following: true}, coverage: 'partial', freshness: 'stale'});
beforeEach(() => callMock.mockReset());
describe('unified holder contract', () => {
  it('uses one filtered holders request and forwards the opaque cursor and JWT', async () => {
    callMock.mockResolvedValue({data: {source: 'all', scope: 'following', items: [{holder: view()}], total: '1', total_is_exact: true, coverage: ['snapshot_coverage_limited']}});
    const page = await fetchHolderList('ethereum', '0xtoken', {source: 'all', scope: 'following', bearer: 'jwt', cursor: 'opaque+/='});
    expect(page.items[0].balance).toBe('9007199254740993.000000000000000001');
    expect(page.items[0].costUSD).toBeUndefined();
    expect(page.items[0].valueUSD).toBe('0');
    expect(callMock).toHaveBeenCalledWith('/v1/tokens/ethereum/0xtoken/holders?source=all&scope=following&limit=20&cursor=opaque%2B%2F%3D', {bearer: 'jwt', signal: undefined});
  });
  it('accepts native, external user and wallet rows from the same following response', async () => {
    callMock.mockResolvedValue({data: {items: [{holder: view('smartx_user', 'same')}, {holder: view('external_user', 'same')}, {holder: view('wallet', 'same')}], total: 3, total_is_exact: true}});
    const p = await fetchFollowedHolderList('jwt', 'bsc', 'coin');
    expect(new Set(p.items.map((r) => r.key)).size).toBe(3);
    expect(callMock).toHaveBeenCalledTimes(1);
  });
  it('rejects ignored source/scope, never relabels an old onchain response', async () => {
    callMock.mockResolvedValue({data: {items: [], total: 0}});
    await expect(fetchHolderList('bsc', 'coin', {source: 'smartx', scope: 'all'})).rejects.toThrow('source');
  });
  it('does not downgrade following to public data without a session', async () => {
    await expect(fetchHolderList('bsc', 'coin', {source: 'all', scope: 'following'})).rejects.toThrow('sign in');
    expect(callMock).not.toHaveBeenCalled();
  });
  it('keeps unavailable relations distinct and rejects malformed numeric fields', () => {
    expect(normalizeHolder({...view(), viewer: {state: 'unavailable', following: true, remark: 'private'}})).toMatchObject({following: false, remark: undefined, relationState: 'unavailable'});
    expect(() => normalizeHolder({...view(), position: {...view().position, balance: 123}})).toThrow('exact strings');
    expect(() => normalizeHolderPage({items: [], total: '9007199254740993'})).toThrow('count');
  });
  it('retains distinct on-chain wallets mapped to the same user', () => {
    const holder = {...view('smartx_user', 'user-1'), position: {...view().position, basis: 'onchain'}};
    const page = normalizeHolderPage({items: [{wallet_address: '0xA', holder}, {wallet_address: '0xB', holder}], total: 2});
    expect(page.items.map((r) => r.key)).toEqual(['onchain:0xa', 'onchain:0xb']);
  });
  it('does not turn a related wallet follow into a user follow or user note', () => {
    const wallet = {type: 'wallet', namespace: 'evm', address: '0xabc'};
    const holder = normalizeHolder({...view('smartx_user', 'user-1'), viewer: {state: 'available', following: true, followed_subjects: [wallet], remark: 'Wallet note', remark_subject: wallet}});
    expect(holder.following).toBe(true);
    expect(holder.followingPrimary).toBe(false);
    expect(holder.remarkSubject).toMatchObject(wallet);
  });

});
