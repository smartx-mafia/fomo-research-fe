// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {render, screen, waitFor, cleanup} from '@testing-library/react';
import {SWRConfig} from 'swr';
const {fetchMock} = vi.hoisted(() => ({fetchMock: vi.fn()}));
vi.mock('@/api/token-holder-list', () => ({fetchFollowedHolderList: fetchMock, fetchHolderList: vi.fn()}));
import {TokenFollowHoldersCard, normalizeChainSlug} from './TokenFollowHoldersCard';
const external = {key: 'external_user:subject:1', identity: {type: 'external_user', id: 'subject:1'}, name: 'External trader', sources: ['FOMO'], basis: 'external_snapshot', balance: '10', valueUSD: '20', relationState: 'available', following: true, sharedWallets: false};
beforeEach(() => {cleanup();fetchMock.mockReset();});
describe('followed holder card', () => {
  it('does not query without a session', () => {render(<TokenFollowHoldersCard chain="bsc" address="coin" />);expect(fetchMock).not.toHaveBeenCalled();});
  it('renders external identities without a fabricated platform user link', async () => {
    fetchMock.mockResolvedValue({items: [external], total: 1, totalIsExact: true, coverage: ['snapshot_coverage_limited']});
    render(<SWRConfig value={{provider: () => new Map()}}><TokenFollowHoldersCard bearer="jwt" chain="eth" address="coin" /></SWRConfig>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('jwt', 'ethereum', 'coin', ''));
    expect(await screen.findByText('External trader')).toBeTruthy();
    expect(screen.queryByRole('link', {name: 'External trader'})).toBeNull();
    expect(screen.getByText(/limited snapshot coverage/)).toBeTruthy();
  });
  it('keeps canonical chain aliases', () => {expect(normalizeChainSlug('SOL')).toBe('solana');expect(normalizeChainSlug('eth')).toBe('ethereum');expect(normalizeChainSlug('unknown')).toBeNull();});
});
