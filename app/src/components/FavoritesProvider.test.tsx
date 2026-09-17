// @vitest-environment jsdom

import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useEffect} from 'react';

const mocks = vi.hoisted(() => ({
  batch: vi.fn(),
  favoriteStatus: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  clearSite: vi.fn(),
  session: undefined as {jwt: string} | undefined,
}));

vi.mock('@/api/token-metadata', async (load) => ({
  ...await load<typeof import('@/api/token-metadata')>(),
  batchGetTokenMetadata: mocks.batch,
}));
vi.mock('@/api/favorites', async (load) => ({
  ...await load<typeof import('@/api/favorites')>(),
  favoriteStatus: mocks.favoriteStatus,
  addFavorite: mocks.addFavorite,
  removeFavorite: mocks.removeFavorite,
}));
vi.mock('@/session/storage', () => ({useSession: () => mocks.session, clearSite: mocks.clearSite}));

import {FavoritesProvider, StarButton, useFavorites} from './FavoritesProvider';
import {tokenKey, type TokenRef} from '@/api/token-metadata';
import {normalizeTokenRisk} from '@/lib/token-risk';

function result(token: TokenRef, favorite = false) {
  return {chain: token.chain, address: token.address, status: 1, source: 2,
    info: {...token, decimals: 18, symbol: token.address.slice(-1).toUpperCase(), is_verify: false},
    personal: {is_favorited: favorite}};
}

function Probe({token, withToggle = false}: {token: TokenRef; withToggle?: boolean}) {
  const {retainMetadata, metadataMap, statusMap, badgeFavoriteMap, personalReadyMap, toggle} = useFavorites();
  useEffect(() => retainMetadata(token), [retainMetadata, token]);
  const key = tokenKey(token.chain, token.address)!;
  return <div>
    <span data-testid={`meta-${token.address}`}>{metadataMap[key]?.status ?? 'none'}</span>
    <span data-testid={`risk-${token.address}`}>{JSON.stringify(metadataMap[key]?.risk)}</span>
    <span data-testid={`fav-${token.address}`}>{String(statusMap[key] === true)}</span>
    <span data-testid={`badge-fav-${token.address}`}>{String(badgeFavoriteMap[key] === true)}</span>
    <span data-testid={`personal-ready-${token.address}`}>{String(personalReadyMap[key] === true)}</span>
    {withToggle ? <button type="button" onClick={() => void toggle(token.chain, token.address)}>toggle</button> : null}
  </div>;
}

function BatchProbe({tokens}: {tokens: TokenRef[]}) {
  const {ensureMetadata} = useFavorites();
  useEffect(() => ensureMetadata(tokens), [ensureMetadata, tokens]);
  return null;
}

function PrimeProbe({token}: {token: TokenRef}) {
  const {primeFavoriteStatus, statusMap, badgeFavoriteMap, personalReadyMap} = useFavorites();
  const key = tokenKey(token.chain, token.address)!;
  return <><button type="button" onClick={() => primeFavoriteStatus([token])}>prime</button>
    <span data-testid="primed">{String(statusMap[key] === true)}</span>
    <span data-testid="prime-badge">{String(badgeFavoriteMap[key] === true)}</span>
    <span data-testid="prime-ready">{String(personalReadyMap[key] === true)}</span></>;
}

function LegacyStatusProbe({token}: {token: TokenRef}) {
  const {ensureStatus, statusMap, badgeFavoriteMap, personalReadyMap} = useFavorites();
  const key = tokenKey(token.chain, token.address)!;
  useEffect(() => ensureStatus([token]), [ensureStatus, token]);
  return <><span data-testid="legacy-status">{String(statusMap[key] === true)}</span>
    <span data-testid="legacy-badge">{String(badgeFavoriteMap[key] === true)}</span>
    <span data-testid="legacy-ready">{String(personalReadyMap[key] === true)}</span></>;
}

describe('FavoritesProvider metadata hydration', () => {
  it('stores the whole canonical risk beside info and retains it on a later batch failure', async () => {
    const token = {chain: 'bsc', address: '0xa'};
    const risk = normalizeTokenRisk({token_is_scam: null, assessment: {
      mode: 'enforce', grade: 4, buy_action: 'confirm', checks_complete: false,
      confirmation_version: 'hash:123', policy_version: 'policy', decision_version: 'decision',
      goplus_status: 'stale', recommendation_allowed: false, keyword_search_allowed: true, square_distribution_allowed: false,
      items: [{code: 'goplus_buy_tax', grade: 4, display_source: 'goplus', params: {rate: '3.88'}, evidence: [{source: 'goplus', field: 'buy_tax', value: '0.0388', observed_at_ms: '1789000000000'}]}],
      checks: [{code: 'test', state: 'unknown', value: ''}],
    }});
    mocks.batch.mockResolvedValueOnce({data: {results: [{...result(token), risk}]}});
    const view = render(<FavoritesProvider><Probe token={token} /></FavoritesProvider>);
    await waitFor(() => expect(screen.getByTestId('meta-0xa').textContent).toBe('ready'));
    expect(JSON.parse(screen.getByTestId('risk-0xa').textContent!)).toEqual(risk);
    mocks.batch.mockRejectedValueOnce(new Error('offline'));
    mocks.session = {jwt: 'new-viewer'};
    view.rerender(<FavoritesProvider><Probe token={token} /></FavoritesProvider>);
    await waitFor(() => expect(screen.getByTestId('meta-0xa').textContent).toBe('error'));
    expect(JSON.parse(screen.getByTestId('risk-0xa').textContent!)).toEqual(risk);
  });
  beforeEach(() => {
    mocks.session = undefined;
    mocks.batch.mockReset();
    mocks.favoriteStatus.mockReset();
    mocks.addFavorite.mockReset();
    mocks.removeFavorite.mockReset();
    mocks.clearSite.mockReset();
  });

  it('coalesces sibling token requests into one metadata batch', async () => {
    mocks.batch.mockImplementation(async (tokens: TokenRef[]) => ({data: {results: tokens.map((token) => result(token))}, sentRequestID: 'r'}));
    const a = {chain: 'bsc', address: '0xa'};
    const b = {chain: 'solana', address: 'SoB'};
    render(<FavoritesProvider><Probe token={a} /><Probe token={b} /></FavoritesProvider>);
    await waitFor(() => expect(screen.getByTestId('meta-0xa').textContent).toBe('ready'));
    expect(screen.getByTestId('meta-SoB').textContent).toBe('ready');
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.batch.mock.calls[0][0]).toEqual([a, b]);
    expect(mocks.favoriteStatus).not.toHaveBeenCalled();
  });

  it('deduplicates and chunks large screens at 500 refs', async () => {
    mocks.batch.mockImplementation(async (tokens: TokenRef[]) => ({data: {results: tokens.map((token) => result(token))}, sentRequestID: 'r'}));
    const tokens = Array.from({length: 501}, (_, index) => ({chain: 'bsc', address: `0x${index}`}));
    render(<FavoritesProvider><BatchProbe tokens={[tokens[0], ...tokens]} /></FavoritesProvider>);
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(2));
    expect(mocks.batch.mock.calls.map((call) => call[0].length)).toEqual([500, 1]);
  });

  it('keeps public metadata but refreshes viewer favorite state after login', async () => {
    mocks.batch.mockImplementation(async (tokens: TokenRef[], bearer?: string) => ({
      data: {results: tokens.map((token) => result(token, bearer === 'jwt-b'))}, sentRequestID: 'r',
    }));
    const token = {chain: 'bsc', address: '0xa'};
    const view = render(<FavoritesProvider><Probe token={token} /></FavoritesProvider>);
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('fav-0xa').textContent).toBe('false');
    mocks.session = {jwt: 'jwt-b'};
    view.rerender(<FavoritesProvider><Probe token={token} /></FavoritesProvider>);
    expect(screen.getByTestId('fav-0xa').textContent).toBe('false');
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('fav-0xa').textContent).toBe('true'));
    expect(mocks.batch.mock.calls[1][1]).toBe('jwt-b');
  });

  it('does not let an older batch overwrite an optimistic favorite mutation', async () => {
    mocks.session = {jwt: 'jwt'};
    let settle!: (value: unknown) => void;
    mocks.batch.mockImplementationOnce(() => new Promise((resolve) => {settle = resolve;}));
    mocks.addFavorite.mockResolvedValue({data: {favorited: true, changed: true, chain: 'bsc', address: '0xa'}});
    const token = {chain: 'bsc', address: '0xa'};
    render(<FavoritesProvider><Probe token={token} withToggle /></FavoritesProvider>);
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', {name: 'toggle'}));
    await waitFor(() => expect(screen.getByTestId('fav-0xa').textContent).toBe('true'));
    await act(async () => settle({data: {results: [result(token, false)]}, sentRequestID: 'old'}));
    await waitFor(() => expect(screen.getByTestId('meta-0xa').textContent).toBe('ready'));
    expect(screen.getByTestId('fav-0xa').textContent).toBe('true');
  });

  it('single-flights repeated toggles for the same viewer and token', async () => {
    mocks.session = {jwt: 'jwt'};
    mocks.batch.mockResolvedValue({data: {results: [result({chain: 'bsc', address: '0xa'})]}, sentRequestID: 'r'});
    let settle!: (value: unknown) => void;
    mocks.addFavorite.mockImplementationOnce(() => new Promise((resolve) => {settle = resolve;}));
    const token = {chain: 'bsc', address: '0xa'};
    render(<FavoritesProvider><Probe token={token} withToggle /></FavoritesProvider>);
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(1));
    const button = screen.getByRole('button', {name: 'toggle'});
    fireEvent.click(button); fireEvent.click(button);
    expect(mocks.addFavorite).toHaveBeenCalledTimes(1);
    await act(async () => settle({data: {favorited: true, changed: true, chain: 'bsc', address: '0xa'}}));
    await waitFor(() => expect(screen.getByTestId('fav-0xa').textContent).toBe('true'));
  });

  it('ignores a previous viewer mutation after the session changes', async () => {
    mocks.session = {jwt: 'jwt-a'};
    mocks.batch.mockImplementation(async (tokens: TokenRef[]) => ({data: {results: tokens.map((token) => result(token, false))}, sentRequestID: 'r'}));
    let settle!: (value: unknown) => void;
    mocks.addFavorite.mockImplementationOnce(() => new Promise((resolve) => {settle = resolve;}));
    const token = {chain: 'bsc', address: '0xa'};
    const view = render(<FavoritesProvider><Probe token={token} withToggle /></FavoritesProvider>);
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', {name: 'toggle'}));
    mocks.session = {jwt: 'jwt-b'};
    view.rerender(<FavoritesProvider><Probe token={token} withToggle /></FavoritesProvider>);
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('fav-0xa').textContent).toBe('false'));
    await act(async () => settle({data: {favorited: true, changed: true, chain: 'bsc', address: '0xa'}}));
    expect(screen.getByTestId('fav-0xa').textContent).toBe('false');
    expect(mocks.clearSite).not.toHaveBeenCalled();
  });

  it('primes watchlist rows as favorited without a status request', () => {
    const token = {chain: 'solana', address: 'SoA'};
    render(<FavoritesProvider><PrimeProbe token={token} /></FavoritesProvider>);
    fireEvent.click(screen.getByRole('button', {name: 'prime'}));
    expect(screen.getByTestId('primed').textContent).toBe('true');
    expect(screen.getByTestId('prime-badge').textContent).toBe('false');
    expect(screen.getByTestId('prime-ready').textContent).toBe('false');
    expect(mocks.favoriteStatus).not.toHaveBeenCalled();
  });

  it('does not let the legacy WS favorite status source authorize an avatar badge', async () => {
    mocks.session = {jwt: 'jwt'};
    mocks.favoriteStatus.mockResolvedValue({data: {results: [{chain: 'bsc', address: '0xa', is_favorited: true}]}});
    const token = {chain: 'bsc', address: '0xa'};
    render(<FavoritesProvider><LegacyStatusProbe token={token} /></FavoritesProvider>);
    await waitFor(() => expect(screen.getByTestId('legacy-status').textContent).toBe('true'));
    expect(screen.getByTestId('legacy-badge').textContent).toBe('false');
    expect(screen.getByTestId('legacy-ready').textContent).toBe('false');
  });

  it('restores the canonical badge snapshot and rehydrates after a failed cross-source mutation', async () => {
    mocks.session = {jwt: 'jwt'};
    let settleMetadata!: (value: unknown) => void;
    let rejectRemove!: (reason: unknown) => void;
    const token = {chain: 'bsc', address: '0xa'};
    mocks.batch
      .mockImplementationOnce(() => new Promise((resolve) => { settleMetadata = resolve; }))
      .mockResolvedValueOnce({data: {results: [result(token, false)]}, sentRequestID: 'rehydrated'});
    mocks.removeFavorite.mockImplementationOnce(() => new Promise((_, reject) => { rejectRemove = reject; }));

    render(<FavoritesProvider><PrimeProbe token={token} /><Probe token={token} withToggle /></FavoritesProvider>);
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', {name: 'prime'}));
    expect(screen.getByTestId('fav-0xa').textContent).toBe('true');
    expect(screen.getByTestId('badge-fav-0xa').textContent).toBe('false');

    fireEvent.click(screen.getByRole('button', {name: 'toggle'}));
    await waitFor(() => expect(mocks.removeFavorite).toHaveBeenCalledTimes(1));
    await act(async () => settleMetadata({data: {results: [result(token, false)]}, sentRequestID: 'during-mutation'}));
    expect(screen.getByTestId('badge-fav-0xa').textContent).toBe('false');

    await act(async () => rejectRemove(new Error('favorite store unavailable')));
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('personal-ready-0xa').textContent).toBe('true'));
    expect(screen.getByTestId('fav-0xa').textContent).toBe('false');
    expect(screen.getByTestId('badge-fav-0xa').textContent).toBe('false');
  });

  it('queues canonical rehydration when a mutation fails before the in-flight metadata returns', async () => {
    mocks.session = {jwt: 'jwt'};
    let settleMetadata!: (value: unknown) => void;
    let rejectRemove!: (reason: unknown) => void;
    const token = {chain: 'bsc', address: '0xa'};
    mocks.batch
      .mockImplementationOnce(() => new Promise((resolve) => { settleMetadata = resolve; }))
      .mockResolvedValueOnce({data: {results: [result(token, false)]}, sentRequestID: 'forced-refresh'});
    mocks.removeFavorite.mockImplementationOnce(() => new Promise((_, reject) => { rejectRemove = reject; }));

    render(<FavoritesProvider><PrimeProbe token={token} /><Probe token={token} withToggle /></FavoritesProvider>);
    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', {name: 'prime'}));
    fireEvent.click(screen.getByRole('button', {name: 'toggle'}));
    await waitFor(() => expect(mocks.removeFavorite).toHaveBeenCalledTimes(1));

    await act(async () => rejectRemove(new Error('favorite store unavailable')));
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    await act(async () => settleMetadata({data: {results: [result(token, false)]}, sentRequestID: 'stale-in-flight'}));

    await waitFor(() => expect(mocks.batch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('personal-ready-0xa').textContent).toBe('true'));
    expect(screen.getByTestId('badge-fav-0xa').textContent).toBe('false');
  });

  it('renders and removes a known Watchlist favorite correctly on the first frame', async () => {
    mocks.session = {jwt: 'jwt'};
    mocks.removeFavorite.mockResolvedValue({data: {favorited: false, changed: true, chain: 'bsc', address: '0xa'}});
    render(<FavoritesProvider><StarButton chain="bsc" address="0xa" knownFavorited /></FavoritesProvider>);
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('★');
    fireEvent.click(button);
    await waitFor(() => expect(mocks.removeFavorite).toHaveBeenCalledTimes(1));
    expect(mocks.addFavorite).not.toHaveBeenCalled();
    await waitFor(() => expect(button.textContent).toBe('☆'));
  });
});

afterEach(() => document.body.replaceChildren());
