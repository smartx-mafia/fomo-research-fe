import {beforeEach, describe, expect, it, vi} from 'vitest';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));
import {getUnifiedLeaderboard, getUnifiedLeaderboardMeta} from './leaderboard-new';

const sourceMeta = {source: 'mixed', data_mode: 'provider_snapshot', data_provider: 'gmgn',
  as_of: '2026-08-01T00:00:00Z', coverage: 'ranked_selection', ledger_verified: false};

describe('unified external leaderboard adapter', () => {
  beforeEach(() => callMock.mockReset());
  it('uses the isolated Global contract and keeps int64 timestamps exact', async () => {
    callMock.mockResolvedValueOnce({data: {windows: ['1d', '7d', '30d', 'all'], dimensions: ['ALL', 'SmartX', 'Global']}});
    callMock.mockResolvedValueOnce({data: {meta: sourceMeta, snapshot: {window: '7d', dimension: 'Global', updated_at: '9007199254740993', stale: false, count: 1, list: [{rank: 1, identity: {type: 'external_user', id: 'subject:42', user_type: 2}, profile: {}, platforms: [], dimension: 'Global', pnl_basis: 'window_realized_plus_current_unrealized', total_profit_usd: '9007199254740993.123456789', snapshot_at: '9007199254740994', chains: [], identity_revision: 'opaque'}]}}});
    const meta = await getUnifiedLeaderboardMeta();
    const reply = await getUnifiedLeaderboard('7d', 'jwt');
    expect(meta.windows).toEqual(['1d', '7d', '30d', 'all']);
    expect(callMock.mock.calls[0]).toEqual(['/v1/leaderboard-new/meta', {signal: undefined}]);
    expect(callMock.mock.calls[1]).toEqual(['/v2/smartmoney/leaderboard?window=7d&dimension=Global', {signal: undefined, bearer: 'jwt', preserveInt64Fields: ['updated_at', 'snapshot_at']}]);
    expect(reply.updated_at).toBe('9007199254740993');
    expect(reply.list[0].snapshot_at).toBe('9007199254740994');
    expect(reply.list[0].total_profit_usd).toBe('9007199254740993.123456789');
    expect(reply.meta).toEqual(sourceMeta);
  });

  it('rejects platform-user rows and malformed external identities in the external-only view', async () => {
    callMock.mockResolvedValueOnce({data: {meta: sourceMeta, snapshot: {window: '7d', dimension: 'Global', updated_at: '1', stale: false, count: 1, list: [{rank: 1, identity: {type: 'smartx_user', id: 'smartx-1', user_type: 1}, profile: {}, platforms: [], dimension: 'Global', pnl_basis: 'snapshot_delta', total_profit_usd: '5', snapshot_at: '1', chains: [], identity_revision: ''}]}}});
    await expect(getUnifiedLeaderboard('7d')).rejects.toThrow(/identity user_type/);
    callMock.mockResolvedValueOnce({data: {meta: sourceMeta, snapshot: {window: '7d', dimension: 'Global', list: [{identity: {type: 'wallet', namespace: 'evm', address: '0xabc', user_type: 0}, dimension: 'Global', total_profit_usd: '1'}]}}});
    await expect(getUnifiedLeaderboard('7d')).rejects.toThrow(/identity user_type/);
  });

  it('refuses snapshots without provider provenance or decimal PnL strings', async () => {
    callMock.mockResolvedValueOnce({data: {meta: {...sourceMeta, ledger_verified: true}, snapshot: {window: '7d', dimension: 'Global', list: []}}});
    await expect(getUnifiedLeaderboard('7d')).rejects.toThrow(/provenance/);
    callMock.mockResolvedValueOnce({data: {meta: sourceMeta, snapshot: {window: '7d', dimension: 'Global', list: [{identity: {type: 'external_user', id: 'subject:42', user_type: 2}, dimension: 'Global', total_profit_usd: 1}]}}});
    await expect(getUnifiedLeaderboard('7d')).rejects.toThrow(/non-decimal/);
  });
});
