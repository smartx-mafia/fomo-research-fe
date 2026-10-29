// @vitest-environment jsdom
import React from 'react';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';

vi.mock('@privy-io/react-auth', () => ({usePrivy: () => ({ready: true, authenticated: true, user: {id: 'did:test'}})}));
vi.mock('@privy-io/react-auth/solana', () => ({useWallets: () => ({wallets: [], ready: true}), useSignMessage: () => ({signMessage: vi.fn()})}));
vi.mock('next/dynamic', () => ({default: () => () => <div>Recovered checkout</div>}));
vi.mock('@/config', () => ({CROSSMINT_CLIENT_API_KEY: 'test-browser-key'}));
vi.mock('@/session/storage', () => ({readSite: () => ({jwt: 'jwt'})}));
const {getDeposit} = vi.hoisted(() => ({getDeposit: vi.fn()}));
vi.mock('@/api/deposit', () => ({getDeposit, createFiatDeposit: vi.fn(), submitFiatWalletProof: vi.fn()}));
import {FiatDepositCard} from './FiatDepositCard';

afterEach(() => {cleanup(); sessionStorage.clear(); vi.clearAllMocks();});

it('shows the existing order amount and mounts checkout without an original browser marker', async () => {
  getDeposit.mockResolvedValue({deposit_id: 'd-existing', provider_order_id: 'p-existing', status: 2, client_secret: 'test-secret', next_action: 'mount_checkout', deposit: {deposit_id: 'd-existing', kind: 1, status: 2, fiat_amount: '5.00'}});
  render(<FiatDepositCard bearer="jwt" ownerKey="owner" receiptEmail="test@example.com" identityMatched resumeID="d-existing" onProtectedError={() => false} />);
  await waitFor(() => expect((screen.getByRole('textbox', {name: 'Amount (USD)'}) as HTMLInputElement).value).toBe('5.00'));
  expect(screen.getByText('Recovered checkout')).toBeTruthy();
  expect(screen.queryByRole('button', {name: 'Review fiat deposit'})).toBeNull();
});
