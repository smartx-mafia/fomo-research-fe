import {describe, expect, it} from 'vitest';

import {isFiatTerminal, parseFiatRecovery, recoveryTracksDeposit, type FiatRecovery} from './fiat-deposit-recovery';

const intent = {idempotencyKey: 'deposit-123', fiatAmount: '100.00', receiptEmail: 'a@example.com'};

describe('fiat deposit recovery metadata', () => {
  it('round trips an account and Privy-actor scoped active order without any client secret', () => {
    const record: FiatRecovery = {version: 1, ownerKey: 'user-1', privyUserID: 'did:privy:1', phase: 'active', intent, depositID: 'd-1', providerOrderID: 'p-1'};
    const parsed = parseFiatRecovery(JSON.stringify(record), 'user-1');
    expect(parsed).toEqual({corrupt: false, record});
    expect(JSON.stringify(parsed)).not.toContain('client_secret');
  });

  it('requires the exact owner, actor, intent for uncertain dispatch, and deposit id for active state', () => {
    expect(parseFiatRecovery(JSON.stringify({version: 1, ownerKey: 'user-1', privyUserID: 'did:1', phase: 'unknown', intent}), 'user-2').corrupt).toBe(true);
    expect(parseFiatRecovery(JSON.stringify({version: 1, ownerKey: 'user-1', privyUserID: 'did:1', phase: 'unknown'}), 'user-1').corrupt).toBe(true);
    expect(parseFiatRecovery(JSON.stringify({version: 1, ownerKey: 'user-1', privyUserID: 'did:1', phase: 'active'}), 'user-1').corrupt).toBe(true);
    expect(parseFiatRecovery('{broken', 'user-1').corrupt).toBe(true);
    expect(parseFiatRecovery(JSON.stringify({version: 1, ownerKey: 'user-1', privyUserID: 'did:1', phase: 'active', depositID: 7}), 'user-1').corrupt).toBe(true);
    expect(parseFiatRecovery(JSON.stringify({version: 1, ownerKey: 'user-1', privyUserID: 'did:1', phase: 'active', depositID: 'd-1', providerOrderID: {}}), 'user-1').corrupt).toBe(true);
    expect(parseFiatRecovery(JSON.stringify({version: 1, ownerKey: 'user-1', privyUserID: 7, phase: 'unknown', depositID: 'd-1'}), 'user-1').corrupt).toBe(true);
    expect(parseFiatRecovery(JSON.stringify({version: 1, ownerKey: 'user-1', privyUserID: 'did:1', phase: 'unknown', intent: {...intent, idempotencyKey: 7}}), 'user-1').corrupt).toBe(true);
    expect(parseFiatRecovery(JSON.stringify({version: 1, ownerKey: 'user-1', privyUserID: 'did:1', phase: 'unknown', intent: {...intent, receiptEmail: 7}}), 'user-1').corrupt).toBe(true);
    expect(parseFiatRecovery(JSON.stringify({version: 1, ownerKey: 'user-1', privyUserID: 'did:1', phase: 'unknown', depositID: 'd-1'}), 'user-1').corrupt).toBe(false);
  });

  it('clears recovery only for completed, failed, or refunded terminal states', () => {
    for (const status of [5, 6, 7]) expect(isFiatTerminal(status)).toBe(true);
    for (const status of [1, 2, 3, 4, 9]) expect(isFiatTerminal(status)).toBe(false);
  });

  it('never treats an unrelated history record as the unresolved recovery target', () => {
    const unresolved: FiatRecovery = {version: 1, ownerKey: 'user-1', privyUserID: 'did:1', phase: 'unknown', intent};
    expect(recoveryTracksDeposit(unresolved, 'old-terminal-order')).toBe(false);
    expect(recoveryTracksDeposit({...unresolved, phase: 'active', depositID: 'd-1'}, 'd-1')).toBe(true);
  });
});
