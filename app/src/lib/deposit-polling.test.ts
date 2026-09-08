import {describe, expect, it} from 'vitest';

import type {FiatDepositSession} from '@/api/deposit';
import type {PortfolioReply} from '@/api/portfolio';

import {
  abortablePollDelay,
  fiatOrderPollDelayMs,
  shouldAutoPollFiatOrder,
  solanaAcceptedBalanceChanged,
  solanaAcceptedBalanceSnapshot,
  waitForVisibleDocument,
} from './deposit-polling';

const mint = 'So11111111111111111111111111111111111111112';
const portfolio = (amount?: string, partialErrors: PortfolioReply['partial_errors'] = []): PortfolioReply => ({
  positions: amount ? [{asset: {chain: 'solana', chain_id: '101', kind: 'spl', token_address: mint}, amount_raw: amount}] : [],
  partial_errors: partialErrors,
});

describe('deposit polling policy', () => {
  it('rejects immediately when a poll delay starts with an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortablePollDelay(60_000, controller.signal)).rejects.toBeTruthy();
    await expect(waitForVisibleDocument(controller.signal)).rejects.toBeTruthy();
  });

  it('backs fiat polling off to a bounded 15 second interval', () => {
    expect([0, 1, 2, 3, 99].map(fiatOrderPollDelayMs)).toEqual([3_000, 5_000, 10_000, 15_000, 15_000]);
  });

  it('polls only nonterminal fiat orders that are waiting or have the checkout mounted', () => {
    const order = (status: number, next_action: string): FiatDepositSession => ({deposit_id: 'd-1', status, next_action});
    expect(shouldAutoPollFiatOrder(order(1, 'wait'))).toBe(true);
    expect(shouldAutoPollFiatOrder(order(4, 'wait'))).toBe(true);
    expect(shouldAutoPollFiatOrder(order(2, 'mount_checkout'))).toBe(true);
    expect(shouldAutoPollFiatOrder(order(2, 'submit_wallet_proof'))).toBe(false);
    expect(shouldAutoPollFiatOrder(order(5, 'wait'))).toBe(false);
    expect(shouldAutoPollFiatOrder(order(9, 'none'))).toBe(false);
  });

  it('detects accepted Solana balance changes without using JavaScript numbers', () => {
    const baseline = solanaAcceptedBalanceSnapshot(portfolio('900719925474099312345'), [mint]);
    const next = solanaAcceptedBalanceSnapshot(portfolio('900719925474099312346'), [mint]);
    expect(baseline).toBeTypeOf('string');
    expect(solanaAcceptedBalanceChanged(baseline!, next)).toBe(true);
    expect(solanaAcceptedBalanceChanged(baseline!, baseline)).toBe(false);
  });

  it('fails closed when the accepted Solana balance is incomplete', () => {
    expect(solanaAcceptedBalanceSnapshot(portfolio(undefined, [{chain: 'solana', reason: 'rpc unavailable'}]), [mint])).toBeUndefined();
    expect(solanaAcceptedBalanceSnapshot(portfolio(undefined, [{token_address: mint, reason: 'mint read failed'}]), [mint])).toBeUndefined();
    expect(solanaAcceptedBalanceSnapshot(portfolio(undefined, [{chain: 'base', reason: 'unrelated'}]), [mint])).toBeTypeOf('string');
  });
});
