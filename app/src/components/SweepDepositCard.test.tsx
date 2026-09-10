// @vitest-environment jsdom
import React from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';

const api = vi.hoisted(() => ({create: vi.fn(), get: vi.fn()}));
vi.mock('@privy-io/react-auth', () => ({usePrivy: () => ({ready: true, authenticated: true, user: {id: 'did:alice'}}), useWallets: () => ({wallets: [], ready: true})}));
vi.mock('@/api/deposit', () => ({createDepositSweep: api.create, getDepositSweep: api.get, prepareDepositSweep: vi.fn(), submitDepositSweep: vi.fn()}));
vi.mock('@/lib/deposit-signing', () => ({signDepositSweepCalibur: vi.fn()}));
import {SweepDepositCard} from './SweepDepositCard';

afterEach(() => {cleanup(); sessionStorage.clear(); vi.clearAllMocks();});
describe('Sweep creation and recovery', () => {
  it('starts from deposit routes without Portfolio and retains the known ID if GET fails', async () => {
    const address = `0x${'12'.repeat(20)}`, token = `0x${'ab'.repeat(20)}`;
    api.create.mockResolvedValue({sweep: {sweep_id: 'sweep-1', origin_chain: 'base', origin_token: token, lifecycle: 'created'}});
    api.get.mockRejectedValue(new Error('Temporary GET failure'));
    const props = {bearer: 'jwt', ownerKey: 'alice', identityMatched: true, onProtectedError: () => false};
    const view = render(<SweepDepositCard {...props} addresses={[{chain: 'base', address, address_format: 'evm', accepted_tokens: [{symbol: 'USDC', address: token, decimals: 6}], min_sweep_amount: '1000000', deposit_mode: 'sweep', balance_raw: '1000000', balance_meets_minimum: true}]} />);
    await waitFor(() => expect((screen.getByText('Review sweep') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Review sweep'));
    fireEvent.click(screen.getByText('Create sweep intent'));
    await screen.findByText('Temporary GET failure');
    expect(api.create).toHaveBeenCalledWith('jwt', 'base', token, expect.any(AbortSignal));
    expect(JSON.parse(sessionStorage.getItem('smartx.deposit.sweep-recovery.v1.alice')!)).toMatchObject({sweepID: 'sweep-1', originChain: 'base', originToken: token});
    view.rerender(<SweepDepositCard {...props} addresses={undefined} />);
    expect(screen.getByText('Sweep sweep-1')).toBeTruthy();
    expect(screen.getByText('Check same sweep')).toBeTruthy();
    expect(api.create).toHaveBeenCalledTimes(1);
  });
});
