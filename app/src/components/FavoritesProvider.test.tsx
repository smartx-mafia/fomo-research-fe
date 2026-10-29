// @vitest-environment jsdom

import React, {useEffect} from 'react';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  session: undefined as {jwt: string} | undefined,
  batch: vi.fn(),
  favoriteStatus: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  clearSite: vi.fn(),
}));

vi.mock('@/api/token-metadata', async (original) => ({
  ...await original<typeof import('@/api/token-metadata')>(),
  batchGetTokenMetadata: mocks.batch,
}));
vi.mock('@/api/favorites', () => ({
  favoriteStatus: mocks.favoriteStatus,
  addFavorite: mocks.addFavorite,
  removeFavorite: mocks.removeFavorite,
}));
vi.mock('@/session/storage', () => ({useSession: () => mocks.session, clearSite: mocks.clearSite}));

import {FavoritesProvider, useFavorites} from './FavoritesProvider';
import {tokenKey, type TokenRef} from '@/api/token-metadata';

function Probe({token}: {token: TokenRef}) {
  const {ensureMetadata, metadataMap, badgeFavoriteMap, personalReadyMap} = useFavorites();
  useEffect(() => ensureMetadata([token]), [ensureMetadata, token]);
  const key = tokenKey(token.chain, token.address)!;
  return <><span data-testid="status">{metadataMap[key]?.status ?? 'none'}</span>
    <span data-testid="verified">{String(metadataMap[key]?.info?.is_verify === true)}</span>
    <span data-testid="favorite">{String(badgeFavoriteMap[key] === true)}</span>
    <span data-testid="personal-ready">{String(personalReadyMap[key] === true)}</span></>;
}

describe('FavoritesProvider metadata hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = {jwt: 'jwt'};
    mocks.batch.mockImplementation(async (tokens: TokenRef[]) => ({data: {results: tokens.map((token) => ({
      ...token, status: 1, source: 2, info: {...token, decimals: 18, symbol: 'T', is_verify: true},
      personal: {is_favorited: true},
    }))}, sentRequestID: 'request'}));
  });

  it('hydrates verified metadata and viewer favorite state from the canonical batch', async () => {
    const token = {chain: 'bsc', address: '0xAbC'};
    render(<FavoritesProvider><Probe token={token} /></FavoritesProvider>);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(screen.getByTestId('verified').textContent).toBe('true');
    expect(screen.getByTestId('favorite').textContent).toBe('true');
    expect(screen.getByTestId('personal-ready').textContent).toBe('true');
    expect(mocks.batch).toHaveBeenCalledWith([{chain: 'bsc', address: '0xabc'}], 'jwt');
  });
});

afterEach(cleanup);
