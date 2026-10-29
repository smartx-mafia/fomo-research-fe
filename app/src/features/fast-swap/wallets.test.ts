import {describe, expect, it} from 'vitest';

import {fastSwapWallets, walletForChain} from './wallets';

describe('fast swap Privy wallet selection', () => {
  it('uses embedded wallet ids and the smallest explicit wallet index', () => {
    const wallets = fastSwapWallets([
      {type: 'wallet', walletClientType: 'metamask', chainType: 'ethereum', id: 'external', address: '0xExternal', walletIndex: 0},
      {type: 'wallet', walletClientType: 'privy', chainType: 'ethereum', id: 'w-2', address: '0x2', walletIndex: 2},
      {type: 'wallet', walletClientType: 'privy', chainType: 'ethereum', id: 'w-0', address: '0x0', walletIndex: 0},
      {type: 'wallet', walletClientType: 'privy', chainType: 'solana', id: 'w-sol', address: 'So1', walletIndex: 0},
    ]);
    expect(walletForChain(wallets, 'eip155:8453')).toMatchObject({id: 'w-0', address: '0x0'});
    expect(walletForChain(wallets, 'solana:mainnet')).toMatchObject({id: 'w-sol', address: 'So1'});
    expect(wallets.some((wallet) => wallet.id === 'external')).toBe(false);
  });
});
