import {beforeEach, describe, expect, it, vi} from 'vitest';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));

import {
  getSourceActions,
  getSourceCapabilities,
  getSourcePnL,
  getSourcePositions,
  sourceRefreshMs,
  sourceSurfaceReady,
} from './smartmoney-source';

const meta = {
  source: 'gmgn', data_mode: 'provider_snapshot', data_provider: 'gmgn',
  as_of: '2026-08-01T00:00:00Z', coverage: 'partial', ledger_verified: false,
} as const;

describe('provider snapshot source reads', () => {
  beforeEach(() => callMock.mockReset());

  it('gates reads on the exact provider-snapshot capability epoch and surface reason', async () => {
    const data = {
      protocol_version: '2', epoch: 'provider-snapshot-v1', supported_chains: ['base'],
      surfaces: {
        positions: {enabled: true, state: 'ready', reason: 'data_mode=provider_snapshot;ledger_verified=false', poll_after_ms: 30000},
        pnl: {enabled: true, state: 'ready', reason: 'scope_unverified', poll_after_ms: 30000},
      },
    };
    callMock.mockResolvedValue({data});
    const capabilities = await getSourceCapabilities();
    expect(sourceSurfaceReady(capabilities, 'positions')).toBe(true);
    expect(sourceRefreshMs(capabilities, 'positions')).toBe(30000);
    expect(sourceSurfaceReady(capabilities, 'pnl')).toBe(false);
    expect(sourceRefreshMs(capabilities, 'pnl')).toBe(0);
    expect(sourceSurfaceReady(capabilities, 'actions')).toBe(false);
    expect(sourceSurfaceReady({...capabilities, surfaces: {...capabilities.surfaces,
      positions: {...capabilities.surfaces.positions, reason: 'not_' + capabilities.surfaces.positions.reason}}}, 'positions')).toBe(false);
    callMock.mockResolvedValue({data: {...data, epoch: 'explicit-data-modes-v1', data_modes: ['provider_snapshot', 'ledger_calculated']}});
    expect(sourceSurfaceReady(await getSourceCapabilities(), 'positions')).toBe(true);
    callMock.mockResolvedValue({data: {...data, epoch: 'explicit-data-modes-v1', data_modes: ['ledger_calculated']}});
    await expect(getSourceCapabilities()).rejects.toThrow('unsupported contract');
    callMock.mockResolvedValue({data: {...data, epoch: 'old'}});
    await expect(getSourceCapabilities()).rejects.toThrow('unsupported contract');
  });

  it('sends the exact subject or wallet scope and preserves monetary decimal strings', async () => {
    const amount = '9007199254740993123.123456789012345678';
    callMock.mockResolvedValueOnce({data: {meta, snapshot: {user: {list: [], open: [{balance: amount}], closed: []}}}});
    const positions = await getSourcePositions({type: 'user', userId: 'subject:9007199254740993123'});
    expect(positions.snapshot.user?.open[0].balance).toBe(amount);
    expect(callMock.mock.calls[0][0]).toBe('/v2/smartmoney/positions?identity.type=user&identity.user_id=subject%3A9007199254740993123');

    callMock.mockResolvedValueOnce({data: {meta, snapshot: {wallet: {open: [], closed: []}}}});
    await getSourcePositions({type: 'wallet', namespace: 'evm', address: '0xAbC'}, 'base');
    expect(callMock.mock.calls[1][0]).toBe('/v2/smartmoney/positions?identity.type=wallet&identity.namespace=evm&identity.address=0xAbC&chain=base');
    callMock.mockResolvedValueOnce({data: {meta, snapshot: {wallet: {open: [], closed: []}}}});
    await getSourcePositions({type: 'wallet', namespace: 'evm', address: '0xAbC'}, 'all');
    expect(callMock.mock.calls[2][0]).toContain('chain=all');
    await expect(getSourceActions({type: 'wallet', namespace: 'evm', address: '0xAbC'}, 'all')).rejects.toThrow('one chain');
    expect(callMock).toHaveBeenCalledTimes(3);
  });

  it('keeps opaque cursors intact and refuses unverified provenance or wrong snapshot branches', async () => {
    callMock.mockResolvedValueOnce({data: {meta, classification: 'provider_reported', snapshot: {list: [], next_cursor: ''}}});
    await getSourceActions({type: 'wallet', namespace: 'solana', address: 'AbC'}, 'solana', 'opaque+/=');
    expect(callMock.mock.calls[0][0]).toBe('/v2/smartmoney/actions?identity.type=wallet&identity.namespace=solana&identity.address=AbC&chain=solana&cursor=opaque%2B%2F%3D');

    callMock.mockResolvedValueOnce({data: {meta: {...meta, ledger_verified: true}, windows: []}});
    await expect(getSourcePnL({type: 'user', userId: 'subject:1'})).rejects.toThrow('lacks provider-snapshot provenance');
    callMock.mockResolvedValueOnce({data: {meta, snapshot: {wallet: {open: [], closed: []}}}});
    await expect(getSourcePositions({type: 'user', userId: 'subject:1'})).rejects.toThrow('does not match');
  });
});
