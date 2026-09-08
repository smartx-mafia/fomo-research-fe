import {describe, expect, it} from 'vitest';

import {embeddedWalletAddresses, signerHasAddress} from './privy-wallets';

describe('Privy embedded wallet address extraction', () => {
  it('keeps only Privy EVM/SVM wallets and sorts the server-primary index first', () => {
    const wallets = embeddedWalletAddresses([
      {type: 'wallet', walletClientType: 'metamask', chainType: 'ethereum', address: '0xexternal', walletIndex: 0},
      {type: 'wallet', walletClientType: 'privy', chainType: 'solana', address: 'SoLTwo', walletIndex: 2},
      {type: 'wallet', walletClientType: 'privy-v2', chainType: 'ethereum', address: '0xBBB', walletIndex: 1},
      {type: 'wallet', walletClientType: 'privy', chainType: 'ethereum', address: '0xAAA', walletIndex: 0},
      {type: 'email', address: 'person@example.com'},
    ]);
    expect(wallets).toEqual([
      {chainType: 'ethereum', address: '0xAAA', walletIndex: 0},
      {chainType: 'ethereum', address: '0xBBB', walletIndex: 1},
      {chainType: 'solana', address: 'SoLTwo', walletIndex: 2},
    ]);
  });

  it('deduplicates EVM case-insensitively while preserving Solana case sensitivity', () => {
    const wallets = embeddedWalletAddresses([
      {type: 'wallet', walletClientType: 'privy', chainType: 'ethereum', address: '0xAbC'},
      {type: 'wallet', walletClientType: 'privy', chainType: 'ethereum', address: '0xabc', walletIndex: 3},
      {type: 'wallet', walletClientType: 'privy', chainType: 'solana', address: 'AbC'},
      {type: 'wallet', walletClientType: 'privy', chainType: 'solana', address: 'abc'},
    ]);
    expect(wallets).toHaveLength(3);
    expect(wallets[0]).toEqual({chainType: 'ethereum', address: '0xabc', walletIndex: 3});
  });

  it('matches EVM signer addresses case-insensitively and SVM addresses exactly', () => {
    expect(signerHasAddress(['0xabc'], {chainType: 'ethereum', address: '0xAbC'})).toBe(true);
    expect(signerHasAddress(['abc'], {chainType: 'solana', address: 'AbC'})).toBe(false);
    expect(signerHasAddress(['AbC'], {chainType: 'solana', address: 'AbC'})).toBe(true);
  });
});
