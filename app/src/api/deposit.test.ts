import {beforeEach, describe, expect, it, vi} from 'vitest';

const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));

import {
  createDepositSweep,
  createFiatDeposit,
  prepareDepositSweep,
  submitFiatWalletProof,
  submitDepositSweep,
} from './deposit';

describe('deposit API contract', () => {
  beforeEach(() => callMock.mockReset());


  it('creates fiat with the exact idempotency key, decimal string, USD and canonical email only', async () => {
    callMock.mockResolvedValue({data: {deposit_id: 'd-1', provider_order_id: 'p-1', client_secret: 'secret', status: 1}});
    await createFiatDeposit('jwt', {idempotencyKey: 'deposit-key', fiatAmount: '100.00', receiptEmail: 'a@example.com'});
    expect(callMock).toHaveBeenCalledWith('/v1/deposits/fiat', {method: 'POST', bearer: 'jwt', signal: undefined, body: {idempotency_key: 'deposit-key', fiat_amount: '100.00', fiat_currency: 'USD', receipt_email: 'a@example.com'}});
  });

  it('creates a sweep from the exact Portfolio chain and token with no client amount', async () => {
    callMock.mockResolvedValue({data: {sweep: {sweep_id: 's-1', lifecycle: 'pending', origin_chain: 'base', origin_token: '0xabc'}, duplicate: true}});
    await expect(createDepositSweep('jwt', 'base', '0xabc')).resolves.toMatchObject({duplicate: true});
    expect(callMock).toHaveBeenCalledWith('/v1/deposit-sweeps', {method: 'POST', bearer: 'jwt', signal: undefined, body: {origin_chain: 'base', origin_token_address: '0xabc'}});
  });

  it('requires sign kind and exact prepare envelope, then submits only base64 signature', async () => {
    callMock.mockResolvedValueOnce({data: {sweep: {sweep_id: 's-1', lifecycle: 'awaiting_signature', origin_chain: 'base', origin_token: '0xabc', amount_raw: '1000000', destination_token: 'solana-usdc'}, sign_kind: 5, sign_data: 'c2lnbg==', wallet_address: '0xwallet', expires_at: '2026-09-07T00:01:00Z'}});
    await expect(prepareDepositSweep('jwt', 's-1')).resolves.toMatchObject({sign_kind: 5, wallet_address: '0xwallet'});
    callMock.mockResolvedValueOnce({data: {sweep: {sweep_id: 's-1', lifecycle: 'submitted', origin_chain: 'base', origin_token: '0xabc'}}});
    await submitDepositSweep('jwt', 's-1', 'base64-signature');
    expect(callMock.mock.calls[1]).toEqual(['/v1/deposit-sweeps/s-1/submit', {method: 'POST', bearer: 'jwt', signal: undefined, body: {signature: 'base64-signature'}}]);
  });

  it('fails closed when Prepare omits the complete balance or destination token', async () => {
    callMock.mockResolvedValueOnce({data: {sweep: {sweep_id: 's-1', lifecycle: 'awaiting_signature', origin_chain: 'base', origin_token: '0xabc', amount_raw: '0'}, sign_kind: 5, sign_data: 'c2lnbg==', wallet_address: '0xwallet'}});
    await expect(prepareDepositSweep('jwt', 's-1')).rejects.toThrow(/positive complete balance or destination token/);
  });

  it('requires wallet-proof success to be explicitly verified', async () => {
    callMock.mockResolvedValueOnce({data: {status: 2, verified: true}});
    await expect(submitFiatWalletProof('jwt', 'd-1', 'c-1', 'sig')).resolves.toEqual({status: 2, verified: true});
    callMock.mockResolvedValueOnce({data: {status: 2}});
    await expect(submitFiatWalletProof('jwt', 'd-1', 'c-1', 'sig')).rejects.toThrow(/success response is invalid/);
  });
});
