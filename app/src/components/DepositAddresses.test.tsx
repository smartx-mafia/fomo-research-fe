import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import {DepositAddresses} from './DepositAddresses';

describe('DepositAddresses', () => {
  it('renders the local EVM sweep warning without relying on API copy', () => {
    const html = renderToStaticMarkup(
      <DepositAddresses
        addresses={[
          {chain: 'solana', address: 'SoL', address_format: 'base58', accepted_tokens: []},
          {chain: 'base', address: '0xWallet', address_format: 'evm', accepted_tokens: [], min_sweep_amount: '1000'},
          {chain: 'bsc', address: '0xWallet', address_format: 'evm', accepted_tokens: [], min_sweep_amount: '2000'},
        ]}
        loading={false}
        solanaMonitor={{state: 'idle', attempts: 0}}
        canMonitorSolana={false}
        onStartSolanaMonitor={() => undefined}
        onStopSolanaMonitor={() => undefined}
      />,
    );

    expect(html.match(/EVM balances can be swept to Solana USDC/g)).toHaveLength(1);
    expect(html).not.toContain('仅向此 Privy 钱包');
  });
});
